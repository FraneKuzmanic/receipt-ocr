# Iteration 18 — Extraction accuracy, reliability & processing speed (Commits A & B)

**Date:** 2026-08-25
**Spec:** `.agents/specs/extraction-accuracy-and-speed.md`
**Plan:** `.agents/plans/extraction-accuracy-and-speed.md`
**Scope:** Commit A (accuracy and transparency) plus Commit B (plan tasks 15–22: client-side
downscale, concurrent Azure/storage upload, `failureReason` surfacing and the offline scoring
harness). Commit A is `63b4a80`; Commit B is pending human review and commit.

## Why this iteration exists

The prototype is functionally complete; extraction quality was the remaining gap. Investigation
during spec drafting found that Azure Document Intelligence itself was returning correct data on
every fixture examined — currency and the VAT recap table were both present in the raw response —
but the application's own mapper discarded them: a currency symbol gate dropped code-only currency,
`analyzeResult.tables` was never read for VAT, and a trailing `%` or Croatian tax-class letter made
`parseAmount` reject an otherwise-valid amount.

Planning then re-verified the spec's own evidence against the recorded fixtures and found three
things the spec got wrong (documented in the plan's §0): the naive currency rule would have turned
a kuna receipt into `EUR`, the proposed VAT-recap warning would have false-positived on 3 of 7 real
fixtures (all VAT-exempt), and the VAT table's assumed column shape didn't hold for one real fixture.
The implementation follows the plan's corrected versions of all three, not the spec's original text.

## What was built

**Currency resolution** (`api/src/providers/document-extraction/currency.ts`) replaces the old
symbol-and-code gate with an ordered, evidence-based resolution: an explicit currency token adjacent
to an amount in the OCR text (excluding a token used as a label, e.g. `EURO:`, or inside a conversion
expression, e.g. `(1 Eur= 7,43567)`); then Azure's own code when corroborated by a symbol; then,
only for a receipt identifiable as Croatian (an OIB/JIR/ZKI was found), inference from the issue date
against the 2023-01-01 euro changeover. An inferred value is deliberately given a confidence below
`LOW_CONFIDENCE_THRESHOLD`, so it flows through the existing amber "needs checking" review-form
treatment rather than introducing a second visual convention for "inferred vs. low-confidence."

**VAT recap table reading** (`api/src/providers/document-extraction/vat-tables.ts`) adds a
header-driven reader for `analyzeResult.tables`. A table qualifies when its header row contains at
least two of a keyword set (`porez`, `stopa`, `osnovica`, `iznos`, `pdv`, `tax`, `rate`, `base`,
`net`, `vat`, `%`); columns are mapped by header semantics rather than position, in priority order
(rate → base → amount, each claimed once, so a header like `"Iznos poreza"` resolves to `vatAmount`
and not a stray label column); summary rows (leading `ukupno`/`sveukupno`/`total`) are skipped; a row
is kept only when at least one of its three values parses. `vatBreakdown` precedence is
`TaxDetails` → the table reader → `TotalTax`, so a structured Azure result is still preferred when
one exists.

**Amount noise normalization** (`api/src/providers/document-extraction/receipt-amount.ts`) adds
`parseReceiptAmount`, used only by `mapVatBreakdown` and `mapItems`: it strips a trailing `%`, a
trailing single Croatian-alphabet letter (a tax-class marker, e.g. `"13,00 H"`), or a trailing `*`/`#`
annotation, then delegates to the unmodified `parseAmount`. `subtotal`/`total` extraction is
untouched. `shared/src/money.ts` was not modified, confirmed identical against its pre-iteration
state.

**The `vat_present_but_unread` warning** fires when the OCR content shows a structural VAT-recap
signal (at least two distinct of `osnovica`, `stopa`, `iznos`, `porez`) but no VAT row was ultimately
mapped, and abstains outright when a VAT-exemption phrase is present (`nije u sustavu pdv`,
`pdv nije obračunat`, `oslobođen… pdv`, or a `čl./član/članka 90` citation) — a deterministic,
structural rule chosen specifically because the spec's original bare-`PDV`-mention rule was measured
to false-positive on 3 of 7 real fixtures, all of them legitimately VAT-exempt. Like every existing
warning it is informational only, computed in `computeWarnings` from a precomputed boolean
(`vatTextPresent`) rather than from a regex inside the pure warnings module, and never blocks
confirmation.

**Source-region highlighting for table-sourced VAT.** `source-regions.ts` previously only projected
VAT outlines from `TaxDetails.valueArray`, so a table-sourced VAT row would have silently stopped
producing highlight regions. `addVatRegions` now re-runs `findVatTable`/`mapVatTableRows` (mirroring
the file's existing precedent of re-running Croatian text fallbacks independently rather than
threading provenance through `MappedAnalyzeResult`) and emits one region per populated cell from that
cell's own `boundingRegions`, at the canonical row index the review form actually uses (i.e. after
skipped summary rows are removed).

