# Plan B: an LLM pass and Content Understanding against the production engine (receipts)

**Date:** 2026-10-09
**Question (product owner):** iteration 26 fixed our own extraction layer and left a list of
defects rules could not fix. Do an LLM, in either of two shapes, or Azure AI Content Understanding
fix them, on the same receipts, without losing what production already reads well?
**Harness:** `scripts/bakeoff/` (see its `README.md`). Records in `.bakeoff/plan-b/` (git-ignored).
**Plan:** `.agents/plans/plan-b-llm-pass-content-understanding-measurement.md`.

This is a measurement beside the product. Nothing under `api/`, `client/` or `shared/` changed and
the application has no LLM. Adopting an engine is a later iteration and needs an amendment to PRD
§4.7.

## Written before the first paid call

Everything in this section was fixed before any Plan B call was made, and was not changed after.

### Decision bar

An arm is **worth adopting** when, against `production` in the same runs:

1. more receipts need no critical correction, **or** the same number and more scalar fields are
   right, in its **worst** run (evaluated as: in every run);
2. it loses no item cell and no VAT cell (for `repair` this holds by construction);
3. on the small photos (under 500 px wide) it returns **no ungrounded wrong value** — a non-null
   scalar that is wrong and is not found among that receipt's OCR words;
4. scored values that differ between its three runs are at most 2.

A difference of one or two values between arms is noise (iteration 25, the payslip bake-off) and is
reported as "no difference". Latency p50/p90 and cost per receipt are reported per arm beside the
verdict, not folded into it. `score-plan-b.ts` computes the table; it is not written by hand.

### The arms

| Arm | What it is |
| --- | --- |
| `production` | The iteration 26 engine, **called live** through the product's own provider (`createAzureProvider().extract`): `prebuilt-invoice` and `prebuilt-receipt` merged, the Croatian rules, the QR code's JIR |
| `ocr` | `prebuilt-layout` markdown → `gpt-4.1` → every field. Iteration 25's best arm, on schema v2 |
| `repair` | `gpt-4.1` is given production's OCR text and production's 14 scalar values, and returns the 14 scalars as printed. A merge policy then decides what changes. Items, VAT rows, positions and confidences stay production's |
| `cu` | One Content Understanding custom analyzer (`receipt_planb_v2`, API `2025-11-01`, base `prebuilt-document`, completion model `gpt-4.1`) built from the same field schema |

One model (`gpt-4.1`, chat completions, temperature 0, strict JSON schema), one field schema
(`scripts/bakeoff/field-schema.ts`, schema v2: `subtotal` removed, no description reworded), one
set of rules. Every arm is given **the file the app would upload**: a photo above 2 MP or 1.5 MB is
re-encoded as a 1,600 px JPEG at quality 82, as `client/src/capture/downscale.ts` does.

### The repair policies

The scorer applies all three to the same recorded calls.

- A field is **locked** when production took it from the QR code, or the QR code agrees with it
  (`qrCorroboratedFields`: issue date, issue time, total, JIR). No policy changes a locked field.
- A model value is **eligible** only when it normalises to a value **and is on the page**: found
  among production's OCR words, as the model copied it or in a printed form of its canonical value.
  A value that is not on the page is never merged; it is counted.
- A null from the model never blanks a production value, in any policy.

| Policy | What the model may do |
| --- | --- |
| `fill` | fill a field production left empty |
| `weak` | `fill`, and replace production's value on `sellerName`, `sellerAddress`, `buyerName`, `buyerAddress`, `buyerOib`, `paymentMethod` |
| `all` | `fill`, and replace production's value on every scalar that is not locked |

Because no policy lets the model blank a value, the wrong buyer production reads on `26515835`
cannot be fixed by any of them. That is a known limit, not a fourth policy to add after the results.

### Scoring

Ground truth: the 16 files in `.agents/fixtures/expected/`, whose scalars the product owner
verified on 2026-10-09, plus line items from `scripts/bakeoff/ground-truth/`. **Line items and VAT
rows are not verified**; scalar scores are final and table scores are labelled.

