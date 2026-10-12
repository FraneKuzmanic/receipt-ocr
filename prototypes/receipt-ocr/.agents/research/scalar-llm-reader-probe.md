# Scalar probe: an LLM as a parallel reader of scalar fields (receipts)

**Date:** 2026-10-12
**Question (product owner):** can an LLM be added as a third reader of the 14 scalar fields only,
running in parallel with the two Azure prebuilt models and merged by a fixed rule, for 1–3 s of
added latency?
**Handoff:** `.agents/specs/scalar-llm-reader-probe.md`. No `/plan-feature` plan: the product owner
asked for the probe to be run directly.
**Harness:** `scripts/bakeoff/` (`run-scalar-probe.ts`, `score-scalar-probe.ts`, `scalar-merge.ts`).
Records in `.bakeoff/scalar-probe/` (git-ignored).

This is a measurement beside the product. Nothing under `api/`, `client/` or `shared/` changed and
the application has no LLM. Adopting one needs an amendment to PRD §4.7, the PRD §8 excluded
dependencies and ROADMAP §5 rule 10.

## Written before the first paid call

Everything in this section was fixed before any probe call was made.

### The merge rule (`scalar-merge.ts`)

For each of the 14 scalars:

1. **QR-locked** (the QR code supplied it or agrees with it): production's value, always.
2. **Buyer name, address, OIB:** the LLM's value, including empty.
3. **Payment method, issue time:** the LLM's value when it has one, else production's.
4. **Every other scalar:** production's value when it has one, else the LLM's.
5. **A disagreement under rule 4** (both have a value, they differ under the harness comparator):
   production's is kept and the field is counted as one the review form would flag.

A value the normaliser inferred (a currency from the date) or could not read is not the LLM's
reading. Items, VAT rows, positions and confidences are production's. The rule is scored twice,
without and with Plan B's on-the-page test (`isGrounded`, against the LLM path's own OCR words);
with it, a value that is not on the page counts as the LLM having read nothing, never "empty".
Both are reported; **the rule without the test is the one the bar is read on first**, as the
handoff's table was.

### Configurations

Two text sources by two deployments, each given the document text only (production's reading is
not shown), the Plan B system prompt and field descriptions unchanged, the scalar schema
(`REPAIR_SCHEMA`), temperature 0.

| | `gpt-4.1` | `gpt-4.1-mini` |
| --- | --- | --- |
| `prebuilt-layout` (markdown) | `layout+gpt-4.1` | `layout+gpt-4.1-mini` |
| `prebuilt-read` (plain text) | `read+gpt-4.1` | `read+gpt-4.1-mini` |

`prebuilt-read` cannot return markdown, so `read` against `layout` changes the OCR model and the
text format together. The probe cannot separate the two.

### Runs

- **Run 1, the parallel run, 16 receipts.** For each receipt, production and both text calls
  start at the same moment, and each model call starts when its text arrives. Every record
  carries when it finished after that common start. This is the latency measurement and the
  production reading every merge is built on.
- **Runs 2 and 3: the model calls only**, on run 1's text. Document Intelligence returned the same
  values in all three Plan B runs (0 scored values differed), so paying for its calls twice more
  buys little. The run-to-run figure is therefore the model's on fixed text, not the whole path's.
