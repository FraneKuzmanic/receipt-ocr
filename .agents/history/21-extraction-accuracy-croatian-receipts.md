# Iteration 21 — Croatian receipt extraction accuracy

**Date:** 2026-08-27
**Plan:** _none — user reported defects on named sample receipts and asked for reproduction, analysis, then implementation_
**Commit:** _pending human review_

## Why this iteration exists

The user reviewed the sample receipts by hand and listed extraction defects on seven of them. Each was
reproduced by uploading through the running application in a real browser, and the raw Azure response
was pulled per receipt so causes were established from evidence rather than inferred from behaviour.
Nineteen defects were confirmed: fifteen the user reported and four more found alongside them.

## What was actually wrong

**Two hypotheses were wrong and worth recording**, because both looked obviously right from the code.

1. **`TaxDetails` is absent on all seven receipts.** The mapper prefers the model's structured VAT
   field over the table-derived one, which looked like the cause of every missing taxable base. It is
   not implicated at all — every VAT value in this corpus comes from Azure's generic table detection,
   so all the VAT defects live in the column mapper.
2. **The blank VAT row on two receipts is the review form's empty editable row**, not stored data.
   Canonical `vatBreakdown` is `null` on both, which is correct for the VAT-exempt taxi receipt.

The real mechanisms:

- **Time was guessed from a label that need not hold a time.** The only sources were `TransactionTime`
  (absent everywhere) and a regex requiring the literal word *vrijeme*. Where the word appeared but
  was followed by a date, `[0-9]{1,2}[:.,][0-9]{2}` matched the date: `Datum i vrijeme: 17.08.2026.
  10:30` stored **17:08:20**. On the taxi receipt the label holds the ride duration, so it stored
  **00:16:19** against a real issue time of 23:59:47. Four receipts lost the time entirely because it
  sits beside the date under no such label.
- **The VAT column mapper broke five ways**, all present in the corpus: a merged `Stopa% Osnovica`
  header cell claimed one column and orphaned the base; header and data columns drifted apart by one;
  `PDV` was missing from the amount terms and an OCR `osnavica` matched nothing; the rate cell carried
  a tax-group code (`01 25.00 %` → `0125.00`); and the summary-row check looked at a column the
  `UKUPNO POREZ` label was not in, so it became a second VAT row repeating the same amount. A sixth
  receipt wraps its recap across two printed lines, so Azure emits no table for it at all.
- **JIR and ZKI required a contiguous match.** A wrapped value and a stray `.` between label and value
  each defeated it. The failure is asymmetric: a broken ZKI vanished while a broken JIR still matched
  the pattern and was stored as fact.
- **`VendorTaxId` could never be corrected.** `applyTextFallbacks` fills only what the model left
  empty, so the VAT number printed one line above the OIB won permanently.
- **A dual-currency receipt lost both total and currency together**, because both derive from
  `InvoiceTotal` and the provider selected the informational kuna line.

## What was built

Six deterministic rules and two mapper corrections, described in README "Extraction". In short: the
issue time is read beside the date and only with colon separators; identifiers are collected past one
line break before and one inside the value, then validated strictly; a VAT header cell may name two
columns and a role's value is accepted across the span its label covers; header terms match within one
character; a rate discards a leading tax-group code and rejects anything outside 0-100; a tax id is
accepted only once it normalizes to a checksum-valid OIB. A text-based recap fallback covers the
receipt Azure gives no table for, and runs only when neither model nor table VAT was found.

**Step 1 of the plan was the fixture corpus, and it mattered more than any single fix.** Ground truth
already existed for most of these receipts, but the harness skips an expectation whose recorded Azure
response is missing — so six failing receipts sat outside the corpus while it reported healthy
numbers. Recording them first is what made every later change measurable.

## Files created / modified

**Created** — `api/src/providers/document-extraction/fixtures/{22559270,gradanin-gotovina-pos,
ina-racun-sladoled,inareceipt,receiptEuroMistake,receiptWithTaxMistake}.json`,
`.agents/fixtures/expected/{receiptEuroMistake,receiptWithTaxMistake}.json`, this file.

**Modified** — `api/src/providers/document-extraction/{croatian,vat-tables,receipt-amount,
azure-fields,currency}.ts` and their tests, `scripts/score-extraction.ts`,
`.agents/fixtures/expected/{22559270,gradanin-gotovina-pos,ina-racun-sladoled,inareceipt,
racuntaksi1}.json`, `README.md`, `.claude/commands/validate.md`, `.agents/ROADMAP.md`.

## Decisions made

- **A checksum-invalid OIB is discarded rather than stored.** An OIB carries an ISO 7064 MOD 11,10
  check digit, so a failure *proves* the value is wrong, and PRD §7.7 prefers missing to wrong. This
  is the one place an identifier can be verified; JIR and ZKI carry no checksum and cannot be.