One comparator for every arm, production included (`scripts/bakeoff/compare.ts`): amounts
numerically; dates, times, OIBs and currency exactly; JIR and ZKI ignoring case; payment method by
its category; names and addresses ignoring case, spacing and punctuation **but not diacritics**.
This is more lenient than `npm run score:extraction` (which compares most fields exactly), so
production's numbers here are not the README's.

15 receipts: iteration 25's 14, and `0f089468f365211452db4ccf6e8da466` (Konzum), which has
verified scalars and no recorded fixture. It is the only receipt the production rules were not
written against, and it is reported on its own line as well as in the totals.

### Estimate

| | Per run of 15 receipts | Probe (3 receipts) |
| --- | --- | --- |
| `production` (2 models × $0.01 a page) | $0.30 | $0.06 |
| `ocr` (layout page + model) | about $0.22 | about $0.04 |
| `repair` (model call only; production is counted above) | about $0.08 | about $0.02 |
| `cu` (pages, contextualization, model tokens; up to 10% for abandoned submits) | about $0.30–0.50 | about $0.08 |
| **Total** | **about $1.00** | **about $0.20** |

Three runs and a probe: **about $3.3**, against a cap of **$5**, which only the product owner may
raise. The runner stops before a run that would pass it.

## Changed after the probe, before the scored runs

The probe (three receipts, never scored) was read value by value. Four things were changed
because of it; the field schema, the decision bar and the three policies were not.

