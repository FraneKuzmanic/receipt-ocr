# Feature: Azure extraction provider & canonical mapper (Task 07)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

An uploaded receipt currently stops at `processing` forever. This task wires Azure Document
Intelligence behind a provider abstraction, maps its output into the existing canonical receipt
model, persists the machine extraction separately from the current values, and drives the
`processing → review | failed` transition. A failed extraction can be retried against the already
stored source.

This is **the OCR implementation task the PRD defers all provider-specific decisions to**
(PRD §4.7, §7.6) and the highest-risk task in the roadmap. It owns three locked decisions that must
be recorded in the history file: **Azure model choice, API version, and confidence policy**.

## User Story

As a business user
I want the receipt I just photographed to come back with its seller, number, date and total already
filled in
So that I only verify and correct values instead of typing all of them from scratch.

## Problem Statement

Task 05 stores a source document and creates a `processing` row. Task 06 built a client that polls
for a status change that nothing can currently produce, so every upload times out after 60 seconds
by design. Nothing extracts data, so the product has no value loop yet.

## Solution Statement

A `DocumentExtractionProvider` interface with one Azure implementation, composed of three pure,
separately testable pieces:

1. **Transport** — call Azure `2024-11-30`, poll the long-running operation, classify failures as
   retryable or not.
2. **Field mapper** — Azure `analyzeResult.documents[0].fields` → `CanonicalReceiptFields`, using the
   existing `parseAmount` / `parseIssueDate` / `parseIssueTime` helpers from `@receipt/shared`.
3. **Croatian deterministic layer** — regex over `analyzeResult.content` for the fields no Azure
   prebuilt model returns: OIB, JIR, ZKI, and issue time / document number fallbacks.

A service orchestrates them, and `POST /api/receipts` fires the service **after** responding `201`,
so the upload stays fast and Task 06's existing 2-second polling observes the transition unchanged.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: `api` (new providers/, services/, routes), `shared` (one DTO),
`client` (retry action on the failed state)
**Dependencies**: `@azure-rest/ai-document-intelligence@1.1.0` (verified below)

---

## RESEARCH EVIDENCE GATHERED DURING PLANNING

Everything in this section was **measured against the live Azure resource in `.env`**, not assumed.
Reproduce any of it with the scripts this plan adds.

### E1 — The resource supports exactly one API version

```text
GET {endpoint}/documentintelligence/documentModels?api-version=2024-11-30 → 200
GET {endpoint}/documentintelligence/documentModels?api-version=2023-07-31 → 404 Resource not found
```

**Consequence:** `@azure/ai-form-recognizer` (v5.1.0, targets the v3.1 `2023-07-31` surface) **cannot
work against this resource**. The package choice is settled by the server, not by preference. Models
available include `prebuilt-receipt`, `prebuilt-invoice`, `prebuilt-layout`, `prebuilt-read`.

### E2 — `@azure-rest/ai-document-intelligence@1.1.0` is TypeScript 7 clean

This project has been bitten twice by TypeScript 7 incompatibility (`typescript-eslint`,
`decimal.js` — see README "Toolchain notes"), so this was probed before recommending it. A file using
`DocumentIntelligence()`, `getLongRunningPoller`, `isUnexpected` and `AnalyzeOperationOutput`
typechecked at **exit 0** under the exact `api/tsconfig.json` settings (`nodenext`, `strict`,
`noUncheckedIndexedAccess`, `verbatimModuleSyntax`), and ran successfully end to end against the live
endpoint. **It is safe. Do not substitute a different package.**

### E3 — Neither prebuilt model alone covers the PRD's critical fields

One synthetic Croatian fiscal receipt (text PDF) through both models, `locale=hr-HR`:

| PRD §6.5 critical field | `prebuilt-receipt`        | `prebuilt-invoice`     |
| ----------------------- | ------------------------- | ---------------------- |
| Seller name             | `MerchantName` ✅          | `VendorName` ✅         |
| **Document number**     | **absent ❌**              | `InvoiceId` ✅          |
| Issue date              | `TransactionDate` ✅       | `InvoiceDate` ✅        |
| Total                   | `Total` ✅                 | `InvoiceTotal` ✅       |
| Currency                | `Total.valueCurrency` ✅   | `InvoiceTotal` ✅       |
| — secondary —           |                           |                        |
| Seller OIB              | absent ❌                  | `VendorTaxId` ✅        |
| Subtotal                | absent ❌                  | `SubTotal` ✅           |
| Issue time              | `TransactionTime` ✅       | **absent ❌**           |
| Payment method          | absent                    | `PaymentTerm` ✅        |
| VAT breakdown           | `TaxDetails[]`            | `TotalTax`             |
| Items                   | `Description/Quantity/Price/TotalPrice` | `Description/Quantity/UnitPrice/Amount` |

**`prebuilt-receipt` misses the document number, which is a critical field. `prebuilt-invoice`
covers 5/5 critical fields and misses only issue time (secondary), which the deterministic layer
recovers from the text.**

⚠️ **This was one clean text PDF, not a thermal-print phone photo — confirmed against 6 real
receipts below (E3b).** `prebuilt-receipt` was expected to win on real photos; it did not.

### E3b — Confirmed against 6 real receipts (5 Croatian phone photos + 1 US photo)

The human supplied real receipts (`.agents/fixtures/receipts/`, gitignored — real names/OIBs, never
committed): Eurospin (EUR, 2024), Štorija/REBECA d.o.o. (HRK, 2020, torn edge), Semovčanka Nova
(dual EUR/HRK display, 2020), two taxi receipts (S.A.L.N. Systems EUR 2025; Zaton Veliki HRK 2019,
**with a blank JIR field** — a genuine missing-fiscal-id edge case), and Trader Joe's (USD, English).
All 12 combinations (6 receipts × 2 models) were run against the live resource.