**Review form.** An empty `vatBreakdown` now renders one blank row on the review screen instead of
only an "Add VAT row" link, so the section reads as an empty form rather than an absent feature. No
other structural change to the form.

## Files created / modified

**New** — `api/src/providers/document-extraction/{currency,receipt-amount,tax-signals,vat-tables}.ts`
and their four `*.test.ts` siblings.

**Modified** — `api/src/providers/document-extraction/azure-fields.ts` (currency resolution, VAT
precedence, `parseReceiptAmount` wiring, `vatSource` on `MappedAnalyzeResult`), `azure-fields.test.ts`
(fixture assertions for all three fixed defects), `source-regions.ts` / `source-regions.test.ts`
(table-sourced VAT region projection), `types.ts` (`"inferred"` source, `vatTextPresent` on
`ExtractionMetadata`), `api/src/validation/warnings.ts` / `warnings.test.ts` (`vatTextPresent` input,
the new rule), `api/src/services/receipt-extraction.ts` / `.test.ts` (the flag threaded through and
persisted), `api/src/routes/receipts.ts` (a `vatTextPresent` metadata reader mirroring the existing
`unreadableFields` one), `shared/src/warnings.ts` (`vat_present_but_unread` added to
`WARNING_CODES`), both locale files (the new warning's `hr`/`en` copy), `README.md` (VAT
source-region and warning-count sections updated), `.claude/commands/validate.md` (four new Phase 4
test rows, Phase 6.18 guarding `shared/src/money.ts`, the new Phase 8.16 journey).

**Untouched, verified** — `shared/src/money.ts`.

## Decisions made

- **VAT precedence keeps `TaxDetails` first**, even though the table reader is more capable, because
  a provider-supplied structured field carries confidence data a scraped table does not, and the
  `images.json` fixture proves the structured path still works where Azure supplies it.
- **`findVatTable` is re-run inside `source-regions.ts`** rather than threading table provenance
  through `MappedAnalyzeResult`'s return shape, mirroring this file's existing precedent for Croatian
  text-fallback regions and keeping the mapper's return type from growing an Azure-shaped payload one
  refactor away from leaking.
- **Leading zeros in table-sourced VAT values (e.g. `"05.00"`, `"01.90"`) are left as-is.** Stripping
  them would mean touching `shared/src/money.ts`, which this iteration deliberately does not modify,
  and `parseAmount` could already emit them from other inputs before this iteration. Recorded here as
  a known, pre-existing, cosmetic gap rather than something silently "fixed" in passing.
- **An inferred currency reuses the existing amber low-confidence review treatment** instead of
  introducing a second "needs checking" visual convention, per the plan's resolution of the spec's
  open question 2.
- **ZKI extraction (spec §2.8) was investigated and closed with no code change.** Both fixtures the
  client reported it missing on extract ZKI correctly through the existing text fallback; the
  reported gap was almost certainly observed against the QR panel, where a bare-JIR QR payload
  legitimately yields `zki: null`. Not re-investigated further.

## Deviations from the plan

None in Commit A. Commit B resumed in the same iteration and is recorded below.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, exit 0 |
| `npm test` | Pass: **48 files, 442 tests** |
| `npm run test:integration` (hosted) | Pass: **27/27** (8 auth + 3 repository + 16 route) |
| Phase 4 (new unit tests: `receipt-amount`, `currency`, `vat-tables`, `tax-signals`, extended
  `azure-fields`, `source-regions`, `warnings`, `receipt-extraction`) | Pass |
| Phase 6.11 (mojibake) | Pass — locale files edited, verified UTF-8 |
| Phase 6.18 (new — `shared/src/money.ts` unmodified) | Pass |
| Phase 8.16 (new journey — real browser) | Pass, see below |

### Real-browser verification (Phase 8.16)

Run via `agent-browser` (Chromium, 1440×900) against a disposable account
(`validate-commit-a-18@example.test`), using live Azure calls, not replayed fixtures.

- Uploaded `.agents/fixtures/receipts/receiptEuroMistake.jpg` (the source image recorded as
  `racun-mobilna-trgovina.json`) → reached review with VAT rate `25.00`, taxable base `82.95`, VAT
  amount `20.74`, all populated from the table reader.
- Currency populated as `HRK`, amber, "This value may need extra checking" — the inferred path,
  correct for this pre-2023 receipt.
- Focusing each VAT field individually produced a source outline that tracked to the correct cell in
  the source image's VAT table row across Rate/Base/Amount.
- Croatian UI: all VAT labels and the low-confidence warning translated correctly with diacritics
  intact.
- Uploaded a second, newly-recorded fixture (`.agents/fixtures/receipts/primjer1-hr-nopdv.pdf`, a
  genuinely VAT-exempt Croatian receipt, via live Azure) → no `vat_present_but_unread` warning
  appeared anywhere on the review screen.
- Both disposable test receipts were deleted via the UI afterward; no orphan data left in the hosted
  project beyond the disposable auth user itself (no self-service account deletion exists in the UI).

## Known gaps / follow-ups

- **Commit B completion supersedes this historical note.** Its implementation, measurements and
  remaining follow-ups are recorded below.
