# Feature: Extraction accuracy, reliability & processing speed

The following plan should be complete, but it is important that you validate documentation, codebase
patterns and task sanity before you start implementing.

Pay special attention to the naming of existing utils, types and models. Import from the right files.

**Source spec:** [`.agents/specs/extraction-accuracy-and-speed.md`](../specs/extraction-accuracy-and-speed.md)
**Roadmap position:** iteration 18, outside the numbered task list (`.agents/ROADMAP.md` §3)

> **Read §0 before anything else.** Planning re-ran the spec's evidence against the recorded Azure
> fixtures and found the spec wrong in three places. Implementing §4.1 and §4.5 as the spec words
> them produces a failing definition-of-done item and three false-positive warnings.

---

## Feature Description

The prototype is functionally complete; extraction quality and processing speed are now the limiting
factor. This iteration fixes three confirmed extraction defects, makes silent extraction failures
visible, cuts controllable latency, and builds an offline measurement harness so accuracy becomes a
number that moves rather than a feeling.

The central finding of the spec's investigation holds and planning confirms it: **Azure is not the
problem.** On every fixture examined, Azure returned the VAT recap and the currency evidence
correctly. Our own mapper discards both. Every accuracy fix below is a change to our own code, at no
additional Azure cost and no additional latency.

## User Story

As a business user digitizing Croatian receipts,
I want the VAT table, currency and amounts on my receipt to be read correctly and quickly, and to be
told plainly when something could not be read or why processing failed,
So that I spend my time confirming a mostly-correct draft rather than retyping fields the receipt
clearly shows and guessing at silent failures.

## Problem Statement

1. **Currency is dropped** whenever Azure returns a currency code without a symbol
   (`azure-fields.ts:86` requires both), so the review form shows an empty critical field and raises
   a `missing_critical_field` warning on receipts whose currency is plainly legible.
2. **VAT is never extracted from Croatian receipts.** `prebuilt-invoice` returns no `TaxDetails` on
   them, but it does return a fully parsed VAT recap in `analyzeResult.tables`, which the mapper
   ignores entirely.
3. **Amounts are silently lost** to a trailing `%` or a tax-class letter, because
   `shared/src/money.ts` requires `^[\d.,]+$` after stripping currency and whitespace.
4. **Missing data announces nothing.** A receipt whose source clearly shows a VAT recap arrives with
   an empty VAT section and zero warnings — the worst failure mode in the system.
5. **A failed receipt cannot say why.** `extractionMetadata.failure.reason` is persisted but never
   read; `routes/receipts.ts` reads only `retryable`, so every distinct cause renders one fixed
   string.
6. **Latency is dominated by bytes and by a serial pipeline.** Azure's analysis is a flat ~7.1–7.4 s
   floor, but everything controllable scales with upload size, and `POST /api/receipts` awaits the
   storage upload before extraction starts even though the bytes are already in memory.

## Solution Statement

Read the data Azure already returns. Add a header-driven VAT recap table reader behind the existing
`TaxDetails` path; resolve currency from ordered evidence rather than a symbol gate; normalize
receipt-specific amount noise in the extraction layer without touching the canonical money contract.
Surface silent gaps as one new non-blocking warning and surface failure causes as a stable code the
client translates. Cut controllable latency by downscaling large photos in the browser and starting
the Azure analysis concurrently with the storage upload. Prove all of it with an offline harness that
replays recorded Azure responses through the real mapper.

## Feature Metadata

**Feature Type**: Bug Fix (§4.1–§4.3) + Enhancement (§4.4–§4.7) + New Capability (§5 harness)
**Estimated Complexity**: **High** — five independent workstreams across all three workspaces
**Primary Systems Affected**: `api/src/providers/document-extraction/*`, `api/src/validation/warnings.ts`,
`api/src/routes/receipts.ts`, `api/src/services/receipt-extraction.ts`, `shared/src/{warnings,api}.ts`,
`client/src/capture/*`, `client/src/routes/ProcessingPage.tsx`, `client/src/i18n/locales/*`
**Dependencies**: none new. `tsx` (already a devDependency) runs the harness.

---

## §0. PLANNING FINDINGS — READ FIRST

Planning replayed the recorded Azure fixtures in
`api/src/providers/document-extraction/fixtures/` and reached four conclusions that change the work.
Each was verified by inspecting real fixture JSON, not by reasoning about it.

### 0.1 Recorded fixtures for BOTH spec receipts already exist, under different names

The spec talks about `receiptEuroMistake.jpg` and `receiptWithTaxMistake.jpg` and implies live Azure
calls are needed. They are not. The recordings are already committed:

| Spec name | Recorded fixture | Proof |
| --- | --- | --- |
| `receiptEuroMistake.jpg` | **`racun-mobilna-trgovina.json`** | `InvoiceTotal.content` `"103,69"`, `valueCurrency` `{amount:103.69, currencyCode:"EUR"}` with **no symbol**; VAT table `["Porez","%","Osnovica","Iznos"]` → `["PDV","25.00","82,95","20,74"]` + summary `["Ukupno porezi","","","20,74"]`; JIR `ac12e053-…` and ZKI `08a78e71…` in a third table |
| `receiptWithTaxMistake.jpg` | **`31231822.json`** | `InvoiceTotal.content` `"13.00 kn"`, `valueCurrency` `{currencySymbol:"kn", amount:13, currencyCode:"HRK"}`; VAT table `["Vrsta poreza","Stopa%","Osnovica","Iznos"]` → `["PDV 25%","25.00","10.40","2.60"]`; line item `["KAVA S MLIJEKOM 13,00","1,00","13,00 H"]` — the exact `13,00 H` the spec §2.3 names |

**Consequence:** the entire accuracy workstream (§4.1–§4.5) is unit-testable offline today, with zero
Azure cost. Write the tests against these fixture names. Do not re-record to "get" these two.

The client has also dropped **eight new source receipts** into `.agents/fixtures/receipts/` dated
2026-08-25 (`22559270.png`, `cijene-prelaze-svaku-mjeru-v0-b2i9tkdog9jg1.jpg`,
`gradanin-gotovina-pos.jpg`, `ina-racun-sladoled.jpg`, `inareceipt.jpg`, `primjer1-hr-nopdv.pdf`,
`receipt123.jpg`, `Wide-Racunnnnn-1000.jpg`), fulfilling D8. **None of them has a recorded response
yet.** Task 22 records them.

### 0.2 The spec's currency rule 1 produces `EUR` on the flagship receipt, not `HRK`

Spec §4.1 asserts the ordered resolution "produces `HRK`" on `receiptEuroMistake.jpg`. It cannot, as
worded. That receipt's content contains **no kuna token at all**:

```
UKUPNO
103,69
NAC.PLAC .: NOVCANICE I KOVANICE
EURO:
13,94 (1 Eur= 7,43567)
```

The only currency tokens are `EURO:` and `Eur=`. The spec anticipates this and says "only a currency
token adjacent to an amount counts" — **but `EURO:` is followed on the next line by the amount
`13,94`, so adjacency does not disqualify it.** A naive rule 1 returns `EUR`, rule 2 and 3 never run,
and the definition-of-done item "extracts `currency: "HRK"` with `source: "inferred"`" fails.

**Rule 1 must additionally exclude:**
- a token immediately followed by `:` — a label (`EURO:`), not a denomination;
- a token inside a conversion expression — followed by `=`, or inside a parenthesised group
  containing `=` (`(1 Eur= 7,43567)`).

Verified against every recorded fixture with those two exclusions in place:

