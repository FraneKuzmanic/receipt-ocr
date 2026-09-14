# Iteration 24 — Demo-readiness review fixes

**Date:** 2026-09-14
**Plan:** _none — the user reported observations from a full manual run, asked for an analysis and a recommendation, then asked for the three recommended fixes directly_
**Commit:** _pending human review_

## Why this iteration exists

Before a client demo, the user ran every sample receipt through the deployed app, compared each
result against Document Intelligence Studio, and asked which of their findings were worth fixing —
with an explicit constraint: nothing may risk the speed, efficiency or accuracy the app already has,
and a 1-in-100 edge case does not justify a special case.

## How the observations were analysed

The exact Azure responses from the user's runs are stored in `raw_provider_result`, so they were read
back from the hosted database (read-only) rather than re-created. Each observation was traced to one
of three causes: a model limitation (present in Studio too), an input-quality limitation, or a defect
in our own layer. Only the third category was fixed.

**Why the app sometimes disagreed with Studio: image size.** The client downscales images above 2 MP
to a 1,600 px long edge; Studio receives the original. `lira_trogir` (`IMG_20260827_144105.jpg`,
2736×3648) reached Azure at 1200×1600, where the receipt model read the first item as `00ml` and the
invoice model returned a three-line address — neither happens at full resolution. The smaller image
also *gained* the document number and OIB, and the other three downscaled samples were correct, so
downscaling was deliberately left unchanged: one cropped photo is not evidence for a change that
costs upload latency on every receipt.

**Considered and rejected on evidence:**

- **Letting the receipt model win `sellerAddress`.** Across the 14 live runs the models agree on 11;
  the receipt model is better on `lira_trogir` and `receipt123`, the invoice model on `22559270`
  (`M. Tita 10, Opatija` against `10, Opatija`). A fixed switch moves the error rather than removing
  it, and a containment rule would pick the wrong value on `22559270`.
- **`lira_trogir` JIR, ZKI and currency.** The photo crops the left edge (`IR:`, `KI`, `NIB`), no QR
  decodes at either resolution, and the only `€` is in the amount written in words. Label-less
  identifier guessing would risk wrong values on other documents.
- **Buyer fields on retail `26515835`.** Studio's invoice model makes the same error; it is the store
  branch, already flagged amber at 0.43/0.38 confidence.
- **`primjer-pdf-racuna` OIB.** `12345678902` fails the MOD 11,10 check (the check digit would be 3);
  it is a synthetic sample, and rejecting it is correct.
- **`receipt123` ZKI** (`Zas.Mod:cdeca52…#35562` in OCR) and **`receiptWithTaxMistake` payment
  method** (unread by both models and Studio) — input and model limits.
- **Total tax, IBAN, SWIFT, due date** — scope and export-contract decisions, parked for discussion.

## What was built

1. **Wrapped text is stored as one line.** OCR returns values with the line breaks they were printed
   with; the review form's `<input>` elements delete line breaks rather than render them, which is
   exactly what the user reported (`TrogirObrt`, `papir'100-2000`, `P2500erfect-it`), and Save
   persisted the glued text. `azure-fields.ts` now joins wrapped lines with a space for every text
   field and item description. `reviewForm.ts`'s `toFormValues` applies the same rule so receipts
   stored before the change display correctly without a backfill.
2. **A euro total replaced from text is outlined where that text is.** On `ina-racun-sladoled` both
   models return `136,68 kn` as the total; the euro-denomination rule correctly stores `18.14`, but
   `mapSourceRegions` still outlined the provider's total field — the kuna line. `findPayableEuroTotal`
   now returns offsets (the same `CroatianMatch` shape the other text fallbacks use), and a total whose
   metadata source is `text` is projected from that span for both `total` and `currency`.
3. **`qr_jir_mismatch`.** PRD §7.5 asks for fiscal identifiers to be cross-checked against the QR code,
   but only total and date/time were. On `receipt123` the OCR JIR differs from the QR JIR in six
   characters, and the user had judged the value correct — a JIR has no checksum, so a misread is
   otherwise invisible. The rule compares case-insensitively, warns only when both values exist, and
   never fills or replaces the field.

## Files created / modified

**API** — `api/src/providers/document-extraction/{azure-fields,currency,source-regions}.ts` and the
`azure-fields`/`source-regions` tests; `api/src/validation/warnings.ts` and its test.
**Shared** — `shared/src/warnings.ts` (new code). **Client** — `client/src/review/reviewForm.ts` and
its test; `client/src/i18n/locales/{en,hr}.json`. **Docs** — `README.md`, this file,
`.agents/ROADMAP.md`.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 51 files, **526 tests** (518 before; +8) |
| `npm run score:extraction` | **Byte-identical** to the pre-change output |
| `oxlint` / `prettier --check --end-of-line auto` on changed files | Pass |
| `/validate` 6.6, 6.11 | Pass |

Not run: `npm run build` and browser journeys (the client change is a pure value mapping covered by
its unit test), and integration tests (no route, schema or migration change). Model calls,
precedence and polling are untouched, so latency is unaffected by construction.

## Known gaps / follow-ups

- **Stored receipts keep their old values.** `receipt123`'s JIR warning appears only after a
  re-extraction or a Save recomputes warnings; the `ina-racun-sladoled` highlight is projected at
  read time, so it corrects immediately. Existing CSV exports of unedited receipts still carry line
  breaks inside quoted cells (valid RFC 4180). Saving such a receipt stores the space-joined text,
  which differs from its line-broken `original_extraction`, so those fields gain the "edited" marker
  without a user change. Re-uploading avoids all three.
- **A browser tab opened before the deploy cannot parse `qr_jir_mismatch`**, because warning codes
  are a strict enum in the response schema (iteration 19's failure class). It affects only receipts
  carrying that warning; reloading the tab fixes it.
- **Image-size sensitivity is real but unmeasured beyond one photo.** Worth a controlled experiment
  (smoothing quality, a larger long edge) only if phone photos in practice show it.
