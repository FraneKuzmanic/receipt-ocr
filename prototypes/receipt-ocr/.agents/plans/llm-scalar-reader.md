# Feature: An LLM as a third, parallel reader of scalar fields (iteration 29)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

**Handoff:** `.agents/specs/llm-scalar-reader.md` · **Evidence:** `.agents/research/scalar-llm-reader-probe.md` · **Previous history:** `.agents/history/28-scalar-llm-reader-probe.md`

## Feature Description

Every uploaded receipt is read a third time. Beside the two Azure prebuilt models
(`prebuilt-invoice`, `prebuilt-receipt`), the API runs `prebuilt-read` OCR on the same file and
gives its plain text to a `gpt-4.1` deployment on Azure OpenAI, which returns the 14 scalar fields
as printed. The three readings start at the same moment. The third is merged into the two-model
result on the server by a fixed per-field rule, before the receipt reaches `review`. Line items and
VAT rows are never asked of it.

This is the first iteration that puts an LLM in the application. It amends PRD §4.7, §7.6, §8 and
ROADMAP §5 rule 10 in the same commit.

## User Story

As a business user reviewing a scanned receipt
I want more of the header, buyer, payment and fiscal fields to arrive already correct
So that I correct fewer fields before confirming, without the upload taking longer

## Problem Statement

The production engine reads VAT rows and line items well and is weakest on scalar fields. Over the
15 receipts with verified scalars it has 183 of 209 right. The misses are of three kinds no
deterministic rule has fixed: a payment method printed as an unlabelled tender line, a buyer the
model invents on a retail receipt, and identifiers behind a cropped label. The amber
"needs checking" flag also still sits on a correct value 10 times out of 14.

## Solution Statement

Add a scalar reader as a third leg of the existing provider. Measured on 2026-10-12
(`read+gpt-4.1`, three runs): merged scalars right 198 of 209, no correct production value changed,
identical in every run, 0.0 s added at p50 and p90, about half a cent a receipt.

