# Iteration 26 — Extraction layer fixes and receipt schema v2 ("Plan A")

**Date:** 2026-10-09
**Plan:** `.agents/plans/extraction-layer-fixes-receipt-schema-v2.md`
**Commit:** _pending human review_
**Status:** implemented and validated. The product owner verified the scalar ground truth on
2026-10-09 and Task 20 was completed the same day; one addition beyond the plan followed from that
review (warnings recomputed on read, see Deviations).

## Post-completion review (2026-10-09, separate session)

A two-axis review (standards and spec, two sub-agents) ran on the uncommitted work, and one browser
upload of `22559270` confirmed the fresh-extraction behaviour. Changes made before commit:

- **Payment method went back to free text, at the product owner's direction.** The category enum,
  the select, its locale keys, `shared/src/payment-method.ts`, `client/src/i18n/paymentMethods.test.ts`
  and the stored-row payment conversion are gone. Extraction stores the printed wording, and only
  when it names a payment method (provider field first, then the labelled text). The scoring
  harness compares the stored wording's category with the ground truth's, so the verified
  expected files are unchanged and the score is unchanged (12/16). **Wherever this file says
  payment method is a category, a select or `cash`, read it as the printed wording in a text box.**
  Schema v2 is now only the removal of `subtotal`.
- **A valid OIB printed with its `HR` prefix no longer raises `oib_checksum_invalid`.**
- **The abbreviated label `Nač. plać.` is read with its diacritics**, not only as `Nac. plac.`.
- Five stale doc statements corrected (`schemaVersion: 1` twice and the old VAT rule in
  `/validate`, one README sentence, one line below).

Validation after these changes: typecheck pass; `npm test` 53 files, 606 tests pass;
`score:extraction` unchanged; Prettier clean on changed files. Not re-run: build, hosted
integration, browser.

Review findings left open: no VAT outline when every tax row is dropped and the amount falls back to
the total-tax field; a foreign VAT id on the buyer gets the OIB check-digit warning; a non-fiscal QR
holding a bare UUID would replace a printed JIR unflagged; Add buyer drops keyboard focus; the
`original_extraction` conversion has no unit test; recompute-on-read is still unverified in a
browser (a write to the hosted row was blocked by the permission system).

## Why this iteration exists

The product owner ran all 14 sample receipts through the deployed app on 2026-10-09 and found a
problem on almost every one. Traced against the stored results, most were defects in our own layer
rather than in the Azure models: correct values flagged as doubtful, false VAT warnings, values
present in the OCR text that no rule read, and a `subtotal` field with no stable meaning. This is the
baseline Plan B (an LLM pass, Content Understanding) will be measured against.

## What was built

1. **Receipt schema v2.** `subtotal` is removed from the canonical schema, the mapper, the review
   form, source regions and both exports. `paymentMethod` is one of five category codes. JSON export
   is `schemaVersion: 2`; the CSV has twenty columns.
2. **Stored rows convert when read.** `fromStoredFields` drops a stored `subtotal` and categorises a
   stored free-text payment method for both `canonical_data` and `original_extraction`. No migration.
3. **Payment method** is categorised from the provider's field, with a labelled text fallback
   (`Način plaćanja …`) when that field is absent or names no method.
4. **VAT rows.** A consumption-tax (PNP) row and an all-empty tax row are dropped; highlighting
   indexes through the same filtered list. The warning now checks each row against its own base and
   rate (`vatRowConsistent`, tolerance 0.01) and never against the total.
5. **OIB.** A labelled OIB that fails its check digit is shown when no valid one exists, with the new
   `oib_checksum_invalid` warning (seller and buyer). A valid model-read OIB marks a receipt Croatian
   for currency inference.
6. **The QR code supplies the JIR** at extraction (`applyQrJir`); metadata source `qr`.
7. **Evidence-aware low-confidence list.** Only a model reading below the threshold is listed, and
   not when the QR code corroborates it. Inferred and text-sourced currency carry no confidence.
8. **Buyer block** hidden unless a buyer value was extracted, behind an Add buyer control.
9. **Scoring harness** replays the QR code and reports unexpected/missing warnings and
   low-confidence flags on correct values, for all receipts and for images under 500 px wide.

## Files created / modified

