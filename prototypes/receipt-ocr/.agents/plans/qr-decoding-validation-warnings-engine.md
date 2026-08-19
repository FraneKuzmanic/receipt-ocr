# Feature: QR decoding & validation/warnings engine (Task 08)

The following plan should be complete, but it is important that you validate documentation, codebase
patterns and task sanity before you start implementing.

Pay special attention to the naming of existing utils, types and models. Import from the right files.
`api` and `shared` use `nodenext` module resolution, so **every relative import needs a `.js`
extension even in `.ts` source**. Cross-workspace imports always use `@receipt/shared`.

## Feature Description

Croatian fiscalized receipts carry a QR code containing the Tax Administration verification URL, the
JIR (or ZKI), the issue date/time and the total. This task decodes that QR when present, stores the
payload separately from the OCR result, and adds a deterministic warnings engine that cross-checks QR
values against the extracted canonical values and flags obviously missing or inconsistent data.

Warnings are informational only. Nothing here may ever block confirmation.

## User Story

As a business user
I want the application to tell me when the extracted data looks incomplete or disagrees with the
receipt's own QR code
So that I know which fields deserve a second look before I confirm — without being blocked from
confirming a receipt I know is correct.

## Problem Statement

After Task 07, an uploaded receipt reaches `review` with canonical fields populated from Azure, but:

- The fiscal QR code on the receipt — an independent, machine-precise source for the total, the
  date/time and the JIR — is completely ignored.
- `receipts.warnings` is always `[]`. `shared/src/warnings.ts` defines seven warning codes and both
  locale files already carry `hr`/`en` messages for all seven, but **nothing produces a single
  warning**. The taxonomy is dead weight until something fills it.
- A field that Azure saw but could not normalize (a date written `31/03/2025,`) is stored as `null`,
  indistinguishable from a receipt that genuinely has no date. The user is given no hint that
  something was there.

## Solution Statement

Enable Azure Document Intelligence's **free `barcodes` add-on** on the existing analyze call, parse
the Croatian fiscal QR payload into a structured record, persist it in the already-existing
`qr_extraction` column, and run a pure warnings engine over `(canonical fields, QR data, unreadable
field list)` at the end of extraction.

The engine is a set of pure functions with no I/O, so Task 09 can re-run it on every `PATCH` without
re-running OCR — which is exactly what "correcting the total clears the warning" requires.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: `api` — document-extraction provider, extraction service, new validation
module. `shared` — unchanged. `client` — unchanged.
**Dependencies**: **None added.** QR decoding rides on the existing `@azure-rest/ai-document-intelligence`
call.

---

## DECISIONS THIS TASK OWNS

`.agents/ROADMAP.md` §2 defers two decisions to Task 08. Both are resolved below **with live
evidence gathered during planning**, not intuition. Record them in the history file.

### D1 — QR decode library and where decoding runs → **no library; server-side, inside the existing Azure call**

`features=barcodes` was probed live against the configured Azure resource with `prebuilt-invoice`,
API version `2024-11-30`, over all six real receipt sources in `C:\Users\Frane\Desktop\računi\`:

| Source | Barcode result | Latency |
| --- | --- | ---: |
| `26515835.jpg` | `QRCode` conf 1 → `https://porezna.gov.hr/rn?jir=1193a137-a1f5-4085-9e1b-3a0919701a4f&datv=20240123_1512&izn=199` | 9,632 ms |
| `racuntaksi1.jpg` | `QRCode` conf 1 → `https://porezna.gov.hr/rn?jir=18916f95-5787-4e7f-a190-3a091970cfa2&datv=20250331_2359&izn=132,72` | 7,569 ms |
| `racun-mobilna-trgovina.jpg` | `QRCode` conf 1 → `ac12e053-3300-496a-8ad4-1bd2c10b0ec6` (bare UUID, **no URL**) | 7,838 ms |
| `31231822.jpg` | no barcode | 9,976 ms |
| `images.jpg` | no barcode | 7,486 ms |
| `Screenshot_20190705-1907152.png` | no barcode | 12,870 ms |

Why this beats adding a QR library:

- **Zero new dependencies.** Every Node QR library needs an image decoder in front of it (`jpeg-js`,
  `sharp`, `canvas`), and a **PDF rasterizer** for PDF sources, and **none** of them decode HEIC —
  all three of which this app accepts today. Azure handles PDF, JPEG, PNG and HEIF identically.
- **Barcode extraction is a Free add-on**, not a premium one (Azure "Version availability" table).
  No extra Azure cost, and `prebuilt-invoice` lists Barcodes as an optional supported feature in the
  "Model analysis features" table.
- **No latency cost** — the numbers above sit inside the spread Task 07 already recorded (7.4–8.0 s).
- **Field extraction is provably unaffected.** A back-to-back comparison of `26515835.jpg` with and
  without the feature returned an **identical field set** (`CustomerAddress`,
  `CustomerAddressRecipient`, `CustomerName`, `InvoiceId`, `InvoiceTotal`, `Items`, `VendorAddress`,
  `VendorAddressRecipient`, `VendorName`, `VendorTaxId`) and identical `content` for `VendorName`,
  `InvoiceId`, `InvoiceTotal` and `VendorTaxId`.

The only content change: Azure inserts the literal marker `:barcode:` into `analyzeResult.content` at
the barcode's reading-order position (`content` grew 498 → 508 chars). See **G3**.

### D2 — Croatian fiscal QR payload format → three real variants, parsed tolerantly

Specification (Porezna uprava "Fiskalizacija — Tehnička specifikacija za korisnike"): the QR is
version 4 and carries the verification URL, JIR (36 chars) **or** ZKI (32 chars), `datv` as
`GGGGMMDD_HHMM` (13 chars) and `izn`, the total.

```text
https://porezna.gov.hr/rn?jir=<uuid-36>&datv=YYYYMMDD_HHMM&izn=1000000,00
https://porezna.gov.hr/rn?zki=<hex-32>&datv=YYYYMMDD_HHMM&izn=1000000,00
```