The reader is **additive, never load-bearing** (iteration 23's rule): an error, a timeout or a
malformed answer is logged and the two-model result stands unchanged. With its configuration absent
the application behaves exactly as it does today.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: `api/src/providers/document-extraction/` (provider, merge, source regions), `api/src/config.ts`, `api/src/routes/receipts.ts` (the low-confidence list), `scripts/score-extraction.ts`, `PRD.md`, `README.md`, `.agents/ROADMAP.md`, `.claude/commands/validate.md`, `render.yaml`, `.env.example`
**Dependencies**: none added. Azure OpenAI is called with Node's built-in `fetch`; `prebuilt-read` uses the already installed `@azure-rest/ai-document-intelligence` 1.1.0. **Do not install an LLM SDK.**

---

## DECISIONS SETTLED WITH THE PRODUCT OWNER (2026-10-12) — do not reopen

From the handoff:

1. **Shape.** `prebuilt-read` text → `gpt-4.1` → 14 scalars as printed. Starts with the two prebuilt
   calls. The model sees the document text only, never production's reading.
2. **Items and VAT rows stay production's.**
3. **Merged on the server before `review`.** No progressive fill.
4. **The merge rule** (reference implementation `scripts/bakeoff/scalar-merge.ts`):
   1. A field the QR code supplied or agrees with is production's.
   2. Buyer name, address and OIB are the reader's, **including empty**.
   3. Payment method and issue time are the reader's when it has one, else production's.
   4. Every other scalar is production's when it has one, else the reader's.
   5. Under rule 4, both have a value and they differ: production's is kept.
5. **No on-the-page (grounding) test in the merge.**
6. **`gpt-4.1`, `prebuilt-read`.** Not `-mini`, not `prebuilt-layout`.

From the grilling session:

| # | Decision |
| --- | --- |
| Q1 | Iterations 27 and 28 are committed first, as one `chore(bakeoff)` commit, pushed with `git push github prototype/receipt-ocr` only. No subtree push for that commit (it would redeploy unchanged product code). Iteration 29 is its own commit. |
| Q2 | The deployed app uses the same Azure OpenAI resource whose values are in the local `.env`. Because a dead reader is silent by design, it must be visible in the logs: one startup line saying whether it is on, one `warn` per failed or abandoned read. |
| Q4 | A low-confidence flag is cleared when the reader read the same value. |
| Q5, Q13 | A value the reader supplies is outlined on the source by finding its printed text among the `prebuilt-read` words. Tolerant of case, spacing, diacritics, punctuation, a label glued to the value, and the printed forms of a date or amount. Several occurrences: the first on the page. Not found: no outline. |
| Q6 | The `prebuilt-read` response and the model's answer are stored in `raw_provider_result`. The probe's recorded answers become committed fixtures so the merged result is scored offline. |
| Q7 | Grace: the reader may run **3 s** after the two-model result is ready, then it is abandoned. |
| Q8 | No spending cap for this iteration. Still estimate before a paid run and record every paid run in the history file. |
| Q9 | The product owner enters the four variables in the Render dashboard. Not part of the unattended run. |
| Q10 | The PRD is edited in place, minimally, with dated amendment notes; one ROADMAP amendment; §5 rule 10 reworded. |
| Q11 | `amelie-receipt`'s drafted scalar truth is correct. Mark it verified. |
| Q14 | A value the reader fills into an empty field carries no confidence and is never amber. |
| Q15 | The agent uploads five receipts through the local app and checks stored results, outlines and flags in a real browser. The product owner does the post-deploy check. |

Assumptions the product owner accepted:

- **No backfill.** Receipts already stored keep their two-model reading. Retry re-runs with the reader.
- **Prompt, schema and normaliser are copied word for word.** The measured accuracy is of that wording.
- **Flags are fixed at extraction.** Agreement and disagreement are recorded in the private
  metadata then and are not recomputed when the user edits.
- **The reader is on only when all four `AZURE_OPENAI_*` variables are set.**
- **Nothing naming the LLM reaches `shared/`, the API response or the UI.**
- Local ports stay 3001/5173. The three standing reds stay untouched.

### One decision to confirm at plan review: which disagreements raise amber (Q12)

Q12 was agreed as "(c): a rule-5 disagreement on one of the five critical fields shows the ordinary
amber hint". That was agreed before the split was measured. Measured afterwards, free, on the
recorded `read+gpt-4.1` runs over all 16 receipts:

| Critical-field disagreement | Production's confidence | Who is right | Already amber today |
| --- | --- | --- | --- |
| Konzum `total` (100.98 kept, 13.40 read) | 0.985 | reader | no |
| `primjer-pdf-racuna` `sellerName` | 0.946 | production | no |
| `inareceipt` `sellerName` (2 of 3 runs) | 0.915 | production | no |
| `receipt123` `sellerName` | 0.413 | neither | yes |
| `amelie-receipt` `sellerName` | 0.443 | reader | yes |

So (c) adds two or three new amber flags a run, and only one of them is on a wrong value. Both
false ones are `sellerName`, where the two readers differ on how much of the header is the name,
not on what is printed. On the four critical fields that hold one exact value (`documentNumber`,
`issueDate`, `total`, `currency`) the only disagreement is the Konzum total, which is the case the
flag exists for.

**This plan implements the narrower list**: `FLAGGED_DISAGREEMENT_FIELDS = ["documentNumber",
"issueDate", "total", "currency"]`. It is one constant in `scalar-merge.ts`. If the product owner
prefers (c) as agreed, add `"sellerName"` to it; nothing else changes. ROADMAP's iteration 26
amendment is the reason for the recommendation: a flag that fires on correct values teaches the
user to ignore it. Sixteen receipts is a small sample either way; say so in the history file.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

Product:

- `api/src/providers/document-extraction/azure.ts` (whole file, 309 lines) — Why: the provider the reader joins. `extract` (lines 95–173) runs the two models; `SECONDARY_GRACE_MS` and its timer (lines 44, 99–121) are the pattern for the reader's grace; the `.catch` that logs and returns `null` (lines 110–118) is the additive pattern; `analyzeWithAzure` (lines 200–252) is the submit-and-poll loop `prebuilt-read` reuses; `applyQrJir` (lines 261–269) runs before the scalar merge.
- `api/src/providers/document-extraction/merge.ts` (whole file) — Why: `FieldModel`, `ModelExtraction`, `MergedExtraction`. The scalar merge takes a `MergedExtraction`-shaped input and must keep `fieldModels` and `metadata` consistent.
- `api/src/providers/document-extraction/types.ts` (whole file) — Why: `ExtractionFieldMetadata.source`, `ExtractionMetadata.fieldModels`, `LOW_CONFIDENCE_THRESHOLD`, `ExtractionError`.
- `api/src/providers/document-extraction/source-regions.ts` (lines 218–253 `addTextRegion`/`envelope`, 255–274 `addCorners`, 291–340 `mapStoredSourceRegions` and the `stored*` readers) — Why: where reader-supplied values get their outlines and where a cleared buyer's outline must be dropped.
- `api/src/providers/document-extraction/croatian.ts` — Why: `normalizeOib` (the normaliser's OIB rule).
- `api/src/providers/document-extraction/payment-method.ts` — Why: `categorizePaymentMethod`, used by the scorer; **not** applied to the reader's payment wording (see Notes).
- `api/src/validation/warnings.ts` (lines 19–25 `CRITICAL_FIELDS`, 99–120 `computeStoredWarnings`, 145–166 `qrCorroboratedFields`) — Why: the QR lock is `metadata source === "qr"` plus `qrCorroboratedFields`.
- `api/src/routes/receipts.ts` (lines 110–165 the two callers, 366–385 `lowConfidenceFields`) — Why: the one place flags are computed.
- `api/src/services/receipt-extraction.ts` — Why: what is persisted and logged per extraction. `json()` drops `undefined`, so optional metadata keys vanish when unset.
- `api/src/config.ts` (whole file) — Why: optional-versus-required pattern; `AZURE_DI_SECONDARY_MODEL_ID` (lines 100–106) is the precedent for an optional leg.
- `api/src/app.ts` (line 28) — Why: where the provider is constructed; the reader is wired here.
- `api/src/index.ts` — Why: the startup log line.
- `api/src/logger.ts` — Why: the redaction list (`*.content`, `*.raw`, …) and its one-level wildcard limit.
- `api/src/providers/document-extraction/azure.test.ts` (lines 1–110 and the tests named "secondary") — Why: test patterns: `fakeAzure`, the `analyze` option stub, `recorded()`, `extractRecorded()`, fake timers for the grace test.
- `api/src/providers/document-extraction/merge.test.ts`, `source-regions.test.ts` — Why: fixture-driven test style to mirror.
- `shared/src/receipt.test.ts` (lines 130–145) — Why: the provider-vocabulary guard to extend.
- `shared/src/api.ts` (lines 91–112) — Why: `sourceRegionSchema` is `.strict()` with `origin: "model" | "text"`. Reader outlines use `"text"`; **do not change this schema**.
- `scripts/score-extraction.ts` (lines 75–122 `loadRows`, 243–260) — Why: the offline scorer that gains a reader mode.

Harness (the reference implementation; read, port, do not reword):

- `scripts/bakeoff/scalar-merge.ts` (whole file) and `scripts/bakeoff/scalar-merge.check.ts` — Why: the rule and its nine checks, to port.
- `scripts/bakeoff/field-schema.ts` (lines 18–52 the 14 scalar descriptions, 80–86 `SHARED_RULES` and `SYSTEM`, 88–109 `toJsonSchema`) — Why: the prompt and schema, copied verbatim.
- `scripts/bakeoff/repair.ts` (lines 15–25 `REPAIR_SCHEMA`, 54–77 `ProductionReading`, `LlmReading`, `lockedFields`) — Why: the scalar schema's exact shape and the lock.
- `scripts/bakeoff/normalize.ts` (lines 23–99) — Why: the scalar parsers to port.
- `scripts/bakeoff/compare.ts` (lines 25–52 `matches`) — Why: the agreement test to port.
- `scripts/bakeoff/model-input.ts` (lines 760–805 `complete`) — Why: the exact request body that was measured.
- `scripts/bakeoff/run-scalar-probe.ts` (lines 65–66 `document`) — Why: the exact user message: `<dokument>\n${content}\n</dokument>`.
- `scripts/bakeoff/layout.ts` — Why: how `prebuilt-read` was called: raw bytes, `locale: "hr-HR"`, **no** `features`, **no** `outputContentFormat`.
- `scripts/bakeoff/ground.ts` (`surfaceForms`, `key`, `groundValue`, `layoutGeometry`) — Why: the page search to port for outlines.
- `scripts/bakeoff/scalar-probe-records.ts` — Why: where the recorded runs live and their shapes.

Process:

- `.claude/commands/validate.md` — Why: the checks run against this work, and the file to hand-extend (Phase 4 table, Phase 6, Phase 8).
- `.agents/history/26-extraction-layer-fixes-receipt-schema-v2.md` ("Browser run") — Why: how a disposable-account browser run was done and cleaned up.

### New Files to Create

- `api/src/providers/document-extraction/scalar-reader.ts` — the prompt, the scalar schema, the OCR-then-completion call, the answer check and the normaliser.
- `api/src/providers/document-extraction/scalar-reader.test.ts`
- `api/src/providers/document-extraction/scalar-merge.ts` — the merge rule, the agreement test, the flag lists.
- `api/src/providers/document-extraction/scalar-merge.test.ts`
- `api/src/providers/document-extraction/word-search.ts` — finding a printed value among OCR words.
- `api/src/providers/document-extraction/word-search.test.ts`
- `api/src/providers/document-extraction/fixtures/reader/<name>.json` — 14 files, one per receipt that already has a primary fixture.
- `scripts/bakeoff/product-parity.check.ts` — asserts the product's prompt and schema equal the harness's.
- `.agents/history/29-llm-scalar-reader.md` — written by `/execute`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

The request shapes below were exercised 247 times on 2026-10-12 against this project's own
resources; the harness files above are the primary reference. The links are for the reasons given.

- [Azure OpenAI structured outputs](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs)
  - Why: `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`; every property must be listed in `required`, and `additionalProperties: false` is mandatory under `strict`.
- [Azure OpenAI REST reference, chat completions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#chat-completions)
  - Why: URL shape `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={v}`, the `api-key` header, the `choices[0].message.content` and `finish_reason` fields.
- [Document Intelligence read model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/read)
  - Why: `prebuilt-read` returns `content`, `pages[].words[]` with `polygon` and `span`; it cannot return markdown.
- [MDN: AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
  - Why: `fetch(url, { signal })` rejects with an `AbortError` when the grace timer fires.

### Patterns to Follow

**Module resolution.** `api` is `nodenext`: relative imports carry `.js` even in `.ts` source
(`import { mergeScalars } from "./scalar-merge.js"`). Cross-workspace imports use the package name
(`@receipt/shared`). `api/` must never import from `scripts/`.

**The additive leg** (`azure.ts:107–121`), to mirror for the reader:

```ts
const secondaryPending =
  settings.secondaryModelId === ""
    ? Promise.resolve(null)
    : analyze(input, secondaryController.signal, settings.secondaryModelId).catch(
        (error: unknown) => {
          logger.warn(
            { err: error, modelId: settings.secondaryModelId },
            "secondary extraction model unavailable; continuing with the primary result",
          );
          return null;
        },
      );
const response = await analyze(input, controller.signal, settings.modelId);
graceTimer = setTimeout(abortSecondary, SECONDARY_GRACE_MS);
const secondaryResponse = await secondaryPending;
```

**Text-sourced metadata** (`azure.ts:303–307`): `metadata[name] = { confidence: null, source: "text" }`.
A reader-supplied value records `{ confidence: null, source: "reader" }`.

**Optional configuration** (`config.ts:100–107`): a blank value means "not set"; nothing optional
goes through `readRequired`.

**Logging.** Structured object first, message second; never a value read from a receipt:
`logger.warn({ err: error, reason }, "scalar reader unavailable; continuing with the two-model result")`.

**Tests.** Vitest, colocated `*.test.ts`, fixture replay via
`new URL("./fixtures/…", import.meta.url)`; fake timers for the grace test
(`vi.useFakeTimers()` as the existing `SECONDARY_GRACE_MS` test does).

**Comment density.** This folder explains *why* a rule exists and names the receipt that earned
it. Match that; do not narrate what the code does.

**Vocabulary.** In `api/` the leg is called the **scalar reader** (`scalar-reader.ts`,
`source: "reader"`, `fieldModels[...] = "reader"`, `metadata.reader`). The words `openai`, `gpt`
and `llm` appear only in `scalar-reader.ts`, `config.ts`, their tests, and the docs.

---

## DESIGN

### Flow inside `extract`

```text
t0 ── primary  (prebuilt-invoice) ───────────────┐
   ── secondary (prebuilt-receipt) ──────────────┤ existing: merge, QR JIR
   ── reader: prebuilt-read ──► gpt-4.1 ─────────┤
                                                 ▼
        two-model result ready ── start READER_GRACE_MS (3 s) ── await reader
                                                 ▼
             reading present → mergeScalars → result     reading null → result unchanged
```

- The reader starts before the primary call is awaited, like the secondary.
- The reader's grace timer starts when the two-model result is ready, that is after
  `await secondaryPending`. Worst-case added wait is 3 s.
- The overall `EXTRACTION_TIMEOUT_MS` abort also aborts the reader.
- A 429 from the completion endpoint is a failure, not a retry: the harness waited out
  `retry-after` (10 s by default), which the 3 s grace makes pointless.

### Where it is wired

`createAzureProvider()` with no options stays a **two-model provider**. The reader is passed in:

```ts
// api/src/app.ts
const extractionProvider =
  options.extractionProvider ?? createAzureProvider({ scalarReader: createScalarReader() });
```

`createScalarReader()` returns `null` when the configuration is incomplete. This placement is
deliberate: the local `.env` holds real `AZURE_OPENAI_*` values and `config.ts` loads it in tests,
so a reader built by default inside `createAzureProvider` would make every existing provider test,
`scripts/bakeoff/production.ts` and `scripts/score-extraction.ts` call the paid service.

### Types

```ts
// types.ts
export interface ExtractionFieldMetadata {
  readonly confidence: number | null;
  readonly source: "model" | "text" | "inferred" | "qr" | "reader";
}
// ExtractionMetadata gains:
readonly fieldModels?: Record<string, "primary" | "secondary" | "reader">;
/** The scalar reader's part in this extraction; null when it was off, failed or was abandoned. */
readonly reader?: {
  readonly ocrModelId: string;
  readonly deployment: string;
  readonly latencyMs: number;
  /** Scalars both readings hold with the same value. */
  readonly agreed: string[];
  /** Rule 5: both hold a value, they differ, the two-model value was kept. */
  readonly disagreed: string[];
} | null;
```

```ts
// scalar-reader.ts
export interface ScalarReading {
  /** Each value as the model copied it. */
  readonly printed: Record<string, string | null>;
  /** The same values through the production parsers; null where a parser could not read one. */
  readonly fields: Record<string, string | null>;
  readonly ocrModelId: string;
  readonly deployment: string;
  readonly latencyMs: number;
  /** The OCR response, kept for outlines and debugging. */
  readonly analyzeResult: AnalyzeResultOutput;
}
export type ScalarReader = (input: ExtractionInput, signal: AbortSignal) => Promise<ScalarReading>;
```

### What is stored

`raw_provider_result` gains two keys beside `secondaryAnalyzeResult`:

- `readerAnalyzeResult` — the `prebuilt-read` `analyzeResult`, or `null`.
- `readerAnswer` — the 14 values as the model copied them, or `null`.

`fieldModels[name] = "reader"` for every scalar the merge filled, replaced **or cleared**.
`extraction_metadata.reader` holds the summary above. Nothing else changes shape; no migration.

### Flags (`lowConfidenceFields`)

```text
listed = (source "model", confidence < 0.7, not QR-corroborated, not in metadata.reader.agreed)
       ∪ (metadata.reader.disagreed ∩ FLAGGED_DISAGREEMENT_FIELDS, not QR-corroborated)
```

The client renders the list as it does today: the ordinary amber and the generic hint. **No client
change, no new copy, no new translation key.**

### Outlines (`mapStoredSourceRegions`)

1. Project as today from the primary and secondary responses.
2. Drop every region path whose `fieldModels` entry is `"reader"` (this removes the outline of a
   replaced value and of a cleared buyer).
3. For each such path with a non-empty `readerAnswer` value, search the `readerAnalyzeResult`
   words for it and add a region with `origin: "text"`, normalised by the read page's own
   dimensions through the existing `addCorners`.

---

## IMPLEMENTATION PLAN

### Phase 0: Preconditions

Commit iterations 27 and 28; mark `amelie-receipt` verified; capture baselines.

### Phase 1: Foundation

Configuration, types, and the three pure modules (normaliser, merge, word search) with their tests.
Nothing calls the network yet.

### Phase 2: Core Implementation

The reader's two calls, its wiring into the provider with the grace timeout, and what is stored.

### Phase 3: Integration

Flags, outlines, startup log, fixtures and the offline scorer, `.env.example`, `render.yaml`.

### Phase 4: Testing & Validation

Parity with the probe, the live run, the browser check.

### Phase 5: Documents

PRD, ROADMAP, README, `/validate`, history.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

All commands run from `prototypes/receipt-ocr/` unless a task says the monorepo root. The shell is
Git Bash or PowerShell 5.1; in PowerShell chain with `;`, never `&&`.

### Task 0 — COMMIT iterations 27 and 28 (precondition)

- **IMPLEMENT**: One commit holding the working tree as it stands before this iteration:
  `scripts/bakeoff/**`, `.agents/ROADMAP.md`, and with `git add -f`:
  `.agents/plans/plan-b-llm-pass-content-understanding-measurement.md`,
  `.agents/specs/scalar-llm-reader-probe.md`, `.agents/specs/llm-scalar-reader.md`,
  `.agents/research/plan-b-engines.md`, `.agents/research/scalar-llm-reader-probe.md`,
  `.agents/history/27-plan-b-llm-pass-content-understanding-measurement.md`,
  `.agents/history/28-scalar-llm-reader-probe.md`, and this plan. Message:
  `chore(bakeoff): measure an LLM pass, Content Understanding and a parallel scalar reader`.
  End the message with the attribution lines the session provides.
- **GOTCHA**: `.agents` is ignored at the monorepo root, so new files under it need `git add -f`.
  `.bakeoff/` and `.env` must stay untracked: check `git status --short` shows neither.
- **GOTCHA**: Push with `git push github prototype/receipt-ocr` **only**. Do not run the subtree
  push for this commit (decision Q1) and never push to `origin`.
- **GOTCHA**: If the product owner has already committed these, skip the task and say so.
- **VALIDATE**: `git status --short` prints nothing; `git log --oneline -1` shows the new commit.

### Task 1 — UPDATE `scripts/bakeoff/ground-truth/amelie-receipt.json`

- **IMPLEMENT**: Set `"verifiedBy": "product owner, 2026-10-12"` and replace the first note with
  `"Scalars drafted by the agent from the photo on 2026-10-12 and verified by the product owner the same day."`
  Change no value.
- **GOTCHA**: `score-scalar-probe.ts` keeps `amelie-receipt` outside its totals by sample list, not
  by this key. Leave the scorer alone; the probe's published numbers must stay reproducible.
- **VALIDATE**: `node --env-file-if-exists=.env --import tsx scripts/bakeoff/score-scalar-probe.ts` exits 0.

### Task 2 — CAPTURE baselines (no file change)

- **IMPLEMENT**: Save the two-model score and the test count to the scratchpad for later comparison.
- **VALIDATE**: `npm run score:extraction > "$SCRATCH/score-before.json"` and `npm test` (record the
  file and test counts; history 26 recorded 53 files, 606 tests).

### Task 3 — UPDATE `api/src/config.ts`

- **IMPLEMENT**: Four optional string settings on `Config`, each `process.env[...]?.trim() ?? ""`:
  `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`,
  `AZURE_OPENAI_API_VERSION`. Add a doc comment: the scalar reader is on only when all four are
  set; blank any one to turn it off.
- **PATTERN**: `config.ts:100–107`.
- **GOTCHA**: None may go through `readRequired`. The deployed app must start with all four absent.
- **VALIDATE**: `npm run typecheck`

### Task 4 — UPDATE `api/src/providers/document-extraction/types.ts`

- **IMPLEMENT**: The three type changes under "Types" in DESIGN: `"reader"` in
  `ExtractionFieldMetadata.source`, `"reader"` in `ExtractionMetadata.fieldModels`, and the optional
  `reader` summary.
- **GOTCHA**: `merge.ts` exports `FieldModel = "primary" | "secondary"` and types its own
  `fieldModels` with it. Leave `FieldModel` as it is (the two-model merge never produces
  `"reader"`); the widening happens where the scalar merge returns its result.
- **VALIDATE**: `npm run typecheck`

### Task 5 — CREATE `api/src/providers/document-extraction/scalar-merge.ts`

- **IMPLEMENT**:
  - `export const SCALAR_FIELDS` — the 14 names in the order of `field-schema.ts`:
    `sellerName, sellerAddress, sellerOib, buyerName, buyerAddress, buyerOib, documentNumber,
    issueDate, issueTime, total, currency, paymentMethod, jir, zki`.
  - `BUYER_FIELDS`, `READER_FIRST_FIELDS = ["paymentMethod", "issueTime"]`,
    `FLAGGED_DISAGREEMENT_FIELDS = ["documentNumber", "issueDate", "total", "currency"]` with a
    comment giving the measured reason (see "One decision to confirm").
  - `sameValue(field, left, right): boolean` — port of `compare.ts` `matches` for scalars: `total`
    by `amountsEqual` when both are amounts, else string equality; `issueDate`, `issueTime`,
    `sellerOib`, `buyerOib`, `currency` exact; `jir`, `zki` case-insensitive; every other field by
    the text key (lower case, everything that is not a letter or digit removed, diacritics kept).
    Two empty values are equal; one empty is not.
  - `mergeScalars(production, reading)` where `production` is
    `{ fields, metadata, fieldModels, qr }` and `reading` is `{ printed, fields }`. Port
    `scripts/bakeoff/scalar-merge.ts` branch for branch, **without** the `grounded` parameter.
    Returns `{ fields, metadata, fieldModels, agreed, disagreed }`:
    - locked = fields whose metadata `source === "qr"` ∪ `qrCorroboratedFields(production.fields, production.qr)`; a locked field is skipped entirely.
    - `offered` is `reading.fields[name]`, but `null` when `reading.printed[name]` is empty.
    - buyer field: a filled `offered` different from the current value is taken; an **empty
      `printed`** with a filled current value clears it to `null`.
    - reader-first field: a filled `offered` different from the current value is taken.
    - any other field: taken only when the current value is empty; when both are filled and
      `!sameValue` it goes to `disagreed`.
    - `agreed` = every non-locked scalar where both are filled and `sameValue`.
    - On take: `metadata[name] = { confidence: null, source: "reader" }`, `fieldModels[name] = "reader"`.
    - On clear: `delete metadata[name]`, `fieldModels[name] = "reader"`, value `null`.
  - Never touches `vatBreakdown`, `items` or any key outside `SCALAR_FIELDS`. Returns new objects;
    does not mutate its inputs.
- **PATTERN**: `scripts/bakeoff/scalar-merge.ts:43–91`; doc comment style of `merge.ts:4–16`.
- **IMPORTS**: `amountsEqual`, `isAmount`, `type CanonicalReceiptFields` from `@receipt/shared`;
  `qrCorroboratedFields` from `../../validation/warnings.js`; `type FiscalQrData` from
  `./fiscal-qr.js`; `type ExtractionFieldMetadata` from `./types.js`.
- **GOTCHA**: A value the parser could not read has a filled `printed` and a `null` field. It must
  neither fill nor clear: that is why the clear tests `printed`, not `offered`.
- **GOTCHA**: `/validate` 6.22 greps `merge.ts` for confidence comparisons. This file compares no
  confidence either; keep it that way.
- **VALIDATE**: `npm run typecheck`

### Task 6 — CREATE `api/src/providers/document-extraction/scalar-merge.test.ts`

- **IMPLEMENT**: Port all nine cases of `scripts/bakeoff/scalar-merge.check.ts` to Vitest (read
  that file and keep each case's intent), then add:
  - a field the QR code supplied (`source: "qr"`) or corroborates is never changed and appears in
    neither `agreed` nor `disagreed`;
  - a cleared buyer field: value `null`, no metadata, `fieldModels` `"reader"`;
  - a taken value's metadata is `{ confidence: null, source: "reader" }`;
  - `d. o.o.` against `d.o.o.` on `sellerName` is `agreed`, not `disagreed`;
  - `vatBreakdown` and `items` are returned identical (same reference content);
  - inputs are not mutated;
  - `sameValue`: `"100.50"`/`"100.5"` equal on `total`; JIR case-insensitive; `issueDate` exact.
- **VALIDATE**: `npx vitest run --project api scalar-merge`

### Task 7 — CREATE `api/src/providers/document-extraction/word-search.ts` and its test

- **IMPLEMENT**:
  - `printedForms(canonical: string): string[]` — port of `ground.ts` `surfaceForms` (date, OIB
    with `HR`, amount forms).
  - `findWords(candidates: readonly string[], analyzeResult): { pageNumber: number; polygon: number[] } | null`
    — port of `groundValue` returning the **first** match in page-then-reading order: words taken
    from `analyzeResult.pages[].words[]`, each word split at `:` into tokens that keep the word's
    polygon (`repair.ts:93–100`), runs of up to 24 consecutive tokens within one page, comparison
    by a key that removes whitespace, folds diacritics (`NFD`, combining marks stripped, `đ`→`d`),
    lower-cases, and removes **every character that is not a letter or digit**. The polygon
    returned is the eight-number envelope of the run (reuse the envelope logic; export `envelope`
    from `source-regions.ts` or pass the points through `addCorners` there).
- **GOTCHA**: The key is wider than the harness's, which removed only `. , ; :` and so missed
  `screenshot-20190705-1907152`'s `NOVCANICE`, printed as `(NOVCANICE)`. That was the one miss in
  13 reader-supplied values a run. This widening affects outlines only, never values.
- **GOTCHA**: A candidate whose key is empty must be skipped, or it matches the first word.
- **IMPLEMENT (test)**: with a small hand-built `analyzeResult`: a value found across three words;
  a value glued to its label (`JIR:b19e…`); a bracketed value; a date found as `1.06.2026` from
  canonical `2026-06-01`; an amount `33.10` found as `33,10`; a value printed twice returns the
  first; a value not on the page returns `null`; a run never crosses a page.
- **VALIDATE**: `npx vitest run --project api word-search`

### Task 8 — CREATE `api/src/providers/document-extraction/scalar-reader.ts` (pure parts)

- **IMPLEMENT**:
  - `SCALAR_DESCRIPTIONS: Record<string, string>` — the 14 descriptions copied **character for
    character** from `scripts/bakeoff/field-schema.ts:19–52`.
  - `READER_SYSTEM` — `SYSTEM` from `field-schema.ts:80–86`, character for character (two
    sentences, a blank line, then `SHARED_RULES`).
  - `READER_SCHEMA` — `{ type: "object", properties, required, additionalProperties: false }`
    where each property is `{ type: ["string", "null"], description }` and `required` lists all 14
    in order. It must equal `REPAIR_SCHEMA` in `repair.ts`.
  - `documentMessage(content: string): string` — `` `<dokument>\n${content}\n</dokument>` ``.
  - `parseAnswer(value: unknown): Record<string, string | null>` — a Zod object of the 14 keys,
    each `z.string().nullable()`, unknown keys stripped. Throws on anything else.
  - `normalizeScalars(printed): Record<string, string | null>` — port of `normalize.ts` scalars
    only: `oneLine` for `sellerName`, `sellerAddress`, `buyerName`, `buyerAddress`,
    `documentNumber`, `paymentMethod`; the `oib` parser for both OIBs; the `date` parser (day-first
    through `parseIssueDate`, then the month-first fallback); `parseIssueTime`; `parseAmount` for
    `total`; `currencyCode`; the `jir` parser; `compact` for `zki`. A blank or whitespace-only
    printed value is `null`.
- **IMPORTS**: `parseAmount`, `parseIssueDate`, `parseIssueTime` from `@receipt/shared`;
  `normalizeOib` from `./croatian.js`; `z` from `zod`.
- **GOTCHA**: Do **not** port the normaliser's currency inference (`normalize.ts:163–169`). The
  merge already treats an inferred value as "not the reader's reading" (`printed` empty → nothing
  offered), so leaving it out is equivalent and production's own inference stays the only one.
- **GOTCHA**: The descriptions and the system prompt are Croatian with diacritics. Write the file
  as UTF-8 and check it for mojibake after writing (`/validate` 6.11 shows the failure shape).
- **VALIDATE**: `npm run typecheck`

### Task 9 — ADD the two calls to `scalar-reader.ts`

- **IMPLEMENT**:
  - `export function createScalarReader(options?): ScalarReader | null`. Options (all for tests):
    `settings` (endpoint, key, deployment, apiVersion), `ocr`
    (`(input, signal) => Promise<AnalyzeResultOutput>`), `complete`
    (`(content, signal) => Promise<unknown>`). Returns `null` when any of the four settings is
    blank and no `complete` was injected.
  - Default `ocr`: `prebuilt-read` through the provider's own submit-and-poll loop. Export that
    loop from `azure.ts` for this (see Task 10) and call it with `modelId: "prebuilt-read"`,
    `locale`, and **no** `features`.
  - Default `complete`: one `fetch` POST to
    `${endpoint without trailing slash}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
    headers `{ "api-key": key, "Content-Type": "application/json" }`, `signal`, body exactly as
    measured:
    ```json
    {
      "messages": [
        { "role": "system", "content": "<READER_SYSTEM>" },
        { "role": "user", "content": "<documentMessage(content)>" }
      ],
      "temperature": 0,
      "max_tokens": 8000,
      "response_format": {
        "type": "json_schema",
        "json_schema": { "name": "HrReceipt", "schema": "<READER_SCHEMA>", "strict": true }
      }
    }
    ```
    A non-2xx status throws `new Error(`scalar reader: HTTP ${status}`)`. Then
    `JSON.parse(body.choices[0].message.content)`.
  - The reader: `ocr` → `complete(documentMessage(analyzeResult.content ?? ""))` → `parseAnswer` →
    `normalizeScalars`; returns a `ScalarReading` with `latencyMs` measured around both calls.
- **GOTCHA — receipt text must never reach a log.** An error thrown here carries the HTTP status
  only: never the response body, the prompt or the answer, and never as `cause`. `logger`'s
  redaction is one level deep and would not catch text nested in an error.
- **GOTCHA**: No retry and no 429 wait. Any failure rejects; the provider logs it and carries on.
- **GOTCHA**: An empty OCR `content` is not an error: the model returns 14 nulls, the merge then
  clears nothing it should not (a buyer field is cleared only when `printed` is empty **and**
  production has one: that is the measured rule). But a receipt with no text at all is one where
  the two-model result should stand, so when `content` is empty or whitespace, reject with
  `new Error("scalar reader: no text")` before calling the model.
- **PATTERN**: `scripts/bakeoff/model-input.ts:760–805`, `scripts/bakeoff/layout.ts:39–81`.
- **VALIDATE**: `npm run typecheck`

### Task 10 — UPDATE `api/src/providers/document-extraction/azure.ts`

- **REFACTOR**: Export the submit-and-poll loop so the reader can use it for `prebuilt-read`.
  `analyzeWithAzure` currently always sends `features: ["barcodes"]`; give it an optional
  `features` argument defaulting to `["barcodes"]` and let the reader pass none (send no
  `features` query parameter in that case). Behaviour for the two existing models is unchanged.
- **ADD** to `AzureProviderOptions`: `readonly scalarReader?: ScalarReader | null;`
- **ADD** `export const READER_GRACE_MS = 3_000;` with a comment: measured 2 s kept 16 of 16 calls
  from a home connection; one `gpt-4.1` call in 192 was held 84 s by the service; 3 s is the top of
  the accepted budget and also the worst-case added wait.
- **ADD** in `extract`, mirroring the secondary:
  - a `readerController`, aborted when `controller` aborts;
  - `readerPending` started before the primary is awaited, `Promise.resolve(null)` when
    `options.scalarReader` is null or undefined, otherwise the call with a `.catch` that logs
    `warn` (`"scalar reader unavailable; continuing with the two-model result"`, with `err` and
    whether it was the grace timer that fired) and returns `null`;
  - after `await secondaryPending`: `readerGraceTimer = setTimeout(abortReader, READER_GRACE_MS)`,
    then `const reading = await readerPending`;
  - after `applyQrJir`: when `reading !== null`, `mergeScalars({ fields: merged.fields, metadata:
    merged.metadata, fieldModels: merged.fieldModels, qr }, reading)` and use its `fields`,
    `metadata` and `fieldModels` for the result;
  - result `metadata.reader`: the summary when merged, `null` otherwise;
  - result `raw`: `readerAnalyzeResult: reading?.analyzeResult ?? null`,
    `readerAnswer: reading?.printed ?? null`, and the merged `fieldModels`;
  - `finally`: `clearTimeout(readerGraceTimer)`.
- **GOTCHA**: `metadata.latencyMs` must keep meaning the whole extraction, so compute it after the
  reader is awaited, as today.
- **GOTCHA**: `fields` and `metadata.fields` must come from the **same** merge result; the
  low-confidence list reads metadata by field name.
- **GOTCHA**: The reader runs on the success path only. If the primary throws, the `finally`
  `controller.abort()` cancels the reader; do not await it there.
- **VALIDATE**: `npx vitest run --project api azure` (every existing test still passes unchanged)

### Task 11 — UPDATE `api/src/app.ts` and `api/src/index.ts`

- **IMPLEMENT**: In `app.ts`, build the default provider as
  `createAzureProvider({ scalarReader: createScalarReader() })`. In `index.ts`, add
  `scalarReader: <true|false>` to the `"api listening"` log object (true when all four settings are
  non-blank; export a small `scalarReaderConfigured()` from `scalar-reader.ts` or read `config`).
- **GOTCHA**: Check how `api/src/app.test.ts` and `api/src/routes/receipts.integration.ts` build
  the app. Any that call `createApp()` without `extractionProvider` now construct a reader from the
  local `.env`. Constructing is free; **calling** is paid. Confirm no test reaches `extract` on a
  default-built app: `grep -rn "createApp(" api/src` and read each call site.
- **VALIDATE**: `npm run typecheck`; `npm test`

### Task 12 — CREATE `api/src/providers/document-extraction/scalar-reader.test.ts`

- **IMPLEMENT**:
  - `READER_SCHEMA` has 14 required properties, no `items` or `vatBreakdown`,
    `additionalProperties: false`, every type `["string", "null"]`.
  - `normalizeScalars`: `"1.06.2026"` → `2026-06-01`; `"33,10"` → `33.10`; `"€"` → `EUR`;
    `"kn"` → `HRK`; `"OIB: 73710835843"` → the OIB; an OIB failing its check digit is kept as
    printed; a JIR without hyphens gains them; a wrapped address becomes one line; an unreadable
    date is `null`; a blank is `null`; no currency is inferred from a date.
  - `parseAnswer` rejects a non-object, a missing key and a number value; strips an unknown key.
  - The default `complete`, with `globalThis.fetch` stubbed by `vi.stubGlobal`: the URL, the
    `api-key` header and the body shape; the request carries the signal; a 429 and a 500 each
    reject **once** with a message holding the status and nothing from the body.
  - `createScalarReader` with injected `ocr` and `complete`: returns printed and normalised
    values; rejects on empty OCR content without calling `complete`; returns `null` when a setting
    is blank.
- **GOTCHA**: `vi.unstubAllGlobals()` in `afterEach`. No test may reach the network.
- **VALIDATE**: `npx vitest run --project api scalar-reader`

### Task 13 — ADD provider tests to `azure.test.ts`

- **IMPLEMENT** (each with the existing `analyze` stub and an injected `scalarReader`):
  - merged: a reading fills an empty `paymentMethod`, clears a buyer the models invented, and the
    result's `metadata.reader.agreed`/`disagreed`, `fieldModels` and `raw.readerAnswer` are set;
  - **a reader that throws leaves the two-model result identical** to a run with no reader
    (compare `fields`, `metadata.fields`, `metadata.fieldModels`), with `metadata.reader === null`
    and `raw.readerAnswer === null`;
  - **a reader that never settles is abandoned `READER_GRACE_MS` after the two-model result**
    (fake timers; assert its signal is aborted and the result is the two-model one);
  - **a reader returning a malformed answer** (reject from `parseAnswer`) leaves the two-model
    result intact;
  - **no reader configured** (`scalarReader: null`): result identical to today, `metadata.reader`
    is `null`;
  - the QR code's JIR is still what is stored when the reading offers a different JIR;
  - `vatBreakdown` and `items` are untouched by a reading.
- **PATTERN**: the existing "stalled second model" test for fake timers.
- **VALIDATE**: `npx vitest run --project api azure`

### Task 14 — UPDATE `api/src/routes/receipts.ts` (`lowConfidenceFields`) and its test

- **IMPLEMENT**: Read `metadata.reader` defensively, as the function already reads `fields`
  (stored JSON, type `unknown`). Apply the rule under "Flags" in DESIGN. Update the doc comment:
  two more bullets, one for agreement, one for a disagreement on an exact-valued critical field.
- **IMPORTS**: `FLAGGED_DISAGREEMENT_FIELDS` from `../providers/document-extraction/scalar-merge.js`.
- **GOTCHA**: The signature `(metadata, corroborated = [])` is also called by
  `scripts/score-extraction.ts`; keep it.
- **GOTCHA**: A row stored before this iteration has no `reader` key: behaviour must be exactly
  today's. A `reader` of `null` likewise.
- **IMPLEMENT (test, `receipts.test.ts`)**: a low model confidence is dropped when the field is in
  `agreed`; kept when it is not; a `disagreed` `total` at confidence 0.98 is listed; a `disagreed`
  `sellerAddress` is not; a `disagreed` field the QR code corroborates is not; metadata without
  `reader` gives today's list.
- **VALIDATE**: `npx vitest run --project api receipts`

### Task 15 — UPDATE `source-regions.ts` (`mapStoredSourceRegions`) and its test

- **IMPLEMENT**: The three steps under "Outlines" in DESIGN. Add `storedReaderAnalyzeResult(raw)`
  and `storedReaderAnswer(raw)` beside the existing `stored*` readers, with the same defensive
  shape checks. For each path owned by `"reader"`: candidates are the printed value with wrapped
  lines joined by a space, then `normalizeScalars` of it and its `printedForms`; `findWords` over
  the read response; `addCorners(..., "text", readDimensions)`.
- **GOTCHA**: `total` and `currency` share one region in the existing projection (deduplicated by
  corners). Dropping by path uses the existing `retain`, which already removes one field from a
  shared region and keeps the other.
- **GOTCHA**: The read response's page dimensions are its own; build them with the existing
  `pageDimensions` from the read response, not from the primary's.
- **GOTCHA**: The final `sourceRegionsResponseSchema.parse` is the Azure-leak guard (`/validate`
  6.17). Keep it as the last step.
- **IMPLEMENT (test)**: using a recorded primary fixture plus a `fixtures/reader/` file (Task 16):
  a reader-supplied `paymentMethod` is outlined with `origin: "text"`; a cleared `buyerName` has no
  region although the primary response holds one; a reader-supplied value not on the page has no
  region; a receipt stored with no reader keys projects exactly as before (existing tests
  unchanged).
- **VALIDATE**: `npx vitest run --project api source-regions`

### Task 16 — CREATE the reader fixtures

- **IMPLEMENT**: For each of the 14 receipts that have a file in
  `api/src/providers/document-extraction/fixtures/` **and** a record under
  `.bakeoff/scalar-probe/`, write `fixtures/reader/<name>.json`:
  `{ "analyzeResult": <text-read-r1/<name>.json → operation.analyzeResult>, "answer": <llm-read-gpt-4.1-r1/<name>.json → fields> }`.
  A throwaway script in the scratchpad is fine; do not commit it.
- **GOTCHA**: `0f089468f365211452db4ccf6e8da466` (Konzum) and `amelie-receipt` have probe records
  but no primary fixture, so they get no reader fixture here; they are covered by the live run
  (Task 20) and the harness score. `31231822`, `racun-mobilna-trgovina` and `mapper-edge-cases`
  have a primary fixture and no probe record: no reader fixture, scored two-model as today.
- **GOTCHA**: The probe read the file the app would upload (Chrome-downscaled for four photos);
  some primary fixtures were recorded from the full-resolution file (`lira_trogir`). The offline
  merged score is therefore a regression gate, not a reproduction of the probe's 198.
- **GOTCHA**: `/validate` 6.19 and 6.23 list `fixtures/` and `fixtures/secondary/`; a `reader`
  directory entry has no `.json` suffix and passes both. Run them.
- **GOTCHA**: These files hold receipt text, as the existing fixtures do. They are committed.
- **VALIDATE**: `ls api/src/providers/document-extraction/fixtures/reader | wc -l` prints 14; the
  6.19 and 6.23 one-liners in `.claude/commands/validate.md` print `ok`.

### Task 17 — UPDATE `scripts/score-extraction.ts`

- **IMPLEMENT**: A `--reader` flag. Without it the script's output is **byte-identical** to
  Task 2's baseline. With it, after `applyQrJir`, a receipt that has a `fixtures/reader/` file gets
  `mergeScalars` applied with `{ printed: answer, fields: normalizeScalars(answer) }`; flags are
  computed with `lowConfidenceFields({ fields: metadata, reader: { agreed, disagreed } }, …)`; the
  output gains a top-level `"reader": { "receiptsMerged": n }`.
- **GOTCHA**: `npm run score:extraction -- --reader` passes the flag through npm.
- **GOTCHA**: With the reader, a receipt's warnings can legitimately change (`lira_trogir` gains
  its document number from the reader fixture, so `missing_critical_field:documentNumber`
  disappears). Do not edit `.agents/fixtures/expected-warnings.json` to hide that: its two-model
  expectations stay. Report each difference in the history file with its cause. If more than three
  receipts differ, stop and investigate before continuing.
- **VALIDATE**: `npm run score:extraction > "$SCRATCH/score-after.json"`; `diff` against
  `score-before.json` is empty. Then `npm run score:extraction -- --reader` runs and every scalar
  count is ≥ its two-model count **except** where the history file explains a specific receipt.

### Task 18 — CREATE `scripts/bakeoff/product-parity.check.ts` and RUN the parity check

- **IMPLEMENT**: A `node:test` file asserting `READER_SYSTEM === SYSTEM`,
  `deepStrictEqual(READER_SCHEMA, REPAIR_SCHEMA)`, and `SCALAR_FIELDS` equal in order, importing
  the product modules by relative path as the other harness files do.
- **IMPLEMENT (one-off, scratchpad, not committed)**: over all 16 receipts and runs 1–3 of
  `.bakeoff/scalar-probe/llm-read-gpt-4.1-r*`, compare the product's
  `mergeScalars(production-r1, { printed, fields: normalizeScalars(printed) })` with the harness's
  `mergeScalars(reading, { printed, fields: normalize(printed).fields })` (no `grounded`). The 14
  scalar values must be identical for every receipt and run, and `disagreed` must match.
- **GOTCHA**: The harness comparator's `paymentMethod` rule is asymmetric and is never reached
  under rule 4; a difference there is a porting bug, not an expected one.
- **GOTCHA**: `.bakeoff/` is local and git-ignored. If the records are missing, say so in the
  history file and skip the one-off; the committed check still runs.
- **VALIDATE**: `node --env-file-if-exists=.env --import tsx --test scripts/bakeoff/*.check.ts`
  passes (46 checks before this iteration, plus the new file's); the one-off prints 0 differences
  over 48 receipt-runs.

### Task 19 — UPDATE `.env.example`, `render.yaml`

- **IMPLEMENT**: `.env.example`: a section `# --- Scalar reader (iteration 29) ---`, a comment that
  the four are server-only, must never gain a `VITE_` prefix, and that leaving any blank turns the
  reader off; then the four names with **no values**. `render.yaml`: the four keys on
  `receipt-ocr-api` with `sync: false`, under the existing secrets comment.
- **GOTCHA**: `/validate` 6.1b fails on any value in `.env.example`. 6.6 fails until the README
  configuration table lists the same four names (Task 23): run 6.6 after that task.
- **GOTCHA**: The local `.env` already holds real values for these four. Do not print, log or copy
  them anywhere.
- **VALIDATE**: the 6.1 and 6.1b one-liners print `ok`.

### Task 20 — LIVE RUN: five uploads through the local app (paid, about $0.15)

- **IMPLEMENT**:
  1. Free the ports (`/validate` 8.1). Start the API with `PORT=3001` (the local `.env` sets
     another port the Vite proxy does not follow; `/validate` 8.17) and the client with
     `--strictPort`. Confirm the startup log says `scalarReader: true` and Vite reports 5173.
  2. Create a disposable account. Upload, from `.agents/fixtures/receipts/` (the Konzum file is
     `0f089468f365211452db4ccf6e8da466.png`): `lira_trogir`, `26515835`, the Konzum receipt,
     `amelie-receipt`, `primjer1-hr-nopdv`.
  3. For each stored row (read with the secret key): `extraction_metadata.reader` is not null;
     `raw_provider_result.readerAnswer` holds 14 keys; `canonical_data`'s scalars equal the
     probe's merged values for that receipt (`score-scalar-probe.ts --verbose` lists them), any
     difference explained by a fresh OCR call.
  4. Expected, from the probe: payment method filled on `26515835`; the wrong buyer cleared on
     `26515835`; `lira_trogir`'s seller OIB, JIR and ZKI filled and its buyer OIB cleared;
     Konzum's currency filled and its `total` amber (disagreement) with the kuna value still
     shown; `primjer1-hr-nopdv`'s buyer filled and the buyer block open.
  5. In a real browser at 1440 px and 390 px, in `hr` and `en`: reader-supplied values are
     outlined on their own text; a cleared buyer shows no stray outline and the buyer block is
     hidden behind Add buyer; amber appears only with the existing generic hint; no new or raw
     translation key; no horizontal overflow.
  6. Record per receipt the extraction `latencyMs` and the reader's `latencyMs`.
  7. Delete the account, its rows and its five stored source objects. Free the ports.
- **GOTCHA**: `agent-browser open` hung in iteration 27; if it does, drive headless Chrome
  directly as that iteration did. Layout and hit-testing are only provable in a real browser.
- **GOTCHA**: Grep the application logs for any receipt value (a seller name, an OIB): there must
  be none.
- **GOTCHA**: Estimate before uploading (5 × about $0.026) and record the actual calls and cost in
  the history file. If a step needs more paid calls than about 15, say why in the history file.
- **VALIDATE**: every point of step 3–5 observed and written into the history file; orphan-user
  check from `/validate` 7b prints `[]`.

### Task 21 — UPDATE `PRD.md` (in place, minimal, dated)

Use the wording "Amended 2026-10-12 (iteration 29)" and point at
`.agents/research/scalar-llm-reader-probe.md`. Change only these places:

- **§2 principle 6** — "LLM orchestration" stays in the list of things to avoid; add that one
  fixed-rule scalar reader is the exception.
- **§4.7** — the "LLM-based extraction, verification, or fallback" line: amended to say an LLM
  reads scalar fields as a third, additive reader; LLM verification, LLM fallback and LLM reading
  of items or VAT stay out of scope.
- **§7.6** — "sole OCR/document extraction platform" and "LLM fallback is not part of the initial
  PoC": amended; Azure Document Intelligence remains the only OCR; the scalar reader is given its
  text and is never load-bearing.
- **§7.8** — "No LLM validation in the PoC": unchanged, with a note that the reader produces
  values, not validation, and adds no warning.
- **§8** — "Explicitly excluded dependencies: LLM SDKs": unchanged and still true; add one line
  that the reader calls the Azure OpenAI REST endpoint with the runtime's `fetch`.
- **§9.2** — add the four `AZURE_OPENAI_*` names to the example block.
- **§9.4** — one sentence: receipt text is sent to Azure OpenAI in the same Azure tenant as
  Document Intelligence; neither the text nor the answer is logged.
- **§14** — the "PoC expands…" row: remove "LLM" from the list kept out of scope, or qualify it.
- **Appendix C item 4** — amended: an LLM is in the extraction path as an additive scalar reader.
- **Completion checklist** — "Azure model/fallback/LLM implementation details are deferred":
  leave, with the amendment note.
- **GOTCHA**: Prettier does not touch `*.md` and must not. Keep hand-aligned tables aligned.
- **VALIDATE**: `git diff --stat PRD.md` shows a small diff; `grep -n "LLM" PRD.md` and read every
  hit: none still says the application has no LLM without the amendment beside it.

### Task 22 — UPDATE `.agents/ROADMAP.md`

- **IMPLEMENT**: Status paragraph (iteration 29, a product change); one row 29 in "Iterations
  outside the numbered task list" linking this plan and the history file; **§5 rule 10** reworded
  so "LLMs" is no longer in the blanket list, with what stays out (LLM reading of items or VAT, an
  LLM winning a critical field, LLM validation); and one amendment paragraph, in the style of the
  existing ones, stating: the reader and its evidence; that the buyer-clearing rule narrows
  iteration 23's "a second reader never blanks a value" for three fields; that it is additive and
  never load-bearing; and the flag decision with its measured reason.
- **VALIDATE**: read the diff; the progress table and existing amendments are untouched.

### Task 23 — UPDATE `README.md`

- **IMPLEMENT**: the status blurb; a new subsection under "Extraction" ("A third reader for scalar
  fields"): the shape, the merge rule as a table, why it is a fixed rule and not confidence, the
  grace, what is stored, how flags change, how outlines are found, the measured numbers and their
  limits (in-sample, 13 of 15 unchanged); the `score:extraction -- --reader` mode; the four rows in
  the Configuration table; the Logging section (receipt text and the model's answer are never
  logged; the reader's errors carry a status only); any sentence saying the app has no LLM
  (`grep -n -i "llm" README.md`).
- **GOTCHA**: `/validate` 6.6 checks that every backticked file path in the README exists and that
  the Configuration table and `.env.example` name the same variables.
- **VALIDATE**: the 6.6 one-liner prints `ok`.

### Task 24 — UPDATE `shared/src/receipt.test.ts` and `.claude/commands/validate.md`

- **IMPLEMENT (test)**: extend the forbidden vocabulary with `openai|\bgpt\b|\bllm\b` so the
  second provider is guarded like the first.
- **IMPLEMENT (validate.md, by hand, never regenerated)**:
  - Phase 4 table: one row per new test file and per extended one, saying what each protects, in
    the table's existing voice. The load-bearing ones: a failed, slow or malformed reader leaves
    the two-model result intact; the merge rule; no receipt text in an error.
  - Phase 6: **6.25** the reader stays additive and optional — `config.ts` does not pass any
    `AZURE_OPENAI_` name to `readRequired`, and `azure.ts` still catches the reader's rejection;
    **6.26** no model vocabulary in `client/src` or `shared/src`.
  - Phase 8: **8.18** the journey of Task 20, with the paid-call note.
  - Update "As of Iteration 17 there are twelve journeys" only if that sentence is still being
    maintained; otherwise leave it.
- **VALIDATE**: `npx vitest run --project shared receipt`; run the new 6.25 and 6.26 one-liners.

### Task 25 — FULL VALIDATION, then history

- **IMPLEMENT**: Run the Validation Commands below once each. Write
  `.agents/history/29-llm-scalar-reader.md` from the ROADMAP template: what was built, files,
  decisions, deviations, validation results with real output for anything red, the paid runs and
  their cost, latency observed, the offline `--reader` score beside the two-model one, and known
  gaps. Record there the two manual steps left for the product owner (below).
- **GOTCHA**: The history file and this plan need `git add -f`.
- **VALIDATE**: all of Level 1–3 green except the three standing reds named below.

### Manual steps for the product owner (not part of the unattended run)

1. Review the diff; decide Q12's list (`sellerName` in or out); `/commit`.
2. In the Render dashboard, on `receipt-ocr-api`, add `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`,
   `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` with the values from the local `.env`.
3. After the push to `github` `main` redeploys: upload one receipt and confirm in Render's log the
   startup line `scalarReader: true` and no `scalar reader unavailable` warning.
4. A browser tab open across the deploy needs no reload: no response field was added or removed.

---

## TESTING STRATEGY

Vitest, colocated, no network. The reader's two calls are injected (`ocr`, `complete`) or `fetch`
is stubbed; the provider is tested through the existing `analyze` option plus an injected
`scalarReader`.

### Unit Tests

- `scalar-merge.test.ts` — the rule, branch by branch; the lock; agreement and disagreement lists.
- `scalar-reader.test.ts` — schema shape, normaliser, answer check, request shape, failure modes.
- `word-search.test.ts` — the tolerant search and its refusals.
- `azure.test.ts` — the reader inside the provider: merged, failed, slow, malformed, off.
- `receipts.test.ts` — the flag rule.
- `source-regions.test.ts` — reader outlines, the dropped outline of a cleared buyer.
- `shared/src/receipt.test.ts` — vocabulary guard.

### Integration Tests

`npm run test:integration` (hosted) must stay green; no route, schema or migration changes. The
live five-upload run (Task 20) is the end-to-end proof.

### Edge Cases

- The reader rejects, never settles, returns non-JSON, returns JSON missing a key.
- The reader finishes before the primary; after it within the grace; after the grace.
- All four variables absent; one blank.
- A parser cannot read a printed value (filled `printed`, `null` field): neither fills nor clears.
- The QR code supplies the JIR and the reader offers another.
- The reader returns the same value as production (`agreed`, nothing replaced).
- A receipt with no buyer in either reading: buyer fields stay empty, nothing recorded as cleared.
- OCR returns no text: the model is not called.
- A row stored before this iteration: flags, outlines and warnings exactly as today.
- A PDF source: read page dimensions are in inches; outlines still normalise to fractions.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```
npm run typecheck
npm run lint
npx prettier --check --end-of-line auto <each changed .ts/.json/.yaml file>
npx oxlint scripts/bakeoff
npx tsc --ignoreConfig --strict --noUncheckedIndexedAccess --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target esnext --skipLibCheck --types node scripts/bakeoff/*.ts scripts/score-extraction.ts
```

Standing reds, not this iteration's, to be reported and left: two lint errors in
`client/src/capture/downscale.ts:13-14`; repository-wide `npm run format:check` on CRLF files;
`/validate` 6.9 on `client/src/review/pdfDocument.ts`.

### Level 2: Unit Tests

```
npm test
node --env-file-if-exists=.env --import tsx --test scripts/bakeoff/*.check.ts
```

### Level 3: Integration and offline scoring

```
npm run build
npm run test:integration
npm run score:extraction
npm run score:extraction -- --reader
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score-scalar-probe.ts
```

`score:extraction` without the flag must be byte-identical to the Task 2 baseline. Phase 7a is
skipped: no migration changed; say so.

### Level 4: Manual Validation

Task 20, in full. `/validate` Phase 6 one-liners 6.1, 6.1b, 6.2, 6.6, 6.7 (by inspection), 6.17,
6.19, 6.22, 6.23, and the new 6.25 and 6.26.

### Level 5: Additional Validation

With the four variables blanked for one API start (`AZURE_OPENAI_DEPLOYMENT=` on the command line):
the startup log says `scalarReader: false` and one upload reaches `review` with
`extraction_metadata.reader` null. This is the deployed app's state until the product owner adds
the variables, so it must be seen working.

---

## ACCEPTANCE CRITERIA

- [ ] With the reader configured, an upload reaches `review` with the scalar merge applied, and
      `extraction_metadata.reader`, `raw_provider_result.readerAnswer` and
      `raw_provider_result.readerAnalyzeResult` stored.
- [ ] The product's merge gives the same 14 scalars as the harness's on all 16 receipts and three
      recorded runs (Task 18).
- [ ] A reader that fails, is slow, or answers malformed leaves the two-model result unchanged; a
      slow one is abandoned 3 s after the two-model result.
- [ ] With the four variables absent the API starts and behaves as before this iteration.
- [ ] `npm run score:extraction` is byte-identical to its baseline; `-- --reader` runs.
- [ ] Line items and VAT rows are never changed by the reader.
- [ ] A low-confidence flag is cleared by agreement; a disagreement on `documentNumber`,
      `issueDate`, `total` or `currency` is amber; no other new flag; no new UI copy.
- [ ] Reader-supplied values are outlined where their text is found; a cleared buyer leaves no
      outline.
- [ ] No receipt text, prompt or answer appears in any log line.
- [ ] No model vocabulary in `shared/`, `client/`, the canonical column or any API response.
- [ ] PRD, ROADMAP §5 rule 10, README, `.env.example`, `render.yaml` and `/validate` are updated.
- [ ] The live run's five receipts match the probe's merged values, with differences explained.
- [ ] No dependency added.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed once, results recorded honestly
- [ ] Full test suite passes (unit + hosted integration)
- [ ] No new lint or type error
- [ ] Live run done, account and objects cleaned up, spend recorded
- [ ] Acceptance criteria all met
- [ ] History file written; plan, history and fixtures staged with `git add -f` where needed
- [ ] The four manual steps handed to the product owner

---

## NOTES

**What this does not fix.** Receipts needing no critical correction stay 13 of 15: rule 4 keeps
production's value on every critical field. On the two receipts production was not tuned on, the
reader alone read 28 of 28 scalars and the merge reaches 24. Loosening rule 4 is out of scope until
more unseen receipts are scored. 198 is an upper estimate: the rule was chosen on these receipts.

**The reader's payment wording is stored as it copied it.** Production stores a provider payment
value only when its wording names a payment method (iteration 26). The probe did not apply that
test to the reader's value, and the measured 198 is without it. Do not add it here.

**A buyer OIB from the reader is not check-digit validated before it replaces production's.** The
existing `oib_checksum_invalid` warning still fires on it, so a bad one is visible.

**Buyer clearing depends on the reader finishing.** The same receipt can show an invented buyer on
one extraction and none on a retry, if the reader was abandoned once. That follows from "additive"
and is accepted.

**Outlines were not measured by the probe.** On the recorded runs 12 of 13 reader-supplied values
a run were found among the `prebuilt-read` words with the harness's search; the widened key in
Task 7 is expected to find the thirteenth. Three of the 13 had more than one candidate on the page.

**The grace is counted from the two-model result**, which itself can wait up to
`SECONDARY_GRACE_MS` (10 s) for a stalled secondary. The two graces are sequential by design: the
reader's 3 s is the most it can add.

**Run-to-run stability was measured on fixed OCR text.** A fresh `prebuilt-read` call per
extraction can change the text slightly; Task 20's comparison with the probe will show whether it
does.

**The Azure OpenAI resource is on student credit** the product owner plans to leave. When it ends
the reader fails on every call and the app keeps working at two-model accuracy. The `warn` line and
the startup line are how that is noticed.

**Rejected alternatives.**
- *Reader built by default inside `createAzureProvider`*: would make existing tests and both
  harness scripts call the paid service through the local `.env`.
- *A confidence gate* ("use the reader only where production is unsure"): measured worse, 194
  against 198, and it broke a correct document number.
- *Recomputing agreement on every read against edited values*: more moving parts for a flag the
  user has already acted on; the product owner accepted fixed-at-extraction.
- *A new `origin` for reader outlines*: would change a strict shared schema the API validates its
  own output against; `"text"` already means "found in the document text".
- *Sharing the prompt between harness and product by import*: `api/` may not import `scripts/`,
  and moving the frozen harness wording risks rewording it. A parity check guards the copy instead.

**Confidence for one-pass execution: 7/10.** The merge, normaliser and request are ports of
measured code with a parity check. The risks are the provider wiring with three timers
(Task 10, covered by fake-timer tests), the outline projection across two responses with
different page dimensions (Task 15, provable only in a browser), and warning differences in the
`--reader` score that need judgement rather than a rule (Task 17).