**Shared** — new `payment-method.ts`, `vat.ts`, `vat.test.ts`; `receipt.ts`, `api.ts`, `warnings.ts`,
`index.ts`, `receipt.test.ts`, `api.test.ts`.
**API** — new `providers/document-extraction/payment-method.ts` and its test;
`providers/document-extraction/{azure-fields,azure,croatian,currency,field-aliases,source-regions,types,vat-tables}.ts`
and the `azure-fields`, `azure`, `croatian`, `currency`, `source-regions` tests;
`validation/warnings.ts` and test; `routes/receipts.ts`, its test and its integration test (export
version assertion); `repositories/receipts.ts` and test; `export/receipts.ts` and test.
**Client** — `routes/ReviewPage.tsx` and test; `review/reviewForm.ts`, `review/regionSections.ts` and
tests; `i18n/locales/{en,hr}.json`; new `i18n/paymentMethods.test.ts`.
**Scripts** — `scripts/score-extraction.ts`.
**Docs and fixtures** — `README.md`, `.claude/commands/validate.md`, `.agents/ROADMAP.md`, this file;
new `.agents/fixtures/ground-truth-review.md` and `.agents/fixtures/expected-warnings.json`.

The monorepo `.gitignore` ignores `.agents`, so the three new files under `.agents/` (this file and
the two fixtures) need `git add -f` to be committed. The plan file is in the same position.

## Outcome per reported problem

| Receipt | Problem | Outcome |
| --- | --- | --- |
| `screenshot-…`, `receiptEuroMistake`, `receipt123`, `22559270`, `gradanin-…` | currency amber, value correct | Fixed: inferred currency carries no confidence and is never listed |
| `26515835` | currency amber, value correct | Fixed: text-sourced currency no longer borrows the total's confidence |
| `inareceipt` | currency amber, value correct | **Not fixed.** In the recorded fixture this currency is model-sourced (the text names both EUR and KN), so it keeps the total's confidence, 0.52. Removing it is D12's later step |
| `22559270`, `racuntaksi1` | date amber, value correct | Fixed: the QR code agrees with the date, so it is not listed |
| `receipt123`, `22559270` | "VAT amounts don't match total" | Fixed: per-row rule; `receipt123` has one VAT row |
| `receiptWithTaxMistake`, `receiptEuroMistake`, `lira_trogir` | payment method missing or garbage | Fixed: all three read `cash` from the labelled text |
| `receipt123` | `NONCANICE` | Fixed: categorised as `cash` |
| `receipt123` | JIR wrong | Fixed: taken from the QR code |
| `lira_trogir` | currency missing | Fixed: `EUR`, inferred |
| `primjer-pdf-racuna` | seller OIB missing | Fixed: shown with `oib_checksum_invalid`, outlined on the page |
| `inareceipt`, `lira_trogir`, `26515835`, `22559270` | subtotal doubtful | Field removed |
| most receipts | empty buyer block | Hidden behind Add buyer |

## Decisions made

D1–D14 were settled before the plan and are recorded in its NOTES. Taken during execution:

- **`expected-warnings.json` holds `"code:field"` strings per receipt** and a receipt not listed is
  expected to produce none. It was a draft until the ground truth was verified and is final now.
- **The harness output is restructured** into `all` and `smallImages`, each with the same blocks, in
  place of the previous top-level `critical` / `supplementalExactMatches` keys.
- **The low-confidence flag count judges only fields that have ground truth**; flags on fields without
  it are reported separately (`flagsWithoutGroundTruth`) rather than guessed at.
- **`messages("vatBreakdown")` stays in the VAT fieldset.** `vat_present_but_unread` still uses the
  bare path, and so do VAT warnings stored before this iteration.
- **The buyer OIB is kept as read** when it is not a valid OIB (with the warning), mirroring the seller.

## Deviations from the plan

- **Task 18 skipped.** No hosted row has `source_original_filename = '0f089468f365211452db4ccf6e8da466.png'`
  (checked read-only), so the 15th receipt has no recorded fixture. It is in the review table.
  `/validate` 6.19 and 6.23 pass.
- **Task 20 was done in a second pass**, after the product owner verified the table. Sixteen expected
  files now hold the scalar fields; existing `vatBreakdown` expectations were kept, except
  `receipt123`, which lost its PNP row. `receipt123`'s ZKI is too blurred to read and is left
  unscored; `screenshot-…`'s ZKI is recorded in capitals as printed; the Konzum receipt has no
  expected file because it has no fixture (`/validate` 6.19).
- **Warnings are recomputed when a stored receipt is read — not in the plan.** The browser run showed
  a row stored with the old VAT warning still displaying it, and exporting it, until saved; that is
  the state of the product owner's own `22559270` and `receipt123` rows. The product owner left the
  decision to the agent's recommendation. `mapReceiptRow` now calls `computeStoredWarnings` for
  `review` and `confirmed` rows, and the three helpers that read stored QR and metadata moved from
  the routes file into `validation/warnings.ts`. Two repository tests cover it.