| Fixture | Tokens found by corrected rule 1 | Rule fired | Final currency | Correct? |
| --- | --- | --- | --- | --- |
| `racun-mobilna-trgovina` (euro-mistake) | none (`EURO:` label, `Eur=` conversion) | 3 — inferred, date `2020-02-21` < 2023 | **HRK** | ✅ matches the receipt |
| `31231822` (tax-mistake) | `kn` from `13.00 kn` | 1 — text | HRK | ✅ |
| `26515835` | `EUR` from `UKUPNO EUR ⏎ 1,99` | 1 — text | EUR | ✅ (Azure gave code, no symbol — rule 2 would have abstained) |
| `primjer-pdf-racuna` | `EUR` from `630,00 EUR` | 1 — text | EUR | ✅ |
| `racuntaksi1` | `EUR` **and** `HRK` (dual-priced) → not exactly one → abstain | 2 — model (symbol `EUR` + code) | EUR | ✅ |
| `screenshot-20190705` | none adjacent (`IZNOS(KN)`, `UKUPNO KN (NOVCANICE)`) | 3 — inferred, 2019 | HRK | ✅ |
| `images` (English) | `$` | 1 — text | USD | ✅ |

Seven of seven correct. **`racuntaksi1` is the case that justifies "exactly one distinct token"** —
it prints both `132.72 EUR` and `999.98 HRK`.

### 0.3 The spec's `vat_present_but_unread` rule false-positives on 3 of 7 fixtures

Spec D7 claims the warning fires "without warning on receipts that genuinely carry no VAT line". The
lexical signal it specifies (`PDV`, `osnovica`, `stopa`, `porez`, `VAT`, `tax rate`) fires on three
receipts that are explicitly **VAT-exempt**:

| Fixture | Matching text | Reality |
| --- | --- | --- |
| `racuntaksi1` | `…po osnovi clanka 90. Zakona o PDV-u)` | Exempt under art. 90. No VAT exists. |
| `primjer-pdf-racuna` | `PDV nije obračunat prema čl. 90. Zakona o PDV-u.` | "VAT is not calculated". No VAT exists. |
| `screenshot-20190705` | `PODUZETNIK NIJE U SUSTAVU PDV-A PREMA ČL. 90 ST. 2` | Business is not VAT-registered. No VAT exists. |

Shipping that rule would warn on 3 of 7 real receipts that are correct — precisely the
"train the user to ignore warnings" failure `README.md` argues against in its Warnings section, and a
direct violation of PRD §7.7's "missing stays missing is a correct outcome".

**The rule must therefore:**
1. require a **structural** recap signal — at least two distinct of `osnovica`, `stopa`, `iznos`,
   `porez` — rather than the bare presence of `PDV`; **and**
2. abstain entirely when a VAT-exemption phrase is present:
   `nije u sustavu pdv`, `pdv nije obračunat`, `oslobođen… pdv`, or a `čl./član/članka 90` citation.

Verified: fires on `26515835`, `31231822`, `racun-mobilna-trgovina` (all three genuinely have an
unread recap, and all three stop firing once §4.2 lands — which is the point), abstains on the three
exempt receipts above and on `images` (which has real `TaxDetails`). **Zero false positives across
the corpus.**

### 0.4 The spec's VAT table shape assumption is wrong for one real fixture

Spec §4.2 says a candidate table has "a label column, a rate column, a taxable-base column and a
VAT-amount column", and that summary rows are matched "on a leading `ukupno`/`total` **in the label
column**". `26515835.json` has no label column:

```
["Stopa%", "Osnovica", "Iznos poreza"]     <- 3 columns, header
["05.00%", "01.90",    "00.09"]            <- the VAT row
["Račun broj:", "10752/310012/2"]          <- an unrelated row Azure merged into the table
```

Three consequences for the implementation:
- **The label column is optional.** Map columns by header semantics and treat whatever is left over
  as the label, rather than assuming column 0 is a label.
- **`Iznos poreza` contains both `iznos` and `porez`.** Assign columns in priority order
  (rate → base → amount), each column claimed once, so this resolves to `vatAmount` and not to a
  second label column.
- **The stray `["Račun broj:", …]` row is discarded by the "keep a row only when at least one of
  rate/base/amount parses" rule** — `parseReceiptAmount("10752/310012/2")` is `null` because of the
  slashes. Keep that rule; it is load-bearing, not belt-and-braces. Add it as an explicit test.

Also note `screenshot-20190705-1907152.json` table 0, whose **header row is data**
(`["A1","1.00","0.00%","200.00"]`) and whose cells are **sparse** (missing `columnIndex` entries read
back as `null`). It matches exactly one keyword (`%`), so the "at least two distinct" threshold
correctly rejects it. That is the negative test.

### 0.5 A decision the spec does not cover: leading zeros

`26515835`'s VAT row is `["05.00%", "01.90", "00.09"]`. After `parseReceiptAmount` these become
`"05.00"`, `"01.90"`, `"00.09"` — valid under `AMOUNT_PATTERN` (`^-?\d+(\.\d+)?$`), arithmetically
correct (`01.90 + 00.09 = 1.99` = the total), but they would reach CSV export verbatim as `01.90`.

**Decision: leave them.** Stripping leading zeros means touching `shared/src/money.ts`, which spec
§4.3 explicitly rules out, and `parseAmount` can already emit them today from other inputs, so this
is pre-existing cosmetic behaviour rather than a regression this iteration introduces. Record it as a
known gap in the history file. Do **not** "fix" it opportunistically (CLAUDE.md §3).

---

## CONTEXT REFERENCES

### Relevant Codebase Files — YOU MUST READ THESE BEFORE IMPLEMENTING

**Extraction core**

- `api/src/providers/document-extraction/azure-fields.ts` (whole file, 221 lines) — Why: the mapper
  every accuracy fix lands in. **Line 86** is the currency symbol gate; `mapVatBreakdown`
  (180–193) and `mapItems` (195–206) are where `parseReceiptAmount` replaces `parseAmount`.
- `api/src/providers/document-extraction/azure.ts` (lines 61–99, 109–131, 149–168) — Why: `extract()`
  orchestration, `analyzeWithAzure` (the POST/poll split for latency metrics), and
  `applyTextFallbacks`, which runs **after** `mapAnalyzeResult` and is why currency rule 3 must be
  self-contained inside the mapper (see the gotcha in Task 3).
- `api/src/providers/document-extraction/field-aliases.ts` (whole file, 31 lines) — Why: alias tables;
  `VAT_CELL_ALIASES` stays for the `TaxDetails` path, `paymentMethod: ["PaymentTerm"]` is the field
  §4.4 adds a text fallback for.
- `api/src/providers/document-extraction/croatian.ts` (whole file, 56 lines) — Why: the exact regex
  and `CroatianMatch` shape §4.4's two new fallbacks must mirror. Note `ISSUE_TIME` (line 8) requires
  a `vrijeme` label, which is the §4.4 gap.
- `api/src/providers/document-extraction/types.ts` (whole file, 52 lines) — Why:
  `ExtractionFieldMetadata.source` (line 14) gains `"inferred"`; `ExtractionMetadata` (17–26) gains
  the latency split; `ExtractionError` (37–47) carries the `reason` §4.6 surfaces.
- `api/src/providers/document-extraction/content-markers.ts` (whole file, 37 lines) — Why:
  `stripContentMarkers` must be applied before any content regex, or a `:barcode:` marker can land
  inside a match.
- `api/src/providers/document-extraction/source-regions.ts` (lines 40–91, **129–156**) — Why:
  `addVatRegions` reads `TaxDetails.valueArray`. Table-sourced VAT hits the `!field?.valueArray`
  branch with `field === undefined` and silently emits **zero** regions. Note lines 69–88: this
  module already re-runs the Croatian fallbacks itself — that is the precedent for re-running the
  VAT table reader here rather than threading provenance through `mapAnalyzeResult`.

**Warnings, routes, services**

