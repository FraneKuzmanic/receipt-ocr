# Iteration 18 — Extraction accuracy, reliability & processing speed (Commit A)

**Date:** 2026-08-25
**Spec:** `.agents/specs/extraction-accuracy-and-speed.md`
**Plan:** `.agents/plans/extraction-accuracy-and-speed.md`
**Scope of this commit:** Commit A only (plan tasks 1–14 — accuracy & transparency). Commit B
(client-side downscale, concurrent Azure/storage upload, `failureReason` surfacing, the offline
scoring harness — plan tasks 15–22) is **not started** and is deliberately out of this commit, per
the plan's explicit two-commit split.

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

None in the implemented tasks (1–14). Commit B (tasks 15–22) was not started in this session, which
is explicitly the plan's own permitted stopping point ("If time forces a cut, Commit A alone is a
coherent, shippable iteration").

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

- **Commit B is not started**: client-side image downscale (plan task 19–20, threshold still
  unmeasured), concurrent Azure/storage upload (task 21), `failureReason` surfaced to the client
  (task 15–17), and the offline `scripts/score-extraction.ts` accuracy/latency harness with
  before/after numbers (task 22) all remain open, owned by this same iteration number when resumed.
  PRD §11.4's latency target amendment (from "2–5 s" to a measured warm figure) is blocked on that
  harness and has not been made yet.
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