- **One planned test assertion was wrong.** `ina-racun-sladoled` prints `kartica-MasterCard` as an
  unlabelled tender line and the provider returns no payment field for it, so it is not read — which
  is the plan's own rule. The assertion was replaced with `racuntaksi1`.
- **`api/src/routes/receipts.integration.ts`** needed its export assertion moved to
  `schemaVersion` 2; the plan did not list it.
- **The baseline for the new harness numbers** was measured by running a throwaway script against the
  stashed pre-change tree, since the old harness reported neither flags nor warnings.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | The same two pre-existing errors (`client/src/capture/downscale.ts:13-14`); none new |
| `prettier --check --end-of-line auto` on changed files | Pass (four files reformatted first) |
| `oxlint` on changed files | Pass |
| Ad hoc strict `tsc` on `scripts/score-extraction.ts` | Pass |
| `npm test` | Pass: 54 files, **610 tests** (526 at iteration 24) |
| `npm run build` | Pass |
| `npm run test:integration` (hosted) | Pass: 27 tests; no orphan users |
| `npm run score:extraction` | Runs; numbers below |
| `/validate` Phase 6 | All pass, including the new 6.24, **except 6.9** (see below) |
| `/validate` 7a | Not run: no migration changed |
| Browser, 1440 px and 390 px, `en` and `hr` | Pass — see below |

**6.9 is red and was red before this iteration.** It forbids `fetch(` outside
`client/src/api/client.ts` and names `client/src/review/pdfDocument.ts`, added in iteration 22 and not
touched here. Whether the check or the code is wrong was not decided in this iteration.

**Not run:** `npm install` on a clean checkout (no dependency changed), repository-wide
`npm run format:check` (recorded red on CRLF files since iteration 23; only changed files were
checked), and the Phase 8 journeys other than the review form — auth, capture, history, shell and
highlighting journeys were not repeated beyond what the uploads exercised.

### Browser run

Local API and Vite (5173), a disposable account, five real uploads (ten Azure calls), then the
account, its rows and its five stored sources were deleted.

- `receipt123`: JIR `b19e5e13-0388-4284-9be9-3a0919701be5`, one VAT row `25.00 / 18.97 / 4.74`, no
  VAT warning, currency `EUR` not amber, payment `Cash`. Amber: seller name, seller address, document
  number (genuine low confidences).
- `22559270`: three VAT rows, no VAT warning, date and currency not amber. Amber: payment method
  (model confidence 0.56 — the known limit below).
- `primjer-pdf-racuna`: OIB `12345678902` amber with the check-digit warning and outlined on the PDF;
  buyer block open with John Smith; payment `Bank transfer`.
- `receiptWithTaxMistake`: payment `Cash`; nothing amber.
- `lira_trogir` (uploaded downscaled, as the app does): currency `EUR` not amber, payment `Cash`,
  document number and seller OIB read.
- No subtotal field anywhere; the select and the Add buyer control are 44 px tall; no horizontal
  overflow at 390 px; Croatian labels `Gotovina`, `Transakcijski račun`, `Dodaj kupca`.
- **A row rewritten to the v1 shape** (`subtotal`, `paymentMethod: "Gotovina"`) opened, showed `cash`,
  listed no edited field, saved, confirmed and exported: CSV header of twenty columns without
  `subtotal`, JSON `"schemaVersion": 2`. A `PATCH` carrying `subtotal` returned 400.

`.env` sets `PORT` to 3002 on this machine, which the Vite proxy (fixed at 3001) does not follow; the
API was started with `PORT=3001` for the session. Recorded in `/validate` 8.17.

### Final score (verified ground truth)

16 fixtures, after Task 20. Critical: seller name 13/16, document number 15/16, issue date 16/16,
total 16/16, currency 16/16; no critical correction on 13/16. Supplementary: issue time 15/16,
seller OIB 15/16, buyer OIB 15/16, buyer name 14/16, buyer address 14/16, seller address 11/16,
JIR 13/16, ZKI 12/15, VAT breakdown 11/13, payment method 12/16. Warnings: 0 unexpected, 0 missing.
Low-confidence flags on correct values: 9 of 16. Small images (5): seller name 3/5, payment method
3/5, JIR 3/5, ZKI 2/4, flags on correct values 6 of 8.

**Payment method: 9 of the 13 distinct receipts that print one**, which meets the plan's criterion.
The four misses are unlabelled tender lines (`26515835`, `images`, `ina-racun-sladoled`,
`screenshot-20190705-1907152`).

