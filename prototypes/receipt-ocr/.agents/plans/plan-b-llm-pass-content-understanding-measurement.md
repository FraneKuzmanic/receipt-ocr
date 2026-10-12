# Feature: Plan B — an LLM pass and Content Understanding, measured against the Plan A baseline (Iteration 27)

The following plan should be complete, but validate documentation, codebase patterns and task sanity
before implementing. Pay special attention to the names of existing utils, types and models, and
import from the right files.

Paths are relative to `prototypes/receipt-ocr/`. Line numbers are as of commit `2ff0687`.

**This is a measurement beside the product. Nothing under `api/`, `client/` or `shared/` changes, and
the application still has no LLM (PRD §4.7, ROADMAP §5 rule 10).** Everything is built in
`scripts/bakeoff/`, records go to the git-ignored `.bakeoff/`, and the deliverable is a research file
with a recommendation. Adopting an engine is a later iteration with its own PRD amendment.

## Feature Description

Iteration 26 ("Plan A") fixed our own extraction layer and left a list of defects it could not fix
with rules: unlabelled tender lines, the venue returned instead of the legal entity, a wrong or
missing buyer, JIR/ZKI whose labels are cropped, weak seller addresses. Plan B measures whether two
other engines fix them, on the same receipts, the same schema v2, the same verified ground truth and
the same comparator:

| Arm | What it is |
| --- | --- |
| `production` | The Plan A engine (two Document Intelligence prebuilt models merged, Croatian rules, QR JIR), **called live** through the real provider on the file the app would upload. The baseline. |
| `ocr` | Standalone LLM: `prebuilt-layout` markdown → `gpt-4.1` → every field. Iteration 25's best arm, re-run on schema v2 and the downscaled inputs. |
| `repair` | LLM pass on top of production: the model gets production's OCR text and production's values, and returns the scalar fields as printed. Three merge policies, fixed before any call, decide what it may change. Items, VAT rows, boxes and confidences stay production's. |
| `cu` | Azure AI Content Understanding, one custom analyzer built from the same field schema. |

## User Story

As the product owner deciding where to take receipt extraction next,
I want the production engine, an LLM pass and Content Understanding scored on the same receipts by
the same rule, with accuracy, stability, latency and cost side by side,
so that I can decide whether an LLM belongs in the product, and in which shape, on evidence.

## Problem Statement

- Production reads the critical fields well (13 of 16 receipts need no critical correction) and is
  weak on a known list: seller name 13/16, seller address 11/16, payment method 12/16, ZKI 12/15.
- Iteration 25 showed an LLM over OCR text beats production on scalars and loses on line items, but
  its ground truth was unverified, it used schema v1 (`subtotal`), full-resolution files, and a
  comparator that ignored diacritics. Its numbers cannot be compared with Plan A's.
- A pass on top of production, which would keep production's items, outlines and confidence flags,
  has never been measured. Neither has Content Understanding on receipts.
- `scripts/bakeoff/score.ts` does not run today: it throws on `22559270` because the verified
  expected files now hold `paymentMethod` as a category and `scripts/bakeoff/ground-truth/` still
  holds the printed wording.

## Solution Statement

Extend the existing harness. Bring it to schema v2 and the verified ground truth, change the
comparator to the agreed rule, add a live production arm, a repair arm and a Content Understanding
arm beside the existing `ocr` arm, run all four interleaved in one sitting three times, and score
them with one scorer. Write the decision bar into the research file before the first paid call.

## Feature Metadata

**Feature Type**: New Capability (measurement harness) — no product change
**Estimated Complexity**: Medium-High
**Primary Systems Affected**: `scripts/bakeoff/`, `.agents/research/`, `.agents/history/`, `.agents/ROADMAP.md`, local `.env`
**Dependencies**: none new. Azure OpenAI `gpt-4.1` and Content Understanding on the payslip project's
Foundry resource (Sweden Central); Document Intelligence on this project's resource;
`@napi-rs/canvas` (already installed by `pdfjs-dist`, not a declared dependency).

---

## DECISIONS SETTLED WITH THE PRODUCT OWNER (2026-10-09 grilling) — do not relitigate

- **B1** Measurement only. No change to `api/`, `client/`, `shared/`. Ends with a research file and a recommendation.
- **B2** Two LLM shapes: standalone from OCR text, and a repair pass on production's output.
- **B3** Content Understanding runs as one custom analyzer built from our schema. No prebuilt analyzer.
- **B4** Spend cap **$5** for Plan B's paid calls. The cap may be raised, but only by the product owner: stop and ask before passing it.
- **B5** Decision bar: accuracy first; latency and cost are reported and do not disqualify (see "Decision bar").
- **B6** Line items and VAT rows are scored now and labelled **unverified**; scalar scores are final. Re-scoring after verification is free.
- **B7** One model: the `gpt-4.1` deployment iteration 25 used.
- **B8** One comparator for every arm including production: amounts numeric; dates, times, OIBs and currency exact; JIR/ZKI ignoring case; names and addresses ignoring case, spacing and punctuation **but not diacritics**. `npm run score:extraction` stays the strict product harness; the difference is stated wherever both are quoted.
- Inherited from Plan A: every engine is given the file the app would upload (downscaled when above 2 MP or 1.5 MB); seller is the legal entity and its registered seat; payment method ground truth is the category.

### Decision bar (copy into the research file before the first paid call)

An arm is **worth adopting** when, against `production` in the same runs:

1. more receipts need no critical correction, **or** the same number and more scalar fields are right, in its **worst** run;
2. it loses no item cell and no VAT cell (for `repair` this holds by construction);
3. on the small photos (under 500 px wide) it returns **no ungrounded wrong value** — a non-null scalar that is wrong and is not found among that receipt's OCR words;
4. scored values that differ between its three runs are at most 2.