- In run 1 a receipt is uploaded four times at once (production's two models, layout, read) where
  the feature would upload it three times. That can only make the measured latency worse.

16 receipts: Plan B's 15, given the same input files, and `amelie-receipt`
(`.agents/fixtures/receipts/amelie-receipt.jpg`, 2.4 MB, re-encoded in headless Chrome to the
1200x1600 JPEG the app would upload). Its scalar truth was drafted by the agent and is **not
verified**, so it is reported on its own line and is outside the totals and the bar.

### Decision bar

On the 15 receipts with verified scalars, a configuration passes when the merged result:

1. needs a critical correction on no more receipts than production, in every run;
2. breaks no correct production scalar, in every run;
3. has more scalars right than production, in every run;
4. differs on at most 2 scored values between its runs;
5. adds no more than 3 s to production at p90, in the parallel run.

Known before running: the simulation from Plan B's records puts `layout+gpt-4.1` at 3.0 s on
criterion 5 and its two unstable scalars at the limit of criterion 4. A pass or fail by that
margin is reported as on the edge, not as a result.

### Estimate

| | Calls | Cost |
| --- | --- | --- |
| Smoke: one receipt, run 1 only, never scored | 7 | about $0.04 |
| Run 1: production ($0.02), layout ($0.01), read ($0.0015), four model calls (about $0.011) a receipt | 16 × 7 | about $0.68 |
| Runs 2 and 3: four model calls a receipt | 2 × 16 × 4 | about $0.35 |
| **Total** | | **about $1.07** |

Spent on Plan B: $2.56. Cap $5, which only the product owner may raise. List prices, not checked
against the invoice: `gpt-4.1` $2.00 / $0.50 cached / $8.00 and `gpt-4.1-mini` $0.40 / $0.10 /
$1.60 per 1M tokens; `prebuilt-layout`, `-invoice` and `-receipt` $0.01 a page; `prebuilt-read`
$0.0015 a page.

## Results

Run on 2026-10-12, one sitting. 16 parallel receipt runs and 128 repeat model calls, none failed,
none throttled. Computed by `score-scalar-probe.ts`; nothing was changed after the scored runs.

### Accuracy, 15 receipts with verified scalars (209 scored)

| | LLM alone | Merged, rule | Merged, rule + on-the-page test | No critical correction (of 15) | Correct production values broken | Merged values differing between runs |
| --- | --- | --- | --- | --- | --- | --- |
| `production` | – | 183 | 183 | 13 | – | – |
| `layout+gpt-4.1` | 197 | **198** | 197 | 13 | 0 | 0 |
| `layout+gpt-4.1-mini` | 195 | **198** | 197 | 13 | 0 | 0 |
| `read+gpt-4.1` | 195–197 | **198** | 197 | 13 | 0 | 0 |
| `read+gpt-4.1-mini` | 192 | 196 | 195 | 13 | 0 | 0 |

Production reads 183, as in all three Plan B runs. The merged 198 is the figure the handoff's
free re-score predicted.

### What the merge did, per run

| | Filled | Replaced | Buyer cleared | Wrong made right | Right made wrong | Disagreements flagged | Flag on a wrong production value | Flag on a right one |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `layout+gpt-4.1` | 11–12 | 1 | 3 | 15 | 0 | 5–6 | 4–5 | 1 |
| `layout+gpt-4.1-mini` | 11 | 1 | 3 | 15 | 0 | 5–6 | 3–4 | 2 |
| `read+gpt-4.1` | 12 | 1 | 3 | 15 | 0 | 9–11 | 7 | 2–4 |
| `read+gpt-4.1-mini` | 12 | 1 | 3 | 13 | 0 | 10 | 6 | 4 |

The 15 corrections are the same in the first three rows: the payment method on five receipts
with an unlabelled tender line, the wrong buyer on `26515835` and the buyer OIB on `lira_trogir`
cleared, the buyer of `primjer1-hr-nopdv` filled, `lira_trogir`'s seller OIB, JIR and ZKI,
Konzum's currency, and a time printed without seconds. `read+gpt-4.1-mini` fills `lira_trogir`'s
JIR and ZKI swapped, in every run: two wrong values written into empty fields.

Production's own low-confidence flags: 14 remain on values the merge keeps, 10 of them on correct
values. The LLM read the same value on 8–9 of those 10, and on 0–2 of the 4 wrong ones.

### The two receipts production was not tuned on (scalars right, of 14)

| | Production | Merged | LLM alone |
| --- | --- | --- | --- |
| Konzum | 10 | 12 | 14 (13 for `read+gpt-4.1-mini`) |
| `amelie-receipt`, truth **not verified** | 12 | 12 | 14 |

On both, every value the merge leaves wrong is one where production has a wrong value, the LLM
has the right one, and rule 4 keeps production's with a flag: Konzum's kuna total and shop number,
Amélie's seller name and address with the venue's appended.

### Latency, the parallel run (16 receipts)

Production alone: 3.9 / 5.6 s (p50 / p90). Text ready: `layout` 2.6 / 3.8 s, `read` 1.3 / 2.7 s.

| | LLM path done | Added to production, p50 / p90 | Done before production | Within 1 s | Within 2 s | Within 3 s | Model call alone, all runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `layout+gpt-4.1` | 4.5 / 5.4 s | 0.0 / 3.0 s | 9/16 | 10/16 | 14/16 | 15/16 | 1.5 / 2.3 s |
| `layout+gpt-4.1-mini` | 4.6 / 5.5 s | 0.0 / 2.1 s | 7/16 | 12/16 | 14/16 | 16/16 | 1.9 / 2.4 s |
| `read+gpt-4.1` | 2.9 / 4.1 s | **0.0 / 0.0 s** | 15/16 | 15/16 | 16/16 | 16/16 | 1.5 / 1.8 s |
| `read+gpt-4.1-mini` | 3.7 / 4.5 s | 0.0 / 0.3 s | 12/16 | 15/16 | 16/16 | 16/16 | 2.0 / 2.5 s |

One `gpt-4.1` call in 192 stalled: on `22559270` the model finished generating in 1.9 s and the
service returned the response after 83.7 s. It is the one `layout+gpt-4.1` receipt outside 3 s,
and the p90 does not show it.

### Cost a receipt, on top of production's $0.0200

| | Text page | Model call, billed | Without caching |
| --- | --- | --- | --- |
| `layout+gpt-4.1` | $0.0100 | $0.0027 | $0.0046 |
| `layout+gpt-4.1-mini` | $0.0100 | $0.0005 | $0.0009 |
| `read+gpt-4.1` | $0.0015 | $0.0023 | $0.0041 |
| `read+gpt-4.1-mini` | $0.0015 | $0.0004 | $0.0008 |

### Decision bar

All four configurations pass all five criteria, with and without the on-the-page test.
`layout+gpt-4.1` passes criterion 5 at exactly 3.0 s, which is on the edge and not a result; the
other three pass it by 0.9 s or more. Criterion 4 was measured on fixed OCR text (see Limits).

## Answers to the probe's questions

1. **A scalar-only prompt reads scalars as well as the full one.** 197 alone on layout text
   against the Plan B `ocr` arm's 196–197, and the call is about half as long (1.5 s against
   2.7 s at the median).