**Seller name went from 14/16 to 13/16 because the ground truth changed, not the code**: it is now the
legal entity. `lira_trogir` and `receipt123` were already misses; `22559270` became one because the
mapper returns `Milenij hoteli d. o.o.` and the receipt prints `d.o.o.`. Issue date gained a
receipt (`26515835` now has an expected date).

### Score, before and after, on the ground truth as it was before Task 20

The like-for-like comparison: 16 fixtures scored, expected files unchanged.

| | Before | After |
| --- | --- | --- |
| Seller name | 14/16 | 14/16 |
| Document number | 15/16 | 15/16 |
| Issue date | 15/15 | 15/15 |
| Total | 16/16 | 16/16 |
| Currency | 15/16 | **16/16** |
| No critical correction needed | 14/16 | 14/16 |
| Issue time | 8/8 | 8/8 |
| JIR / ZKI / seller OIB | 1/3, 1/3, 1/2 | unchanged |
| VAT breakdown | 10/13 | 10/13 |
| Warnings not expected | 5 | **0** |
| Warnings expected and missing | 0 | 0 |
| Low-confidence flags on correct values | 16 of 17 | **7 of 8** |
| — small images only (5 receipts) | not measured | 5 of 6 |

The five false warnings before were `vat_arithmetic_mismatch` on `22559270` and `receipt123`,
`qr_jir_mismatch` on `receipt123`, and `missing_critical_field:currency` on `lira_trogir` (its
`missing_critical_field:documentNumber` is expected on the full-resolution fixture and remains). The
seven remaining flags on correct values: `26515835:total`, `images:documentNumber`,
`inareceipt:documentNumber`, `inareceipt:total`, `inareceipt:currency`, `lira_trogir:total`,
`receipt123:documentNumber`.

No critical field regressed. VAT breakdown stays 10/13 only because `receipt123`'s expected file
still lists the PNP row as VAT; it becomes a match once Task 20 removes it.

Payment method could not be scored in this comparison, because the expected files did not hold it
before Task 20.

## Acceptance criteria

Met: schema v2 everywhere; read conversion; no VAT warning on `receipt123`/`22559270`; `receipt123`
JIR; `primjer-pdf-racuna` OIB; `lira_trogir` currency; inferred/text/QR-corroborated values never
listed; flags lower (16 → 7); no critical regression; buyer block; no latency-relevant code changed
(no new provider call, polling untouched).
Payment method 9 of 13, and Task 20, were met in the second pass.

## Known gaps / follow-ups

- **Items and VAT rows are not verified** (D13's second pass), including the open question of
  `primjer1-hr-nopdv`'s zero-rate recap.
- **Seller name is compared exactly**, so `d. o.o.` against `d.o.o.` is a miss. Whether a spacing
  difference in a legal suffix should count is a scoring decision for Plan B's shared comparator.
- **The recompute-on-read change was verified by unit and hosted integration tests, not in a
  browser**; the browser run preceded it.
- **A JIR stored before this iteration is not replaced from the QR code** — that happens at
  extraction only. Such a receipt now shows `qr_jir_mismatch` (correctly) until re-uploaded.
- **A browser tab opened before the deploy cannot save** (it sends `subtotal`, which the strict PATCH
  schema rejects with 400) and cannot parse a receipt carrying `oib_checksum_invalid`. Reloading
  fixes both. This is iteration 19's accepted limit for a removed field.
- **`lira_trogir`'s full-resolution fixture** puts the seller's OIB in `buyerOib` (the provider
  returned it as the customer tax id), so that replay would open the buyer block. The app uploads the
  photo downscaled and reads it as the seller's, as the browser run showed.
- **Payment method keeps the model's confidence** when the model supplied it, so `22559270`'s still
  shows amber at 0.56.
- **Unlabelled tender lines, the wrong buyer on `26515835`, cropped-label JIR/ZKI, `receipt123`'s
  seller and ZKI, `primjer1-hr-nopdv`'s duplicate zero-rate VAT row** — out of scope; Plan B.
- **`scripts/bakeoff/` still names `subtotal` and free-text payment methods**; Plan B owns it.
- **`/validate` 6.9** is red on `pdfDocument.ts` and needs a decision (narrow the check or route the
  PDF fetch through the client module).
- **The 15th receipt** (Konzum) needs one upload through the app before it can be recorded.
- Choices in the plan the product owner has not explicitly seen: English category codes in the CSV;
  the OIB warning also on the buyer OIB; all-empty VAT rows dropped; VAT tolerance 0.01;
  text-sourced currency losing its borrowed confidence.
