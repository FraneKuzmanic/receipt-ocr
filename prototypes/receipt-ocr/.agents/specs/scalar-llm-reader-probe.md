# Handoff — Iteration 28: probe an LLM as a parallel reader of scalar fields

**Written:** 2026-10-12, by the session that primed on iteration 27 and discussed it with the product owner.
**For:** a fresh agent. Run `/prime`, read this file, then `/plan-feature` from it.
**Kind of work:** a measurement beside the product, like iterations 25 and 27. Nothing under `api/`,
`client/` or `shared/` changes in this iteration. Building the feature is the iteration after, and
only if this probe supports it.

## The question

The production engine reads VAT rows and line items well and is weakest on scalar fields. Plan B
(iteration 27, `.agents/research/plan-b-engines.md`) showed an LLM reads scalars better. Can an LLM
be added as a **third reader of scalars only**, running **in parallel** with the two Azure prebuilt
models, merged by a **fixed rule**, for a latency cost the product owner accepts?

## Settled with the product owner — do not relitigate

1. **Items and VAT rows stay production's.** The LLM never touches them.
2. **Latency budget: 1–3 s added is acceptable.** They like the current speed; less is better.
3. **No visible post-processing.** Everything is merged on the server before the receipt reaches
   `review`. Once the form is shown, nothing changes except what the user edits. A progressive
   "fields fill in later" design is rejected.
4. **The LLM may clear the buyer block** (name, address, OIB) when it sees no buyer. This narrows
   the iteration 23 rule "a second reader never blanks a value" for those three fields only.
5. **A paid probe of about $1 is approved.** Plan B's cap is $5 and $2.56 is spent
   (`run-plan-b.ts --summary` shows $2.44; two deleted probe records account for the rest). Stay
   under the $5 cap in total. Show the estimate and get a go-ahead before the first paid call, as
   iterations 25 and 27 did; the product owner runs on limited Azure credit.
6. **Adopting an LLM needs an amendment** to PRD §4.7, the PRD §8 excluded-dependencies list and
   ROADMAP §5 rule 10. Not in this iteration; record it as the precondition for the next.

## What is already known (free re-score of the recorded Plan B runs, 2026-10-12)

15 receipts, 3 runs, 209 scored scalars. The LLM here is the `ocr` arm's scalars: `gpt-4.1` on
`prebuilt-layout` markdown, not shown production's answer. Items and VAT are production's in every
row. Comparator and ground truth are the harness's (`compare.ts`, `truth.ts`).

| Merge rule | Scalars right (of 209) | No critical correction (of 15) | Correct production values broken |
| --- | --- | --- | --- |
| Production | 183 | 13 | — |
| Fill empty fields only | 194 | 13 | none |
| Product owner's first idea: production low-confidence (<0.7) or empty → LLM, LLM cannot blank | 194 | 13 | none |
| Same, LLM may blank a low-confidence value | 197 | 12 | `images` documentNumber |
| Fixed field list (below), no blanking | 195 | 13 | none |
| **Fixed field list + LLM may clear the buyer block** | **198** | **13** | **none** |
| LLM wins everywhere except QR-locked | 195–196 | 13 | `22559270` sellerAddress, `ina-racun-sladoled` sellerOib |

Disagreements between production and the LLM, counted over the three runs:

- Production **empty**, LLM has a value: 33, LLM right 33.
- Production **low confidence**: 22, LLM right 12, production right 3, neither 7. Every LLM win is
  a deletion (wrong buyer on `26515835`, buyer OIB on `lira_trogir`, Konzum's shop number read as
  a document number). Production's win is `images` documentNumber, which the LLM returns empty.
- Production **high confidence**: 13, LLM right 9 (Konzum total, `images` issueTime, `lira_trogir`
  sellerAddress), production right 4 (`22559270` sellerAddress, `ina-racun-sladoled` sellerOib).
- **QR-locked** or no-confidence (text/inferred): 6, production right 6.

So production's confidence does not say who is right in a disagreement, which is why the candidate
rule is a field list and not a confidence gate. All of this is in-sample on 15 receipts, 14 of
which production was tuned on; treat 198 as an upper estimate.

Of the `ocr` arm's 20 values that differed between identical runs, 18 were item cells and 2 were
scalars (both `sellerAddress`).

The script that produced these numbers was a throwaway and was deleted. Rebuild its merge as a
real harness module with a `.check.ts`, like `repair.ts`.

### The candidate merge rule (fix it in the plan before any paid call)

For each of the 14 scalars:

1. **QR-locked** (`lockedFields` in `repair.ts`): production's value, always.
2. **Buyer name, address, OIB:** the LLM's value, including empty.
3. **Payment method, issue time:** the LLM's value when it has one, else production's.
4. **Every other scalar:** production's value when it has one, else the LLM's.
5. **Disagreement on a field under rule 4** (both have a value, they differ): keep production's
   and count it as "would be flagged amber". Report how many such flags land on a value that is
   actually wrong versus right. Also report how many of production's current low-confidence flags
   on correct values an LLM agreement would clear.