2. **`gpt-4.1-mini` is not worth it.** It is no faster here (1.9–2.0 s against 1.5 s), reads 2–5
   fewer scalars alone, and on `read` text swaps a JIR and a ZKI. It saves about $0.002 a receipt.
3. **`prebuilt-read` holds accuracy under the merge rule (198) and is 1.3 s faster and $0.0085
   cheaper than layout.** Its text makes the LLM disagree with a correct production value more
   often (2–4 a run against 1), which matters only if disagreements are shown as flags.
4. **Run in parallel, `read+gpt-4.1` added nothing to production's time** on 15 of 16 receipts
   and 0.4 s on the other. A grace of 2 s after production would have kept every call.
5. **`amelie-receipt`:** production 12 of 14, the LLM 14 of 14, merged 12, on unverified truth.

## Recommendation

**Build it, as `prebuilt-read` + `gpt-4.1`, under the rule as written, without the on-the-page
test, and with a grace timeout after which the LLM's reading is dropped.**

- It passes the bar with room: 15 more scalars right of 209, none of production's correct values
  changed, the same answer in every run, no measurable added wait, about half a cent a receipt.
- The on-the-page test costs one correct value a run and bought nothing on these receipts.
- The grace timeout is not optional: one call in 192 took 84 s. It is the iteration 23 rule for
  the second model (additive, never load-bearing), applied to a third reader.

**What it does not do:** it does not raise the number of receipts needing no critical correction
(13 of 15 either way), because rule 4 keeps production's value on every critical field. On the two
untuned receipts the LLM alone read 28 of 28 scalars and production 22; the merge reaches 24. Two
receipts are too few to loosen rule 4 on, and on the 14 tuned ones production wins those
disagreements. The cheap next step is more unseen receipts, scored by this harness for free once
their truth is written, before deciding whether the LLM should win any critical field.

**Open for the implementation plan:** whether a rule-4 disagreement is shown as an amber flag
(on `read` text 7 of 9–11 land on a wrong value; on layout text 4–5 of 5–6), and whether LLM
agreement clears one of production's low-confidence flags (it would clear 8–9 of the 10 on correct
values, and 0–2 of the 4 on wrong ones).

**Precondition:** an amendment to PRD §4.7, the PRD §8 excluded dependencies and ROADMAP §5 rule 10.

## Limits

- 15 scored receipts, 14 of which production was tuned on and all of which the merge rule was
  chosen after seeing. 198 is an upper estimate.
- Run-to-run stability is the model's on run 1's text. A fresh OCR call each run was not paid for.
- Latency is 16 receipts in one sitting from a home connection, with four uploads at once where
  the feature would make three.
- `read` against `layout` changes the OCR model and the text format together.
- `amelie-receipt`'s truth is the agent's draft.
- A value the LLM supplies has no position, so the review screen cannot outline it unless it is
  located by text match; not measured here.
- Prices are list prices, not checked against the invoice.

## Spend

| | Calls | Cost |
| --- | --- | --- |
| Smoke, one receipt | 7 | $0.04 |
| Scored runs: 16 receipts in parallel, then two repeats of the model calls | 240 | $0.79 |
| **Probe** | 247 | **$0.83** |
| Plan B (iteration 27) | | $2.56 |
| **All, against the $5 cap** | | **$3.39** |

The estimate was $1.07; more of the input was billed as cached than assumed.