- **The Croatian-receipt signal uses OIB *shape*, not the checksum.** Coupling them regressed currency
  inference: an OIB whose check digit was mis-scanned still identifies the document as Croatian, and
  requiring validity there withdrew the inference from exactly the receipts needing it most.
- **Three ground-truth files were corrected, not the code.** `22559270` recorded bases of `60.68` and
  `292.00`; the receipt's own TOTAL row is `440.92`, which only reconciles with `60.08` and `292.04`.
  `ina-racun-sladoled` recorded the kuna total as expected; `14.51 + 3.63 = 18.14 €` confirms the euro
  line is the real one. Every VAT expectation in the corpus is now arithmetic-verified.
- **QR-filled canonical fields were deliberately not built.** It was step 6 of the proposal and
  loosens a locked decision (PRD §7.5), so it is left for the user. It turned out not to be needed for
  the reported defects: the wrapped-line fix recovers `racuntaksi1`'s JIR from OCR directly, and the
  rejoined value matches the QR payload exactly, which independently corroborates the fix.

## Deviations from the plan

The published plan had six steps; five were implemented. Step 6 is held pending the user's decision.

Step 2 claimed identifier validation would fix `inareceipt`'s corrupted JIR. **It does not, and the
claim was wrong.** OCR read `8df1` as `Bdf1`, which is structurally valid hex — validation catches
malformed and truncated values, not character substitution inside a well-formed one.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, exit 0 |
| `npm test` | Pass: 48 files, **477 tests** (28 new) |
| `npx oxlint` on the ten changed source files | Pass, exit 0 |
| `npx prettier --write --end-of-line auto` on changed files | Applied |
| `npm run score:extraction` | See below |
| Browser re-upload of all seven receipts | All reported defects fixed; see below |

Scored corpus. "Before" is the 13 fixtures available once the six failing receipts were recorded;
"after" is the complete 15, which additionally includes `receipt123` and `primjer1-hr-nopdv`. The two
columns are therefore not a like-for-like corpus — the final numbers are measured over strictly more
receipts, including the worst scan in the set.

| Metric | Before (13) | After (15) |
| --- | --- | --- |
| Seller name | 92.3% | **93.3%** (14/15) |
| Document number | 84.6% | **100%** |
| Issue date / total / currency | 100% / 92.3% / 92.3% | **100%** each |
| No critical-field correction required | 84.6% | **93.3%** (14/15) |
| Issue time | 1 / 7 | **7 / 7** |
| VAT breakdown | 4 / 10 | **9 / 12** |
| Seller OIB | 0 / 1 | **1 / 1** |
| JIR / ZKI | 0 / 2 each | **1 / 2** each |

The one seller-name miss is `receipt123`, a badly degraded photo whose seller line OCR reads as
`fte bars\nANTIQUE"`; nothing in the mapper can recover that.

Each of the seven receipts was re-uploaded through the browser after the change and every defect the
user reported is gone, including all six on `ina-racun-sladoled`.

Not run, deliberately, per the user's instruction to validate only what the change implicates:
`npm run build`, Phase 6 security checks, Phase 7 integration and the Phase 8 browser journeys beyond
the seven receipt uploads. Nothing here touches the API surface, the schema, configuration, auth,
money handling or the client.

## Known gaps / follow-ups

- **`inareceipt`'s JIR and ZKI remain OCR-corrupted** and cannot be repaired deterministically:
  neither identifier carries a checksum, so `Bdf1` is indistinguishable from a real value. They are
  now surfaced for correction instead of silently dropped, which is the available improvement.
- **`inareceipt`'s VAT is still unmapped** (rate and base null, amount from `TotalTax`). Its recap is
  a third layout — inline `label: value` pairs, `Osnovica bez PDV 0.40 EUR` — that neither the table
  mapper nor the line-oriented text fallback reads. Pre-existing, not a regression, and outside the
  defects the user reported.
- **A 0%-VAT recap has no agreed canonical mapping, and this needs the user's call.**
  `primjer1-hr-nopdv` prints `Stopa 0% / Osnovica 100.00 / PDV 0.00`; the mapper now extracts it as one
  row, while the ground truth records `null`. Extracting what the document prints is not inventing
  data, so the expectation may be the wrong half — but rewriting an expectation to match new output is
  exactly the corpus-flattering this iteration exists to stop, so it was left failing and is raised
  here instead.
- **`receipt123` is a badly degraded photo** and is now the corpus's floor: its seller name is
  unreadable and its second 0.3% VAT row is lost. Kept deliberately, because a corpus of clean scans
  reports the health of the scans rather than of the product.
- **The deterministic rule count keeps growing.** These rules are individually justified and stay
  inside PRD §4.7, but the honest read is that a Croatian receipt parser is being hand-built beneath a
  generic invoice model. **Azure Query Fields** remains the unevaluated alternative that could replace
  several of them without an LLM; it bills per page as an add-on and was not measured.
- **Test rows from the analysis and verification runs** are still on the hosted project under a
  disposable account (`extraction-analysis-2026@gmail.com`).