- `api/src/validation/warnings.ts` (whole file, 119 lines) — Why: `WarningInput` (9–14) is what the
  new flag is threaded through; `computeWarnings` (24–62) is a pure function over fields and must
  stay that way — no regex, no content.
- `api/src/routes/receipts.ts` (lines 113–167, **194–231**, 233–265, 287–304, 322–343, 376–388) —
  Why: the detail/PATCH responses §4.6 extends; `POST /` is where §4.7b reorders; `unreadableFields`
  (376–382) is the exact helper pattern the new metadata reader mirrors.
- `api/src/services/receipt-extraction.ts` (whole file, 78 lines) — Why: `ExtractReceiptInput` gains
  the pre-started extraction promise; the `catch` (55–73) already persists `{reason, retryable}`.

**Shared contracts**

- `shared/src/money.ts` (lines 15–60, 133–165) — Why: `AMOUNT_PATTERN`, and `parseAmount`'s exact
  rejection path (`DIGITS_AND_SEPARATORS` at line 46) that a `%` or trailing letter trips.
  **This file is not modified.**
- `shared/src/warnings.ts` (whole file, 41 lines) — Why: `WARNING_CODES` gains one entry. Read the
  comment at 3–11 before adding it.
- `shared/src/api.ts` (lines 31–44) — Why: `receiptDetailResponseSchema` gains `failureReason`.

**Client**

- `client/src/routes/HomePage.tsx` (lines 64–110) — Why: `selectFile` and the upload handler; the
  downscale slots in here.
- `client/src/capture/receiptFile.ts` (whole file, 127 lines) — Why: `analyzeReceiptImage` (91–126)
  is the exact canvas/`decode()`/`URL.revokeObjectURL` pattern the downscale must mirror, including
  `PreviewUnavailableError` for browsers that cannot decode HEIC.
- `client/src/routes/ProcessingPage.tsx` (lines 101–131) — Why: the fixed `processing.failed` string
  §4.6 replaces, and the retry button that must not render for `unreadable_document`.
- `client/src/routes/ReviewPage.tsx` (lines 170, 417–453) — Why: the `useFieldArray` VAT section
  §4.8 adds one blank row to.
- `client/src/i18n/uploadErrors.test.ts` — Why: the exact parity-test shape §4.6's new test copies.

**Tests to mirror**

- `api/src/providers/document-extraction/azure-fields.test.ts` — fixture-driven mapper tests.
- `api/src/validation/warnings.test.ts` — one test per rule, including the "not enough information"
  path.
- `api/src/providers/document-extraction/source-regions.test.ts` — region projection assertions.

### New Files to Create

- `api/src/providers/document-extraction/receipt-amount.ts` — `parseReceiptAmount`, the extraction-layer
  noise normalizer that delegates to `parseAmount`.
- `api/src/providers/document-extraction/receipt-amount.test.ts`
- `api/src/providers/document-extraction/vat-tables.ts` — `findVatTable` + `mapVatTable`, the
  header-driven VAT recap reader.
- `api/src/providers/document-extraction/vat-tables.test.ts`
- `api/src/providers/document-extraction/currency.ts` — `resolveCurrency`, the ordered resolution.
- `api/src/providers/document-extraction/currency.test.ts`
- `api/src/providers/document-extraction/tax-signals.ts` — `hasUnreadVatSignal`, the structural recap
  detector with the exemption exclusion.