A difference of one or two values between arms is noise (iteration 25, payslip bake-off) and is
reported as "no difference". Latency p50/p90 and cost per receipt are reported per arm beside the
verdict, not folded into it.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `scripts/bakeoff/README.md` — the harness, its commands, the record layout, the spend rule.
- `scripts/bakeoff/samples.ts` (whole file) — `SAMPLES`, `EXCLUDED`, `sourceBytes`, `readCache`/`writeCache`, `requireEnv`, the directory constants.
- `scripts/bakeoff/field-schema.ts` (whole file) — `RECEIPT_FIELDS`, `SCALAR_FIELDS`, `SHARED_RULES`, `SYSTEM`, `toJsonSchema`, `SCHEMA`. Line 39-41 is `subtotal`, to remove.
- `scripts/bakeoff/normalize.ts` (whole file) — printed value → canonical value with production's parsers. Line 79 is `subtotal`.
- `scripts/bakeoff/compare.ts` (whole file) — `matches`, `scoreReceipt`, the groups. Lines 12, 23 name `subtotal`; lines 33-39 are the text rule to change.
- `scripts/bakeoff/compare.check.ts`, `normalize.check.ts` — the `node:test` checks to update; mirror their style.
- `scripts/bakeoff/model-input.ts` (lines 74-125) — `Usage` and `complete(system, content, schema)`, the one chat-completions request. Reuse as is.
- `scripts/bakeoff/layout.ts` (whole file) — `analyzeLayout(bytes)`, raw bytes then a 500 ms poll. Mirror its shape for the Content Understanding call.
- `scripts/bakeoff/run-input-modes.ts` (lines 43-51, 116-221) — flags, interleaving with a rotating first arm, `isRecorded`, the summary table. Mirror for the new runner.
- `scripts/bakeoff/spend.ts` (whole file) — `PRICE`, `modelUsd`, `recordedSpend`, `guardSpend`, `requireConfirmation`. It walks all of `.bakeoff/`, so iteration 25's $1.32 would count against Plan B's cap unless scoped.
- `scripts/bakeoff/score.ts` (lines 37-53 ground truth, 55-75 production replay, 158-211 tallies, 273-298 run variance) — the scorer to mirror, and the broken ground-truth merge.
- `scripts/bakeoff/ground.ts` (lines 28-70 `surfaceForms`, 113-150 `groundValue`) — finds a canonical value among OCR words; the "ungrounded" test.
- `scripts/score-extraction.ts` (lines 17, 27, 295-306) — imports `matches` from `bakeoff/compare.js` for three lenient fields, and compares payment method by category. **A change to `matches` can move its numbers.**
- `api/src/providers/document-extraction/azure.ts` (lines 62-112 `createAzureProvider`, 261-300 `applyQrJir`, `extractFiscalQr`, `applyTextFallbacks`) — the real provider the `production` arm calls.
- `api/src/providers/document-extraction/types.ts` — `ExtractionInput`, `ProviderExtractionResult` (`fields`, `metadata.latencyMs`, `metadata.fields[..].source`, `qr`, `raw`).
- `api/src/providers/document-extraction/payment-method.ts` (line 40) — `categorizePaymentMethod`.
- `api/src/providers/document-extraction/content-markers.ts` — `stripContentMarkers`.
- `api/src/validation/warnings.ts` — `qrCorroboratedFields(fields, qr)`.
- `api/src/config.ts` — importing the provider loads this; it requires the Supabase and Azure DI variables, all present in `.env`.
- `client/src/capture/downscale.ts` (whole file) — the upload rule to reproduce in Node: above 2,000,000 px or 1.5 MiB → JPEG, long edge 1,600, quality 0.82; PDFs unchanged.
- `.agents/fixtures/expected/*.json` (16 files) — verified scalar ground truth; `paymentMethod` is a category code.
- `.agents/fixtures/ground-truth-review.md` (line 68) — the verified Konzum row.
- `.agents/research/input-modes.md` — iteration 25's result and limits; the shape of the write-up.
- `.agents/history/25-input-modes-experiment.md`, `26-extraction-layer-fixes-receipt-schema-v2.md` — what was learned.
- On branch `prototype/payslip-ocr` (read with `git show prototype/payslip-ocr:<path>` from the monorepo root; do not switch branches):
  - `prototypes/payslip-ocr/scripts/bakeoff/run-cu.ts` (lines 17-62 request and definition, 64-81 poll, 90-155 ensure and submit with stall retry, 185 record)
  - `prototypes/payslip-ocr/scripts/provision-analyzer.ts` (lines 52-73, the `/defaults` PATCH)
  - `prototypes/payslip-ocr/api/src/providers/document-extraction/content-understanding/analyzer.ts` (lines 7-25 `toCuField`, 77-102 definition), `usage.ts` (10-70 cost), `row-order.ts` (20-29 the `D(...)` source parser, and the row sort)
  - `prototypes/payslip-ocr/.agents/history/01-extraction-bakeoff.md` (lines 85-96, setup failures)

### New Files to Create

- `scripts/bakeoff/truth.ts` — one ground-truth loader for both scorers.
- `scripts/bakeoff/inputs.ts` — the file the app would upload, per sample.
- `scripts/bakeoff/production.ts` — one live production extraction.
- `scripts/bakeoff/repair.ts` — the repair request and the three merge policies (pure functions).
- `scripts/bakeoff/content-understanding.ts` — analyzer definition, ensure, analyze, unwrap, cost.
- `scripts/bakeoff/run-plan-b.ts` — the runner.
- `scripts/bakeoff/score-plan-b.ts` — the scorer.
- `scripts/bakeoff/repair.check.ts`, `content-understanding.check.ts`, `inputs.check.ts` — offline checks.
- `scripts/bakeoff/ground-truth/0f089468f365211452db4ccf6e8da466.json` — the Konzum receipt's truth.
- `.agents/research/plan-b-engines.md` — the result (needs `git add -f`).
- `.agents/history/27-plan-b-llm-pass-content-understanding-measurement.md` (needs `git add -f`).

### Relevant Documentation