- **Leading zeros in table-sourced VAT amounts** (e.g. `"05.00"`) are preserved verbatim through to
  export — a pre-existing, cosmetic `parseAmount` behavior this iteration did not touch. See
  "Decisions made" above.
- **The eight new source receipts** dropped into `.agents/fixtures/receipts/` on 2026-08-25 mostly
  still have no recorded Azure fixture (plan task 22, step 1); one (`primjer1-hr-nopdv.pdf`) was
  exercised live during this session's browser verification but its response was not separately
  saved as a committed fixture recording.
- `client/src/history/ReceiptTable.tsx` has an uncommitted change unrelated to this iteration (a
  row-click behavior tweak) that the spec explicitly flags as needing its own decision — left
  untouched here.

## Commit B completion

### What was built

**Failure reasons.** The shared receipt-detail contract now exposes a nullable provider-neutral
`failureReason` only for `failed` records. The API reads the persisted stable code, never a provider
message. Processing renders a translated reason; `unreadable_document` deliberately offers Upload
another receipt without the pointless Retry action, while retryable provider failures retain Retry.

**Measured image downscale.** Images above 2 MP or 1.5 MB are decoded in the browser, constrained to
a 1,600 px long edge, and JPEG-encoded at quality 0.82. PDFs, small inputs, HEIC that cannot decode,
and any canvas failure keep their original bytes. The selected preview is built from the exact file
that uploads. This intentionally amends the PRD source-file rule: private Storage keeps the
OCR-appropriate derivative rather than byte-exact camera source.

**Concurrent extraction.** The API starts the provider call immediately after server-side source
validation, attaches a rejection handler synchronously, then uploads and inserts the receipt before
handing the already-running promise to the background service. A row still never exists without a
source object; an insertion failure can waste one Azure call. Azure metadata now records initial
request (`uploadMs`) and poll (`analyzeMs`) durations beside total latency.

**Offline corpus scoring.** `npm run score:extraction` executes the actual mapper, Croatian
fallbacks and warnings against recorded Azure responses and reviewed expected values. The original
seven recordings remain available offline. The six new recordings used for the wider measurement
were lost during temporary-worktree cleanup and must be re-recorded before treating the wider
13-fixture comparison as reproducible.

### Measurements

| Measure | Before Commit A | After Commit B |
| --- | ---: | ---: |
| Seller exact match | Not reproducible (recordings lost) | 100% (7/7) |
| Document-number exact match | Not reproducible (recordings lost) | 100% (7/7) |
| Date exact match | Not reproducible (recordings lost) | 100% (6/6) |
| Total exact match | Not reproducible (recordings lost) | 100% (7/7) |
| Currency exact match | Not reproducible (recordings lost) | 100% (7/7) |
| No critical correction required | Not reproducible (recordings lost) | 100% (7/7) |
| VAT exact match | Not reproducible (recordings lost) | 75% (3/4) |

The committed recordings report p50 3 s and p95 5 s between Azure operation timestamps. A live,
warm 2.14 MP receipt reduced from 262,363 to 191,995 bytes at the chosen 1,600 px edge; its seller,
number, date, total and currency matched the full-size Azure recording. The provider recorded 8,331
ms total (1,190 ms initial request; 7,138 ms poll). The PRD's former 2-5 s aspiration is therefore
amended to an approximately 8 s warm baseline; Render cold starts remain separate at 30-50 s.

### Validation

| Check | Result |
| --- | --- |
| Focused typecheck | Pass |
| Commit B client tests (`downscale`, `ProcessingPage`, `ReviewPage`, `HomePage`, failure-reason i18n) | Pass: 5 files, 33 tests |
| Commit B API/shared tests (`receipt-extraction`, route helpers, shared API schema) | Pass: 3 files, 35 tests |
| `npm run score:extraction` | Pass: 7 retained fixtures, offline |
| Live Chromium check | Pass: downscaled 2.14 MP receipt reached review with all five critical values exact; stored derivative size confirmed; disposable receipt and user removed afterwards |

### Deviations and follow-ups

- Azure returned HTTP 400 for `cijene-prelaze-svaku-mjeru-v0-b2i9tkdog9jg1.jpg` and
  `Wide-Racunnnnn-1000.jpg`, so no recordings or expected labels were committed for those two
  sources. The latter also cannot be decoded by Windows' image reader. They remain source-quality
  cases to investigate, not evidence that the mapper should invent values.
- `Screenshot_20190705-1907152.png` is 1.99 MP and 1.3 MB, so it correctly stays below both
  downscale thresholds. The successful 2.14 MP receipt was the longest valid live measurement case.
- The 13 ground-truth files are deliberately conservative and should be client-spot-checked before
  the corpus becomes an external accuracy claim. Ambiguous fields are omitted rather than guessed.
- The six additional recorded Azure payloads must be recreated from their source files before the
  planned 13-fixture measurement can be used again. The seven retained fixtures report 3/4 exact
  VAT breakdowns, but that is too small to support a broader accuracy claim.