| PRD §6.5 critical field | `prebuilt-receipt` | `prebuilt-invoice` |
| --- | --- | --- |
| Seller name | 6/6 | 6/6 (see gotcha below) |
| **Document number** | **0/6 — field does not exist on this model** | **6/6** (5 high-confidence, 1 low-confidence guess on Trader Joe's, which has no true document number) |
| Issue date | 6/6 | **5/6 — silently absent on Eurospin**, no error, just missing |
| Total | 6/6 | 6/6 |
| Currency (symbol-backed, confident) | 4/6 | 3/6 |

**Document number decides it.** `prebuilt-receipt` cannot ever populate a PRD-critical field — it is
not in that model's schema, at all, regardless of receipt quality. `prebuilt-invoice` is the only
model that can satisfy PRD §6.5 for this field. **Decision confirmed: `prebuilt-invoice`.**

Three new findings from real receipts, folded into the tasks below:

1. **`prebuilt-invoice` can silently drop the issue date entirely** (Eurospin: no `InvoiceDate` key
   at all, and it also mis-classified the branch name "EUROSPIN SISAK" as `CustomerName` instead of
   part of the seller). The deterministic layer must include a date fallback, not just time —
   `croatian.ts` gains `findIssueDate()`. See task 6.
2. **The `currencyCode`-without-`currencySymbol` distrust rule (E5) is proven necessary, not
   theoretical**: on the **same** Semovčanka receipt, `prebuilt-receipt` reported `currencyCode: "HRK"`
   and `prebuilt-invoice` reported `currencyCode: "EUR"` — **the two models actively disagreed**, and
   neither had a `currencySymbol`. Both are correctly dropped to `null` by the existing rule.
3. **`VendorName` can be corrupted by a stylized logo**: Eurospin's `VendorName` read as `"EURO\nSpin"`
   (the logo's line break), while `VendorAddressRecipient` correctly read `"Eurospin Hrvatska d.o.o."`
   with comparable confidence. **The mapper should read seller name from `VendorAddressRecipient`
   when present, falling back to `VendorName`.** See task 8.
4. A live (not simulated) **429** was hit partway through this comparison run — real confirmation
   that E8's retryable classification matters under ordinary use, not just theoretical load.
5. `prebuilt-receipt`'s document-type classifier collapsed to **0.119 confidence** on a taxi receipt
   (`docType: "receipt"`) despite extracting reasonable field values — a signal that the receipt
   classifier is unreliable outside retail-format documents. Not used for gating in this task (no
   field is dropped on low `docConfidence`), but worth naming as a known model weakness in the
   history file.

No PDF receipt was supplied in this batch — all 6 sources were JPEG/PNG. The "PDF reaches review"
item in the Definition of Done still needs at least one real or synthetic PDF exercised manually
before task 07 is called done.

### E4 — `valueCurrency.amount` is a JS float. Never read it.

```json
"Total": { "type": "currency", "valueCurrency": { "currencySymbol": "EUR", "amount": 8.08, "currencyCode": "EUR" }, "content": "8,08 EUR", "confidence": 0.986 }
```

`amount: 8.08` is a JS `number`. ROADMAP §5 rule 9 and PRD §6.4 forbid money ever being one.
**The mapper must read `field.content` and pass it through `parseAmount()`.** Verified against the
real strings Azure returned:

```text
"8,08 EUR" -> "8.08"    "6,46" -> "6.46"    "1,62" -> "1.62"
"2,30"     -> "2.30"    (trailing zero preserved — this is the whole point)
"1.234,56" -> "1234.56" "1,234.56" -> "1234.56"
```

`Quantity` is likewise `valueNumber: 1` — use its `content` too.

### E5 — `currencyCode` lies. Trust `currencySymbol`.

On the *same document*, `Total.valueCurrency.currencyCode` was `EUR` (with
`currencySymbol: "EUR"`) while `TotalTax.valueCurrency.currencyCode` was **`HRK`** — a currency
Croatia stopped using in 2023, inferred with no symbol present. **Only accept `currencyCode` from a
field whose `valueCurrency` also carries a `currencySymbol`; otherwise leave currency null**
(PRD Appendix A: "Leave unknown when not confidently determined").

### E6 — Dates and times arrive pre-normalized, but re-parse anyway

`valueDate: "2026-08-17"` from content `"17.08.2026."` (day-first read correctly);
`valueTime: "14:32:05"`. Both already satisfy `ISO_DATE_PATTERN` / `ISO_TIME_PATTERN`. Round-trip
them through `parseIssueDate` / `parseIssueTime` anyway so a malformed value becomes `null` instead
of failing the Zod schema at persistence time.

### E7 — `analyzeResult.content` supports the Croatian deterministic layer

Both models return the identical flat text, so this layer is model-independent:

```text
"KONZUM plus d.o.o.\nMarijana Cavica 1A\n10000 Zagreb\nOIB: 62226620908\nRACUN br. 381/1/3\n
Datum: 17.08.2026. Vrijeme: 14:32:05\n…\nUKUPNO:\n8,08 EUR\nNacin placanja: KARTICA\n
JIR: 8f2c1a9b…\nZKI: a1b2c3d4…"
```

Verified extractions: OIB `62226620908`, JIR, ZKI, time `14:32:05`, all via simple labelled regex.

### E8 — Azure error shapes (drives the retryable taxonomy)

| Condition             | HTTP | Body                                                    | Classification    |
| --------------------- | ---- | ------------------------------------------------------- | ----------------- |
| Corrupt/unsupported   | 400  | `error.code=InvalidRequest`, `innererror.code=InvalidContent` | **non-retryable** |
| Bad key / wrong host  | 401  | `error.code=401`                                        | **non-retryable** (misconfiguration) |
| Throttled             | 429  | —                                                       | **retryable**     |
| Service fault         | 5xx  | —                                                       | **retryable**     |

### E9 — Latency is dominated by Azure, not by the client

Three runs each, same document, median of three:

```text
SDK  (getLongRunningPoller, intervalInMs 500): 7570, 7309, 7286 ms → median 7309
raw  fetch + 500 ms poll loop:                 3954, 6746, 7422 ms → median 6746
```

Client overhead is ~500 ms; **Azure's own processing varies 3.9–7.5 s and dominates**. Two
consequences:

1. The SDK-vs-hand-rolled-fetch choice **must not be argued on latency**. Take the SDK (E2:
   verified, officially supported per PRD §8, server-only so bundle size is irrelevant — the same
   argument README already makes for `pdf-lib`'s 22 MB).
2. **A synchronous upload response cannot meet PRD §11.4's 2–5 s target for this document class.**
   The asynchronous `processing` + polling design Task 06 already built is the correct architecture,
   and Task 12 must record the honest number (~4–7.5 s) rather than the aspiration.

### E10 — `raw_provider_result` is ~20 KB per simple document

19,110 bytes (receipt) / 20,013 bytes (invoice) for a one-page PDF, mostly `boundingRegions.polygon`
and `spans`. Fine for `jsonb`, which TOASTs and compresses. Store it **verbatim** — PRD §7.6 requires
retaining it for debugging. Flag growth on real multi-page photos as a Task 12 watch item; do not
pre-optimize.

---

## PREREQUISITE STATUS — resolved during planning

**6 real receipts were supplied and the model comparison has already been run** (E3b above):
5 Croatian phone photos (Eurospin, Štorija/REBECA, Semovčanka Nova, two taxi receipts — one with a
genuinely blank JIR) and 1 US/English receipt (Trader Joe's). They live in
`.agents/fixtures/receipts/`, which is git-ignored (added to `.gitignore` during planning) — the raw
photos must **never** be committed; only the recorded Azure JSON responses (task 17) are.

**The model decision is settled: `prebuilt-invoice`.** Task 16's script and gate remain in the task
list so the evidence is reproducible and captured in the history file, but this is now a
confirmation step, not an open question.

**Still missing: a PDF receipt.** All 6 supplied sources are JPEG/PNG. Task 17 (fixture recording)
and the manual validation step both need at least one PDF exercised — a synthetic one (as built
during planning, see task 17's note) is acceptable since PDF text-layer handling is not
model-comparison-sensitive.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `shared/src/receipt.ts` (lines 43–97) — Why: `canonicalReceiptFieldsSchema` is the exact target
  shape of the mapper. Note every field is `.nullable().optional()` and the object is `.strict()`,
  so an unknown key is a hard failure.
- `shared/src/money.ts` (lines 35–59) — Why: `parseAmount` is the only legal path from Azure text to
  canonical money. Returns `null` and never throws.
- `shared/src/datetime.ts` (lines 29–84) — Why: `parseIssueDate` / `parseIssueTime`. Note seconds are
  never padded on.
- `api/src/repositories/receipts.ts` (lines 23–47, 149–192) — Why: `UpdateReceiptInput` already
  carries `status`, `canonicalData`, `originalExtraction`, `extractionMetadata`, `rawProviderResult`.
  **No repository change is needed.** `update()` filters on `user_id` and `deleted_at`.
- `api/src/routes/receipts.ts` (lines 43–72) — Why: the POST route to extend; note the
  upload-then-insert-with-compensation ordering, and that `file.bytes` is already in memory.
- `api/src/app.ts` (lines 14–24) — Why: `AppOptions.authenticator` is the **established dependency
  injection pattern** to mirror for the extraction provider.
- `api/src/auth/authenticator.ts` (lines 11–21) — Why: `AuthContext` gives `{ userId, client }`; the
  per-request user-scoped client is what the background task must keep using so RLS still applies.
- `api/src/config.ts` (lines 61–93) — Why: `readRequired` and the accumulate-all-problems pattern.
- `api/src/middleware/error-handler.ts` (lines 9–19) — Why: `HttpError(status, code)`; codes are
  stable machine strings, never prose, and must not name a provider.
- `api/src/storage/receipt-sources.ts` — Why: add `downloadSource` here; `sourceObjectPath` is
  derivable, so retry needs no extra database read for the path.
- `api/src/logger.ts` (lines 5–11) — Why: redaction list. **Extend it, never work around it.**
- `api/src/routes/receipts.integration.ts` (lines 1–45) — Why: the hosted integration pattern —
  disposable `taskNN-` users, explicit Storage cleanup, `createApp()` driven by supertest.
- `client/src/routes/ProcessingPage.tsx` (lines 39–75, 97–116) — Why: the polling loop and the
  `failed` branch that must gain a retry action.
- `client/src/api/client.ts` (lines 30–77) — Why: every call goes through `request()`; adding a raw
  `fetch` elsewhere fails `/validate` Phase 6.9.
- `.claude/commands/validate.md` — Why: you must hand-extend Phase 4, Phase 8 and Phase 9.

### New Files to Create

```text
api/src/providers/document-extraction/types.ts            provider-independent interface (PRD §6.3)
api/src/providers/document-extraction/azure.ts            transport, LRO polling, error classification
api/src/providers/document-extraction/azure.test.ts
api/src/providers/document-extraction/azure-fields.ts     pure: Azure fields → CanonicalReceiptFields
api/src/providers/document-extraction/azure-fields.test.ts
api/src/providers/document-extraction/croatian.ts         pure: regex over analyzeResult.content
api/src/providers/document-extraction/croatian.test.ts
api/src/providers/document-extraction/fixtures/*.json     recorded real Azure responses
api/src/services/receipt-extraction.ts                    orchestration + persistence + status
api/src/services/receipt-extraction.test.ts
scripts/record-azure-fixture.mjs                          record a real response as a test fixture
scripts/compare-azure-models.mjs                          the model-decision evidence harness
```

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Analyze Document — REST reference](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document?view=rest-aiservices-v4.0%20(2024-11-30))
  - Section: request body (`base64Source`) and the `Operation-Location` 202 flow
  - Why: this is the exact contract the provider implements
- [prebuilt-invoice field schema](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/invoice#field-extraction)
  - Section: field list and types
  - Why: the authoritative list behind the E3 table; confirm any field you map
- [prebuilt-receipt field schema](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt#field-extraction)
  - Why: needed because the mapper must read both vocabularies for the comparison harness
- [Service quotas and limits](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/service-limits)
  - Section: transactions per second, file size and page limits
  - Why: informs the 429 retry policy and confirms the existing 10 MB / 10 page upload limits are safe
- [@azure-rest/ai-document-intelligence on npm](https://www.npmjs.com/package/@azure-rest/ai-document-intelligence)
  - Why: `getLongRunningPoller` / `isUnexpected` usage; pin `1.1.0`

### Patterns to Follow

**Dependency injection — mirror `authenticator` exactly** (`api/src/app.ts:14`):

```ts
export interface AppOptions {
  authenticator?: Authenticator;
  /** Injected by tests. Built lazily otherwise, so importing this module creates no client. */
  extractionProvider?: DocumentExtractionProvider;
}
```

**Error codes are stable machine strings, never prose, and never name a provider**
(`api/src/middleware/error-handler.ts:9`):

```ts
throw new HttpError(409, "retry_not_allowed"); // good
throw new HttpError(500, "azure_threw");       // NEVER — leaks the provider (ROADMAP §5 rule 7)
```

**Missing stays missing** (`shared/src/money.ts:35`, PRD §7.7). Every mapper helper returns `null`
rather than `""`, `0`, or a guess. There is no `?? ""` anywhere in this task.

**Module resolution:** `api` is `nodenext` — relative imports need a `.js` extension in `.ts`
source (`import { config } from "../config.js"`). Cross-workspace imports use `@receipt/shared`.

**Logging:** never log receipt contents, extracted values or the source bytes (PRD §9.4). Log
`{ receiptId, modelId, latencyMs, status }` and nothing from the document.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Dependency, configuration, the provider-independent interface, and the two pure functions the mapper
is built from. Everything here is unit-testable with no network.

### Phase 2: Core Implementation

The Azure transport with LRO polling and error classification, then the orchestration service that
persists the result and moves the status.

### Phase 3: Integration

Wire the service into `POST /api/receipts` as fire-and-forget, add `POST /api/receipts/:id/retry`,
and give the client a retry action on the failed state.

### Phase 4: Evidence, Testing & Validation

Record real fixtures, run the model comparison, lock the decision, and extend `/validate`.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. UPDATE `api/package.json`

- **IMPLEMENT**: add `"@azure-rest/ai-document-intelligence": "1.1.0"` to `dependencies`, keeping
  the exact-version style every other entry uses (no `^`).
- **GOTCHA**: do **not** add `@azure/ai-form-recognizer` — E1 proves it cannot reach this resource.
- **VALIDATE**: `npm install; npm run typecheck`

### 2. UPDATE `api/src/config.ts`

- **IMPLEMENT**: add to `Config` and `parsed`:
  - `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: readRequired(...)`
  - `AZURE_DOCUMENT_INTELLIGENCE_KEY: readRequired(...)`
  - `AZURE_DI_MODEL_ID` — plain string, default `"prebuilt-invoice"`
  - `AZURE_DI_LOCALE` — plain string, default `"hr-HR"`
  - `EXTRACTION_TIMEOUT_MS` — `readCount`, default `60000`
- **PATTERN**: `api/src/config.ts:66` `readRequired`, `api/src/config.ts:37` `readCount`
- **GOTCHA**: making the two Azure values required changes startup behaviour — README currently says
  "Azure values are not needed until Task 07". That sentence must be updated in task 19. Required is
  consistent with the Supabase precedent and its documented rationale (fail at startup, not on every
  request).
- **VALIDATE**: `npm run typecheck`

### 3. UPDATE `api/vitest.config.ts` and `api/vitest.integration.config.ts`

- **IMPLEMENT**: add placeholder `env` values for `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` and
  `AZURE_DOCUMENT_INTELLIGENCE_KEY` so unit and integration tests still boot `config.ts`.
  - `api/vitest.config.ts` — add beside the existing Supabase placeholders.
  - `api/vitest.integration.config.ts` — its `env` block currently holds only
    `{ LOG_LEVEL: "silent" }` and inherits everything else from the runner's `process.env`. Add the
    two Azure placeholders there **as well**.
- **PATTERN**: `api/vitest.config.ts:9-14` — the existing Supabase placeholders and their comment.
- **GOTCHA**: `npm run test:integration:local` does **not** load `.env` (only the hosted script does,
  via `--env-file-if-exists`), so without the integration-config placeholders the local target dies
  at config validation before a single test runs.
- **GOTCHA**: placeholders must never be real credentials — these files are committed.
- **VALIDATE**: `npx vitest run --project api`

### 4. UPDATE `.env.example`

- **IMPLEMENT**: add `AZURE_DI_MODEL_ID=`, `AZURE_DI_LOCALE=`, `EXTRACTION_TIMEOUT_MS=` as **names
  only**. The two Azure credentials are already present.
- **GOTCHA**: `/validate` Phase 6.1b fails the build if any non-allow-listed name carries a value.
- **VALIDATE**: run `/validate` Phase 6.1 and 6.1b commands verbatim.

### 5. CREATE `api/src/providers/document-extraction/types.ts`

- **IMPLEMENT**: the provider-independent contract from PRD §6.3. No Azure vocabulary in this file.

```ts
export interface ExtractionInput {
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
}

export interface ExtractionFieldMetadata {
  readonly confidence: number | null;
  /** "model" = a structured field the provider returned; "text" = recovered by deterministic parsing. */
  readonly source: "model" | "text";
}

export interface ProviderExtractionResult {
  readonly fields: CanonicalReceiptFields;
  readonly metadata: {
    readonly provider: string;
    readonly modelId: string;
    readonly apiVersion: string;
    readonly analyzedAt: string;
    readonly latencyMs: number;
    readonly documentConfidence: number | null;
    readonly fields: Record<string, ExtractionFieldMetadata>;
  };
  /** The provider's response verbatim, for debugging (PRD §7.6). */
  readonly raw: unknown;
}

export class ExtractionError extends Error {
  readonly retryable: boolean;
  readonly reason: string; // stable machine string, e.g. "unreadable_document"
  constructor(reason: string, retryable: boolean, cause?: unknown) { … }
}

export interface DocumentExtractionProvider {
  extract(input: ExtractionInput): Promise<ProviderExtractionResult>;
}
```

- **GOTCHA**: `metadata.fields` is keyed by **canonical** field names (`sellerName`, `total`), never
  Azure names. `modelId` is provider identification (needed by Task 12's evaluation) and is
  acceptable; a provider *field name* is not (ROADMAP §5 rule 7).
- **VALIDATE**: `npm run typecheck`

### 6. CREATE `api/src/providers/document-extraction/croatian.ts`

- **IMPLEMENT**: pure functions over `analyzeResult.content` (a plain string), each returning
  `string | null`:
  - `findOib(content)` — `/\bOIB[:\s]*([0-9]{11})\b/i`
  - `findJir(content)` — accept both the UUID form and 32 bare hex characters. **Real Croatian JIRs
    are UUIDs (8-4-4-4-12) — confirmed against all 6 real fixtures — but a synthetic probe used bare
    hex during planning, so handle both.** A receipt legitimately has no JIR at all (the Zaton Veliki
    fixture's `JIR:` label is present with nothing after it) — that must resolve to `null`, not an
    empty string.
  - `findZki(content)` — 32 hex characters
  - `findIssueDate(content)` — label `Datum`/`Dat\.`, then `parseIssueDate`. **Required, not
    optional**: `prebuilt-invoice` silently omitted `InvoiceDate` entirely on a real receipt
    (E3b finding 1) with no error — this is the fallback that catches it.
  - `findIssueTime(content)` — label `Vrijeme`, then `parseIssueTime`
  - `findDocumentNumber(content)` — label `Račun`/`Racun`/`R-1`/`Br.`, tolerant of OCR
- **PATTERN**: mirror `shared/src/datetime.ts` — named regex constants at module top, exhaustive
  null returns, no throwing.
- **GOTCHA**: treat OCR text as **untrusted input** (PRD §9.3). Never interpolate it into a log line
  or an error message. Croatian diacritics (`č ć ž š đ`) must survive — write the regexes against
  both diacritic and ASCII-folded forms, because OCR of thermal print drops them routinely.
- **GOTCHA**: **do not validate the OIB checksum.** PRD §4.6 and §13 put OIB verification explicitly
  out of scope — extract only.
- **VALIDATE**: `npx vitest run --project api croatian`

### 7. CREATE `api/src/providers/document-extraction/croatian.test.ts`

- **IMPLEMENT**: one test per function, each covering found / absent / malformed. Include the real
  probe text from E7 verbatim as one fixture string, plus a UUID-form JIR and a diacritic form
  (`Račun br. 381/1/3`).
- **VALIDATE**: `npx vitest run --project api croatian`

### 8. CREATE `api/src/providers/document-extraction/azure-fields.ts`

- **IMPLEMENT**: `mapAnalyzeResult(analyzeResult): { fields, fieldMetadata, documentConfidence }`.
  Pure — takes parsed JSON, does no I/O. Reads **both** model vocabularies (they are disjoint, so one
  alias table covers both and the comparison harness in task 16 needs it):

  | Canonical        | prebuilt-invoice          | prebuilt-receipt              |
  | ---------------- | ------------------------- | ----------------------------- |
  | `sellerName`     | `VendorName`              | `MerchantName`                |
  | `sellerAddress`  | `VendorAddress`           | `MerchantAddress`             |
  | `sellerOib`      | `VendorTaxId`             | — (deterministic layer)       |
  | `buyerName`      | `CustomerName`            | —                             |
  | `buyerAddress`   | `CustomerAddress`         | —                             |
  | `buyerOib`       | `CustomerTaxId`           | —                             |
  | `documentNumber` | `InvoiceId`               | — (deterministic layer)       |
  | `issueDate`      | `InvoiceDate`             | `TransactionDate`             |
  | `issueTime`      | — (deterministic layer)   | `TransactionTime`             |
  | `subtotal`       | `SubTotal`                | `Subtotal` if present         |
  | `total`          | `InvoiceTotal`            | `Total`                       |
  | `paymentMethod`  | `PaymentTerm`             | —                             |
  | `vatBreakdown`   | `TaxDetails[]` / `TotalTax` | `TaxDetails[]`              |
  | `items`          | `Description/Quantity/UnitPrice/Amount` | `Description/Quantity/Price/TotalPrice` |

- **GOTCHA (the most important rule in this task)**: **money and quantity come from
  `field.content` through `parseAmount()`, never from `valueCurrency.amount` or `valueNumber`** —
  those are JS floats (E4). A single `valueCurrency.amount` read silently violates ROADMAP §5 rule 9.
- **GOTCHA**: currency — accept `valueCurrency.currencyCode` **only when `currencySymbol` is also
  present** (E5, confirmed live in E3b: the same real receipt got `HRK` from one model and `EUR`
  from the other, both with no symbol — a real disagreement, not a hypothetical). Otherwise leave
  `currency` null.
- **GOTCHA**: seller name — prefer `VendorAddressRecipient` over `VendorName` when both are present;
  fall back to `VendorName` only if `VendorAddressRecipient` is absent. E3b caught `VendorName`
  reading a stylized logo as `"EURO\nSpin"` on a real receipt while `VendorAddressRecipient` correctly
  read `"Eurospin Hrvatska d.o.o."` at comparable confidence. For `prebuilt-receipt`, `MerchantName`
  has no equivalent split field and is used as-is.
- **GOTCHA**: addresses arrive as `valueAddress` objects. Use `field.content` (the human-readable
  string) for `sellerAddress`, not a re-assembled object — the canonical field is a plain string.
- **GOTCHA**: `field.confidence` is `undefined` on array fields. Normalize absent confidence to
  `null`, never `0` — `0` means "certainly wrong", `null` means "not reported".
- **GOTCHA**: emit **no key at all** for a field Azure did not return, rather than an explicit
  `null`. `canonicalReceiptFieldsSchema` is `.strict()` but every field is `.optional()`, and the
  database `receipts_*_shape` check constraints accept both absent and JSON `null` — absent is
  cleaner and keeps `original_extraction` honest about what was actually read.
- **VALIDATE**: `npx vitest run --project api azure-fields`

### 9. CREATE `api/src/providers/document-extraction/azure-fields.test.ts`

- **IMPLEMENT**: offline tests driven **only** by committed fixture JSON. Required cases (roadmap
  DoD): a receipt missing VAT, missing buyer, and missing fiscal identifiers. Plus, explicitly:
  - `parseAmount` is used, proven by asserting `total === "8.08"` where `valueCurrency.amount` is
    `8.08` **and** a case where content is `"1.234,56"` → `"1234.56"`
  - trailing zero survives: content `"2,30"` → `"2.30"`
  - `HRK`-claiming `TotalTax` does **not** set `currency`
  - both model vocabularies map to the same canonical shape
- **PATTERN**: `shared/src/money.test.ts` for table-driven assertions.
- **VALIDATE**: `npx vitest run --project api azure-fields`

### 10. CREATE `api/src/providers/document-extraction/azure.ts`

- **IMPLEMENT**: `createAzureProvider(overrides?): DocumentExtractionProvider`.
  - Client: `DocumentIntelligence(config.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, { key: config.AZURE_DOCUMENT_INTELLIGENCE_KEY })`
  - `client.path("/documentModels/{modelId}:analyze", config.AZURE_DI_MODEL_ID).post({ contentType: "application/json", body: { base64Source: bytes.toString("base64") }, queryParameters: { locale: config.AZURE_DI_LOCALE } })`
  - `if (isUnexpected(initial)) throw classify(initial.status, initial.body)`
  - `getLongRunningPoller(client, initial, { intervalInMs: 500 })` then `pollUntilDone()`
  - Compose `mapAnalyzeResult` with the `croatian.ts` fallbacks: **a deterministic value fills a
    canonical field only when the model left it empty**, and its metadata `source` is `"text"`.
  - Measure `latencyMs` around the whole call.
  - Enforce `config.EXTRACTION_TIMEOUT_MS` with an `AbortSignal`; a timeout is **retryable**.
- **PATTERN**: `createSupabaseAuthenticator()` in `api/src/auth/authenticator.ts:41` — a factory
  returning the interface, with the expensive client built once outside the returned closure.
- **GOTCHA**: classification per E8 — `400`/`401`/`404` non-retryable, `429`/`5xx`/timeout/network
  retryable. Map to reasons `unreadable_document`, `provider_unavailable`, `provider_rejected`.
- **GOTCHA**: **never put Azure's message into an `HttpError` code or into a user-facing string.**
  Log it server-side only.
- **VALIDATE**: `npx vitest run --project api azure`

### 11. CREATE `api/src/providers/document-extraction/azure.test.ts`

- **IMPLEMENT**: inject a stub client (or stub `fetch`) and assert:
  - a `400 InvalidContent` becomes `ExtractionError{ retryable: false }`
  - a `429` and a `503` each become `ExtractionError{ retryable: true }`
  - a successful response produces canonical fields and `latencyMs > 0`
  - deterministic values only fill fields the model left empty
- **VALIDATE**: `npx vitest run --project api azure`

### 12. UPDATE `api/src/storage/receipt-sources.ts`

- **IMPLEMENT**: `downloadSource(client, path): Promise<Buffer>` using
  `client.storage.from(config.STORAGE_BUCKET).download(path)`.
- **PATTERN**: the existing `uploadSource` — throw a plain `Error` with a non-provider message on
  failure; the route layer converts to `HttpError`.
- **VALIDATE**: `npm run typecheck`

### 13. CREATE `api/src/services/receipt-extraction.ts`

- **IMPLEMENT**: `extractReceipt({ provider, client, userId, receiptId, bytes, contentType }): Promise<void>`
  — **never rejects**. Flow:
  1. `provider.extract({ bytes, contentType })`
  2. On success: `repository.update(receiptId, { status: "review", canonicalData: fields, originalExtraction: fields, extractionMetadata: metadata, rawProviderResult: raw })`
  3. On `ExtractionError`: `repository.update(receiptId, { status: "failed", extractionMetadata: { ...base, failure: { reason, retryable } } })`
  4. Catch everything else, log, and write `failed` with `retryable: true`.
  5. Log `{ receiptId, modelId, latencyMs, status }` — **no receipt content** (PRD §9.4).
- **GOTCHA**: `canonicalData` and `originalExtraction` are written **identically** here. Task 09
  edits only `canonicalData`, which is what keeps machine output and confirmed values
  distinguishable forever (PRD §6.4). Never write `originalExtraction` again after this.
- **GOTCHA**: `update()` filters `deleted_at is null`, so a receipt the user soft-deleted mid-flight
  returns `null` — treat that as success and do nothing, not as an error.
- **GOTCHA**: the `client` is the caller's user-scoped Supabase client, so RLS still applies to the
  background write. Its token stays valid for roughly an hour — far longer than any extraction. **Do
  not reach for `SUPABASE_SECRET_KEY` here**; it bypasses RLS and is reserved for provisioning.
- **VALIDATE**: `npx vitest run --project api receipt-extraction`

### 14. CREATE `api/src/services/receipt-extraction.test.ts`

- **IMPLEMENT**: with a stub provider and a stub repository/client:
  - success writes `review` with identical `canonicalData` and `originalExtraction`
  - a non-retryable failure writes `failed` with `retryable: false` in metadata
  - a provider that throws a non-`ExtractionError` still writes `failed` and does not reject
  - a soft-deleted receipt (update returns `null`) does not throw
- **VALIDATE**: `npx vitest run --project api receipt-extraction`

### 15. UPDATE `api/src/app.ts` and `api/src/routes/receipts.ts`

- **IMPLEMENT**:
  - `AppOptions.extractionProvider`, defaulted with `createAzureProvider()`, passed to the router
    exactly as `authenticator` is today.
  - In `POST /`: after `res.status(201).json(...)`, fire
    `void extractReceipt({ ..., bytes: file.bytes, contentType: file.contentType })`.
  - New route `POST /:id/retry`: validate the id; `findById`; `404` if null; **`409 retry_not_allowed`
    unless status is `failed` or `processing`**; if the stored `extraction_metadata.failure.retryable`
    is explicitly `false`, also `409`. Otherwise `downloadSource`, set status back to `processing`,
    respond `202 { id, status }`, and fire `void extractReceipt(...)`.
- **GOTCHA**: **`review` and `confirmed` must never be retryable** — re-extracting would overwrite
  `original_extraction` and destroy the user's edits. This guard is the whole reason the endpoint
  checks status.
- **GOTCHA**: fire-and-forget after `res.json()` — the callback must not throw, or Express will try
  to send headers twice. `extractReceipt` never rejects by contract (task 13); still prefix with
  `void` and keep a `.catch()` inside the service, not at the call site.
- **GOTCHA**: retry from `processing` is deliberately allowed. `tsx watch` restarts the API on every
  save, which strands in-flight extractions in `processing` forever; without this the only recovery
  is a fresh upload. Re-running is safe because the source is unchanged and the write is a wholesale
  overwrite.
- **VALIDATE**: `npx vitest run --project api`

### 16. 🚦 MODEL DECISION GATE — CREATE `scripts/compare-azure-models.mjs` and run it

- **IMPLEMENT**: a script that takes a directory of real receipts, runs each through
  `prebuilt-invoice` and `prebuilt-receipt`, and prints a per-field coverage table plus median
  latency for each model.
- **RUN**: against the ≥5 real receipts from the Blocking Prerequisite.
- **DECIDE**: keep `prebuilt-invoice` as `AZURE_DI_MODEL_ID` **only if the real-receipt evidence
  agrees with E3**. If `prebuilt-receipt` wins on real thermal photos, change the default — the
  mapper already handles both vocabularies, so this is a one-line config change.
- **RECORD**: the table, the sample size, and the decision go verbatim into the history file. The
  roadmap DoD requires "The model/confidence decision and its evidence are written into the history
  file."
- **GOTCHA**: E3 is one synthetic text PDF. Do not treat it as the answer; it is the hypothesis.
- **VALIDATE**: `node --env-file=.env scripts/compare-azure-models.mjs .agents/fixtures/receipts`

### 17. CREATE `scripts/record-azure-fixture.mjs` and record fixtures

- **IMPLEMENT**: run one real document through the chosen model and write the response JSON to
  `api/src/providers/document-extraction/fixtures/<name>.json`.
- **RUN**: record at least the three cases task 9 requires (missing VAT / missing buyer / missing
  fiscal identifiers) plus one full Croatian receipt and one English receipt.
- **GOTCHA**: review each fixture before committing — it contains real seller names and OIBs.
- **VALIDATE**: `npx vitest run --project api azure-fields` (now driven by real recorded data)

### 18. UPDATE the client: retry action

- **IMPLEMENT**:
  - `client/src/api/client.ts`: `retryReceipt(id)` calling `POST /api/receipts/:id/retry` **through
    the existing `request()` helper**.
  - `client/src/routes/ProcessingPage.tsx`: on `failed`, show a retry button that calls
    `retryReceipt` and resumes polling by bumping `attempt`. A `409` falls back to the existing
    failed message.
  - `client/src/i18n/locales/{en,hr}.json`: add `processing.retry` (and any new key) to **both**.
- **PATTERN**: the existing `processing.checkAgain` button and the `setAttempt` re-poll trigger.
- **GOTCHA**: `/validate` Phase 6.9 fails on any `fetch(` outside `client/src/api/client.ts`.
- **GOTCHA**: `client/src/i18n/i18n.test.ts` enforces `hr`/`en` key parity — add both or the build
  fails. Never delete the key from the other file to make it pass.
- **VALIDATE**: `npx vitest run --project client`

### 19. UPDATE documentation

- **IMPLEMENT**:
  - `README.md`: an **Extraction** section (model decision + evidence, the confidence policy, the
    retryable taxonomy, the `valueCurrency.amount` trap and why `content` is used instead); the
    Configuration table gains the new variables; correct the stale "Azure values are not needed until
    Task 07" sentence; the API table gains `POST /api/receipts/:id/retry`.
  - `.claude/commands/validate.md`: add the new tests to the Phase 4 table, add the Task 07 journey to
    Phase 8, and **delete the Task 07 row from Phase 9**.
- **GOTCHA**: `/validate` Phase 6.6 machine-checks that every documented env var exists in
  `.env.example` and vice versa, and that every README file path resolves.
- **GOTCHA**: Prettier does not format `*.md` — do not "fix" that.
- **VALIDATE**: run the Phase 6.6 command verbatim.

### 20. UPDATE `.agents/ROADMAP.md` and CREATE `.agents/history/07-azure-extraction-provider-canonical-mapper.md`

- **IMPLEMENT**: flip Task 07 to ✅ with plan/history links; move the "Azure model choice…" bullet
  from *Deliberately deferred* to resolved with a link, exactly as the Task 02 decimal bullet was
  handled; update the status line at the top. Write the history file to the template in ROADMAP §1,
  including the task-16 evidence table.
- **VALIDATE**: `npm run validate`

---

## TESTING STRATEGY

### Unit Tests

Vitest, `--project api`, colocated `*.test.ts`, mirroring the existing api tests. **No test in this
tier may touch the network.** The mapper and Croatian layers are pure functions over committed
fixture JSON; the provider is tested with an injected stub client; the service with a stub provider
and stub repository.

### Integration Tests

Extend `api/src/routes/receipts.integration.ts` (hosted target, `npm run test:integration`), using
disposable `task07-` users and explicit Storage cleanup exactly as Task 05 does:

- Upload a real receipt with an **injected stub provider** → poll `GET /api/receipts/:id` until it
  leaves `processing` → assert `review`, populated canonical fields, and that `original_extraction`
  matches `canonical_data`. This proves the fire-and-forget path without spending Azure calls or
  making the suite flaky.
- A stub provider that throws a retryable `ExtractionError` → status `failed` → `POST /:id/retry`
  returns `202` and a succeeding stub then reaches `review`.
- `POST /:id/retry` on a `review` receipt returns `409` and leaves `original_extraction` untouched.
- Cross-user `POST /:id/retry` returns `404`.

### Live Smoke Test (manual, kept out of CI)

One real document through the real Azure resource, run by hand, recording latency. The roadmap
requires "at least one live smoke test, run manually."

### Edge Cases

- Azure returns `documents: []` (nothing recognized) → all canonical fields absent, status still
  `review`, nothing invented. **Not** `failed` — an unreadable receipt the user can still fill in by
  hand is a review case (PRD §11.3 acceptance principle).
- `valueCurrency.amount` present but `content` unparseable → field `null`, warning deferred to Task 08.
- `TotalTax.currencyCode = "HRK"` with no symbol → `currency` stays null (E5).
- Two-page PDF → maps page 1's document; extra pages are retained in `raw_provider_result`.
- Soft delete during extraction → the update finds no row; no throw.
- API restart mid-extraction → receipt stranded in `processing`; `POST /:id/retry` recovers it.
- Retry on `confirmed` → `409`, `original_extraction` untouched.

---

## VALIDATION COMMANDS

Execute every command. `/validate` is the authority; these are its relevant phases.

### Level 1: Syntax & Style

```
npm run lint
npm run typecheck
npm run format:check
```

### Level 2: Unit Tests

```
npm test
npx vitest run --project api
npx vitest run --project client
npx vitest run --project shared
```

### Level 3: Integration Tests

```
npm run test:integration
```

Phase 7a (Docker) is **skippable — no migration changes in this task**; the skip must be reported,
not silently omitted.

### Level 4: Manual Validation

Free the ports first (`/validate` Phase 8.1) and confirm Vite reports **5173**, not 5174+.

1. Upload a real Croatian receipt photo → reaches `review` with seller, document number, issue date,
   total and currency populated where legible.
2. Upload a PDF receipt → reaches `review`.
3. Inspect the row: `original_extraction` equals `canonical_data`; `raw_provider_result` is present;
   `extraction_metadata` carries `latencyMs` and per-field confidence.
4. Temporarily point `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` at an unreachable host → status `failed`
   → the client's retry button works after restoring it.
5. Confirm **no Azure field name** appears in `GET /api/receipts/:id` or anywhere in the UI.
6. HR/EN switch on every new string.

### Level 5: Additional Validation

```
node -e "const b=require('./api/src/providers/document-extraction/fixtures/<one>.json'); const s=JSON.stringify(require('fs').readFileSync('api/src/providers/document-extraction/azure-fields.ts','utf8')); if(/valueCurrency\s*\.\s*amount|\.valueNumber\b/.test(s)) throw new Error('mapper reads a float money value'); console.log('ok');"
```

Add this as a new `/validate` Phase 6.10 — it is the check that would have caught the single most
likely correctness regression in this task.

---

## ACCEPTANCE CRITERIA

Straight from ROADMAP Task 07's Definition of Done:

- [ ] A real Croatian receipt photo reaches `review` with seller, document number, issue date, total
      and currency populated where legible in the source
- [ ] A PDF receipt reaches `review`
- [ ] Mapper unit tests run **offline from fixtures** and cover a receipt missing VAT, missing buyer,
      and missing fiscal identifiers
- [ ] No Azure field name appears in the API response, `canonical_data`, or the UI
- [ ] A simulated Azure 429/500 produces `failed` with a working retry that succeeds
- [ ] Processing latency is recorded per run (the Task 12 baseline)
- [ ] The model and confidence decision, with its evidence table, is written into the history file
- [ ] `original_extraction` is written once and never again
- [ ] Money never passes through a JS number anywhere in the extraction path
- [ ] Warnings are untouched — the rules engine is Task 08's, not this task's
- [ ] `/validate` passes, with Phase 7a's skip named and justified

---

## COMPLETION CHECKLIST

- [ ] All 20 tasks completed in order
- [ ] Each task's validation command passed immediately
- [ ] `npm run validate` green
- [ ] `npm run test:integration` green against the hosted project, no orphan `task07-` users left
- [ ] Live smoke test run manually and its latency recorded
- [ ] `/validate` Phase 4 table, Phase 8 journey and Phase 9 row updated
- [ ] README Extraction section, Configuration table and API table updated
- [ ] ROADMAP progress row and deferred-decision bullet updated
- [ ] History file written, including the model-comparison evidence

---

## NOTES

### The three decisions this task locks

1. **Model: `prebuilt-invoice` (hypothesis), API version `2024-11-30` (forced).** The API version is
   not a choice — E1 shows the resource serves nothing else. The model is a hypothesis backed by E3
   and **must be confirmed or overturned at task 16 on real receipts.**

2. **Confidence policy: record, never discard.** Every field's confidence is stored in
   `extraction_metadata`; **no value is dropped for being low-confidence.** Rationale: PRD §7.9 asks
   for low-confidence fields to be *visually noticeable*, and PRD §11.3's acceptance principle is
   that any human-readable receipt should be *correctable*. Dropping a value the model actually read
   forces the user to retype it and makes "low confidence" indistinguishable from "not on the
   receipt" — which destroys information. A field becomes `null` only when it cannot be *represented*
   canonically (unparseable amount or date), and Task 08 raises the warning for that. Define
   `LOW_CONFIDENCE_THRESHOLD = 0.7` as metadata for Task 09's highlighting; it gates no data.

3. **Retryability is stored, not inferred.** `extraction_metadata.failure.retryable` is written at
   failure time so `POST /:id/retry` can honour PRD §10.6's "when the previous failure is retryable"
   without re-deriving it.

### Why extraction runs fire-and-forget in-process

A queue or worker is real infrastructure for a PoC that has none, and CLAUDE.md §2 forbids
speculative complexity. Task 06 already built 2-second polling with a 60-second timeout specifically
for this, and its history says so. The honest cost is that an API restart strands a receipt in
`processing` — which is exactly why retry accepts `processing` as well as `failed`.

### Deviation from PRD §6.7 worth recording

PRD §6.7 lists a top-level `mappers/` directory. This plan puts `azure-fields.ts` beside the Azure
provider instead, because the mapper is Azure-specific by nature: a generic `mappers/` folder holding
one provider's field aliases would misrepresent it, and a second provider would bring its own. The
`DocumentExtractionProvider` interface stays provider-independent, which is the property PRD §6.2
actually cares about. Record this in the history file the same way the `apps/`/`packages/` amendment
was.

### Deliberately NOT in this task

QR decoding and every warning rule (Task 08), the review form (Task 09), exposing
`extraction_metadata` through the API (Task 09 needs it for low-confidence highlighting), any LLM
(excluded outright, PRD §4.7). Resist adding a warning here just because the mapper can see a missing
total — the rules engine is one place, and it is Task 08's.

### Confidence score

**8.5 / 10** for one-pass success. The transport, mapper and service are well specified, every
external unknown was measured against the live resource rather than assumed, and the model decision
(`prebuilt-invoice`) is now confirmed against 6 real receipts rather than one synthetic PDF — the
single largest source of risk at the start of planning. The residual 1.5 points are: no PDF among the
supplied fixtures (task 17 needs a manual substitute), and that these 6 receipts, while real, are
still a small and not-adversarial sample — genuinely blurry or glare-heavy phone photos remain
untested until Task 12's fuller evaluation.