- `api/src/providers/document-extraction/tax-signals.test.ts`
- `client/src/capture/downscale.ts` — `downscaleReceiptImage`.
- `client/src/capture/downscale.test.ts`
- `client/src/i18n/failureReasons.test.ts` — locale parity for the `processing.failure.*` keys.
- `scripts/score-extraction.ts` — the offline accuracy/latency harness.
- `.agents/fixtures/expected/<name>.json` — one ground-truth file per scored fixture.

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [Azure DI — analyze result `tables`](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept-layout#tables)
  - Section: table cell structure (`rowIndex`, `columnIndex`, `content`, `boundingRegions`,
    `kind: "columnHeader"`)
  - Why: §4.2's reader walks these; cells can be **sparse**, so index by `rowIndex`/`columnIndex`
    rather than assuming a dense grid.
- [Azure DI — prebuilt invoice field list](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/invoice)
  - Section: supported fields, `TaxDetails` / `TotalTax` / `PaymentTerm`
  - Why: confirms `TaxDetails` is genuinely absent on Croatian receipts rather than misread.
- [MDN — `HTMLCanvasElement.toBlob()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
  - Section: quality argument for `image/jpeg`
  - Why: §4.7a's re-encode; `toBlob` is async and returns `null` on failure, which must be handled.
- [MDN — `createImageBitmap()` / `HTMLImageElement.decode()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode)
  - Why: the existing `analyzeReceiptImage` uses `decode()`; reuse it for consistency rather than
    introducing a second decoding path.
- [PRD §7.3](../../PRD.md) — "Preserve the original uploaded source even if an OCR-friendly derivative
  is generated". Why: §4.7a makes the derivative *become* the upload; this needs an explicit recorded
  amendment, not silence.

### Patterns to Follow

**Module resolution — `api` and `shared` use `nodenext`.** Relative imports need a `.js` extension
even in `.ts` source. Cross-workspace imports use the package name.

```ts
import { parseAmount } from "@receipt/shared";          // package name, never a relative path
import { FIELD_ALIASES } from "./field-aliases.js";      // .js extension, in .ts source
```

**Never invent data (PRD §7.7).** Every parse helper returns `null` rather than throwing or guessing:

```ts
// shared/src/money.ts:36 — the contract every new parser mirrors
export function parseAmount(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  ...
}
```

**Metadata readers on the route are defensive `unknown` walkers.** Mirror this exactly for the new
failure-reason and VAT-signal readers:

```ts
// api/src/routes/receipts.ts:376
function unreadableFields(metadata: unknown): string[] {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const values = (metadata as Record<string, unknown>)["unreadableFields"];
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === "string") : [];
}
```

**Warnings are codes with a dotted field path, never prose**, and the client owns the copy. Adding a
code means adding it to `WARNING_CODES`, to `en.json`, to `hr.json`, and nothing else —
`client/src/i18n/warnings.test.ts` enforces parity automatically.

**`computeWarnings` is a pure function over canonical fields.** It must not gain a content string or
a regex. Pass a precomputed boolean in `WarningInput`, exactly as `unreadable` already is.

**Fixture-driven mapper tests load recorded JSON and assert canonical output:**

```ts
// mirror api/src/providers/document-extraction/azure-fields.test.ts
const fixture = JSON.parse(readFileSync(new URL("./fixtures/31231822.json", import.meta.url), "utf8"));
const result = mapAnalyzeResult(fixture.analyzeResult);
```

**Anti-patterns to avoid**

- Do **not** modify `shared/src/money.ts`. Spec §4.3 is explicit and `/validate` 6.8 guards the file.
- Do **not** read `valueCurrency.amount` or `valueNumber` — `/validate` 6.10 fails the build. Amounts
  always come from text `content`.
- Do **not** let an Azure field name reach the API response, the canonical column or the UI
  (PRD §6.2; `/validate` 6.17, `shared/src/receipt.test.ts`).
- Do **not** assign `originalExtraction` in a receipt route (`/validate` 6.14).
- Do **not** add a raw `fetch` outside `client/src/api/client.ts` (`/validate` 6.9).

---

## IMPLEMENTATION PLAN

### Recommended commit split

This is materially larger than a normal iteration. Ship it as **two commits**, validating each:

- **Commit A — accuracy & transparency** (Tasks 1–14). Self-contained, delivers most of the user
  value, and is provable entirely offline against recorded fixtures.
- **Commit B — speed & measurement** (Tasks 15–22). Touches the client upload path and the request
  lifecycle, and needs real-browser and live-Azure verification.

If time forces a cut, Commit A alone is a coherent, shippable iteration. Do not interleave them.

### Phase 1: Foundation — parsing primitives (Tasks 1–2)

Pure, dependency-free helpers with no callers yet, so they can be proven in isolation before anything
depends on them.

### Phase 2: Core accuracy — currency, VAT tables, amounts (Tasks 3–7)

Wire the primitives into the mapper, add the VAT recap reader, and keep source-region highlighting
working for table-sourced VAT.

### Phase 3: Visibility — warnings and failure transparency (Tasks 8–14)

One new warning code with a measured-zero false-positive rule; the persisted failure reason surfaced
and translated; the review form's empty VAT row.

### Phase 4: Speed (Tasks 15–18)

Client downscale, concurrent analysis, latency phase split.

### Phase 5: Measurement & documentation (Tasks 19–22)

Ground truth, the offline harness, before/after numbers, docs and validation updates.

---

## STEP-BY-STEP TASKS

Execute in order, top to bottom. Each task is atomic and independently testable.

---

### 1. CREATE `api/src/providers/document-extraction/receipt-amount.ts`

- **IMPLEMENT**: `parseReceiptAmount(raw: string | null | undefined): string | null`. Trim, then
  strip receipt noise **before** delegating to `parseAmount`:
  1. trailing `%` (one or more), for VAT rates — `"25%"` → `25`, `"05.00%"` → `05.00`;
  2. a trailing single letter preceded by whitespace, for Croatian tax classes —
     `"13,00 H"` → `13,00`. Match one letter only, including Croatian diacritics
     (`[A-Za-zČĆŽŠĐčćžšđ]`), so a two-letter currency token like `kn` is left for `parseAmount`;
  3. trailing annotation markers `*` or `#`.
  Then `return parseAmount(cleaned)`.
- **PATTERN**: `shared/src/money.ts:36` — returns `null`, never throws, for anything unreadable.
- **IMPORTS**: `import { parseAmount } from "@receipt/shared";`
- **GOTCHA**: Strip `%` **before** the trailing-letter rule, or `"25%"` is unaffected by either.
  Do **not** strip a trailing two-letter token — `parseAmount`'s `CURRENCY_TOKENS` already handles
  `kn`/`EUR`, and stripping letters greedily would corrupt `"1,99 kn"`.
- **GOTCHA**: Never throw. `mapVatTable` calls this on arbitrary OCR cell text including `null`.
- **VALIDATE**: `npx vitest run --project api receipt-amount`

### 2. CREATE `api/src/providers/document-extraction/receipt-amount.test.ts`

- **IMPLEMENT**: Cover `"25%"` → `"25"`; `"05.00%"` → `"05.00"`; `"13,00 H"` → `"13.00"`;
  `"1,99 kn"` → `"1.99"` (two-letter token untouched); `"12,50*"` → `"12.50"`;
  `"Račun broj:"` → `null`; `"10752/310012/2"` → `null`; `null`/`undefined`/`""` → `null`;
  and that a plain `"100.50"` round-trips with its trailing zero preserved.
- **PATTERN**: `shared/src/money.test.ts` table-driven cases.
- **VALIDATE**: `npx vitest run --project api receipt-amount`

### 3. CREATE `api/src/providers/document-extraction/currency.ts`

- **IMPLEMENT**: `resolveCurrency(input): { code: string; source: "text" | "model" | "inferred" } | null`
  implementing spec §4.1 **as corrected by §0.2**:
  1. **Explicit token adjacent to an amount.** Scan the marker-stripped content for a currency token
     (`kn`, `HRK`, `EUR`, `€`, `$`, `£`, `USD`, `GBP`) directly adjacent to a number, in either order,
     allowing intervening whitespace/newlines. **Exclude** a token immediately followed by `:`, and a
     token in a conversion expression (followed by `=`, or inside parentheses containing `=`). Map
     `kn` → `HRK`, `€` → `EUR`, `$` → `USD`, `£` → `GBP`. If exactly **one distinct code** survives,
     return it with `source: "text"`.
  2. **Azure's code, when corroborated.** If `valueCurrency.currencySymbol` **and** `currencyCode`
     are both present, return the code with `source: "model"`.
  3. **Infer from the issue date**, only when the receipt is identifiably Croatian (an OIB, JIR or
     ZKI was found) and an issue date is known: `issueDate < "2023-01-01"` → `HRK`, else `EUR`.
     `source: "inferred"`.
  4. Otherwise `null`.
- **PATTERN**: `api/src/providers/document-extraction/croatian.ts` — module-level `const` regexes,
  small exported pure functions.
- **IMPORTS**: `findOib`, `findJir`, `findZki`, `findIssueDate` from `./croatian.js`.
- **GOTCHA**: **The `:` and `=` exclusions are the whole point of this task.** Without them
  `receiptEuroMistake` resolves to `EUR` and the headline definition-of-done item fails. See §0.2.
- **GOTCHA**: `racuntaksi1` prints both `132.72 EUR` and `999.98 HRK`. "Exactly one distinct code"
  is what makes it abstain to rule 2 instead of picking arbitrarily.
- **GOTCHA**: Apply `stripContentMarkers(...).text` before scanning, so a `:barcode:` marker cannot
  create a spurious `:` adjacency.
- **VALIDATE**: `npx vitest run --project api currency`

### 4. CREATE `api/src/providers/document-extraction/currency.test.ts`

- **IMPLEMENT**: Drive **all seven recorded fixtures** and assert the table in §0.2 exactly —
  `racun-mobilna-trgovina` → `{code:"HRK", source:"inferred"}`; `31231822` → `{code:"HRK",
  source:"text"}`; `26515835` → `{code:"EUR", source:"text"}`; `primjer-pdf-racuna` → `EUR`/`text`;
  `racuntaksi1` → `EUR`/`model`; `screenshot-20190705-1907152` → `HRK`/`inferred`; `images` →
  `USD`/`text`. Add unit cases for the two exclusions (`EURO:` and `(1 Eur= 7,43567)`) and for a
  receipt with no evidence at all returning `null`.
- **GOTCHA**: These fixture assertions are the regression guard for §0.2. If one starts failing,
  re-read §0.2 before changing the expectation.
- **VALIDATE**: `npx vitest run --project api currency`

### 5. CREATE `api/src/providers/document-extraction/vat-tables.ts`

- **IMPLEMENT**: Two exported functions.
  - `findVatTable(analyzeResult): DocumentTableOutput | null` — for each table, read row 0's cells,
    lowercase them, and count **distinct** keyword hits among
    `porez, stopa, osnovica, iznos, pdv, tax, rate, base, net, vat, %`. Require **at least two**.
    Return the first qualifying table.
  - `mapVatTable(table): VatBreakdown[]` — index cells by `rowIndex`/`columnIndex` into a sparse map.
    Assign columns from the header in **priority order, each column claimed once**:
    `rate` ← contains `stopa` / `rate` / `%`; `taxableBase` ← contains `osnovica` / `base` / `net`;
    `vatAmount` ← contains `iznos` / `amount` / `vat` / `tax`. Anything left is the (optional) label.
    For each data row: skip when the label cell — or, when there is no label column, the first
    populated cell — starts with `ukupno` / `sveukupno` / `total`. Parse the three cells with
    `parseReceiptAmount`. **Keep the row only when at least one of the three parses non-`null`.**
- **PATTERN**: `mapVatBreakdown` in `azure-fields.ts:180` for the returned `VatBreakdown` shape
  (`{rate, taxableBase, vatAmount}`, each `string | null`).
- **IMPORTS**: `type { AnalyzeResultOutput, DocumentTableOutput } from "@azure-rest/ai-document-intelligence"`,
  `type { VatBreakdown } from "@receipt/shared"`, `parseReceiptAmount` from `./receipt-amount.js`.
- **GOTCHA**: **Cells are sparse.** `screenshot-20190705-1907152` table 0 has rows with missing
  `columnIndex` entries. Never assume a dense `rowCount × columnCount` grid.
- **GOTCHA**: Priority-order assignment matters — `"Iznos poreza"` contains both `iznos` and `porez`.
  Claiming each column once resolves it to `vatAmount`. See §0.4.
- **GOTCHA**: The "at least one parses" rule is what discards `["Račun broj:", "10752/310012/2"]`.
  It is load-bearing, not defensive.
- **VALIDATE**: `npx vitest run --project api vat-tables`

### 6. CREATE `api/src/providers/document-extraction/vat-tables.test.ts`

- **IMPLEMENT**: Positive cases against recorded fixtures:
  `racun-mobilna-trgovina` → exactly one row `{rate:"25.00", taxableBase:"82.95", vatAmount:"20.74"}`
  (proving the `["Ukupno porezi", …]` summary row is skipped); `31231822` → one row
  `{rate:"25.00", taxableBase:"10.40", vatAmount:"2.60"}`; `26515835` → one row
  `{rate:"05.00", taxableBase:"01.90", vatAmount:"00.09"}` (proving the header-only-3-columns shape
  and that the `["Račun broj:", …]` row is discarded).
  Negative cases: `screenshot-20190705-1907152` → `findVatTable` returns `null` (one keyword only);
  `primjer-pdf-racuna` and `racuntaksi1` → `null`; a synthetic table whose header is a header but
  whose rows are all unparseable → `[]`.
- **GOTCHA**: Assert `"05.00"`/`"01.90"`/`"00.09"` with their leading zeros — that is the decided
  behaviour, per §0.5, not a bug to normalize away.
- **VALIDATE**: `npx vitest run --project api vat-tables`

### 7. UPDATE `api/src/providers/document-extraction/azure-fields.ts`

- **IMPLEMENT**: Four changes.
  1. **Currency (replace lines 84–89).** Delete the symbol gate. Call `resolveCurrency`, passing the
     `InvoiceTotal`/`Total` field, `analyzeResult.content` and the already-mapped `fields`. On a
     result, set `fields.currency` and
     `fieldMetadata.currency = { confidence: <see below>, source: result.source }`.
     **When `source === "inferred"`, set `confidence` to a value below `LOW_CONFIDENCE_THRESHOLD`
     (0.7)** — `0.5` — so the existing `lowConfidenceFields` projection paints it amber and asks the
     user to confirm it. This resolves spec open question 2 by reusing the one existing
     "needs checking" convention rather than inventing a second (README, Review and confirmation).
  2. **VAT precedence.** `TaxDetails` (existing `mapVatBreakdown` when `valueArray` is present) →
     **`findVatTable`/`mapVatTable`** → `TotalTax` (the existing rate-less single-row fallback).
     Only use the table result when it yields at least one row.
  3. **Amount noise.** `mapVatBreakdown` and `mapItems` call `parseReceiptAmount` instead of
     `parseAmount`. **Nothing else changes** — `assignAmount` for `subtotal`/`total` keeps
     `parseAmount` (spec §4.3).
  4. `MappedAnalyzeResult` gains `vatSource: "model" | "table" | "total" | null` so callers can tell
     where VAT came from without re-deriving it.
- **PATTERN**: existing `assignText`/`assignAmount` helpers; keep the same
  `(fields, metadataByField, …)` mutation style rather than introducing a new one.
- **IMPORTS**: add `resolveCurrency` from `./currency.js`, `findVatTable`/`mapVatTable` from
  `./vat-tables.js`, `parseReceiptAmount` from `./receipt-amount.js`, `LOW_CONFIDENCE_THRESHOLD`
  from `./types.js`.
- **GOTCHA**: **`mapAnalyzeResult` currently receives only `analyzeResult`, and currency rule 3 needs
  the JIR/ZKI/OIB and issue date that `applyTextFallbacks` adds afterwards in `azure.ts:72`.** Do
  **not** move currency resolution into `azure.ts` — `source-regions.ts:41` calls `mapAnalyzeResult`
  independently and would then lose the currency region. Instead let `resolveCurrency` derive what it
  needs from `analyzeResult.content` itself (it already imports the `croatian.js` finders), keeping
  the mapper the single source of truth for both callers.
- **GOTCHA**: `signature` change to `MappedAnalyzeResult` ripples into `source-regions.ts`, which
  destructures it. Typecheck after this task, not at the end.
- **VALIDATE**: `npm run typecheck; npx vitest run --project api azure-fields`

### 8. UPDATE `api/src/providers/document-extraction/azure-fields.test.ts`

- **IMPLEMENT**: Add fixture assertions for the three fixed defects:
  `racun-mobilna-trgovina` → `currency === "HRK"`, metadata source `"inferred"`, confidence `< 0.7`,
  and a populated `vatBreakdown`; `31231822` → `vatBreakdown` populated **and**
  `items[0].total === "13.00"` (the `13,00 H` fix, spec DoD line 3); `26515835` → `vatBreakdown`
  populated. Assert `images` still maps VAT from `TaxDetails` (precedence unchanged) and that
  `racuntaksi1` still has no VAT.
- **VALIDATE**: `npx vitest run --project api azure-fields`

### 9. UPDATE `api/src/providers/document-extraction/source-regions.ts`

- **IMPLEMENT**: Make `addVatRegions` handle table-sourced VAT. When `mapped.vatSource === "table"`,
  re-run `findVatTable` and emit one region per populated cell, using each cell's own
  `boundingRegions[0].polygon`, at paths `vatBreakdown.<row>.<rate|taxableBase|vatAmount>` — where
  `<row>` is the index **after** summary/unparseable rows are dropped, so it matches the canonical
  array index the review form uses.
- **PATTERN**: lines 69–88 of this same file already re-run the Croatian fallbacks independently;
  this mirrors that precedent exactly.
- **GOTCHA**: **Row indices must match the mapped array, not the table's raw row numbers.** A skipped
  `Ukupno porezi` row shifts them. Have `mapVatTable` return the source row index alongside each
  mapped row (or return `{ rows, sourceRowIndexes }`) rather than recomputing the skip logic twice.
- **GOTCHA**: All cells in every recorded fixture carry `boundingRegions` (verified 8/8, 12/12, 8/8),
  but still guard for absence — `addCorners` already no-ops on a missing polygon.
- **GOTCHA**: The output must still satisfy `sourceRegionsResponseSchema.parse` at line 90
  (`/validate` 6.17).
- **VALIDATE**: `npx vitest run --project api source-regions`

### 10. UPDATE `api/src/providers/document-extraction/source-regions.test.ts`

- **IMPLEMENT**: Assert `racun-mobilna-trgovina` now yields regions for `vatBreakdown.0.rate`,
  `vatBreakdown.0.taxableBase` and `vatBreakdown.0.vatAmount`, each with four corners inside `[0,1]`,
  and that no region is emitted for the skipped summary row. Assert `images` (the `TaxDetails` path)
  is unchanged.
- **VALIDATE**: `npx vitest run --project api source-regions`

### 11. CREATE `api/src/providers/document-extraction/tax-signals.ts`

- **IMPLEMENT**: `hasUnreadVatSignal(content: string): boolean` per §0.3 — **not** per spec §4.5.
  Return `false` immediately when a VAT-exemption phrase matches:
  `nije u sustavu pdv`, `pdv nije obračunat`, `oslobođen\w*\s+pdv`, or
  `(čl|clan|član|clanka|članka)\.?\s*90`. Otherwise return `true` only when **at least two distinct**
  structural markers appear among `osnovica`, `stopa`, `iznos`, `porez`. Case-insensitive, and run
  against `stripContentMarkers(content).text`.
- **GOTCHA**: This deliberately does **not** treat a bare `PDV` as a signal. Three real fixtures
  mention `PDV` only to say it does not apply. See §0.3 — implementing spec §4.5 literally warns on
  3 of 7 correct receipts.
- **GOTCHA**: Croatian diacritics — match both `čl.` and `cl.`, `članka` and `clanka`; OCR drops
  diacritics regularly.
- **VALIDATE**: `npx vitest run --project api tax-signals`

### 12. CREATE `api/src/providers/document-extraction/tax-signals.test.ts`

- **IMPLEMENT**: Assert `true` for the three fixtures with a real unread recap
  (`26515835`, `31231822`, `racun-mobilna-trgovina`) and `false` for all three exempt fixtures
  (`racuntaksi1`, `primjer-pdf-racuna`, `screenshot-20190705-1907152`) — quoting the exemption
  sentence in each test name so a future reader sees why. Add a unit case proving a single marker
  (`osnovica` alone) is not enough.
- **VALIDATE**: `npx vitest run --project api tax-signals`

### 13. ADD the `vat_present_but_unread` warning

- **IMPLEMENT**: Four coordinated edits.
  1. `shared/src/warnings.ts` — append `"vat_present_but_unread"` to `WARNING_CODES`.
  2. `api/src/validation/warnings.ts` — `WarningInput` gains
     `readonly vatTextPresent?: boolean`. In `computeWarnings`, push
     `{ code: "vat_present_but_unread", field: "vatBreakdown" }` when `vatTextPresent === true` **and**
     `fields.vatBreakdown` is absent or empty. Keep the function pure — no regex, no content string.
  3. `api/src/services/receipt-extraction.ts` — compute the flag once from the provider result and
     pass it into `computeWarnings`; persist it in `extractionMetadata` (alongside
     `unreadableFields`) so the PATCH path can recompute identically.
  4. `api/src/routes/receipts.ts` — add a `vatTextPresent(metadata: unknown): boolean` reader
     mirroring `unreadableFields` at line 376, and pass it in the PATCH handler's `computeWarnings`
     call (line 153).
- **IMPORTS**: `hasUnreadVatSignal` from the provider module, used **only** in the service/provider
  layer — never in `validation/warnings.ts`.
- **GOTCHA**: `ExtractionMetadata` in `types.ts` must gain the field, or persisting it is untyped.
- **GOTCHA**: The warning must never gate anything (`/validate` 6.13, PRD §7.8).
- **GOTCHA**: `client/src/i18n/warnings.test.ts` fails until both locales carry the message — that is
  the next task, so expect a red client suite between 13 and 14.
- **VALIDATE**: `npx vitest run --project api warnings; npx vitest run --project shared`

### 14. ADD locale copy for the new warning and the failure reasons

- **IMPLEMENT**: In `client/src/i18n/locales/en.json` and `hr.json`:
  - `warnings.vat_present_but_unread` — EN: "This receipt shows VAT information we could not read.
    Check the VAT section against the receipt." HR: "Na računu postoji PDV koji nismo uspjeli
    pročitati. Provjerite odjeljak PDV-a prema računu."
  - `processing.failure.unreadable_document`, `.provider_rejected`, `.provider_unavailable` — with
    `unreadable_document` reading as a retake instruction, not a retry prompt (spec §4.6).
- **GOTCHA**: **Write these files with UTF-8 encoding.** `/validate` 6.11 exists because a previous
  task shipped `PokuÅ¡ajte` — Croatian `š`, `č`, `ć`, `ž`, `đ` re-read as Latin-1. Verify with 6.11
  immediately after editing.
- **VALIDATE**: `npx vitest run --project client i18n; node -e "<Phase 6.11 mojibake check>"`

---

*Commit A ends here. Run the Commit A validation set below before continuing.*

---

### 15. ADD `failureReason` to the receipt detail contract

- **IMPLEMENT**: `shared/src/api.ts` — `receiptDetailResponseSchema` gains
  `failureReason: z.string().nullable()`. In `api/src/routes/receipts.ts`, add a
  `failureReason(metadata: unknown): string | null` reader mirroring `unreadableFields`, returning the
  persisted `failure.reason` **only when `receipt.status === "failed"`**, and include it in both the
  `GET /:id` (line 126) and `PATCH /:id` (line 161) responses.
- **GOTCHA**: The reason is a stable machine code the client translates — never prose, never a
  provider message (PRD §7.6, README error convention).
- **GOTCHA**: Adding a required key to `receiptDetailResponseSchema` means every place constructing
  that response must supply it. Typecheck immediately.
- **VALIDATE**: `npm run typecheck; npx vitest run --project api routes`

### 16. UPDATE `client/src/routes/ProcessingPage.tsx`

- **IMPLEMENT**: Keep `failureReason` from the polled receipt in state. In the `failed` branch render
  `t(\`processing.failure.\${reason}\`)` when the reason is one of the three known codes, falling back
  to the existing `processing.failed`. Render the **Retry** button only when the failure is
  retryable — for `unreadable_document`, render the "Upload another receipt" link as the primary
  action instead, since retrying identical bytes cannot succeed.
- **PATTERN**: the existing `state === "failed"` branch at lines 115–131.
- **GOTCHA**: The key is built from a template literal, so `/validate` 6.5's literal-key scan
  **cannot** see it — task 17's parity test is the only guard. This is the same reason
  `warnings.test.ts` and `receiptStatuses.test.ts` exist.
- **VALIDATE**: `npx vitest run --project client ProcessingPage`

### 17. CREATE `client/src/i18n/failureReasons.test.ts`

- **IMPLEMENT**: Assert every known failure code has a non-empty `hr` and `en` message under
  `processing.failure.*`, and that no orphan message exists. Derive the code list from a single
  exported constant rather than restating it.
- **PATTERN**: copy `client/src/i18n/uploadErrors.test.ts` structurally.
- **VALIDATE**: `npx vitest run --project client failureReasons`

### 18. UPDATE `client/src/routes/ReviewPage.tsx` — one blank VAT row

- **IMPLEMENT**: When `vatBreakdown` is empty, initialize the field array with one blank row
  `{rate:"", taxableBase:"", vatAmount:""}` so the section reads as an empty form rather than an
  absent feature (spec §4.8). **No other structural change** — field order, sectioning and the amber
  treatment stay exactly as they are.
- **GOTCHA**: A blank row must not be submitted as a VAT entry. Confirm `reviewForm.ts` already maps
  empty strings to `null` and that an all-null row is dropped before PATCH; if it is not, drop it at
  submit rather than changing the canonical schema.
- **GOTCHA**: CLAUDE.md §3 — do not "improve" the surrounding form while you are in this file.
- **VALIDATE**: `npx vitest run --project client ReviewPage`

### 19. CREATE `client/src/capture/downscale.ts`

- **IMPLEMENT**: `downscaleReceiptImage(file: File): Promise<File>`. Return the **original file
  unchanged** for PDFs, for images at or below the threshold, and whenever decoding or encoding
  fails. Above ~2 MP **or** ~1.5 MB, decode, draw to a canvas scaled so the long edge is
  `DOWNSCALE_LONG_EDGE` px, and re-encode as `image/jpeg` at quality `0.82` via `toBlob`. Export the
  threshold constants so the test and the harness can reference them.
- **PATTERN**: `analyzeReceiptImage` in `client/src/capture/receiptFile.ts:91` — the same
  `URL.createObjectURL` → `image.decode()` → canvas → `finally { URL.revokeObjectURL(url) }` shape,
  and the same `PreviewUnavailableError` handling.
- **GOTCHA**: `toBlob` is asynchronous and yields `null` on failure — wrap it in a promise and fall
  back to the original file.
- **GOTCHA**: A browser that cannot decode HEIC also cannot downscale it, so those uploads keep full
  size. That is accepted (spec open question 3); **do not** add a server-side downscale as a second
  line of defence in this iteration — it is unrequested scope.
- **GOTCHA**: Canvas re-encoding **bakes in EXIF orientation**. This is a side benefit that may fix
  the suppressed source overlay described in README "Review and confirmation" — verify it in a
  browser rather than claiming it.
- **VALIDATE**: `npx vitest run --project client downscale`

### 20. MEASURE the downscale threshold, then wire it into the upload

- **IMPLEMENT**: **Measure before fixing the constant.** Run the corpus's stress cases —
  `Wide-Racunnnnn-1000.jpg`, `Screenshot_20190705-1907152.png` (1.3 MB) and the longest thermal
  receipt available — through Azure at the candidate long edge and compare critical-field extraction
  against the full-size result. Only then fix `DOWNSCALE_LONG_EDGE` (1600 px is the spec's starting
  point, **not** a measured one — spec open question 4). Record the measurement in the history file.
  Then call `downscaleReceiptImage` in `HomePage.tsx` before `createReceipt(selected.file)`.
- **GOTCHA**: **The uploaded file becomes the stored source**, so PRD §7.3's "preserve the original"
  is being deliberately amended. Record the amendment explicitly in the history file **and** in
  `README.md` (spec D4, §4.7a). Do not leave it implicit.
- **GOTCHA**: The preview shown to the user must stay the file that is actually uploaded, or the
  user approves one image and sends another.
- **VALIDATE**: `npx vitest run --project client HomePage`

### 21. Concurrent analysis and the latency phase split

- **IMPLEMENT**: Two changes.
  1. `api/src/routes/receipts.ts` `POST /` (lines 194–231): after `validateSourceFile`, start
     `extractionProvider.extract({ bytes, contentType })` and **attach a no-op `.catch()` to the
     promise immediately**, before any `await`. Then `await uploadSource(...)`, create the row, send
     the `201`, and hand the already-in-flight promise to `extractReceipt`.
     `ExtractReceiptInput` gains `readonly extraction?: Promise<ProviderExtractionResult>`; when
     present, `extractReceipt` awaits it instead of calling `provider.extract`.
  2. `api/src/providers/document-extraction/azure.ts`: time the initial POST and the poll separately
     in `analyzeWithAzure` and record `uploadMs` / `analyzeMs` on `ExtractionMetadata` alongside the
     existing `latencyMs`.
- **GOTCHA**: **The no-op `.catch()` must be attached synchronously at creation.** An early rejection
  while `uploadSource` is still awaited is otherwise an unhandled rejection that can crash the
  process. `extractReceipt` still awaits the same promise and still sees the rejection.
- **GOTCHA**: The invariant "a receipt row never exists without a source object" is preserved because
  the row is still created only after the upload succeeds. The accepted cost is one wasted Azure call
  when the row insert fails — record it.
- **GOTCHA**: The existing rollback (`removeSource` on insert failure, lines 222–229) must still run.
- **VALIDATE**: `npm run typecheck; npx vitest run --project api receipt-extraction; npx vitest run --project api routes`

### 22. Ground truth, the harness, and the before/after numbers

- **IMPLEMENT**: Four steps, in order.
  1. **Record the new fixtures.** Run the existing recorder over the corpus so the eight receipts the
     client added on 2026-08-25 gain responses:
     `node --env-file=.env scripts/record-azure-fixture.mjs .agents/fixtures/receipts`.
  2. **Propose ground truth.** For each source, write `.agents/fixtures/expected/<name>.json` with the
     five critical fields plus VAT and currency, read from the receipt image. **Omit anything
     ambiguous rather than guessing** — a wrong label is worse than no label (spec §5, risk table).
     Flag the file for the client to spot-check (D8).
  3. **Build `scripts/score-extraction.ts`**, run with `npx tsx`, replaying recorded fixtures through
     the **real** `mapAnalyzeResult` + `applyTextFallbacks` + `computeWarnings` pipeline — offline,
     no Azure cost. Report per-field exact-match rate before any user correction, the share of
     receipts needing no critical-field correction, the most-corrected fields, and latency
     percentiles from recorded metadata. Add an npm script.
  4. **Record before and after.** Run the harness at the commit *before* this iteration's first fix
     and again at the end; put both tables in the history file.
- **PATTERN**: `scripts/record-azure-fixture.mjs` and `scripts/compare-azure-models.mjs` for CLI shape
  and env handling.
- **GOTCHA**: A `.ts` script needs `npx tsx`, not bare `node` — the existing scripts are `.mjs` and
  do not import TypeScript. Either use `tsx` or import from built `api/dist`; do not duplicate the
  mapper logic in JavaScript, which would score a copy rather than the real pipeline.
- **GOTCHA**: **The before-numbers must be captured before any fix lands** (spec §5). If tasks 1–21
  are already committed, check out the parent commit to generate them.
- **VALIDATE**: `npm run score:extraction`

---

## TESTING STRATEGY

### Unit Tests

Vitest across three projects (`shared`, `api` node; `client` jsdom). Every new module gets a sibling
`*.test.ts`. The accuracy work is **fixture-driven**: assertions run against the committed recorded
Azure responses, offline and free, which is what makes this whole iteration cheap to iterate on.

New tests to add to the `/validate` Phase 4 table:

| Test | Protects |
|---|---|
| `receipt-amount.test.ts` | Receipt noise (`%`, tax-class letter, `*`) is normalized before `parseAmount`, while two-letter currency tokens are left to it; unreadable input stays `null` |
| `currency.test.ts` | The ordered resolution on all seven fixtures, including the two exclusions (`EURO:` label, `(1 Eur= …)` conversion) that keep the euro-mistake receipt on `HRK` |
| `vat-tables.test.ts` | Header-driven column mapping across three header shapes including a label-less 3-column recap; summary-row skipping; the unrelated-row and header-is-data negative cases |
| `tax-signals.test.ts` | The structural recap signal fires on three genuinely-unread receipts and abstains on three VAT-exempt ones |
| `azure-fields.test.ts` (extended) | The three fixed defects end to end through the real mapper |
| `source-regions.test.ts` (extended) | Table-sourced VAT still projects outlines, from table cell geometry, at canonical row indices |
| `warnings.test.ts` (extended) | `vat_present_but_unread` fires only on an empty breakdown with the flag set, and never blocks |
| `failureReasons.test.ts` | Locale parity for template-literal-built `processing.failure.*` keys |
| `downscale.test.ts` | Threshold behaviour, PDF and small-image passthrough, and graceful fallback when decode or encode fails |

### Integration Tests

`npm run test:integration` (hosted) — required. Extend `api/src/routes/receipts.integration.ts` to
assert `failureReason` is present on a failed receipt and absent otherwise. Phase 7a (Docker) is
**skippable** here: no file under `supabase/migrations/` changes. Report the skip with that reason.

### Edge Cases

- A table whose header row is data (`screenshot-20190705`) — must not be read as a recap.
- Sparse table cells — missing `columnIndex` entries must not throw.
- A VAT recap with no label column (`26515835`).
- An unrelated row merged into the recap table (`Račun broj:`).
- A receipt printed in two currencies (`racuntaksi1`) — must abstain, not pick.
- A currency word used as a label (`EURO:`) and inside a conversion (`1 Eur= 7,43567`).
- A VAT-exemption notice — must not raise `vat_present_but_unread`.
- A receipt genuinely without VAT and without exemption text.
- HEIC that the browser cannot decode — upload proceeds at full size.
- Azure rejecting the analysis *before* the storage upload resolves (the unhandled-rejection path).
- A row insert failing after the concurrent Azure call has started.

---

## VALIDATION COMMANDS

### Commit A (accuracy & transparency)

```
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
```

Plus Phase 6 checks genuinely implicated by this diff: **6.5** (translation keys), **6.6** (docs),
**6.8** (money never a number), **6.10** (no provider floats), **6.11** (mojibake — mandatory, the
locale files are edited), **6.13** (warnings never gate), **6.17** (regions schema).

### Commit B (speed & measurement)

```
npm test
npm run test:integration
npm run score:extraction
```

Plus **6.9** (no raw fetch outside the API client) and **6.14** (routes never rewrite machine
extraction — `POST /` is restructured).

### Level 4: Manual validation

- **Phase 8.8 (extraction)** — re-run with a Croatian receipt; confirm VAT and currency populate.
- **Phase 8.14 (field highlighting)** — re-run at 1440 px against a receipt with a table-sourced VAT
  recap and confirm the VAT outlines still render. **This is the regression this iteration is most
  likely to cause and jsdom cannot see it.**
- **New Phase 8.16 journey** — see below.
- A failed receipt shows a cause-specific translated message; an unreadable document offers no retry.
- A >2 MP photo is downscaled before upload, and the review page, source panel and highlighting all
  still work against the downscaled source.

### Level 5: `/validate` maintenance

Hand-extend `.claude/commands/validate.md` — never regenerate it:
- add the nine Phase 4 rows above;
- add **Phase 8.16 — extraction accuracy**: upload a receipt with a Croatian VAT recap and confirm the
  VAT section populates with rate/base/amount, that currency is populated and marked amber when
  inferred, that VAT source outlines render, and that a VAT-exempt receipt raises **no**
  `vat_present_but_unread` warning;
- add a Phase 6 check that `shared/src/money.ts` is unmodified by this iteration's diff, since the
  whole `parseReceiptAmount` design depends on it staying the canonical contract.

---

## ACCEPTANCE CRITERIA

- [ ] `racun-mobilna-trgovina` (= `receiptEuroMistake.jpg`) extracts `currency: "HRK"` with
      `source: "inferred"`, surfaced as low-confidence in the review form
- [ ] All three Croatian fixtures extract a complete `vatBreakdown` row: `25.00`/`82.95`/`20.74`,
      `25.00`/`10.40`/`2.60`, and `05.00`/`01.90`/`00.09`
- [ ] `31231822` (= `receiptWithTaxMistake.jpg`) extracts its line-item total as `13.00`, not `null`
- [ ] A receipt whose source shows an unread VAT recap raises exactly one `vat_present_but_unread`
      warning, in both languages
- [ ] **Zero false positives** for that warning across the recorded corpus — specifically, the three
      VAT-exempt fixtures raise none
- [ ] The VAT section's source-document outlines still render, sourced from table cell geometry
- [ ] A failed receipt shows a translated, cause-specific message; an unreadable document offers no
      pointless retry
- [ ] A >2 MP photo is downscaled before upload; review, source panel and highlighting still work
- [ ] Azure analysis starts before the storage upload completes, proven by the recorded phase split
- [ ] `npm run score:extraction` runs offline and reports per-field accuracy, with before/after
      numbers in the history file
- [ ] No Azure field name reaches the API surface, the canonical column or the UI
- [ ] `shared/src/money.ts` is byte-identical to its pre-iteration state
- [ ] `/validate` passes, with the new Phase 4 rows and the Phase 8.16 journey
- [ ] PRD §7.3 amendment (stored source is the downscaled upload) recorded in the history file **and**
      README
- [ ] PRD §11.4 latency target amended from "2–5 s" to a measured warm figure, with the free-tier
      cold start called out separately

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task's validation passed immediately
- [ ] Commit A validated and committed before Commit B was started
- [ ] Full test suite passes (unit + hosted integration)
- [ ] No lint or typecheck errors
- [ ] Real-browser verification of the VAT highlighting regression and the downscaled-source flow
- [ ] Acceptance criteria all met
- [ ] `.claude/commands/validate.md` hand-extended
- [ ] History file `.agents/history/18-extraction-accuracy-and-speed.md` written, including the
      before/after accuracy tables and every decision below
- [ ] `.agents/ROADMAP.md` §3 iteration table updated

---

## NOTES

### Decisions taken during planning (resolving the spec's open questions)

- **Open question 1 — ZKI (spec §2.8): closed, not a defect.** Both fixtures extract ZKI correctly
  through the text fallback (`racun-mobilna-trgovina` even carries JIR and ZKI in their own Azure
  table). The client's observation was almost certainly made against the QR panel, where a bare-JIR
  payload legitimately yields `zki: null`. **No code change.** Record this in the history file so it
  is not re-investigated.
- **Open question 2 — inferred values in the UI: reuse the amber low-confidence treatment.**
  Implemented by giving an inferred currency a confidence below `LOW_CONFIDENCE_THRESHOLD`, so it
  flows through the existing `lowConfidenceFields` projection with no new UI concept. This follows
  the README's argument that one appearance for "needs checking" beats two conventions.
- **Open question 3 — HEIC: no server-side downscale.** A browser that cannot decode HEIC uploads at
  full size. Adding a server-side fallback is unrequested scope for a rare case.
- **Open question 4 — downscale threshold: must be measured (task 20).** 1600 px is a starting point,
  not a decision.
- **Leading zeros (§0.5): left as-is.** Fixing them means touching `shared/src/money.ts`, which spec
  §4.3 forbids, and the behaviour predates this iteration.

### Trade-offs

- **VAT precedence keeps `TaxDetails` first** even though the table reader is more capable, because
  `images.json` proves the structured path works where Azure supplies it, and a provider-supplied
  structure carries confidence data a scraped table does not.
- **Re-running `findVatTable` inside `source-regions.ts`** duplicates a little work per request
  rather than threading table provenance through `MappedAnalyzeResult`. This mirrors the existing
  precedent for Croatian fallbacks in that same file and keeps `mapAnalyzeResult`'s return type from
  growing an Azure-shaped payload that would then be one refactor away from leaking.
- **The concurrent Azure call can be wasted** when the row insert fails. Accepted, and cheap relative
  to the latency it saves on every successful upload.

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Currency rule 1 fires on a label or conversion and returns `EUR` on the kuna receipt | **High** — the headline DoD item | The two exclusions in task 3, with all seven fixtures asserted in task 4 |
| `vat_present_but_unread` becomes noise on exempt receipts | **High** — trains users to ignore warnings | Structural signal + exemption exclusion, measured at zero false positives across the corpus (§0.3) |
| VAT source-region highlighting breaks silently when VAT moves to tables | Medium | Explicit scope item (task 9), its own test (task 10), and browser verification in Phase 8.14 |
| Downscaling degrades OCR on faded or long thermal receipts | High | Threshold measured against real stress cases before it is fixed (task 20) |
| Table reader misreads an unrelated table as a recap | Medium | Two-keyword threshold, header-semantic column mapping, summary-row skip, "at least one parses" row filter, `TaxDetails` still first |
| The stored source is no longer the byte-exact original | Low | Deliberate and client-approved (D4); recorded as a PRD §7.3 amendment in both the history file and README |
| Ground-truth labels proposed by the agent are wrong | Medium | Client spot-checks; ambiguous fields omitted rather than guessed |
| Scope is large enough to be rushed | Medium | Two-commit split; Commit A alone is a coherent shippable iteration |

### Confidence

**8/10** for one-pass success on **Commit A** — the accuracy work is fully grounded in recorded
fixtures with exact expected values, and the three spec errors that would have caused rework are
resolved above.

**6/10** for **Commit B** — the downscale threshold is genuinely unmeasured, the concurrency change
touches request lifecycle ordering, and both need real-browser and live-Azure verification that
cannot be front-loaded into a plan.