- **Inputs are made in a real browser.** `inputs.ts` first downscaled in Node. Production then
  read `gradanin-gotovina-pos` with a seller name and address it does not return in the app. The
  same rule run in headless Chrome gives a different file for the largest photo (`lira_trogir`:
  370 KB against Node's 414 KB), and on Chrome's files production's `gradanin` reading was right
  again. The scored runs use Chrome's files (`scripts/bakeoff/browser-downscale.mjs`). Four of the
  thirteen images are downscaled: `26515835`, `gradanin-gotovina-pos`, `lira_trogir`,
  `receiptWithTaxMistake`.
- **An OIB that fails its check digit is kept as printed** by the normaliser. It was dropped, while
  the verified truth for `primjer-pdf-racuna` and `primjer1-hr-nopdv` holds the printed number.
- **A JIR copied without its hyphens is written with them.** The model returned
  `lira_trogir`'s JIR as 32 characters; it is the same identifier.
- **A value OCR returns glued to its label is found on the page.** `JIR:0000…` arrives as one
  word; the search now splits a word at its colons. Also, a value equal to production's, or a
  currency the normaliser inferred from the date, is no longer counted as a rejected model value.

## Results

Three runs of 15 receipts, interleaved, in one sitting (2026-10-09). 180 calls, none failed, none
throttled, no Content Understanding submit stalled. Ranges are over the three runs. Scalars are
14 fields a receipt; 209 are scored.

| | `production` | `ocr` | `repair:fill` | `repair:weak` | `repair:all` | `cu` |
| --- | --- | --- | --- | --- | --- | --- |
| Scalar fields (of 209) | 183 | 196–197 | 190–191 | 191–192 | 191–192 | **199–200** |
| Critical (of 75) | 71 | 72 | 71–72 | 71–72 | 71–72 | 72 |
| Fiscal: seller OIB, JIR, ZKI (of 44) | 37 | 38 | 40 | 40 | 39 | **41** |
| Party: seller address, buyer (of 60) | 51 | 56–57 | 51 | 52 | 52 | 56–57 |
| Time, payment method (of 30) | 24 | **30** | 28 | 28 | 29 | **30** |
| VAT cells (of 33, unverified) | 33 | 33 | 33 | 33 | 33 | 32 |
| Item cells (of 187, unverified) | **168** | 150–168 | **168** | **168** | **168** | 142–143 |
| Item row count exact (of 14, unverified) | 13 | 12–13 | 13 | 13 | 13 | 11 |
| Receipts needing no critical correction (of 15) | **13** | 12 | **13** | **13** | **13** | 12 |
| Scored values that differ between runs | 0 | 20 | 2 | 3 | 3 | 6 |
| Wrong and on the page | 13 | 9–10 | 15–16 | 14–15 | 14–15 | 8–9 |
| Wrong and not on the page | 2 | 0–2 | 1 | 1 | 1 | 0 |
| Missing | 11 | 2 | 1–2 | 1–2 | 1–2 | 1 |
| Latency p50 / p90, end to end | 3.4 / 5.1 s | 7.2 / 9.9 s | 6.1 / 8.1 s | same | same | 6.4 / 8.4 s |
| Cost a receipt, as billed | $0.0200 | $0.0141 | $0.0226 | same | same | $0.0139 |
| Cost a receipt, without caching | $0.0200 | $0.0168 | $0.0247 | same | same | $0.0220 |

`repair` latency and cost include the production call it follows. Its model call alone has a
median of 1,714 input and 145 output tokens.

### By group

| | `production` | `ocr` | `repair:fill` | `repair:weak` | `repair:all` | `cu` |
| --- | --- | --- | --- | --- | --- | --- |
| 2 PDFs: scalars (of 28) | 26 | 28 | 26 | 26 | 26 | 28 |
| 13 images: scalars (of 181) | 157 | 168–169 | 164–165 | 165–166 | 165–166 | 171–172 |
| 13 images: item cells (of 179) | 161 | 143–161 | 161 | 161 | 161 | 135–136 |
| 5 small images: scalars (of 69) | 60 | 58–59 | **62** | **62** | **62** | 61–62 |
| 5 small images: critical (of 25) | **24** | 22 | **24** | **24** | **24** | 22 |
| 5 small images: no critical correction (of 5) | **4** | 2 | **4** | **4** | **4** | 2 |
| 5 small images: item cells (of 99) | **96** | 85–95 | **96** | **96** | **96** | 78–79 |
| 5 small images: wrong and not on the page | 1 | 0–2 | 0 | 0 | 0 | 0 |
| Konzum, not tuned on: scalars (of 14) | 10 | **14** | 11–12 | 11–12 | 11–12 | **14** |
| Konzum: critical (of 5) | 2 | **5** | 2–3 | 2–3 | 2–3 | **5** |

### Per field, each column's worst run

| Field | `production` | `ocr` | `repair:fill` | `repair:weak` | `repair:all` | `cu` |
| --- | --- | --- | --- | --- | --- | --- |
| sellerName (of 15) | 14 | 14 | 14 | 14 | 14 | 13 |
| documentNumber | 14 | 14 | 14 | 14 | 14 | 14 |
| issueDate | 15 | 15 | 15 | 15 | 15 | 15 |
| total | 14 | 15 | 14 | 14 | 14 | 15 |
| currency | 14 | 14 | 14 | 14 | 14 | 15 |
| sellerOib | 14 | 14 | 15 | 15 | 14 | 15 |
| jir | 12 | 12 | 13 | 13 | 13 | 14 |
| zki (of 14) | 11 | 12 | 12 | 12 | 12 | 12 |
| issueTime | 14 | 15 | 14 | 14 | 15 | 15 |
| paymentMethod | 10 | 15 | 14 | 14 | 14 | 15 |
| sellerAddress | 11 | 11 | 11 | 12 | 12 | 11 |
| buyerName | 13 | 15 | 14 | 14 | 14 | 15 |
| buyerAddress | 13 | 15 | 13 | 13 | 13 | 15 |
| buyerOib | 14 | 15 | 13 | 13 | 13 | 15 |
| items.description (of 44) | 35 | 34 | 35 | 35 | 35 | 27 |
| items.quantity (of 47) | 44 | 42 | 44 | 44 | 44 | 41 |
| items.unitPrice (of 47) | 43 | 30 | 43 | 43 | 43 | 36 |
| items.total (of 49) | 46 | 44 | 46 | 46 | 46 | 38 |

### What each repair policy did (per run)

| | `fill` | `weak` | `all` |
| --- | --- | --- | --- |
| Empty fields filled | 10–11 | 10–11 | 10–11 |
| Values replaced | 0 | 1–2 | 5–6 |
| Of those: wrong made right | 8–9 | 9–10 | 10–11 |
| Of those: right made wrong | 1 | 1 | 2 |
| Of those: no difference to the score | 0–1 | 0–2 | 2–4 |
| Model values not on the page, rejected | 2 | 2 | 2 |

### Content Understanding: confidence and position (per run)

151 scalars returned, all 151 with a position. Of the scored ones below confidence 0.5, 7–10 were
right and 3–4 wrong; at 0.5 or above, 132–134 were right and 4–6 wrong.

## Decision bar

Computed by `score-plan-b.ts`, against `production` in the same run.

| | 1. More receipts with no critical correction, or as many and more scalars, in every run | 2. Loses no item or VAT cell | 3. Small photos: no wrong value that is not on the page | 4. At most 2 values differ between runs | Worth adopting |
| --- | --- | --- | --- | --- | --- |
| `ocr` | FAIL (−1 receipt, +13 to +14 scalars) | FAIL (−18 to 0 item cells) | FAIL (2 over three runs) | FAIL (20) | no |
| `repair:fill` | pass (0 receipts, +7 to +8 scalars) | pass | pass (0) | pass (2) | **yes** |
| `repair:weak` | pass (0 receipts, +8 to +9 scalars) | pass | pass (0) | FAIL (3) | no |
| `repair:all` | pass (0 receipts, +8 to +9 scalars) | pass | pass (0) | FAIL (3) | no |
| `cu` | FAIL (−1 receipt, +16 to +17 scalars) | FAIL (−26 to −25 item cells, −1 VAT cell) | pass (0) | FAIL (6) | no |

## Recommendation

**If an LLM goes into the product, it should go in as a fill-only pass on top of the current
engine.** It is the one shape that passes the bar: 7–8 more scalar fields right out of 209, none
of production's items, VAT rows, outlines or flags lost, no invented value on a small photo, and
almost the same answer every run. It adds about 2.7 s at the median and about $0.003 a receipt.

What it buys is narrow. Nearly all of the gain is fields production left empty: the payment
method on receipts whose tender line has no label (10 of 15 becomes 14), and the seller OIB, JIR
and ZKI on `lira_trogir`, whose labels are cropped. It does not raise the number of receipts that
need no critical correction (13 of 15 either way), and it cannot correct a value production got
wrong.

**`weak` and `all` are not better enough to justify letting the model overrule production.** They
add one scalar over `fill` and fail the stability criterion by one value. `all` also made a
correct seller OIB wrong on `ina-racun-sladoled` (the model's OCR text reads `…50625` for
`…60625`).

**The standalone LLM and Content Understanding read the scalars best and are not adoptable as
they stand.** Each has 13–17 more scalars right than production, and both read all five critical
fields on the one receipt production was not tuned on, where production reads two. But each needs
a critical correction on one more receipt than production (12 of 15), both do worse on the small
photos (2 of 5 with no critical correction against production's 4), and both lose line items:
Content Understanding 25–26 cells of 187, the standalone LLM up to 18, with 20 values changing
between identical runs. Neither has the QR code's JIR, which is why both get `receipt123`'s JIR
wrong and production does not.

Content Understanding is the more interesting of the two for a later look: the most scalars, a
position and a confidence on every value, 6 values differing between runs against the LLM's 20,
and the lowest billed cost. Its weakness here is item rows (row numbers kept in descriptions,
rows misaligned on `22559270`), which is where a field description could be tried.

Adopting any of this needs an amendment to PRD §4.7 and ROADMAP §5 rule 10. This iteration
changes nothing in the product.

## Which Plan A leftovers each arm fixed

| Leftover (iteration 26) | `ocr` | `repair` | `cu` |
| --- | --- | --- | --- |
| Unlabelled tender line: `26515835`, `images`, `ina-racun-sladoled`, `screenshot-…` | all four | three; `screenshot-…` rejected (see Limits) | all four |
| Wrong buyer on `26515835` | fixed | not fixable by any policy | fixed |
| Missing buyer on `primjer1-hr-nopdv` | fixed | name filled; address `Street 1` only, or rejected | fixed |
| Cropped-label JIR and ZKI on `lira_trogir` | fixed | fixed | fixed |
| `receipt123` seller name | no (`fte bars`) | no | no (`GEMAGDGIJA d,0.0.`) |
| `primjer1-hr-nopdv` zero-rate VAT row | no | production's | no |

On the Konzum receipt production returns the kuna amount as the total (`100.98` for `13.40`), no
currency, no payment method, and the shop number `1232,` as the document number. `ocr` and `cu`
return all 14 scalars correctly. `repair` fills the currency (two runs of three) and the payment
method, and cannot correct the total or remove the document number.

## Iteration 25's runs, re-scored on verified truth

For context only: full-resolution inputs, the schema that still asked for `subtotal`, production
replayed from fixtures, 14 receipts. Scalars of 195, with the party group now scored.

| | `di` (replayed) | `ocr` | `images` | `crops` |
| --- | --- | --- | --- | --- |
| Scalars (of 195) | 170 | 181–182 | 159–161 | 175–176 |
| Critical (of 70) | 67 | 68 | 60–61 | 66 |
| Item cells (of 175, unverified) | 165 | 158 | 138–144 | 157–158 |
| No critical correction (of 14) | 12 | 12 | 8–9 | 12 |

The order of the arms is the one iteration 25 reported.

## Limits

- 15 receipts, one model, three runs, one sitting. A difference of one or two values is not a
  result; `weak` and `all` fail criterion 4 by exactly one value.
- **Production was tuned on 14 of the 15 receipts** (iterations 18, 21, 23, 24, 26); the other arms
  saw them cold. On the one it was not tuned on it reads 10 of 14 scalars and they read 14.
- **Line items and VAT rows are not verified.** Criterion 2 rests on them. The Konzum receipt
  prints every item in kuna and in euros; its truth is the euro line, which is the agent's choice,
  and every engine is scored wrong on most of its item cells.
- **The grounding test rejected two correct values in every run.** `NOVCANICE`, printed as
  `(NOVcANICE)`, is not found because the brackets are part of the OCR word; `Street 1 London, UK`
  is not found because the two lines are not consecutive words. It was left as it was: changing it
  after the results would be tuning the policies. A looser test would let `fill` fix one more
  payment method and one buyer address.
- **`fill` made one field wrong in every run**: on `primjer-pdf-racuna` the model returns the
  seller's OIB as the buyer's, the number is on the page, and the buyer OIB was empty. This shows
  only because an OIB failing its check digit is now kept (see the probe changes).
- The downscaled inputs were made in headless Chrome on this machine, not captured from the app.
  Production still reads `lira_trogir` without its seller OIB here, which iteration 26's browser
  run did read.
- The standalone and Content Understanding arms have no QR code. Content Understanding returns
  barcodes; using them was not tried.
- A standalone LLM returns no position and no confidence, so it could not draw the review
  screen's outlines. A repair value is located by text match. Content Understanding returns its
  own position and confidence for every value.
- `repair` was measured sequentially after production. Its latency is production's plus the
  model call; nothing was run to shorten it.
- Prices are list prices: gpt-4.1 $2.00 / $0.50 cached / $8.00 per 1M tokens; the three Document
  Intelligence models at $0.01 a page each (not checked); Content Understanding $0.005 a page and
  $1.00 per 1M contextualization tokens. Half or more of each LLM arm's input was billed as cached.
- The comparator is more lenient than `npm run score:extraction`, so production's 13 of 15 here
  and the README's 13 of 16 are different measurements.

## What was changed after seeing results

Nothing. The comparator, normaliser, ground truth, schema and policies are as they were when the
scored runs started. The probe changes are listed above.

## Spend

| | Calls | Cost |
| --- | --- | --- |
| Probe on Node-downscaled inputs (two receipts' records deleted after reading) | 8 | about $0.12 |
| Probe, as recorded | 12 | $0.16 |
| Three runs | 180 | $2.28 |
| **All** | 200 | **about $2.56** |

Against a cap of $5. The recorded figures are `run-plan-b.ts --summary`'s ($2.44); the deleted
probe records are counted by hand from the first probe's summary ($0.17 recorded before the
deletion, $0.05 after).