Unlike `repair`, no grounding test is applied in the table above. Score the rule both with and
without `isGrounded` and report the difference; do not pick after seeing which is better without
saying so.

### Latency, from the same records

| | p50 / p90 |
| --- | --- |
| Production | 3.4 / 5.1 s |
| `prebuilt-layout` call alone | 2.3 / 3.4 s |
| Scalar-only model call alone (`repair`'s, ~1,700 tokens in, ~145 out, `gpt-4.1`) | 2.7 / 3.4 s |
| LLM after production (measured) | 6.1 / 8.1 s |
| Parallel, simulated as max(production, layout + model call) | 5.1 / 6.1 s (adds 1.4 / 3.0 s) |

The model call is almost all output time (about 12 ms a token). The client polls every 2 s, so
production's 3.4 s is seen as about 4 s; a 1 s poll interval is a separate, free improvement to
note, not to build here.

## What the probe must answer

1. **Does a scalar-only prompt read scalars as well** as the `ocr` arm did when it was also asked
   for items? Same system prompt and field descriptions, scalar schema only (`REPAIR_SCHEMA` is
   that schema), the document text only — production's reading is **not** shown to the model.
2. **`gpt-4.1-mini` against `gpt-4.1`:** accuracy under the merge rule, run-to-run stability,
   latency, cost.
3. **`prebuilt-read` against `prebuilt-layout`** as the text source: latency and whether accuracy
   holds.
4. **Real parallel latency.** Run production and (OCR → model) concurrently for the same receipt
   and record the end-to-end time and how long the LLM path trailed production. Latencies from
   different sittings are not comparable (`scripts/bakeoff/README.md`), so this needs fresh
   production calls in the same sitting. Report what share of receipts the LLM path finishes within
   0, 1, 2 and 3 s of production: that is the data for choosing a grace timeout.
5. **A second unseen receipt, `amelie-receipt`.** The source is
   `.agents/fixtures/receipts/amelie-receipt.jpg`. It has no ground truth and no fixture. Draft its
   scalar truth, have the product owner verify it, and only then score it. Report it on its own
   line next to Konzum (`0f089468f365211452db4ccf6e8da466`).

Write the decision bar into the research file before the first paid call. Suggested, to be
confirmed in the plan: the merged result must, in every run, need a critical correction on no more
receipts than production, break no correct production scalar, have more scalars right, differ by
at most 2 scored values between runs, and add no more than 3 s at p90.

## Facts checked this session

- **`gpt-4.1-mini` is deployed** on the same Azure OpenAI resource: same `AZURE_OPENAI_ENDPOINT`
  and `AZURE_OPENAI_KEY` already in this project's `.env`, deployment name `gpt-4.1-mini`
  (answers as `gpt-4.1-mini-2025-04-14`, API version `2024-10-21`). No branch switch or new
  credential is needed. `gpt-4.1-nano` is **not** deployed (404).
- `model-input.ts` reads the deployment from `AZURE_OPENAI_DEPLOYMENT`; the probe needs the
  deployment as a parameter and recorded per call.
- Prices to confirm before estimating: `gpt-4.1` $2.00 / $0.50 cached / $8.00 per 1M tokens;
  `gpt-4.1-mini` believed $0.40 / $0.10 / $1.60; `prebuilt-read` believed $0.0015 a page against
  $0.01 for layout and for each prebuilt model. Fresh production calls cost $0.02 a receipt, which
  is the largest line in the latency run; size the reps to fit the approved amount.
- Inputs must be the files the app would upload: `inputs.ts`, with the Chrome-downscaled files in
  `.bakeoff/plan-b/inputs/`. `amelie-receipt` needs the same treatment if the rule changes it
  (`browser-downscale.mjs`).

## State of the repository

- **Iteration 27 is uncommitted and awaiting the product owner's review.** Its `scripts/bakeoff/`
  changes are in the working tree. Build on them; do not revert or reformat them. Ask whether 27
  should be committed first or whether 28 lands on top in a separate commit.
- `.agents/` is git-ignored at the monorepo root. This file, the plan, the history and the research
  file need `git add -f`.
- Follow the precedent of iterations 25 and 27: harness under `scripts/bakeoff/`, records under
  `.bakeoff/` (git-ignored, holds receipt contents), a `--confirm-spend` guard and a cap, a
  research file `.agents/research/<name>.md`, a history file numbered 28, one ROADMAP row.
  `/validate` is not extended for harness-only work.
- Standing reds that are not this iteration's to fix: `/validate` 6.9 on
  `client/src/review/pdfDocument.ts`, two lint errors in `client/src/capture/downscale.ts`,
  repository-wide `format:check` on CRLF files.

## Out of scope

- Any change to `api/`, `client/`, `shared/`, the PRD or the deployed app.
- Vision input to the model (iteration 25 measured it clearly worse).
- Content Understanding, the `repair` arm's policies, item or VAT extraction.
- Changing the poll interval.