- [Content Understanding: analyze binary (2025-11-01)](https://learn.microsoft.com/en-us/rest/api/contentunderstanding/content-analyzers/analyze-binary?view=rest-contentunderstanding-2025-11-01) — the submit call.
- [Content Understanding: create or replace analyzer](https://learn.microsoft.com/en-us/rest/api/contentunderstanding/content-analyzers/create-or-replace?view=rest-contentunderstanding-2025-11-01) — the `PUT` and its operation.
- [Analyzer reference](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/concepts/analyzer-reference) — `config` flags, `method: extract` against `generate`, description limit (1,024 characters).
- [Models and deployments](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/concepts/models-deployments) — why `/defaults` and `models.completion` are both needed.
- [Service limits](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/service-limits) — formats and sizes.
- [Pricing explainer](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/pricing-explainer) — pages, contextualization tokens, model tokens.
- [Azure OpenAI prompt caching](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching) — why cost is reported as billed and without caching.

### Patterns to Follow

**Harness scripts** are plain TypeScript run with `node --env-file-if-exists=.env --import tsx`, import
each other with a `.ts` extension, import product code with a relative path and `.js`
(`"../../api/src/providers/document-extraction/azure.js"`), and import shared code as
`@receipt/shared`. No tsconfig covers `scripts/`. Comments say why, not what, as in the files above.

**Records**: `writeCache(kind, sample.name, record)`, one JSON per call. A run is recorded only when
every part of it is (`isRecorded`, `run-input-modes.ts:119-121`). A failed call prints `FAILED` and
is not written, so re-running the command fills the gap.

**Paid commands** call `requireConfirmation()` and `guardSpend(...)` before any call.

**A harness that skips what it cannot measure fails instead** (`score.ts:137-142`).

**Never print or commit a secret, and never log receipt contents.** `.bakeoff/` holds receipt
contents and stays git-ignored (monorepo `.gitignore:18`).

---

## IMPLEMENTATION PLAN

### Phase 1: Bring the harness to schema v2 and the verified ground truth (free)

Schema, normaliser and comparator lose `subtotal`; the comparator takes the agreed rule; ground truth
is loaded in one place and reconciled with the verified files; the Konzum receipt joins as the 15th
sample; the old scorer runs again.

### Phase 2: The arms (built and checked offline)

Upload-sized inputs, the live production call, the repair request and policies, the Content
Understanding client.

### Phase 3: Runner and scorer

One runner that interleaves the four arms, one scorer that reports every arm and policy.

### Phase 4: Paid runs, behind two gates

GATE A (product owner approves the estimate and the decision bar), a probe, then three runs in one
sitting.

### Phase 5: Write-up

Research file, history, roadmap row, harness README.

---

## STEP-BY-STEP TASKS

Execute in order. Tasks 1-12 are free. **Nothing paid runs before GATE A (Task 13).**

### 1. UPDATE `scripts/bakeoff/field-schema.ts`

- **IMPLEMENT**: Remove the `subtotal` entry (lines 39-41). Change nothing else: no description is reworded. Update the header comment to say the schema is v2 and is frozen again from Plan B's first paid call.
- **GOTCHA**: Do not tune descriptions against iteration 25's errors. All Plan B arms share this text, and rewording it now would also make the re-scored iteration 25 runs incomparable for a second reason.
- **VALIDATE**: `node --import tsx -e "import('./scripts/bakeoff/field-schema.ts').then(m=>{if('subtotal' in m.RECEIPT_FIELDS)throw new Error('subtotal');console.log(m.SCALAR_FIELDS.length)})"` prints `14`.

### 2. UPDATE `scripts/bakeoff/normalize.ts` and `normalize.check.ts`

- **IMPLEMENT**: Remove `subtotal` from `SCALARS` (line 79). A `subtotal` key in an old record is then ignored. Update any check that names it.
- **VALIDATE**: `node --import tsx --test scripts/bakeoff/normalize.check.ts`

### 3. UPDATE `scripts/bakeoff/compare.ts` and `compare.check.ts`

- **IMPLEMENT**:
  - Remove `subtotal` from `OTHER` (line 12) and `AMOUNTS` (line 23).
  - Add the scalars that now have verified truth to the scored set, in a new group so iteration 25's group names keep their meaning: `PARTY = ["sellerAddress", "buyerName", "buyerAddress", "buyerOib"]`, `Group` gains `"party"`, `SCORED_SCALARS` includes them, `groupOf` returns it.
  - Replace `textKey` (lines 33-39) with the B8 rule: lower-case, then drop everything that is not a letter or digit, keeping diacritics: `value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")`. Update the comment and the file header.
  - Payment method: ground truth holds the category, an arm returns wording. In `matches`, before the text rule: `if (field === "paymentMethod") return categorizePaymentMethod(a) === e || textKey(a) === textKey(e);`
- **IMPORTS**: `categorizePaymentMethod` from `"../../api/src/providers/document-extraction/payment-method.js"`.
- **GOTCHA**: `scripts/score-extraction.ts` calls `matches` for `sellerAddress`, `buyerName`, `buyerAddress`. Capture `npm run score:extraction` output to a scratch file **before** this task and diff it after. If a number moves, that is the B8 rule reaching the product harness: keep the change, record the before and after in the history file, and correct the three README numbers it affects (README "Extraction", the `sellerAddress` / `buyerName` / `buyerAddress` figures). Do not add a second text rule to keep the old numbers.
- **CHECKS to write**: `Građanin d.o.o.` matches `GRAĐANIN  D. O.O.`; it does **not** match `GRADANIN DOO`; `paymentMethod` expected `cash` matches `Novčanice` and `NONCANICE`, not `Kartica`; a `subtotal` key in expected is not scored.
- **VALIDATE**: `node --import tsx --test scripts/bakeoff/compare.check.ts` and the `score:extraction` diff described above.

### 4. CREATE `scripts/bakeoff/truth.ts`; UPDATE `scripts/bakeoff/ground-truth/*.json`

- **IMPLEMENT**: `groundTruth(sample): Record<string, unknown>` = the expected file (when it exists) merged with the sample's `ground-truth/` file minus `verifiedBy` and `notes`. Keep the rule that a key present in both with different values throws. Export `TABLES_VERIFIED: boolean` = every ground-truth file has a non-null `verifiedBy`. A sample with neither file throws.
- **UPDATE the 14 ground-truth files**: delete every scalar key (`sellerOib`, `jir`, `zki`, `paymentMethod`, `subtotal`, `issueDate`, …). The verified expected files are now the only source of scalars. What remains is `items`, `verifiedBy: null` and `notes`. Drop a note that only explains a deleted key.
- **GOTCHA**: `vatBreakdown` stays in the expected files and is **not** owner-verified (history 26). Both tables are reported as unverified; do not move or edit VAT rows.
- **GOTCHA**: Do not "fix" a ground-truth value because an engine disagrees with it. A suspected error goes into the research file's Limits for the product owner.
- **VALIDATE**: `node --import tsx -e "import('./scripts/bakeoff/truth.ts').then(async m=>{const {SAMPLES}=await import('./scripts/bakeoff/samples.ts');for(const s of SAMPLES)m.groundTruth(s);console.log('ok',SAMPLES.length)})"`

### 5. ADD the Konzum receipt as the 15th sample

- **IMPLEMENT**: In `samples.ts` add `sample("0f089468f365211452db4ccf6e8da466", "0f089468f365211452db4ccf6e8da466.png")`. Create its ground-truth file with the scalars of `ground-truth-review.md:68`: `sellerName` `KONZUM plus d.o.o.`, `sellerAddress` `Zagreb, Ulica Marijana Čavića 1A`, `sellerOib` `62226620908`, `total` `13.40`, `currency` `EUR`, `paymentMethod` `cash`, and `null` for `buyerName`, `buyerAddress`, `buyerOib`, `documentNumber`, `issueDate`, `issueTime`, `jir`, `zki` (not in the photo, so an engine must return nothing). Add `items` only for rows fully legible in the photo; `verifiedBy: null`; a note that its scalars are owner-verified and it has no expected file because it has no recorded fixture.
- **GOTCHA**: Do **not** create `.agents/fixtures/expected/0f089468….json`: `/validate` 6.19 fails on an expectation with no recorded fixture. This receipt is outside `npm run score:extraction` and inside Plan B. It is the only receipt production was not tuned on; say so in the write-up and report it on its own line as well as in the totals.
- **VALIDATE**: Task 4's command prints `ok 15`; `/validate` 6.19's command prints `ok`.

### 6. UPDATE `scripts/bakeoff/score.ts` (iteration 25's scorer runs again)

- **IMPLEMENT**: Replace its local `groundTruth` (lines 39-53) with `truth.ts`; the "not verified" banner becomes "ITEMS AND VAT ROWS NOT VERIFIED" from `TABLES_VERIFIED`. Restrict it to the 14 samples that have iteration 25 records and a recorded fixture (it replays production from fixtures; the Konzum receipt has neither). Fix the hard-coded "14" / "12" group labels only if they are now wrong. No other change.
- **WHY**: Re-scoring iteration 25 on verified truth is its own open follow-up, and it is free. Those numbers go into the write-up as context, labelled full-resolution inputs and schema v1.
- **VALIDATE**: `node --env-file-if-exists=.env --import tsx scripts/bakeoff/score.ts` prints its tables and exits 0.

### 7. CREATE `scripts/bakeoff/inputs.ts` and `inputs.check.ts`

- **IMPLEMENT**: `uploadInput(sample): Promise<{ bytes: Buffer; contentType: Sample["contentType"]; downscaled: boolean; width: number; height: number }>`. PDFs pass through. For an image, apply `client/src/capture/downscale.ts`'s rule with its own constants (copy the four numbers with a comment naming that file): unchanged when `width*height <= 2_000_000` and `bytes.length <= 1.5*1024*1024`; otherwise draw at `min(1, 1600/longEdge)` and encode `image/jpeg` at quality 82. Cache the result under `.bakeoff/plan-b/inputs/<sample>.<ext>` so every arm and every run sends the same bytes.
- **IMPORTS**: `createCanvas`, `loadImage` from `@napi-rs/canvas` (pattern: `model-input.ts:8, 56-71`).
- **GOTCHA — orientation**: a browser applies EXIF orientation when it draws; `@napi-rs/canvas` may not. After generating, open each downscaled file (Read tool) and confirm it is upright. If one is rotated, rotate it in this module from the EXIF tag; do not send a sideways receipt to four engines.
- **GOTCHA**: Node's resampling is not the browser's. State this in Limits; it is the closest reproducible stand-in for what the app uploads.
- **CHECK**: a synthetic 3000×2000 canvas comes back 1600×1067 JPEG; a 400×900 PNG comes back byte-identical.
- **VALIDATE**: `node --import tsx --test scripts/bakeoff/inputs.check.ts`, then `node --import tsx -e "import('./scripts/bakeoff/inputs.ts').then(async m=>{const {SAMPLES}=await import('./scripts/bakeoff/samples.ts');for(const s of SAMPLES){const i=await m.uploadInput(s);console.log(s.name,i.contentType,i.downscaled,i.width+'x'+i.height,i.bytes.length)}})"` lists 15 inputs; record which were downscaled.

### 8. CREATE `scripts/bakeoff/production.ts`

- **IMPLEMENT**: `runProduction(input): Promise<ProductionRecord>` calls `createAzureProvider().extract({ bytes, contentType })` and returns `{ arm: "production", latencyMs` (wall clock around the call)`, fields: result.fields, metadata: result.metadata, qr: result.qr, raw: result.raw }`. Export `productionText(record): string` = `stripContentMarkers` of the primary `analyzeResult.content` in `raw`, and `productionWords(record)` = the primary response's page words as `ground.ts`'s `LayoutWord[]` / `LayoutPage[]`.
- **IMPORTS**: `createAzureProvider` from `"../../api/src/providers/document-extraction/azure.js"`; `stripContentMarkers` from `…/content-markers.js`.
- **GOTCHA**: Read `azure.ts:130-170` for the exact shape of `raw` (the primary operation at the top level, `secondaryAnalyzeResult`, `fieldModels`) before writing `productionText`. Importing the provider loads `api/src/config.ts`, which exits without the Supabase and Azure DI variables: run with `--env-file-if-exists=.env`.
- **GOTCHA**: This is the product's code path on purpose: it applies the merge, the Croatian fallbacks and the QR JIR. Do not rebuild it from `mapAnalyzeResult` as `score.ts` does.
- **VALIDATE**: offline only for now — `node --env-file-if-exists=.env --import tsx -e "import('./scripts/bakeoff/production.ts').then(m=>console.log(typeof m.runProduction))"` prints `function`. The live call is first made in the probe (Task 14).

### 9. CREATE `scripts/bakeoff/repair.ts` and `repair.check.ts`

- **IMPLEMENT — the request**:
  - `REPAIR_SCHEMA`: `SCHEMA` restricted to `SCALAR_FIELDS` (same descriptions, strict, every property required, null allowed).
  - `REPAIR_SYSTEM` = `SYSTEM` plus one paragraph in Croatian: the document's text is given with a first automatic reading of it; that reading may hold errors and gaps; return every field as it is printed in the document's text, not as the first reading has it; a field not in the text is null.
  - `repairContent(text, productionFields)`: `<dokument>\n…\n</dokument>\n<prvo_citanje>\n{JSON of production's 14 scalars}\n</prvo_citanje>`.
  - The call itself is `complete(REPAIR_SYSTEM, repairContent(...), REPAIR_SCHEMA)` from `model-input.ts`.
- **IMPLEMENT — the policies** (pure; fixed here, before any call; the scorer applies all three to the same recorded calls, so they cost nothing extra):
  - `LOCKED(production)` = fields whose production metadata source is `qr`, plus `qrCorroboratedFields(fields, qr)`. No policy ever changes a locked field.
  - An LLM value is **eligible** only when it normalises to non-null **and** is grounded: `groundValue(canonical, productionWords)` finds it. An ungrounded value is never merged; it is counted.
  - `fill`: production's value where it has one; an eligible LLM value where production is empty.
  - `weak`: `fill`, and an eligible LLM value also replaces production's on `WEAK = ["sellerName", "sellerAddress", "buyerName", "buyerAddress", "buyerOib", "paymentMethod"]`.
  - `all`: an eligible LLM value replaces production's on every scalar that is not locked.
  - `vatBreakdown` and `items` are always production's.
  - Signature: `applyRepair(policy, production, llmNormalized, words, pages): { fields; changed: string[]; filled: string[]; rejectedUngrounded: string[] }`.
- **GOTCHA**: `paymentMethod` is grounded by its printed wording, not by a category. Ground the raw printed string for text fields and the canonical value (through `surfaceForms`) for dates, amounts and OIBs. `ground.ts`'s `key` folds diacritics; that is acceptable for *finding* a value on the page and is not the scoring rule.
- **GOTCHA**: `weak` deliberately allows the LLM to **replace** a non-empty buyer or seller. It does not let it blank one: an LLM null never removes a production value in any policy. The wrong buyer on `26515835` therefore cannot be fixed by these policies; report it as a known limit rather than adding a fourth policy after seeing results.
- **CHECKS**: fill does not touch a non-empty field; weak replaces `sellerName` and not `total`; all replaces `documentNumber` but not a QR-sourced `jir` nor a QR-corroborated `issueDate`; an ungrounded value is rejected and listed; an LLM null never blanks; tables pass through untouched.
- **VALIDATE**: `node --env-file-if-exists=.env --import tsx --test scripts/bakeoff/repair.check.ts`

### 10. CREATE `scripts/bakeoff/content-understanding.ts` and `content-understanding.check.ts`

- **IMPLEMENT** (port from payslip `run-cu.ts` and `analyzer.ts`; plain `fetch`, no SDK):
  - Env: `AZURE_CONTENT_UNDERSTANDING_ENDPOINT`, `AZURE_CONTENT_UNDERSTANDING_KEY`, `AZURE_CU_API_VERSION` (expected `2025-11-01`), completion model from `AZURE_OPENAI_DEPLOYMENT`. Base `${endpoint}/contentunderstanding/…?api-version=…`, header `Ocp-Apim-Subscription-Key`.
  - `ANALYZER_ID = "receipt_planb_v2"` (**underscores only; a hyphen is rejected**).
  - `analyzerDefinition()`: `baseAnalyzerId: "prebuilt-document"`, `description: "Hrvatski fiskalni račun.\n\n" + SHARED_RULES`, `models: { completion: <deployment> }`, `config: { returnDetails: true, estimateFieldSourceAndConfidence: true, enableLayout: true, enableOcr: true, enableFormula: false }`, `fieldSchema.fields` built from `RECEIPT_FIELDS` by `toCuField`: scalar → `{ type: "string", method: "extract", description }`; table → `{ type: "array", method: "extract", description, items: { type: "object", properties: { <cell>: { type: "string", method: "extract", description } } } }`. The descriptions are the ones every other arm gets, unchanged.
  - `ensureAnalyzer({ recreate })`: `GET /analyzers/{id}`; on 404 `PUT` the definition and poll the `operation-location` until `succeeded`. If it exists, compare `description`, `config` and `fieldSchema.fields` with the definition and **throw** on a difference unless `recreate` (a silently stale analyzer invalidates every record).
  - `analyze(bytes, contentType)`: `POST /analyzers/{id}:analyzeBinary` with raw bytes; `AbortSignal.timeout(5000)` on the submit, up to 4 tries, retrying only a `TimeoutError`; a missing `operation-location` is an error; poll every 500 ms (as `layout.ts` does) to a 300 s deadline; `status` compared lower-cased; `failed`/`canceled` throws. Return `{ arm: "cu", analyzerId, apiVersion, latencyMs` (submit through result, including stall retries)`, submitAttempts, operation }` with the operation body verbatim.
  - `cuFields(operation)`: unwrap `result.contents[0].fields` to the printed-value shape `normalize` takes: scalar `valueString ?? null`; table `valueArray[].valueObject.<cell>.valueString`. **Sort each table's rows by their first sourced cell's page then top y**, parsed from `source` with `/^D\((\d+),([^()]*)\)$/` (first segment before `;`): row order varies between runs of the same document and asking for printed order does not fix it.
  - `cuConfidences(operation)` and `cuSources(operation)`: per scalar path, for the flag and grounding counts.
  - `cuUsd(usage)`: `documentPagesStandard × $0.005 + contextualizationTokens × $1/M + ` model tokens at `PRICE` (keys matched by suffix `-cached-input`, `-input`, `-output`; cached tokens are inside the input count).
- **GOTCHA**: An abandoned submit may still be analysed and billed. Count `submitAttempts − 1` extra analyses at that receipt's cost in the spend total.
- **GOTCHA**: `:analyze` takes a URL only; `enableBarcode` is dropped by this API version, do not send it; values come back as printed, so they go through `normalize` like the LLM arms.
- **GOTCHA**: The analyzer needs the completion and the embedding deployment registered in the resource's `/defaults`. Payslip-ocr did this on the same resource. In Task 12, `GET /contentunderstanding/defaults` and check before the first `PUT`; only if the map lacks them, `PATCH` it merged with what is there (`provision-analyzer.ts:52-73`).
- **CHECKS** (offline, hand-written operation body in the response shape recorded in the research notes below): scalar and null unwrap; an empty table; rows sorted by source y; `cuUsd` on a known usage block; the definition has 16 fields, no hyphen in the id and no description over 1,024 characters.
- **VALIDATE**: `node --env-file-if-exists=.env --import tsx --test scripts/bakeoff/content-understanding.check.ts`

### 11. UPDATE `scripts/bakeoff/spend.ts`; CREATE `scripts/bakeoff/run-plan-b.ts`

- **spend.ts**: `recordedSpend(dir = CACHE_DIR)` and `guardSpend(label, calls, extraUsd, cap, dir)` take the directory to walk, so Plan B's cap counts `.bakeoff/plan-b/` only and iteration 25's commands behave as before. Teach the walk two more record kinds: `arm: "production"` → 2 pages × `PRICE.diPage` (add `diPage: 0.01` and say in `PRICE_NOTE` that prebuilt invoice and receipt are taken at $0.01 a page, list price, unchecked); `arm: "cu"` → `cuUsd` plus the abandoned submits. Raise nothing else.
- **run-plan-b.ts** (mirror `run-input-modes.ts`):
  - Flags: `--reps=3`, `--only=a,b`, `--cap=5`, `--tag=probe`, `--force`, `--arms=production,ocr,repair,cu`, `--recreate-analyzer`, `--summary`, `--confirm-spend`.
  - Records: `.bakeoff/plan-b/<tag->{production|layout|ocr|repair|cu}-r<rep>/<sample>.json`.
  - Per sample, per rep: `production` runs first (repair needs its text); then `ocr`, `repair`, `cu` in an order that rotates with `(index + rep)`. Sequential, one call at a time.
  - `ocr` = `analyzeLayout(input.bytes)` then `complete(SYSTEM, "<dokument>…</dokument>", SCHEMA)`, recorded as iteration 25's `InputModeRecord` shape. `repair` record = `{ arm, rep, sample, latencyMs (the model call), productionLatencyMs, usage, fields }`.
  - Every arm gets `uploadInput(sample)`'s bytes. Record `downscaled` in each record.
  - `guardSpend` before each rep with the calls still to make; `requireConfirmation()` first.
  - `--summary`: per arm, n, input/output tokens (LLM arms), latency p50/p90 **end to end** (`production`: its call; `ocr`: layout + model; `repair`: production + model; `cu`: submit through result), cost per receipt as billed and without caching, and recorded spend against the cap.
- **GOTCHA**: `repair` for rep N reads production's rep N record. If production failed for a sample, skip `repair` for it and print why; the scorer will then refuse to score until it is filled.
- **VALIDATE**: `node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-plan-b.ts --reps=1` (no `--confirm-spend`) exits 1 with the "paid Azure calls" message and makes no call; `… --summary` prints an empty table and `$0.00`.

### 12. CREATE `scripts/bakeoff/score-plan-b.ts`; free environment checks

- **IMPLEMENT** (mirror `score.ts`'s tables and its fail-on-incomplete rule). Columns: `production`, `ocr`, `repair:fill`, `repair:weak`, `repair:all`, `cu`. For each: normalise (`production` is already canonical), `scoreReceipt(groundTruth(sample), fields)`, ranges over the three runs.
  - Groups: all 15; 2 PDFs; 13 images; small images (under 500 px wide, from `uploadInput`'s width); the Konzum receipt alone.
  - Metrics: scalars, critical, fiscal, party, other, VAT cells, item cells, VAT / item row count exact, no critical correction. Tables carry "unverified" in the heading unless `TABLES_VERIFIED`.
  - Per field, each arm's worst run.
  - **Wrong values, split**: per arm, scalars that are wrong and non-null, divided into grounded (found among that rep's OCR words: production's words for `production`/`repair`, the layout words for `ocr`, `pages[].words` for `cu`) and **ungrounded**; and scalars that are missing (null where truth has a value). Reported for all receipts and for small images.
  - Run-to-run: scored values that differ between an arm's runs.
  - Repair detail: per policy, values filled, values changed, changes that fixed / broke / made no difference, and ungrounded values rejected.
  - `cu` detail: scalars below confidence 0.5 that were right and that were wrong; share of non-null values with a `source`.
  - **Decision bar**: one row per arm and policy, the four criteria as pass / fail with the numbers, computed, not written by hand.
  - `--verbose`: every mismatch, receipt by receipt, each arm's runs as normalised value [printed value].
  - Writes the same numbers to `.bakeoff/plan-b/report.json`.
- **VALIDATE**: with no records it exits 1 naming what is missing. Then the free environment checks:
  - `.env` has the four `AZURE_OPENAI_*` variables (it does). It lacks the Content Understanding ones. Copy `AZURE_CONTENT_UNDERSTANDING_ENDPOINT`, `AZURE_CONTENT_UNDERSTANDING_KEY` and `AZURE_CU_API_VERSION` from `../payslip-ocr/.env` with a script that prints names only, never a value (iteration 25 did the same for the OpenAI variables). Do not copy `AZURE_CU_ANALYZER_ID`.
  - `GET /contentunderstanding/defaults` (free) shows the completion and embedding deployments registered.
  - `git check-ignore .bakeoff` confirms records stay untracked.

### 13. GATE A — stop and ask the product owner

Present, in one message:

- the inputs table from Task 7 (which receipts were downscaled, their sizes);
- the estimate, per arm, for a probe and three runs (planning figures: production 15 × 2 pages × $0.01 = $0.30 a run; `ocr` about $0.0145 a receipt; `repair` about $0.005; `cu` about $0.02-0.03 plus up to 10% for abandoned submits; **about $3.3 in all**) and the remaining balance question — the credit balance is only visible to the product owner;
- the decision bar, and the three repair policies with the `WEAK` list;
- that the Konzum receipt is in as the 15th sample.

Proceed only on an explicit yes. Then write the decision bar, the policies and the estimate into `.agents/research/plan-b-engines.md` **before** the first paid call.

### 14. Probe (paid, about $0.20)

- **RUN**: `node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-plan-b.ts --tag=probe --reps=1 --only=gradanin-gotovina-pos,primjer-pdf-racuna,lira_trogir --confirm-spend`
- **CHECK**, by reading the three records per arm: production's values match what the app shows for those receipts (history 26's browser run); `repair` returned 14 keys; `cu` returned 16 fields with `source` on non-null values, and its analyzer built; no arm's values are being marked wrong by the normaliser for how they were copied — read every wrong value by eye for each arm before trusting a score ("check the scorer before trusting a low score").
- **GOTCHA**: A normaliser fix found here is made **now**, before the scored runs, and listed in the research file. The field schema and the repair policies are not changed after this point. Probe records count toward spend and are never scored.
- **VALIDATE**: `… run-plan-b.ts --tag=probe --summary` shows 3 receipts per arm and the spend.

### 15. Three runs, one sitting (paid, about $3)

- **RUN**: `node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-plan-b.ts --reps=3 --confirm-spend`. If a call fails, re-run the same command: recorded calls are skipped.
- **GOTCHA**: One sitting. The generation rate changes from day to day, and the arms are interleaved so one day's rate applies to all. If the guard stops a rep, **stop and ask** (B4); do not raise `--cap` yourself.
- **GOTCHA**: If a Content Understanding or layout call stalls for minutes (iteration 25, run 2), let it finish and record it; that is the arm's result. Do not drop the slow run.
- **VALIDATE**: `node --env-file-if-exists=.env --import tsx scripts/bakeoff/score-plan-b.ts` exits 0 with all six columns and three runs each; `--summary` shows spend under $5.

### 16. Read the results before writing them up

- `score-plan-b.ts --verbose`; for every arm, read a sample of its wrong values against the receipt image. For each Plan A "deliberately out of scope" case (plan A NOTES line 593-596: the wrong buyer on `26515835`, the missing buyer on `primjer1-hr-nopdv`, cropped-label JIR/ZKI on `lira_trogir`, the four unlabelled tender lines, `receipt123`'s seller and ZKI, `primjer1-hr-nopdv`'s duplicate zero-rate VAT row), record which arm fixed it.
- If the comparator or normaliser is found to be marking a correct reading wrong, fix it, re-score (free), and list the change with before and after. Never change ground truth, schema or policies here.

### 17. CREATE `.agents/research/plan-b-engines.md`

Shape of `.agents/research/input-modes.md`: question; decision bar (already written at GATE A); method (arms, inputs, model, API versions, comparator and how it differs from `score:extraction`); results table with ranges over runs; split by group including small images and the Konzum receipt; per-field worst run; wrong values grounded / ungrounded / missing; repair policies; Content Understanding confidence and grounding; latency and cost; **the decision bar table and a plain recommendation**; which Plan A leftovers each arm fixed; iteration 25's arms re-scored on verified truth, labelled; limits; what changed after seeing results; spend.

Limits to state without being asked: 15 receipts, one model, three runs; production was tuned on 14 of them; items and VAT rows unverified; Node downscaling is not the browser's; the standalone and Content Understanding arms have no QR JIR while production and repair do; a standalone LLM returns no position or confidence, so it could not draw the review screen's outlines, while repair values are located by text match and Content Understanding returns its own; adoption needs a PRD §4.7 amendment.

### 18. Documentation and records

- UPDATE `scripts/bakeoff/README.md`: the Plan B arms, the new commands, the record layout under `.bakeoff/plan-b/`, the Content Understanding variables, the scoring rule as changed in Task 3.
- CREATE `.agents/history/27-plan-b-llm-pass-content-understanding-measurement.md` from the ROADMAP template: every paid run with its cost and the running total; deviations; the `score:extraction` before/after from Task 3.
- UPDATE `.agents/ROADMAP.md`: one row 27 in "Iterations outside the numbered task list", and the header's "most recent" line.
- UPDATE `README.md` only if Task 3 moved a `score:extraction` number.
- `/validate` is not extended: the harness is outside the product (iteration 25's precedent). Say so in the history.
- **GOTCHA**: `.agents` is git-ignored at the monorepo root; the plan, research and history files need `git add -f`. Do not commit or push; the product owner runs `/commit`.

---

## TESTING STRATEGY

### Unit checks (`node:test`, offline)

`compare.check.ts`, `normalize.check.ts` (updated), `inputs.check.ts`, `repair.check.ts`,
`content-understanding.check.ts` (new). Pure functions only; no network, no recorded receipt contents
in a check file.

### Integration

The probe (Task 14) is the integration test of every paid path, on three receipts chosen to cover a
clean photo, a PDF and the cropped, downscaled `lira_trogir`.

### Edge cases

- An LLM null never blanks a production value.
- A QR-sourced or QR-corroborated field is never changed by a repair policy.
- An ungrounded LLM value is rejected and counted, not merged.
- Content Understanding rows returned out of order are sorted before scoring.
- A null truth value (Konzum's missing number, date, JIR, ZKI) scores an invented value as wrong.
- A sample missing from any recorded run fails the scorer.
- An existing analyzer whose definition differs from the code throws rather than being reused.

---

## VALIDATION COMMANDS

Run each once, at the point named; do not re-run a passed check that nothing has touched.

### Level 1: Syntax and style

```powershell
npx oxlint scripts/bakeoff
npx prettier --check --end-of-line auto scripts/bakeoff
```

Ad hoc strict typecheck of the harness (no tsconfig covers `scripts/`): the command iteration 25 used
(`tsc --ignoreConfig --strict --noUncheckedIndexedAccess` over the harness files, with whatever module
flags the `.ts`-extension imports need). Record the exact command in the history file.

### Level 2: Offline checks

```powershell
node --env-file-if-exists=.env --import tsx --test scripts/bakeoff/normalize.check.ts scripts/bakeoff/compare.check.ts scripts/bakeoff/inputs.check.ts scripts/bakeoff/repair.check.ts scripts/bakeoff/content-understanding.check.ts
```

### Level 3: The product is untouched

```powershell
git status --short            # only scripts/bakeoff/, and README.md if Task 3 moved a number
npm run score:extraction      # diffed against the capture taken before Task 3
npm run typecheck
npm test
```

`npm test` and `npm run typecheck` are run once because `compare.ts` is imported by a product script;
build, integration tests and browser journeys are **not** run — no file they cover changes. Name them
as not run in the report.

### Level 4: Paid runs

Tasks 14 and 15, behind GATE A.

### Level 5: Security

```powershell
git check-ignore .bakeoff
git diff --stat -- .env.example      # must be empty: the harness variables are not application config
```

Grep the new files for a pasted key or endpoint before handing off.

---

## ACCEPTANCE CRITERIA

- [ ] No file under `api/`, `client/` or `shared/` changed; no LLM or Content Understanding dependency added to any `package.json`.
- [ ] The harness schema, normaliser and comparator have no `subtotal`; the comparator follows B8.
- [ ] `scripts/bakeoff/score.ts` runs again, on verified scalar truth.
- [ ] Four arms recorded for 15 receipts × 3 runs, every arm given the upload-sized file.
- [ ] One scorer reports production, `ocr`, three repair policies and `cu` with ranges over runs, the small-image group, grounded/ungrounded wrong values, run-to-run differences, latency and cost.
- [ ] The decision bar and the repair policies were written down before the first paid call and are evaluated mechanically.
- [ ] Items and VAT results are labelled unverified.
- [ ] Spend is under $5, with every paid run and a running total in the history file.
- [ ] `.agents/research/plan-b-engines.md` states a recommendation and its limits.
- [ ] `npm run score:extraction` is unchanged, or its change is explained and the README corrected.

---

## COMPLETION CHECKLIST

- [ ] Tasks 1-12 done in order, each VALIDATE passed
- [ ] GATE A answered with an explicit yes
- [ ] Probe read by eye before the scored runs
- [ ] Three runs in one sitting; scorer exits 0
- [ ] Research, history, roadmap row and harness README written
- [ ] Nothing committed or pushed

---

## NOTES

**Why the repair model sees production's values.** The product owner chose this shape (B2). A model
that does not see them is the `ocr` arm; the scorer's `repair` policies applied to the `ocr` arm's
scalars would be a "blind repair", and that comparison can be added offline at no cost if the result
makes it interesting. It is not built up front.

**Why three policies and a grounding test instead of one prompt that "only fixes what is wrong".**
What the pass may change is then a deterministic rule that can be read, tested and scored, and one
set of recorded calls answers three questions. The grounding test is what iteration 25's worst
finding asks for: a whole-photo model invented item names and a document number. A value that is not
on the page is never merged.

**Why production is called live.** Plan A recorded that the fixtures for `lira_trogir` and `26515835`
are full-resolution while the app uploads them downscaled, and their results differ. A live call on
the upload-sized file is also the only way to get production's latency in the same sitting as the
other arms. It costs about $0.90 for three runs.

**Why `ocr` is re-run rather than taken from iteration 25.** Schema v2 changes the prompt, and two to
three inputs change size. Iteration 25's records stay under `.bakeoff/input-modes/` and are re-scored
for context.

**Content Understanding response shape** (verified on payslip recordings):
`{ status, result: { contents: [ { markdown, unit, pages: [{ pageNumber, width, height, words }], fields: { <name>: { type: "string", valueString?, confidence?, source? } | { type: "array", valueArray?: [{ valueObject: { <cell>: {...} } }] } } } ] }, usage: { documentPagesStandard, contextualizationTokens, tokens: { "<model>-input", "<model>-cached-input", "<model>-output" } } }`.
A null scalar has no `valueString`; an empty table has no `valueArray`. `source` is
`D(page,x1,y1,…,x4,y4)` in the page's own unit, segments joined by `;`.

**Content Understanding expectations from payslips, to check against, not to assume:** p50 about 13 s
for a 29-field analyzer, an OCR floor near 4 s, about $0.025-0.035 a document, an intermittent
29-55 s stall on submit that a 5 s abandon-and-resubmit clears, ±1-2 fields between identical runs,
and a habit of misattributing a value rather than returning null.

**Things the product owner has not explicitly seen, to flag at GATE A:** the `WEAK` field list; that
no policy lets the LLM blank a production value; the party group being added to the scored scalars;
the Konzum receipt's truth living in the harness rather than in `.agents/fixtures/expected/`; the
comparator change possibly moving three `score:extraction` numbers.

**Out of scope:** wiring any engine into the app; a second model; Content Understanding's prebuilt
analyzers; the `images` and `crops` arms (answered in iteration 25); verifying items and VAT rows;
the open Plan A review findings; `/validate` 6.9.

**Confidence for one-pass success: 7/10.** The risks are the Content Understanding setup on a
resource this project has not called before (payslip-ocr needed about six attempts), the exact shape
of the provider's `raw` for `productionText`, EXIF orientation in the Node downscale, and the
comparator change touching the product's scoring script.