Real payloads deviate from the specification, so the parser must be tolerant:

1. Full URL with `jir` (observed twice).
2. **Bare UUID with no URL at all** (`racun-mobilna-trgovina.jpg`). No specification document mentions
   this; it was found only by probing real receipts.
3. `izn` **with** a decimal separator (`132,72`) and **without** one (`199`) — see D3.

### D3 — An `izn` with no decimal separator produces **no** total comparison

`26515835.jpg` totals **1,99 EUR** (`InvoiceTotal` content `"1,99"`; the receipt's own VAT lines read
base `01.90` + tax `00.09`), yet its QR says `izn=199`. The POS vendor wrote the amount without the
separator. Parsing `199` as `199.00` and comparing it to `1.99` would raise a **false
`qr_total_mismatch` on a perfectly correct receipt** — and a warning users learn to ignore is worse
than no warning.

**Rule:** the QR total is carried into `FiscalQrData.total` only when the raw `izn` contains `,` or
`.`. Otherwise `total` is `null` and the comparison is skipped as "not enough information to judge" —
the same posture the roadmap already requires for VAT. The raw payload is preserved verbatim in
`FiscalQrData.raw`, so nothing is lost and a later task can revisit it.

**Do not** "fix" this by dividing by 100. That invents an interpretation of untrusted data, which
PRD §7.7 forbids.

### D4 — `document_quality` is **not produced** in this task

The seventh warning code has no available server-side signal. Measured across all seven recorded
fixtures:

- `documents[0].confidence` is **hard-coded to `1`** on every single receipt, including the poor
  phone photos. Azure's own documentation says the barcode `confidence` is hard-coded too.
- Per-word confidence does not discriminate either. The clean PDF (`primjer-pdf-racuna`) and a phone
  photo (`31231822`) both have **1.6%** of words below 0.7 and a median of **0.99**. Every fixture
  sits between 1.6% and 5.2%.

The other candidate — forwarding Task 06's client-side blur/resolution heuristic — would mean
accepting a client-asserted quality flag through the upload endpoint, whose multipart parser is
deliberately configured `fields: 0` to reject **all** text fields (a documented security property in
`README.md`). Weakening that for one informational warning is a bad trade.

**Therefore:** keep the code and its existing `hr`/`en` translations, produce nothing, and record this
with the evidence above in the history file. Inventing a threshold the data shows is meaningless would
violate CLAUDE.md §2 and ROADMAP §5 rule 5. This is deliberate pushback, not an oversight.

### D5 — `PATCH /api/receipts/:id` stays in Task 09

Task 08's scope says warnings are "recomputed on `PATCH`", but `PATCH` is listed explicitly in
**Task 09's** scope, and `updateReceiptRequestSchema` already exists in `shared` unused. This task
therefore ships the engine as an exported pure function and wires it at extraction time only. The DoD
item "correcting the total clears that warning without re-running OCR" is proven by a unit test that
calls the engine twice with different totals — which is precisely what "pure function" buys.

Do **not** add `PATCH` here.

### D6 — QR values never populate canonical fields

Per PRD §7.5 and ROADMAP Task 08: the payload goes to `qr_extraction` only. It is never merged into
`canonical_data`, never used as a fallback for a missing `jir`, and never overwrites anything. The QR
is a **cross-check**, not a second extractor.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — YOU MUST READ THESE BEFORE IMPLEMENTING

- `api/src/providers/document-extraction/azure.ts` (whole file, ~148 lines) — Why: the analyze call
  you are adding `features` to (line 111–116), the `AbortSignal` timeout discipline, and
  `applyTextFallbacks` (line 129) which reads `analyzeResult.content` and is affected by G3.
- `api/src/providers/document-extraction/types.ts` — Why: `ProviderExtractionResult`,
  `ExtractionMetadata`, `ExtractionFieldMetadata`, `ExtractionError`, and the already-defined
  `LOW_CONFIDENCE_THRESHOLD`. You extend two of these interfaces.
- `api/src/providers/document-extraction/azure-fields.ts` (lines 109–143) — Why: `assignAmount`,
  `assignDate`, `assignTime` silently drop a value they cannot parse. You make that observable.
- `api/src/providers/document-extraction/croatian.ts` — Why: the sibling module and the exact style
  your new `fiscal-qr.ts` should match — small named regexes, pure functions, `null` on failure,
  reuse of `parseIssueDate`/`parseIssueTime` from `@receipt/shared`.
- `api/src/providers/document-extraction/croatian.test.ts` — Why: the test style to mirror
  (`it.each` table, one "returns null for absent and malformed" case).
- `api/src/services/receipt-extraction.ts` (whole file, 69 lines) — Why: the single place that writes
  a `review` row; you add `qrExtraction` and `warnings` to that one `update` call.
- `api/src/services/receipt-extraction.test.ts` — Why: the `vi.mock` repository pattern to extend.
- `api/src/repositories/receipts.ts` (lines 38–48, 173–211) — Why: `UpdateReceiptInput` **already**
  accepts `qrExtraction` and `warnings`; `update()` already validates warnings with
  `warningsSchema`. **No repository change is needed.**
- `shared/src/warnings.ts` — Why: `WARNING_CODES`, `ReceiptWarning { code, field? }`. The taxonomy is
  fixed — **do not add an eighth code**, and read the comment explaining why.
- `shared/src/receipt.ts` (lines 43–73) — Why: `canonicalReceiptFieldsSchema`. Note `issueDate` is
  `z.iso.date()` and amounts match `AMOUNT_PATTERN` — this is why `unparseable_*` needs the
  `unreadable` signal (see G1).
- `shared/src/money.ts` — Why: `parseAmount`, `amountsEqual`, `addAmounts`. **`Big.strict = true`;
  passing a JS number throws.** `addAmounts` requires already-canonical strings.
- `shared/src/datetime.ts` — Why: `parseIssueDate`, `parseIssueTime` — reuse both for `datv`; do not
  hand-roll date validation and never use `Date.parse`.
- `client/src/i18n/locales/en.json` (lines 79–87) and `hr.json` — Why: **all seven warning messages
  already exist in both languages.** No i18n work is required unless you add a key, which you must not.
- `.claude/commands/validate.md` — Why: you must hand-extend Phase 4, Phase 6, Phase 8 and Phase 9.
- `scripts/record-azure-fixture.mjs` — Why: you add `features: ["barcodes"]` here and re-record.

### New Files to Create

- `api/src/providers/document-extraction/fiscal-qr.ts` — Croatian fiscal QR payload parser.
- `api/src/providers/document-extraction/fiscal-qr.test.ts` — its unit tests, offline.
- `api/src/validation/warnings.ts` — the pure rules engine. (`validation/` is the folder PRD §6.7
  names for exactly this.)
- `api/src/validation/warnings.test.ts` — one test per rule.

### Files to Modify

- `api/src/providers/document-extraction/types.ts`
- `api/src/providers/document-extraction/azure.ts`
- `api/src/providers/document-extraction/azure-fields.ts`
- `api/src/providers/document-extraction/azure.test.ts`
- `api/src/providers/document-extraction/azure-fields.test.ts`
- `api/src/services/receipt-extraction.ts`
- `api/src/services/receipt-extraction.test.ts`
- `api/src/providers/document-extraction/fixtures/*.json` (re-recorded — see Task 12)
- `scripts/record-azure-fixture.mjs`
- `README.md`, `.claude/commands/validate.md`, `.agents/ROADMAP.md`, and a new
  `.agents/history/08-qr-decoding-validation-warnings-engine.md`

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [Azure DI add-on capabilities — Barcode property extraction](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/add-on-capabilities?view=doc-intel-4.0.0#barcode-property-extraction)
  - Why: confirms `features=barcodes`, that barcodes land under `pages[].barcodes[]` with `kind`/
    `value`/`confidence`/`polygon`/`span`, that `:barcode:` is injected into `content`, and that
    `confidence` is hard-coded (which is why D4 cannot use it).
- [Azure DI model overview — "Model analysis features" table](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/model-overview?view=doc-intel-4.0.0#model-analysis-features)
  - Why: shows `prebuilt-invoice` supports Barcodes as an optional (`O`) feature, and that barcode
    extraction is **Free**, not a premium add-on.
- [Porezna uprava — Provjerite fiskalni račun](https://porezna-uprava.gov.hr/hr/fiskalizacija--provjerite-fiskalni-racun/4229)
  - Why: the verification endpoint `https://porezna.gov.hr/rn`. **Reference only — never fetch it.**
- [Fiscalis — QR kodovi na fiskaliziranim računima](https://fiscalis-racunovodstvo.hr/qr-kodovi-na-fiskaliziranim-racunima/)
  - Why: the four mandatory QR data elements and the QR-version-4 size limit (50–114 alphanumeric
    characters), which motivates the payload length cap.

The installed SDK's own types are the authority for the response shape — read them directly:
`node_modules/@azure-rest/ai-document-intelligence/dist/commonjs/outputModels.d.ts`,
`DocumentPageOutput.barcodes` and `DocumentBarcodeOutput`.

### Patterns to Follow

**Pure parser returning `null`, never throwing** (from `croatian.ts` / `money.ts`):

```ts
export function findOib(content: string): string | null {
  return capture(content, OIB);
}
```

An unreadable value is a missing value. `parseAmount`'s doc comment states the rule explicitly:
"Returns `null` for anything it cannot read, and never throws … missing stays missing rather than
being invented (PRD §7.7)."

**Named regexes at module scope, one per concept** (from `croatian.ts` lines 3–10).

**Error convention** (`api/src/middleware/error-handler.ts`, documented in README): failures return a
stable machine `code`, never prose. Not directly exercised here — this task adds no route — but the
warnings engine follows the same philosophy: emit a **code**, let the client own the copy.

**Test style** (from `croatian.test.ts`): a single realistic fixture string at module scope, `it.each`
for the table of cases, plus an explicit "absent and malformed" case.

**Service test style** (from `receipt-extraction.test.ts`): `vi.mock` the repository module with a
class exposing a `vi.fn()` `update`, then assert with `expect.objectContaining`.

### Anti-patterns to avoid

- ❌ Adding an eighth warning code. The seven are derived from the roadmap; the comment in
  `shared/src/warnings.ts` explains why adding one speculatively is wrong.
- ❌ Fetching, resolving or following the QR URL (PRD §9.3). Not even to validate it.
- ❌ Letting a QR value populate a canonical field (D6).
- ❌ `Number(...)` / `parseFloat` on the QR amount. Route everything through `parseAmount`.
- ❌ Any code path where a warning prevents an action.
- ❌ Editing a mapper test to match a re-recorded fixture. See Task 12's stop condition.

---

## GOTCHAS

**G1 — `unparseable_date` and `unparseable_amount` are unreachable without a new signal.**
`canonicalReceiptFieldsSchema` validates `issueDate` with `z.iso.date()` and amounts against
`AMOUNT_PATTERN`, so a persisted receipt **cannot** hold an unparseable value; the mapper already
dropped it to `null`. Both rules would be dead code.

The fix is small and is genuinely needed, not speculative: when `assignAmount`/`assignDate`/
`assignTime` receive a non-empty `field.content` but their parser returns `null`, record the canonical
field name in a new `unreadableFields: string[]`. The engine then distinguishes "the receipt had no
date" from "we saw a date and could not read it".

Two **real** fixtures already exercise this, which is how you know the rules are reachable:

| Fixture | Azure `InvoiceDate` content | `parseIssueDate` result |
| --- | --- | --- |
| `racuntaksi1.json` | `"31/03/2025,"` | `null` — the trailing comma is not stripped |
| `racun-mobilna-trgovina.json` | `"21.02.2020,14:26:38"` | `null` |

Do **not** "fix" `parseIssueDate` to swallow these — that is Task 12's evaluation territory and would
silently change money/date behaviour across the app. Surfacing a warning is this task's job.

**G2 — `izn=199` on a 1,99 EUR receipt.** See D3. This is the single most likely way to ship a
false-positive warning.

**G3 — `features=barcodes` injects `:barcode:` into `analyzeResult.content`.** Measured on
`26515835.jpg`, `content` reads:

```text
…Račun broj:\n10752/310012/2\n:barcode:\nZKI: 602b3d9defd5587af4de4b7f8…
```

`applyTextFallbacks` regexes over this string. In the observed case nothing breaks, but a receipt
whose QR sits immediately after a `Račun br.` / `JIR:` / `ZKI:` label would let the marker be captured
as the value. Strip the markers before running the fallbacks. Azure uses the same convention for
`:formula:`, `:selected:` and `:unselected:`.

**G4 — `Big.strict = true`.** `addAmounts`, `amountsEqual` and `compareAmounts` throw if handed a JS
number **or** a non-canonical string. Always `parseAmount` first and null-check before comparing.

**G5 — QR time is `HH:mm`, receipt time may be `HH:mm:ss`.** `parseIssueTime` deliberately does not
pad seconds. Comparing `"15:12"` to `"15:12:38"` as strings is a false positive — compare on the
`HH:mm` prefix.

**G6 — The QR payload is untrusted input** (PRD §9.3). Cap its length before parsing, wrap
`new URL()` in try/catch (it throws on malformed input), and never fetch it. It is not rendered in
this task, but Task 09 will render it — React escapes by default; do not introduce
`dangerouslySetInnerHTML` anywhere near it.

**G7 — No migration is needed.** `qr_extraction jsonb` already exists
(`supabase/migrations/20260817122048_create_receipts.sql:21`), and `UpdateReceiptInput` already
accepts `qrExtraction` and `warnings`. Because `supabase/migrations/` does not change, **`/validate`
Phase 7a (Docker) is legitimately skippable** — but the skip must be *reported*, per the Reporting
rule at the end of `validate.md`.

**G8 — `nodenext` module resolution.** Relative imports inside `api/` need `.js`:
`import { parseFiscalQr } from "./fiscal-qr.js";`. The linter will not catch a missing extension;
`tsc --build` will.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — the QR parser (no wiring)

Pure, offline, fully testable on its own. `api/src/providers/document-extraction/fiscal-qr.ts`.

### Phase 2: Core — the warnings engine (no wiring)

Pure functions in `api/src/validation/warnings.ts`, unit-tested against hand-built canonical objects.

### Phase 3: Integration — Azure feature flag, unreadable tracking, persistence

Enable `features: ["barcodes"]`, surface barcodes and `unreadableFields` through
`ProviderExtractionResult`, and write `qr_extraction` + `warnings` in the extraction service.

### Phase 4: Fixtures, validation and documentation

Re-record fixtures with the feature enabled, extend `/validate`, update `README.md`, write the history
file and flip the roadmap row.

---

## STEP-BY-STEP TASKS

Execute in order. Each task is atomic and independently verifiable.

### 1. CREATE `api/src/providers/document-extraction/fiscal-qr.ts`

- **IMPLEMENT**: `FiscalQrData` interface and `parseFiscalQr(payload: string): FiscalQrData`.

  ```ts
  export interface FiscalQrData {
    /** The decoded payload, verbatim and untouched. Preserved even when nothing parses out of it. */
    readonly raw: string;
    readonly jir: string | null;
    readonly zki: string | null;
    /** yyyy-mm-dd, normalized through the shared parser. */
    readonly issueDate: string | null;
    /** HH:mm — the fiscal payload never carries seconds. */
    readonly issueTime: string | null;
    /** Canonical decimal string, and null when `izn` carried no decimal separator (see D3). */
    readonly total: string | null;
  }
  ```

  Algorithm:
  1. `raw` is the trimmed payload. If it is empty or longer than `MAX_PAYLOAD_LENGTH` (512 — a QR v4
     holds at most 114 alphanumerics; the cap is slack for non-fiscal codes), return a record with
     `raw` and every other field `null`. Never throw.
  2. If the payload parses as an `http:`/`https:` URL (`new URL` in a try/catch), read `jir`, `zki`,
     `datv` and `izn` from `searchParams`, **case-insensitively** (iterate `searchParams` and compare
     lowercased keys — do not assume lowercase).
  3. Otherwise, if the whole payload matches the JIR UUID shape, set `jir` to it. This is the observed
     bare-UUID variant. **A bare 32-hex payload is deliberately not mapped to `zki`** — there is no
     evidence for it, and guessing would be inventing data.
  4. Validate `jir` against a UUID-or-32-hex regex and `zki` against a 32-hex regex; a value failing
     its shape becomes `null` rather than being stored.
  5. `datv`: match `^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$`, then feed `YYYY-MM-DD` to `parseIssueDate`
     and `HH:mm` to `parseIssueTime` so the calendar and clock are validated by the shared helpers.
  6. `izn`: only when the raw value contains `,` or `.`, run it through `parseAmount`; otherwise `null`.
- **PATTERN**: `api/src/providers/document-extraction/croatian.ts` — module-scope named regexes, small
  pure helpers, `null` on failure.
- **IMPORTS**: `import { parseAmount, parseIssueDate, parseIssueTime } from "@receipt/shared";`
- **GOTCHA**: G2, G6. `parseFiscalQr` **always returns a record** and never `null` — a non-fiscal QR
  (a marketing URL) still preserves `raw` as evidence. The *absence of any QR* is represented by the
  caller passing `null` upward, not by this function.
- **VALIDATE**: `npx vitest run --project api -t "fiscal"` (after task 2)

### 2. CREATE `api/src/providers/document-extraction/fiscal-qr.test.ts`

- **IMPLEMENT**: cover, at minimum, using the **real observed payloads**:
  - `https://porezna.gov.hr/rn?jir=18916f95-5787-4e7f-a190-3a091970cfa2&datv=20250331_2359&izn=132,72`
    → jir set, `issueDate` `2025-03-31`, `issueTime` `23:59`, `total` `"132.72"`.
  - `https://porezna.gov.hr/rn?jir=1193a137-a1f5-4085-9e1b-3a0919701a4f&datv=20240123_1512&izn=199`
    → jir set, `issueDate` `2024-01-23`, `issueTime` `15:12`, **`total` is `null`** (D3), `raw`
    still contains `izn=199`.
  - `ac12e053-3300-496a-8ad4-1bd2c10b0ec6` → `jir` set, everything else `null`.
  - A `zki=<32 hex>` URL variant → `zki` set, `jir` null.
  - Uppercase parameter names (`?JIR=…&DATV=…`) → parsed.
  - A non-fiscal URL (`https://example.com/promo`) → all fields null, `raw` preserved.
  - Junk (`"not a qr"`), empty string, and a 600-character payload → all fields null, never throws.
  - An invalid `datv` (`20241332_2599`) → `issueDate`/`issueTime` null (proves the shared validators
    are doing the calendar check).
- **PATTERN**: `croatian.test.ts` — `it.each` table plus an explicit malformed case.
- **VALIDATE**: `npx vitest run --project api -t "fiscal"`

### 3. CREATE `api/src/validation/warnings.ts`

- **IMPLEMENT**: one exported pure function plus the rule helpers.

  ```ts
  export interface WarningInput {
    readonly fields: CanonicalReceiptFields;
    readonly qr?: FiscalQrData | null;
    /** Canonical field names whose source text was present but could not be normalized. */
    readonly unreadable?: readonly string[];
  }

  export const CRITICAL_FIELDS = [
    "sellerName",
    "documentNumber",
    "issueDate",
    "total",
    "currency",
  ] as const;

  export function computeWarnings(input: WarningInput): ReceiptWarning[];
  ```

  Rules, emitted in this stable order:
  1. **`missing_critical_field`** — one warning per `CRITICAL_FIELDS` entry that is `null`/`undefined`/
     empty-after-trim, each carrying that field name in `field`. (PRD §6.5 fixes this list of five.)
  2. **`unparseable_date`** — for each name in `unreadable` that is `issueDate` or `issueTime`.
  3. **`unparseable_amount`** — for each name in `unreadable` that is a money field (`total`,
     `subtotal`).
  4. **`vat_arithmetic_mismatch`** — field `vatBreakdown`. Fires **only** when `total` is present and
     every `vatBreakdown` entry has both `taxableBase` and `vatAmount`; then check
     `sum(taxableBase) + sum(vatAmount)` against `total` with `amountsEqual`. If `vatBreakdown` is
     absent/empty, or any entry is missing either part, or `total` is null → **emit nothing**. This is
     the mandatory "not enough information to judge" path.
  5. **`qr_total_mismatch`** — field `total`. Only when `qr.total` **and** `fields.total` are both
     non-null and `!amountsEqual(...)`. Emits **exactly one** warning.
  6. **`qr_datetime_mismatch`** — field `issueDate`. **Exactly one** warning covering both date and
     time: fires when (`qr.issueDate` and `fields.issueDate` are both present and differ) **or**
     (`qr.issueTime` and `fields.issueTime` are both present and their `HH:mm` prefixes differ).
  7. **`document_quality`** — **not produced** (D4). Write a short comment in this file recording that
     and pointing at the history file, so the next reader does not think it was forgotten.
- **PATTERN**: pure functions, no I/O, no logging, no `async`.
- **IMPORTS**: `import { amountsEqual, addAmounts, type CanonicalReceiptFields, type ReceiptWarning } from "@receipt/shared";`
  and `import type { FiscalQrData } from "../providers/document-extraction/fiscal-qr.js";`
- **GOTCHA**: G4 — every value reaching `addAmounts`/`amountsEqual` must already be canonical. Values
  read off `CanonicalReceiptFields` are canonical by schema; `qr.total` is canonical by construction in
  task 1. Guard every one for `null` first.
- **GOTCHA**: nothing in this module may throw. A rule that cannot be evaluated emits nothing.
- **VALIDATE**: `npx vitest run --project api -t "warning"` (after task 4)

### 4. CREATE `api/src/validation/warnings.test.ts`

- **IMPLEMENT**: one `describe` per rule, as the DoD requires.
  - Missing-critical: an all-null receipt yields exactly five `missing_critical_field` warnings with
    the five expected `field` values; a fully populated receipt yields none; `sellerName: "   "`
    counts as missing.
  - Unparseable date/amount: `unreadable: ["issueDate"]` → one `unparseable_date`;
    `unreadable: ["total"]` → one `unparseable_amount`; `unreadable: []` → none.
  - VAT: base `1.90` + vat `0.09` vs total `1.99` → **no** warning (this is real data from
    `26515835`); base `1.90` + vat `0.09` vs total `2.50` → one warning; a breakdown entry with
    `vatAmount` but no `taxableBase` → **no** warning (the mandatory not-enough-information path);
    no `vatBreakdown` at all → no warning.
  - QR total: `qr.total "132.72"` vs `total "132.72"` → none; vs `total "130.00"` → **exactly one**
    `qr_total_mismatch`. `qr.total null` (the `izn=199` case) → none regardless of the total.
  - **The DoD's clearing test**: given a mismatching pair, assert one warning; call `computeWarnings`
    again with the corrected total and assert zero — *proving the engine needs no OCR re-run*.
  - QR datetime: matching date+time → none; differing date → exactly one; matching date with receipt
    time `15:12:38` vs QR `15:12` → **none** (G5); differing time → exactly one.
  - A structural assertion that `computeWarnings` returns only objects parsable by
    `receiptWarningSchema` — so a malformed warning can never reach the repository.
- **VALIDATE**: `npx vitest run --project api -t "warning"`

### 5. UPDATE `api/src/providers/document-extraction/types.ts`

- **IMPLEMENT**:
  - Add `readonly unreadableFields: string[];` to `ExtractionMetadata`.
  - Add `readonly qr: FiscalQrData | null;` to `ProviderExtractionResult` (`null` = no QR found).
- **IMPORTS**: `import type { FiscalQrData } from "./fiscal-qr.js";`
- **GOTCHA**: leave `LOW_CONFIDENCE_THRESHOLD` alone — it is Task 09's, and D4 explains why it is not
  a document-quality signal.
- **VALIDATE**: `npm run typecheck` (expect errors in `azure.ts` until task 7 — that is the point)

### 6. UPDATE `api/src/providers/document-extraction/azure-fields.ts`

- **IMPLEMENT**:
  - Add `readonly unreadableFields: string[]` to `MappedAnalyzeResult`.
  - In `assignAmount`, `assignDate` and `assignTime`: when `field?.content` is a non-empty string but
    the parser returned `null`, push the canonical field name onto the list. Do **not** change
    `assignText` — text never fails to parse.
  - Thread the array through `mapAnalyzeResult` and return it.
- **PATTERN**: mirror the existing `metadataByField` parameter threading exactly — same call shape,
  same argument order.
- **GOTCHA**: the field must stay `null`/absent in `fields`. You are only *recording* that something
  unreadable was seen; you are not storing the bad value.
- **VALIDATE**: `npx vitest run --project api -t "azure"`

### 7. UPDATE `api/src/providers/document-extraction/azure.ts`

- **IMPLEMENT**:
  1. In `analyzeWithAzure`, add the feature to the existing query parameters:
     `queryParameters: { locale: settings.locale, features: ["barcodes"] }`.
  2. Add a `stripContentMarkers(content: string): string` helper removing Azure's inline markers
     (`:barcode:`, `:formula:`, `:selected:`, `:unselected:`) and call it on
     `response.analyzeResult.content` **before** passing it to `applyTextFallbacks` (G3).
  3. Add `extractFiscalQr(analyzeResult): FiscalQrData | null` — flatten `pages[].barcodes ?? []`,
     keep `kind === "QRCode"`, run each `value` through `parseFiscalQr`, and return the **first record
     that yielded any fiscal field** (`jir`, `zki`, `issueDate` or `total`), falling back to the first
     QR record if none did, and `null` when there is no QR code at all.
  4. Include `qr` and `metadata.unreadableFields` in the returned `ProviderExtractionResult`.
- **PATTERN**: `mapAnalyzeResult` is already called and destructured at line 67 — extend that block,
  do not restructure `extract()`.
- **GOTCHA**: do not touch the `AbortController`/`pollUntilDone({ abortSignal: signal })` wiring. A
  Task 07 review bug was that the signal did not reach the poll, and `azure.test.ts` has regression
  tests for it. Barcode extraction must not disturb that.
- **GOTCHA**: `pages` and `barcodes` are both optional in the SDK types. Guard with `?? []`.
- **VALIDATE**: `npm run typecheck; npx vitest run --project api -t "azure"`

### 8. UPDATE `api/src/services/receipt-extraction.ts`

- **IMPLEMENT**: in the success branch, before `repository.update`, compute
  `const warnings = computeWarnings({ fields: result.fields, qr: result.qr, unreadable: result.metadata.unreadableFields });`
  and extend the single `update` call with `qrExtraction: result.qr === null ? null : json(result.qr)`
  and `warnings`. Add `warningCount` (a number, not the warnings themselves) to the existing
  `logger.info` call.
- **PATTERN**: reuse the existing `json()` helper at the bottom of the file.
- **GOTCHA**: **never log the QR payload or the warnings array** (PRD §9.4). A count is fine; the
  payload is receipt content. `api/src/logger.ts` already redacts `*.raw`, which covers
  `FiscalQrData.raw` should it ever be logged nested — but do not rely on that, just do not log it.
- **GOTCHA**: the failure branch is unchanged. A failed extraction records no warnings — there is
  nothing to warn about on a receipt that has no data.
- **VALIDATE**: `npx vitest run --project api -t "extraction"`

### 9. UPDATE the three affected test files

- **IMPLEMENT**:
  - `azure.test.ts`: assert `features: ["barcodes"]` reaches the analyze request; assert a stubbed
    `analyzeResult` with a `pages[0].barcodes` QR produces a populated `qr`; assert an
    `analyzeResult` with **no** barcodes produces `qr === null` **and still returns fields normally**
    (the DoD's "no QR must not block OCR"); assert `:barcode:` in `content` does not leak into a text
    fallback (e.g. content `"Račun broj:\n:barcode:\nJIR: <uuid>"` must not yield
    `documentNumber === ":barcode:"`).
  - `azure-fields.test.ts`: assert `unreadableFields` contains `issueDate` for the **real**
    `racuntaksi1.json` fixture (content `"31/03/2025,"`), and is empty for a fixture whose fields all
    parsed.
  - `receipt-extraction.test.ts`: assert the `update` call carries `qrExtraction` and `warnings`;
    assert `qrExtraction: null` when the provider returns `qr: null`.
- **PATTERN**: the existing `vi.mock` + `expect.objectContaining` style already in each file.
- **VALIDATE**: `npm test`

### 10. UPDATE `scripts/record-azure-fixture.mjs`

- **IMPLEMENT**: add `features: ["barcodes"]` to `queryParameters` so re-recorded fixtures match what
  production now receives.
- **VALIDATE**: `node -c scripts/record-azure-fixture.mjs` (syntax) — the real check is task 11.

### 11. RE-RECORD the Azure fixtures

- **IMPLEMENT**:
  ```powershell
  node --env-file=.env scripts/record-azure-fixture.mjs "C:\Users\Frane\Desktop\računi"
  ```
  Then re-record the PDF into the same directory (it lives at
  `C:\Users\Frane\Desktop\primjer-pdf-racuna.pdf`; copy it beside the images first, or run the script
  a second time against a directory containing it).
  Leave `mapper-edge-cases.json` alone — it is hand-authored, not recorded.
- **GOTCHA — STOP CONDITION**: after re-recording, run `git diff` on the fixtures. The **only**
  expected changes are new `barcodes` arrays, `:barcode:` markers in `content`, shifted span offsets,
  and new timestamps. If any extracted **field value** changed, **stop and report it** — do not adjust
  a test to match. Planning measured the field set and the values of `VendorName`, `InvoiceId`,
  `InvoiceTotal` and `VendorTaxId` as byte-identical with and without the feature, so a change means
  something else moved and is real information.
- **VALIDATE**: `npm test` — the existing Task 07 mapper tests must pass **unmodified**.

### 12. UPDATE `.claude/commands/validate.md` (hand-extend — never regenerate)

- **IMPLEMENT**:
  - **Phase 4 table** — add rows for `fiscal-qr.test.ts` and `api/src/validation/warnings.test.ts`,
    and extend the `azure.test.ts` / `azure-fields.test.ts` / `receipt-extraction.test.ts` rows to
    mention barcodes, `unreadableFields` and QR persistence.
  - **New Phase 6.12 — the QR URL is never fetched** (PRD §9.3):
    ```
    node -e "const fs=require('fs'),p=require('path'); const bad=[]; for(const f of ['api/src/providers/document-extraction/fiscal-qr.ts','api/src/validation/warnings.ts']){ const s=fs.readFileSync(f,'utf8'); if(/\bfetch\s*\(|https?\.(get|request)\s*\(|axios/.test(s)) bad.push(f);} if(bad.length) throw new Error('QR handling must never perform a network request: '+bad.join(', ')); console.log('ok');"
    ```
  - **New Phase 6.13 — no warning blocks an action** (PRD §7.8, ROADMAP §5 rule 6):
    ```
    node -e "const fs=require('fs'),path=require('path'); const bad=[]; (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name); if(e.isDirectory())walk(f); else if(/\.ts$/.test(e.name)&&!/\.test\.ts$/.test(e.name)){const s=fs.readFileSync(f,'utf8'); if(/if\s*\([^)]*warnings[^)]*\.length/.test(s)) bad.push(f);}}})('api/src'); if(bad.length) throw new Error('a warning count is being used as a gate: '+bad.join(', ')); console.log('ok');"
    ```
    Note in the file that this is a grep, not a proof — the durable guarantee is that no endpoint
    consults `warnings` at all.
  - **New Phase 8.9 journey** — see the Level 4 manual steps below.
  - **Phase 9** — delete the Task 08 row.
  - Update the Phase 8 header sentence ("As of Task 07 there are five journeys…") to say six and to
    include QR/warnings.
- **GOTCHA**: read the "Maintaining this file" section first. **Do not run
  `/ultimate_validate_command`** — it overwrites and would delete ~140 lines of hard-won checks. This
  task introduces no new tooling, so the generator would find nothing new.
- **VALIDATE**: run every command you added and confirm it passes; then deliberately break one input
  and confirm it **throws**, so you know the check bites.

### 13. UPDATE `README.md`

- **IMPLEMENT**:
  - Extend the **Extraction** section: `features=barcodes` is requested, it is free, it does not
    change field extraction, and `:barcode:` markers are stripped before text fallbacks.
  - New **QR decoding** subsection: the three real payload variants, the D3 rule about a separator-less
    `izn`, that the payload is stored in `qr_extraction` and **never** merged into canonical values,
    and that the URL is never fetched.
  - New **Warnings** subsection: the six produced rules and their field paths, that warnings never
    block, and that `document_quality` is deliberately unproduced with a pointer to the history file.
  - Update the status blockquote at the top — it still says "Task 06 implementation is complete" and
    "Azure extraction arrives in Task 07", both stale.
- **GOTCHA**: Prettier does not format `*.md`, and `/validate` Phase 6.6 checks that every documented
  path/link resolves and that documented env vars match `.env.example` exactly. **This task adds no
  env var**, so do not add a row to the configuration table.
- **VALIDATE**: the Phase 6.6 command in `validate.md`.

### 14. CREATE `.agents/history/08-qr-decoding-validation-warnings-engine.md` and UPDATE `.agents/ROADMAP.md`

- **IMPLEMENT**: follow the history template in ROADMAP §1. Record **D1–D6 with the evidence tables
  from this plan** — especially the `izn=199` finding, the bare-UUID payload variant, and the
  document-confidence measurements behind D4. In `ROADMAP.md`: flip row 08 to ✅ with plan/history
  links, update the status line at the top, and mark the "QR decode library and Croatian fiscal QR
  payload format → Task 08" deferred decision **Resolved** with a link, matching how Tasks 02 and 07
  were struck through.
- **VALIDATE**: `git diff .agents/` reads as an accurate account of what happened.

---

## TESTING STRATEGY

### Unit Tests (Vitest, `--project api`, all offline)

- `fiscal-qr.test.ts` — payload parsing, driven by the three real observed payloads.
- `warnings.test.ts` — one `describe` per rule; the DoD explicitly requires one test per rule and the
  VAT "not enough information" path.
- `azure.test.ts`, `azure-fields.test.ts`, `receipt-extraction.test.ts` — extended as in task 9.

No new test project, runner or framework. `npm test` already covers `shared` (node), `api` (node) and
`client` (jsdom).

### Integration Tests

`npm run test:integration` (hosted Supabase) must pass unchanged — this task adds no route and no
schema change. Run it anyway; it is required on every task.

Phase 7a (Docker) is **skippable** because `supabase/migrations/` is untouched (G7), but the skip must
be reported with that reason.

### Edge Cases That Must Be Tested

- QR absent entirely → `qr_extraction` null, receipt still reaches `review` with fields populated.
- QR present but non-fiscal (a marketing URL) → `raw` stored, no fiscal fields, no QR warnings.
- QR payload is a bare UUID → `jir` only.
- `izn` without a decimal separator → no total comparison (D3).
- `izn` with a comma → compared exactly, no float artifacts.
- Receipt time `HH:mm:ss` vs QR `HH:mm` → no false mismatch (G5).
- VAT breakdown missing `taxableBase` → no VAT warning.
- Malformed / oversized / empty QR payload → never throws.
- Invalid `datv` calendar values → date and time both null.
- A `:barcode:` marker adjacent to a Croatian label → no fallback captures it.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```
npm run lint
npm run typecheck
npm run format:check
```

`npm run typecheck` (`tsc --build`, strict, `noUncheckedIndexedAccess`) is the authoritative gate —
oxlint has no type-aware rules. Do not pipe it through `Select-Object`/`head`; the pipe masks exit
code 2.

### Level 2: Unit Tests

```
npm test
npx vitest run --project api
npx vitest run --project shared
npx vitest run --project client
```

### Level 3: Integration Tests

```
npm run test:integration
```

Confirm the runner prints the **hosted** target before any test runs.

### Level 4: Manual Validation — new `/validate` Phase 8.9 journey

Free ports first (`/validate` Phase 8.1) and confirm Vite reports **5173**, not 5174+ — otherwise you
are testing stale code.

1. Upload `C:\Users\Frane\Desktop\računi\racuntaksi1.jpg`. It must reach `review`. Inspect the row:
   `qr_extraction` holds `jir`, `issueDate` `2025-03-31`, `issueTime` `23:59`, `total` `"132.72"`.
2. Upload `C:\Users\Frane\Desktop\računi\26515835.jpg`. `qr_extraction.total` must be **null** while
   `raw` still contains `izn=199`, and there must be **no** `qr_total_mismatch` (D3).
3. Upload `C:\Users\Frane\Desktop\računi\images.jpg` (no QR). It must reach `review` normally with
   `qr_extraction` null — QR absence never blocks OCR.
4. Take a QR receipt and deliberately mismatch it: edit the stored `canonical_data.total` directly in
   the database to a different value, re-run `computeWarnings` over the row, and confirm **exactly
   one** `qr_total_mismatch`. Restore the correct total and confirm it clears — **without re-running
   OCR**.
5. Confirm no Azure or provider field name (`InvoiceTotal`, `VendorName`, `barcodes`, `prebuilt-`)
   appears in the `GET /api/receipts/:id` response.
6. Confirm the API log for a QR receipt contains **no** QR payload and **no** receipt content.

### Level 5: Additional Validation

Every Phase 6 check in `.claude/commands/validate.md`, including the two you add (6.12, 6.13). Verify
each new check throws on a deliberately broken input before you trust it.

---

## ACCEPTANCE CRITERIA

Mapped to the ROADMAP Task 08 Definition of Done:

- [ ] A receipt with a readable fiscal QR decodes and stores the payload in `qr_extraction`.
- [ ] A receipt with no QR, and one with an unreadable/non-fiscal QR, both still reach `review`.
- [ ] Deliberately mismatching a QR total against the OCR total raises **exactly one** warning.
- [ ] Correcting the total clears that warning without re-running OCR (proven by the pure-function
      test in task 4).
- [ ] The rules engine is unit-tested as pure functions, one test per rule, including the VAT
      "not enough information to judge" path.
- [ ] No warning can prevent confirmation anywhere in the code (Phase 6.13 plus the fact that no
      endpoint reads `warnings`).
- [ ] The QR payload is never fetched, never merged into canonical values, and never overwrites a
      user value (D6, Phase 6.12).
- [ ] `document_quality` is explicitly and defensibly deferred, with evidence, in the history file.
- [ ] No Azure field name reaches the API response, the canonical column or the UI.
- [ ] `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build` and
      `npm run test:integration` all pass.
- [ ] Existing Task 07 mapper tests pass **unmodified** against re-recorded fixtures.

---

## COMPLETION CHECKLIST

- [ ] All 14 tasks completed in order, each validated as it landed
- [ ] Full `/validate` sweep run and reported honestly, naming Phase 7a as skipped and why
- [ ] `README.md` updated, including the stale status blockquote
- [ ] `.claude/commands/validate.md` hand-extended (Phase 4, 6.12, 6.13, 8.9, 9), never regenerated
- [ ] History file written with D1–D6 and their evidence
- [ ] `.agents/ROADMAP.md` row 08 flipped and the deferred decision marked Resolved
- [ ] Working tree contains no probe scripts or scratch files

---

## NOTES

**Why the engine lives in `api/` and not `shared/`.** The warning *taxonomy* is already shared because
the model, the API and the client all need the vocabulary. The *rules* are only ever evaluated
server-side — at extraction now, and on `PATCH` in Task 09, which returns recalculated warnings to the
client. Putting the rules in `shared` would ship the whole rules engine into the browser bundle for no
caller. `PRD.md` §6.7 names an `api/src/validation/` folder for exactly this.

**Why the QR type is not exposed through the API.** `canonicalReceiptSchema` deliberately has no
`qrExtraction` field, and Task 08's DoD does not require the client to see the payload. Task 09 can
add it to the review response if the form actually needs it. Adding it now would be speculative
surface area.

**Scope boundaries held.** No duplicate detection, no buyer-OIB matching, no company verification, no
LLM validation, no Tax Administration verification call — all explicitly out of scope (PRD §4.6, §7.5,
§7.8). No `PATCH` endpoint (D5). No new dependency, no new environment variable, no migration.

**The two riskiest steps** are task 7 (touching `azure.ts`, which carries Task 07's abort-signal
regression fix) and task 11 (re-recording fixtures). Both have explicit stop conditions above.

**Confidence: 8.5/10** for one-pass success. The two deferred decisions are resolved with live
evidence rather than assumption, the response shape is confirmed against the installed SDK's own type
definitions, no new dependency is introduced, and no schema changes. The residual risk is concentrated
in the `unreadableFields` threading through `azure-fields.ts` (mechanical but touches four functions)
and in the fixture re-recording, where an unrelated Azure model drift could surface — which is why
that step has a stop-and-report condition rather than a "make the tests pass" instruction.
