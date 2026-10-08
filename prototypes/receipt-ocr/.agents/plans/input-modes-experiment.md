# Feature: Input-mode experiment on receipts (OCR text vs the document itself)

The following plan should be complete, but it is important that you validate documentation and
codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files.

**This is an experiment, not a product change.** Nothing under `api/`, `client/` or `shared/` is
modified. The output is a measured answer and a written record of it.

**Two hard stops.** No paid call (Azure OpenAI or Document Intelligence) before **GATE A**
(Task 9). Stop and ask if the recorded spend plus the next run's estimate would pass **$4**.

## Feature Description

The product owner's manager asked whether it is better to OCR a document and give the text to an
LLM, or to hand the original file to a multimodal LLM. It was measured on 11 payslips
(`prototypes/payslip-ocr/.agents/research/input-modes.md` on branch `prototype/payslip-ocr`).
This repeats the experiment on 14 Croatian receipts to see whether the findings hold on a second
document type: short, larger print, often poor photos.

Handoff: `.agents/specs/input-modes-experiment.md`. Read it first.

## User Story

As the product owner of the receipt-ocr prototype
I want the four input modes measured on receipts for input tokens, latency, accuracy and cost
So that I can tell my manager, with numbers, whether each payslip finding holds on receipts

## Problem Statement

receipt-ocr has no LLM, no prompt, no field schema with descriptions, no scorer for LLM-shaped
output and no `scripts/bakeoff/`. Its ground truth barely covers items, subtotal, payment method,
OIB, JIR and ZKI, which are the fields where the arms are most likely to differ.

## Solution Statement

Build a small harness under `scripts/bakeoff/`, port the payslip runner into it, and run four arms
through one `gpt-4.1` deployment with one system prompt, one field schema and one request shape.
Only the form of the document in the user message changes.

| Arm | The document is sent as | Samples per run |
| --- | --- | --- |
| `ocr` | DI `prebuilt-layout` markdown as text, **called fresh every run** | 14 |
| `images` | one image per page, `detail: high`; PDF pages rendered at 150 DPI | 14 |
| `files` | the PDF as a `file` part | **2 (PDFs only)** |
| `crops` | each page as overlapping horizontal bands, with one sentence saying so | 14 |
| `di` (reference) | the production engine replayed from recorded fixtures, $0 | 14, once |

For an image source `files` is the identical request to `images`, so it is not sent twice. In the
report, `files` on image sources is stated as "same request as `images`".

Then one separate bounding-box run (14 calls): every page as an image, and for each scalar field
the value, page and a box, judged against where the OCR words put that value.

### Decisions already made by the product owner (2026-10-08). Do not re-ask.

1. Input modes only. The Content Understanding plan (`.agents/plans/content-understanding-bakeoff.md`)
   is shelved. `samples.ts`, `field-schema.ts`, `compare.ts`, `ground-truth/` and `score.ts` are
   built in the shape its Tasks 1, 2, 5 and 8 describe, so it could be revived. No CU arm, no
   `map-cu*.ts`, no `buildAnalyzerDefinition`.
2. The `ocr` arm's layout call is made fresh on every run and timed.
3. Three interleaved runs per arm plus one box run. Budget cap $4.
4. The four `AZURE_OPENAI_*` variables are copied from `..\payslip-ocr\.env` by a script that never
   prints a value.
5. GATE A stays: the product owner verifies the extended ground truth before any paid call.

## Feature Metadata

**Feature Type**: Experiment / evaluation tooling
**Estimated Complexity**: Medium
**Primary Systems Affected**: `scripts/bakeoff/` (new), `.agents/research/`, `.agents/history/`, `.agents/ROADMAP.md`. No application code.
**Dependencies**: Azure OpenAI `gpt-4.1` (payslip project's Foundry resource, chat completions `2024-10-21`); Azure Document Intelligence `prebuilt-layout` `2024-11-30` (this project's resource). No new npm packages: `pdfjs-dist` 6.3.289, `@napi-rs/canvas` 1.0.8, `@azure-rest/ai-document-intelligence` and `tsx` are already in the root `node_modules`.

---

## CONTEXT REFERENCES

### Preconditions

- Work in `prototypes/receipt-ocr/` on branch `prototype/receipt-ocr`. **Do not switch branches.**
  Read payslip files with
  `git show prototype/payslip-ocr:prototypes/payslip-ocr/scripts/bakeoff/<file>`.
- **Do not commit, push or deploy.**
- Shell is Windows PowerShell 5.1: chain with `;`, never `&&`.
- `.agents`, `.claude` and `.bakeoff/` are git-ignored at the monorepo root. `.bakeoff/` holds
  receipt contents and must stay ignored. `scripts/bakeoff/` is **not** ignored.
- `scripts/` is covered by **no tsconfig** (root `tsconfig.json` references only `shared`, `api`,
  `client`), so `npm run typecheck` does not check these files. They are checked by running them.

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

receipt-ocr:

- `.agents/specs/input-modes-experiment.md` — the handoff; "Things learned the hard way" is binding.
- `CLAUDE.md` — simplicity first, surgical changes, push back when wrong.
- `scripts/score-extraction.ts` (204 lines) — `loadRows` (48-82), `readModel` (152-158),
  `loadSecondary` (160-169): how the production engine is replayed. Copy those ~30 lines for the
  `di` arm. **Do not modify this file.**
- `shared/src/receipt.ts` (10-73) — `CanonicalReceiptFields`, `VatBreakdown`, `ReceiptItem`.
  Every arm is normalised into this shape before scoring.
- `@receipt/shared` exports: `parseAmount`, `amountsEqual`, `parseIssueDate`, `parseIssueTime`,
  `parseQuantity`.
- `api/src/providers/document-extraction/receipt-amount.ts` — `parseReceiptAmount` (10),
  `parseReceiptQuantity` (15), `parseVatRate` (36).
- `api/src/providers/document-extraction/croatian.ts` — `isValidOib` (73), `normalizeOib` (90).
- `api/src/providers/document-extraction/currency.ts` — `EURO_ADOPTION_DATE` (23).
- `api/src/providers/document-extraction/azure.ts` (195-246) — `analyzeWithAzure`: raw bytes as
  `application/octet-stream`, then its **own 500 ms poll** of `analyzeResults/{resultId}`. The
  layout call mirrors this.
- `.agents/fixtures/expected/*.json` — existing ground truth, 16 files. **Read-only.**
- `.agents/fixtures/receipts/` — the 14 source files (local only).
- `.agents/plans/content-understanding-bakeoff.md` — Tasks 1, 2, 3 (parser table), 5 and 8 are the
  design this plan reuses; its field descriptions are copied below.

payslip-ocr (read with `git show`, port from):

| File | Lines | Port |
| --- | --- | --- |
| `common.ts` | 95 | cache helpers, `requireEnv`, `fmtMs`. Drop `import "dotenv/config"` and the payslip field lists |
| `model-input.ts` | 118 | `Part`, `imagePart`, `renderPdfPages`, `pageBands`, `Usage`, `complete`: as is. Schema name `HrReceipt`; the system prompt comes from `field-schema.ts` |
| `run-input-modes.ts` | 260 | `toJsonSchema`, `userContent`, the record type, `usd`, `summary`, the interleaved loop |
| `run-boxes.ts` | 197 | `BOX_RULES`, the box schema, `iou`, the judging and its summary: as is |
| `ground.ts` | 230 | `surfaceForms` (drop the `YYYY-MM` period branch and `CROATIAN_MONTHS`), `key`, `envelope`, `groundValue`, `layoutGeometry`. Drop `groundExtraction` |
| `score.ts` | 263 | only `textKey` (diacritic-, case- and punctuation-insensitive text) |

### New Files to Create

All under `scripts/bakeoff/`:

- `README.md` — what this is, env vars, commands, where records go, that `.bakeoff/` is never committed.
- `samples.ts` — the 14 samples, paths, cache helpers, `requireEnv`, `fmtMs`.
- `field-schema.ts` — `FieldDef`, `RECEIPT_FIELDS` (17 fields), `SHARED_RULES`, `SYSTEM`, `toJsonSchema`.
- `normalize.ts` — model JSON (values as printed) → `CanonicalReceiptFields` + `unreadable` + `inferred`.
- `compare.ts` — `matches`, `scoreReceipt`, groups. Pure.
- `model-input.ts`, `layout.ts`, `ground.ts` — ported.
- `run-input-modes.ts`, `run-boxes.ts` — the runners.
- `score.ts` — scores every recorded arm and the `di` reference.
- `normalize.check.ts`, `compare.check.ts` — offline checks, Node's test runner.
- `ground-truth/<sample>.json` × 14 — additive ground truth.

Also: `.agents/research/input-modes.md` (the result), `.agents/history/25-input-modes-experiment.md`,
one row in `.agents/ROADMAP.md` "Iterations outside the numbered task list".

### Relevant Documentation

- [Azure OpenAI vision: image tokens and `detail`](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/gpt-with-vision)
  - Why: `detail: high` fits an image in a 2048 px square, then scales its short side to 768 px.
    This is the resolution effect being measured.
- [Structured outputs](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/structured-outputs)
  - Why: strict schema needs every property in `required` and `additionalProperties: false`.
- [Prompt caching](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/prompt-caching)
  - Why: `usage.prompt_tokens_details.cached_tokens`; cost is reported as billed and uncached.
- [Document Intelligence layout model, markdown output](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/layout)
  - Why: `outputContentFormat=markdown`.

### Patterns to Follow

**Script style.** TypeScript run with tsx, ES modules. Sibling imports inside `scripts/bakeoff/`
use the `.ts` extension (as the payslip harness does). Imports into `api/src/...` use `.js`
(as `scripts/score-extraction.ts` lines 5-10). Cross-workspace imports by package name.
No new npm scripts, no new dependencies.

**Running a script:**

```powershell
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score.ts
```

Fallback if `--import tsx` fails: `npx tsx --env-file=.env scripts/bakeoff/score.ts`.

**The model copies what is printed; normalising is ours.** The schema asks for `17.08.2026.` and
`1.234,56`. `normalize.ts` turns them into canonical values with the parsers production uses, and
only canonical values are scored. Scoring raw strings understated one engine by four points on
payslips.

**Never invent.** A printed value the parser cannot read becomes `null` and is counted as
unreadable. Nothing is computed or defaulted, except the currency inference below, which is
counted apart.

### Gotchas

1. **Do not use the SDK's `getLongRunningPoller` for the layout call.** It obeys Azure's
   `retry-after` (4-7 s) over its own interval (history 23). The payslip `run-layout.ts` uses it;
   here the `ocr` arm's time is a result, so poll at 500 ms as `analyzeWithAzure` does.
2. PDF file input: `{ type: "file", file: { filename, file_data: "data:application/pdf;base64,…" } }`
   on chat completions `2024-10-21`.
3. HEIC is not accepted as an image. The corpus has none; if a source is HEIC, stop and report.
4. `pageBands` never scales a band **up**. Seven of the twelve photos are under 768 px on the short
   side (`images` 387×516, `ina-racun-sladoled` 328×602, `inareceipt` 480×640, `receipt123` 335×597,
   `22559270` 447×876, `receiptEuroMistake` 564×1500, `racuntaksi1` 632×865), so the service does
   not shrink them and bands add no resolution. The resolution effect can only show on the five
   larger ones (`26515835` 1280×3066, `gradanin-gotovina-pos` 1028×2084, `lira_trogir` 2736×3648,
   `receiptWithTaxMistake` 1920×2560, `screenshot-20190705-1907152` 1232×1616). Report `crops`
   against `images` split by that line. **Do not tune the band shape.**
5. **Do not edit `.env.example`, `package.json` or `README.md`.** `/validate` 6.6 requires every
   env name and npm script to be documented in the README. The harness documents itself in
   `scripts/bakeoff/README.md`.
6. `npm run score:extraction` must print byte-identical output before and after. That is why the
   extended ground truth is not written into `.agents/fixtures/expected/`.
7. Vitest runs only the `shared`, `api` and `client` projects. Checks under `scripts/` use
   `node:test` and the `.check.ts` suffix.
8. Repo-wide `npm run lint` and `npm run format:check` were red on a clean tree (history 23).
   Lint and format only `scripts/bakeoff`, with `prettier --end-of-line auto`.
9. Sample names follow no slug rule. Use the table in Task 1.
10. Importing `api/src/providers/document-extraction/azure.js` loads `api/src/config.ts`, which
    throws without the Supabase and DI variables. `.env` has them; only `score.ts` imports it.
11. Never print a key, and never print a response body or receipt text into the conversation
    beyond the few values needed to explain a mismatch.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation (offline, free) — Tasks 1-6
### Phase 2: Runners, written but not run (offline, free) — Task 7
### Phase 3: Ground truth and the `di` baseline (offline, free) — Task 8
### Phase 4: GATE A — Task 9
### Phase 5: Paid runs — Tasks 10-12
### Phase 6: Score, read, report — Tasks 13-14

---

## STEP-BY-STEP TASKS

Execute in order.

### Task 0 — Baseline

- **VALIDATE**: `npm run score:extraction > "$env:TEMP\score-before.json"`

### Task 1 — CREATE `scripts/bakeoff/samples.ts`

- **IMPLEMENT**: `ROOT`, `EXPECTED_DIR` (`.agents/fixtures/expected`), `SOURCES_DIR`
  (`.agents/fixtures/receipts`), `GROUND_TRUTH_DIR` (`scripts/bakeoff/ground-truth`), `CACHE_DIR`
  (`.bakeoff`), `FIXTURES_DIR`, `SECONDARY_FIXTURES_DIR`. `SAMPLES` as below, each with
  `sourceKind: "pdf" | "image"`. `sourceBytes(sample)`, `cachePath`, `readCache`, `writeCache`,
  `requireEnv`, `fmtMs`.

  | `name` (= expected file basename) | `sourceFile` | content type |
  | --- | --- | --- |
  | `22559270` | `22559270.png` | `image/png` |
  | `26515835` | `26515835.jpg` | `image/jpeg` |
  | `gradanin-gotovina-pos` | `gradanin-gotovina-pos.jpg` | `image/jpeg` |
  | `images` | `images.jpg` | `image/jpeg` |
  | `ina-racun-sladoled` | `ina-racun-sladoled.jpg` | `image/jpeg` |
  | `inareceipt` | `inareceipt.jpg` | `image/jpeg` |
  | `lira_trogir` | `lira_trogir.jpg` | `image/jpeg` |
  | `primjer1-hr-nopdv` | `primjer1-hr-nopdv.pdf` | `application/pdf` |
  | `primjer-pdf-racuna` | `primjer-pdf-racuna.pdf` | `application/pdf` |
  | `racuntaksi1` | `racuntaksi1.jpg` | `image/jpeg` |
  | `receipt123` | `receipt123.jpg` | `image/jpeg` |
  | `receiptEuroMistake` | `receiptEuroMistake.jpg` | `image/jpeg` |
  | `receiptWithTaxMistake` | `receiptWithTaxMistake.jpg` | `image/jpeg` |
  | `screenshot-20190705-1907152` | `Screenshot_20190705-1907152.png` | `image/png` |

  `31231822` and `racun-mobilna-trgovina` have expected values and no source file. They are
  outside every arm, including `di`. Export them as `EXCLUDED` so the report can name them.
- **PATTERN**: payslip `common.ts`.
- **GOTCHA**: no `import "dotenv/config"`.
- **VALIDATE**: `node --import tsx -e "import('./scripts/bakeoff/samples.ts').then(m=>{for(const s of m.SAMPLES){m.sourceBytes(s)};console.log(m.SAMPLES.length)})"` prints `14`.

### Task 2 — CREATE `scripts/bakeoff/field-schema.ts`

- **IMPLEMENT**:
  - `interface FieldDef { type: "string" | "array"; description: string; items?: Record<string, FieldDef> }`
  - `RECEIPT_FIELDS: Record<string, FieldDef>`, 17 fields named as the canonical fields: 15 scalars
    and the arrays `vatBreakdown` (`rate`, `taxableBase`, `vatAmount`) and `items` (`description`,
    `quantity`, `unitPrice`, `total`).
  - `SHARED_RULES` = `Pravila: prepiši svaku vrijednost TOČNO kako je ispisana; ne računaj i ne izvodi vrijednosti koje nisu ispisane; ako polja nema na računu, vrati null; iznose ostavi u ispisanom zapisu (npr. 1.234,56).`
  - `SYSTEM` = `Ti si stručnjak za hrvatske fiskalne račune (maloprodaja, ugostiteljstvo, R1 račun). Iz dokumenta izvuci tražena polja.\n\n${SHARED_RULES}`. One wording serves text, images and files.
  - `toJsonSchema(def)` and the exported strict `SCHEMA` object (payslip `run-input-modes.ts`:
    every property required, `["string","null"]`, `additionalProperties: false`).
  - Descriptions, verbatim:
    - `sellerName`: `Naziv izdavatelja računa — tvrtka ili obrt koji je izdao račun, obično na vrhu uz OIB i adresu sjedišta (npr. '... d.o.o.', '... d.d.', '..., obrt za ...'). Ako su ispisani i naziv lokala ili poslovnice i naziv tvrtke, vrati naziv tvrtke ili obrta.`
    - `sellerAddress`: `Adresa sjedišta izdavatelja računa (ulica, broj, poštanski broj, mjesto).`
    - `sellerOib`: `OIB izdavatelja računa — 11 znamenki uz oznaku 'OIB'. Može biti ispisan i kao PDV ID s prefiksom 'HR'. Prepiši kako je ispisano.`
    - `buyerName`: `Naziv kupca, samo ako račun ima zaseban blok kupca ('Kupac:', R1 račun). Naziv poslovnice izdavatelja nije kupac.`
    - `buyerAddress`: `Adresa kupca iz bloka kupca.`
    - `buyerOib`: `OIB kupca iz bloka kupca — 11 znamenki.`
    - `documentNumber`: `Broj računa, npr. '381/1/3' ili '1234/POSL1/1' (redni broj / poslovni prostor / naplatni uređaj). Labeli: 'Račun br.', 'Broj računa', 'Račun:', 'Rn:'. JIR, ZKI, broj stola i oznaka blagajnika su druga polja.`
    - `issueDate`: `Datum izdavanja računa, prepisan TOČNO kako je ispisan (npr. '17.08.2026.', '31.03.25'). Labeli: 'Datum', 'Datum izdavanja', 'Datum i vrijeme'.`
    - `issueTime`: `Vrijeme izdavanja računa, kako je ispisano (npr. '14:30', '14:19:14'), obično odmah uz datum izdavanja. Trajanje vožnje ili usluge je drugo polje.`
    - `subtotal`: `Iznos bez PDV-a ispisan kao zaseban zbroj ('Osnovica ukupno', 'Iznos bez PDV-a', 'Međuzbroj'). Samo broj kako je ispisan.`
    - `total`: `Ukupan iznos računa za platiti, kako je ispisan. Labeli: 'UKUPNO', 'Sveukupno', 'Za platiti', 'Ukupno EUR'. Ako su ispisani iznosi u eurima i u kunama, vrati iznos u valuti u kojoj je račun izdan: eure od 1.1.2023., kune prije toga. Samo broj, bez oznake valute.`
    - `currency`: `Oznaka valute ispisana uz ukupan iznos: 'EUR', '€', 'kn' ili 'HRK'.`
    - `paymentMethod`: `Način plaćanja kako je ispisan, npr. 'Gotovina', 'Novčanice', 'Kartica', 'Kartice', 'Transakcijski račun'. Label: 'Način plaćanja'.`
    - `jir`: `JIR (jedinstveni identifikator računa): 36 znakova u obliku 8-4-4-4-12 heksadecimalnih znakova s crticama, iza oznake 'JIR'. Ako je prelomljen u dva retka, spoji ga bez razmaka.`
    - `zki`: `ZKI (zaštitni kod izdavatelja): 32 heksadecimalna znaka bez crtica, iza oznake 'ZKI' ili 'Zaštitni kod'. Ako je prelomljen u dva retka, spoji ga bez razmaka.`
    - `vatBreakdown`: `Rekapitulacija PDV-a: jedan redak po poreznoj stopi, s ispisanom stopom, osnovicom i iznosom poreza. Redak 'Ukupno' nije porezna stopa. Račun izdavatelja koji nije u sustavu PDV-a nema ovu tablicu.`
      - `rate`: `Stopa PDV-a kako je ispisana, npr. '25%', '13,00'.`
      - `taxableBase`: `Osnovica za tu stopu, kako je ispisana.`
      - `vatAmount`: `Iznos PDV-a za tu stopu, kako je ispisan.`
    - `items`: `Stavke računa: jedan redak po kupljenom artiklu ili usluzi, redom kako su ispisane. Međuzbrojevi, ukupno, rekapitulacija PDV-a i način plaćanja nisu stavke.`
      - `description`: `Naziv artikla ili usluge, kako je ispisan.`
      - `quantity`: `Količina kako je ispisana, npr. '1', '3,000', '0,5'.`
      - `unitPrice`: `Jedinična cijena kako je ispisana.`
      - `total`: `Iznos stavke kako je ispisan.`
- **GOTCHA**: **the schema is frozen once the first paid call is made.** Reword a description only
  now, only if it is ambiguous on its own, never from one receipt's ground truth and never after
  seeing an arm's output. Note any rewording in the report.
- **VALIDATE**: `node --import tsx -e "import('./scripts/bakeoff/field-schema.ts').then(m=>console.log(Object.keys(m.RECEIPT_FIELDS).length, m.SCHEMA.required.length))"` prints `17 17`.

### Task 3 — CREATE `scripts/bakeoff/normalize.ts`

- **IMPLEMENT**: `normalize(fields: Record<string, unknown>)` →
  `{ fields: CanonicalReceiptFields; unreadable: string[]; inferred: string[] }`. Paths are dotted
  canonical paths (`total`, `vatBreakdown.0.rate`, `items.2.total`).

  | Field | Parser |
  | --- | --- |
  | names, addresses, `documentNumber`, `paymentMethod`, item `description` | trim; join wrapped lines with one space; empty → `null` |
  | `sellerOib`, `buyerOib` | `normalizeOib` |
  | `issueDate` / `issueTime` | `parseIssueDate` / `parseIssueTime` |
  | `total`, `subtotal` | `parseAmount` |
  | VAT `rate` | `parseVatRate`; `taxableBase`, `vatAmount`: `parseReceiptAmount` |
  | item `quantity` | `parseReceiptQuantity`; `unitPrice`, `total`: `parseReceiptAmount` |
  | `jir`, `zki` | remove all whitespace |
  | `currency` | `€`/`EUR`/`EURO` → `EUR`; `kn`/`HRK` → `HRK`; otherwise below |

  Currency fallback, as production's last resort: if none was printed **and** the receipt is
  Croatian (a valid seller OIB, a JIR or a ZKI was read) **and** `issueDate` is known, `EUR` on or
  after `EURO_ADOPTION_DATE`, else `HRK`; push `currency` to `inferred`.
  A non-null printed value whose parser returns `null` goes to `unreadable`.
  Drop VAT and item rows whose every cell is `null`; an empty array becomes `null`.
- **IMPORTS**: `@receipt/shared`; `../../api/src/providers/document-extraction/croatian.js`,
  `receipt-amount.js`, `currency.js`.
- **VALIDATE**: Task 5.

### Task 4 — CREATE `scripts/bakeoff/compare.ts`

- **IMPLEMENT**: pure functions, identical for every arm and for `di`.
  - `matches(path, expected, actual)`:
    - both null/undefined → match; one null → miss;
    - amounts, rates, quantities → `amountsEqual` (so `25` equals `25.00`);
    - `issueDate`, `issueTime`, OIB, `currency` → exact;
    - `jir`, `zki` → case-insensitive;
    - other text → payslip `textKey`: NFD, diacritics and `đ` folded, non-alphanumerics dropped, lower case.
  - `scoreReceipt(expected, actual)` → per-path results for scalars; for `vatBreakdown` and `items`:
    `rowCountExact`, and per-cell results with rows aligned **by index** (cells of a missing row
    are misses; cells of an extra row are not counted, the row count is).
  - Groups: `critical` (`sellerName`, `documentNumber`, `issueDate`, `total`, `currency`),
    `fiscal` (`sellerOib`, `jir`, `zki`), `other` (`issueTime`, `subtotal`, `paymentMethod`),
    `vat` (VAT cells), `items` (item cells). Scalars = critical + fiscal + other.
  - A key **absent** from ground truth is not scored. A key present with `null` is scored: the arm
    must return nothing.
  - `noCriticalCorrection(result)`: every expected critical field matches.
- **GOTCHA**: more lenient than `scripts/score-extraction.ts` (numeric equality, folded text), so
  the `di` numbers here will not equal the README's. Say so in the report.
- **VALIDATE**: Task 5.

### Task 5 — CREATE `normalize.check.ts` and `compare.check.ts`

- **IMPLEMENT**: `node:test` + `node:assert/strict`.
  - normalize: scalar, array, null and unparseable values map as expected with the right
    `unreadable`; `HR`-prefixed OIB normalises; a bad check digit → `null`; a JIR split by a space
    is joined; `3,000` quantity → `3.000`; `17.08.2026.` → `2026-08-17`; `kn` → `HRK`; currency
    inferred only when Croatian and dated; an all-null row is dropped; `25%` rate → matches `25.00`.
  - compare: `25` vs `25.00` matches; text differing by case, spacing or diacritics matches;
    expected `null` vs a value is a miss; an absent key is not scored; 3 rows against 4 expected
    gives `rowCountExact: false` and the missing row's cells as misses.
- **VALIDATE**: `node --import tsx --test scripts/bakeoff/normalize.check.ts scripts/bakeoff/compare.check.ts`

### Task 6 — CREATE `model-input.ts`, `layout.ts`, `ground.ts`

- **IMPLEMENT** `model-input.ts`: port as is. `complete(system, content, schema)` with
  `json_schema.name: "HrReceipt"`, `temperature: 0`, `max_tokens: 8000`, the 429 wait-and-retry
  outside the timing. Env: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`,
  `AZURE_OPENAI_API_VERSION`.
- **IMPLEMENT** `layout.ts`: `analyzeLayout(bytes)` → `{ latencyMs, uploadMs, analyzeMs, operation }`.
  `prebuilt-layout`, `2024-11-30`, body raw bytes as `application/octet-stream`,
  `queryParameters: { outputContentFormat: "markdown", locale: "hr-HR" }`, then poll
  `/documentModels/{modelId}/analyzeResults/{resultId}` every **500 ms** until it leaves
  `notStarted`/`running`. Throw on anything but `succeeded`. No cache inside this function.
- **IMPLEMENT** `ground.ts`: port as listed under "port from".
- **PATTERN**: `api/src/providers/document-extraction/azure.ts` lines 195-246.
- **GOTCHA**: gotcha 1.
- **VALIDATE**: `node --import tsx -e "import('./scripts/bakeoff/model-input.ts').then(async m=>{const fs=await import('node:fs');const p=await m.renderPdfPages(fs.readFileSync('.agents/fixtures/receipts/primjer-pdf-racuna.pdf'),150);const i=fs.readFileSync('.agents/fixtures/receipts/26515835.jpg');console.log(p.length,(await m.pageBands(i)).length)})"` prints `1 6` (one PDF page; a 1280×3066 photo is six bands). No network call.

### Task 7 — CREATE `run-input-modes.ts`, `run-boxes.ts`, `README.md`

- **IMPLEMENT** `run-input-modes.ts`, ported from the payslip runner with these changes:
  - Args: `--reps=<n>` (default 3), `--only=<a,b>`, `--tag=<name>` (records go to
    `input-modes/<tag>-<arm>-r<rep>`; default no tag), `--force`, `--summary`, `--confirm-spend`,
    `--cap=<usd>` (default 4).
  - Arms per sample: `ocr`, `images`, `crops`, and `files` **only when `sourceKind === "pdf"`**.
  - `ocr`: call `analyzeLayout` fresh, write the whole operation to
    `input-modes/<tag->layout-r<rep>/<sample>.json`, send
    `<dokument>\n${analyzeResult.content}\n</dokument>`. `extraMs` = the layout `latencyMs`;
    `extraUsd` = pages × `PRICE.layoutPage`. If a record exists but its layout does not, redo both.
  - Loop order: `for rep → for sample → for arm`, sequential. **Rotate the starting arm by sample
    index**, so no arm is always first after another's call.
  - Record: payslip `Record_` plus `sample` and `bands` (count, for `crops`).
  - `PRICE = { input: 2.0, cachedInput: 0.5, output: 8.0, layoutPage: 0.01 }` (USD; gpt-4.1 per 1M
    tokens and DI layout per page, list prices). Print the assumption with every summary.
  - **Spend guard.** `recordedSpend()` sums every record under `.bakeoff/` (model `usage` and
    `extraUsd`, all tags, plus `boxes`). Before each rep, estimate the rep as (uncached calls ×
    that arm's mean recorded cost, or $0.015 when nothing is recorded) + layout pages × $0.01,
    print both, and exit non-zero if `recorded + estimate > cap`. Refuse any network call without
    `--confirm-spend`.
  - `--summary`: per arm and per source group (`all`, `pdf`, `image`, and for images
    `short side > 768` against `≤ 768`): n, input tokens median (cached mean), output tokens
    median, latency p50 / p90 (`latencyMs + extraMs`), $ per receipt **as billed** and **without
    caching** (all input at `PRICE.input`), and the recorded total.
- **IMPLEMENT** `run-boxes.ts`, ported as is: scalars only, `${SYSTEM}\n\n${BOX_RULES}`, records in
  `boxes/`, judged against the `layout-r1` words. Same `--confirm-spend` and cap guard. Add
  `--draw=<sample>`: write `.bakeoff/boxes/<sample>.png` with the model's boxes in one colour and
  the OCR positions in another (`@napi-rs/canvas`), for the by-eye check.
- **IMPLEMENT** `README.md`: purpose, the six env vars and where they come from, every command in
  this plan, the record layout, and that `.bakeoff/` holds receipt contents.
- **VALIDATE**: `node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-input-modes.ts --only=images` exits non-zero with a message naming `--confirm-spend` and makes no network call. Same for `run-boxes.ts`.

### Task 8 — CREATE `ground-truth/<sample>.json` × 14 and `score.ts`

- **IMPLEMENT** ground truth: one file per sample with **only additive keys** — any of `sellerOib`,
  `jir`, `zki`, `subtotal`, `paymentMethod`, `issueTime`, `items` that the expected file lacks —
  plus `"verifiedBy": null` and an optional `"notes"` array.
  - Read each value **from the image or PDF itself** (open the file with the Read tool), never
    from a model output, an Azure fixture or the production mapper.
  - Canonical form: amounts as plain decimals at printed precision (`"18.14"`), quantities at
    printed precision (`"3.000"`), times as printed (`"14:30"`, no added seconds), JIR and ZKI
    lower-case, text as printed with wrapped lines joined by one space.
  - Verified **not printed** → `null`. Printed but illegible to you → **omit** the key and say so
    in `notes`.
  - Check arithmetic: item totals against the receipt total; VAT base + VAT against the total;
    the OIB check digit with `isValidOib`. A mismatch means re-read; if the receipt itself is
    inconsistent, say so in `notes` (history 21 found two wrong ground-truth files this way).
  - Never repeat a key the expected file has.
- **IMPLEMENT** `score.ts`:
  - Ground truth per sample = `{ ...expected, ...additions }`. Throw if a key is in both with
    different values.
  - Arm `di`: copy `readModel`, `loadSecondary` and the merge from `scripts/score-extraction.ts`
    for the 14 samples.
  - LLM arms: every `input-modes/<arm>-r<rep>/` that exists (default tag only), each normalised
    then scored. A run directory that is absent is "not run". **A run directory that exists but
    lacks a sample it should hold (14, or 2 for `files`) makes the script exit non-zero**, naming
    the sample. Nothing is skipped silently.
  - Output, Markdown on stdout and `.bakeoff/report.json`:
    1. per arm, min-max over runs: scalars, critical, fiscal, other, VAT cells, item cells, VAT and
       item row counts exact, receipts needing no critical correction; `di` beside them;
    2. the same split by `pdf` / `image`, and images by short side `> 768` / `≤ 768`;
    3. per field, per arm (worst run);
    4. **per-receipt mismatch list**: sample, path, expected, each arm's normalised value and the
       raw printed value it came from (`--verbose`);
    5. per arm: count of `unreadable`, count of inferred currencies;
    6. run-to-run variance: paths whose normalised value differs between r1, r2, r3.
  - Print `GROUND TRUTH NOT VERIFIED` above the tables while any file has `verifiedBy: null`.
- **VALIDATE**: `node --env-file-if-exists=.env --import tsx scripts/bakeoff/score.ts` prints `di` scored on 14 receipts, every LLM arm as "not run", and `GROUND TRUTH NOT VERIFIED`.

### Task 9 — GATE A: stop and hand back to the product owner

- Run Level 1-3 validation below.
- Copy the Azure OpenAI variables without printing a value:

  ```powershell
  node -e "const fs=require('fs');const want=['AZURE_OPENAI_ENDPOINT','AZURE_OPENAI_KEY','AZURE_OPENAI_DEPLOYMENT','AZURE_OPENAI_API_VERSION'];const src=fs.readFileSync('../payslip-ocr/.env','utf8').split(/\r?\n/);const have=new Set(fs.readFileSync('.env','utf8').split(/\r?\n/).map(l=>l.split('=')[0]));const add=src.filter(l=>want.includes(l.split('=')[0])&&!have.has(l.split('=')[0]));if(add.length)fs.appendFileSync('.env','\n# --- Azure OpenAI (input-mode experiment only; not read by the app) ---\n'+add.join('\n')+'\n');console.log('added',add.map(l=>l.split('=')[0]).join(', ')||'none','| missing in source:',want.filter(n=>!src.some(l=>l.startsWith(n+'='))).join(', ')||'none')"
  ```

- Report and **wait**:
  1. the 14 ground-truth drafts as one table (sample, field, value), every `notes` entry and
     anything you were unsure of, with the request to check them against the receipts and set
     `verifiedBy`;
  2. the `di` baseline table;
  3. the planned spend: 132 model calls (3 × 44) + 14 box calls + 10 probe calls, about $1.90, and
     42 + 3 layout pages, about $0.45: **about $2.35 against the $4 cap**;
  4. any description you reworded and why.
- **Do not proceed without an explicit yes on the ground truth.** The spend is already approved up
  to the cap.

### Task 10 — Paid: probe, three receipts

- `node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-input-modes.ts --tag=probe --reps=1 --only=gradanin-gotovina-pos,primjer-pdf-racuna,lira_trogir --confirm-spend`
  (a photo, a PDF, and the largest photo: 10 model calls, 3 layout pages).
- Check, on the records' **structure**: every arm returned all 17 keys; `files` on the PDF was
  accepted; `crops` band counts are as expected (`gradanin-gotovina-pos` 5, `lira_trogir` 3);
  `usage` carries `prompt_tokens_details`; the layout record has `analyzeResult.content` and
  `pages[].words`.
- **GOTCHA**: if a request is rejected, read the error body and fix the cause. Do not retry
  blindly. Probe records are never scored into the result.
- **VALIDATE**: `--summary --tag=probe` prints a row per arm with non-zero tokens.

### Task 11 — Paid: the three runs, one sitting

- `node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-input-modes.ts --reps=3 --confirm-spend`
- Do not start it unless it can finish in one sitting (about 132 calls at 5-15 s plus 42 layout
  calls: allow 40 minutes). Do not run anything else against either resource meanwhile.
- A `FAILED` line is re-run by the same command (cached records are skipped). Say in the report
  which records were filled in later.
- **VALIDATE**: `score.ts` exits 0 and reports no arm as "not run".

### Task 12 — Paid: the box run

- `node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-boxes.ts --confirm-spend`
- `--draw=gradanin-gotovina-pos` and one PDF; **look at both PNGs** before believing the table.
- **VALIDATE**: `run-boxes.ts --summary` prints the three source rows.

### Task 13 — Score, and read the wrong values

- `score.ts --verbose`; save the Markdown.
- **For every arm, read at least five mismatches by eye against the receipt** and decide: wrong
  reading, invention, a formatting difference the comparator should accept, or wrong ground truth.
  Fix a scorer or normaliser defect and re-score (free). A ground-truth error goes back to the
  product owner; do not edit a verified file yourself.
- **VALIDATE**: the offline checks still pass after any scorer change.

### Task 14 — Write the record

- CREATE `.agents/research/input-modes.md` in the shape of the payslip record: question, method,
  the results table over runs with `di` as the reference line, the split by source kind, what it
  shows, limits, the box test, spend, harness.
- End with a section for the manager, one line each: **did the payslip finding hold on receipts?**
  1. accuracy order of the arms (payslips: `ocr` > `crops` > `files` > `images`);
  2. the resolution effect (payslips: bands closed most of the gap);
  3. the PDF effect (payslips: a PDF file scores like OCR because of its text layer);
  4. input tokens (payslips: a whole page is lower than its OCR text);
  5. latency (payslips: no difference for a whole page);
  6. cost (payslips: a whole page is about half);
  7. boxes (payslips: 0 usable of 232).
  For each: held, did not hold, or cannot be told from this corpus, with the numbers.
- State these limits:
  - 14 receipts, one model, three runs; a difference of 1-2 values is not a result.
  - Two PDFs, one page each: the PDF split says little.
  - Seven photos are below the service's downscaling size, so the resolution effect rests on five.
  - **The `di` reference was tuned on these same 14 receipts** (histories 18, 21, 23, 24); the LLM
    arms saw them cold. It is a reference line, not a fair fourth contestant.
  - `31231822` and `racun-mobilna-trgovina` have ground truth and no source file; they are outside.
  - `sellerAddress` and the three buyer fields were asked for and are not scored (no ground truth).
  - The arms got the stored source files; the app downscales photos above 2 MP to 1,600 px, which
    applies to `lira_trogir` and `receiptWithTaxMistake` here.
  - The comparator is more lenient than `npm run score:extraction`.
  - Prices are list prices. `di` latency was not re-measured; quote the README's 5.7 s median as
    measured on another day.
  - One band shape, not tuned. Direct input returns no confidence and no usable position.
- CREATE `.agents/history/25-input-modes-experiment.md` (short, template in ROADMAP §1, pointing at
  the research file) and add row 25 to the ROADMAP iterations table. No amendment to locked
  decisions: this experiment adopts nothing.
- **VALIDATE**: Level 3 below.

---

## TESTING STRATEGY

### Unit checks

`normalize.check.ts` and `compare.check.ts`: the two places a silent error would change a score.
Written before any paid call.

### Integration

The probe (Task 10) is the integration test: a wrong request shape costs 10 calls, not 132.

### Edge cases

- No VAT recap (`images`, `racuntaksi1`, `screenshot-…`): the arm must return no rows.
- `primjer1-hr-nopdv`: prints a 0% recap while its ground truth records no VAT. Report the result;
  change neither side.
- `lira_trogir`: left edge cropped, JIR and ZKI labels cut. Watch for invented identifiers.
- `ina-racun-sladoled`: kuna and euro on one slip; the total must be the euro amount.
- `primjer-pdf-racuna`: synthetic OIB failing the check digit must normalise to `null`.
- Three-decimal quantities (`lira_trogir`, `screenshot-…`).
- `receipt123`: badly degraded photo; expect disagreement between runs.

---

## VALIDATION COMMANDS

Run each once; re-run only what a fix could affect.

### Level 1: Syntax & style (new files only)

```powershell
npx oxlint scripts/bakeoff
npx prettier --check --end-of-line auto scripts/bakeoff
```

### Level 2: Offline checks

```powershell
node --import tsx --test scripts/bakeoff/normalize.check.ts scripts/bakeoff/compare.check.ts
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score.ts
```

### Level 3: No change to the application

```powershell
npm run score:extraction > "$env:TEMP\score-after.json"; Compare-Object (Get-Content "$env:TEMP\score-before.json") (Get-Content "$env:TEMP\score-after.json")
git status --short
```

Expected: `Compare-Object` prints nothing; `git status` lists only `scripts/bakeoff/`.
`npm run typecheck` and `npm test` are not run: no file they cover changes, and `git status`
proves it.

### Level 4: Paid runs (after GATE A only)

Tasks 10, 11, 12.

---

## ACCEPTANCE CRITERIA

- [ ] No file under `api/`, `client/`, `shared/` changed; `.env.example`, `package.json`, `README.md` untouched.
- [ ] `npm run score:extraction` output byte-identical before and after.
- [ ] Extended ground truth exists for 14 receipts, each marked verified by the product owner.
- [ ] No paid call before GATE A; total recorded spend at or under $4, stated in the report.
- [ ] Three runs recorded for `ocr`, `images`, `crops` (14 each) and `files` (2 each), in one sitting; one box run.
- [ ] The field schema was not changed after the first paid call.
- [ ] The report gives, per arm: accuracy by group over runs, the source-kind split, input and output tokens, latency p50/p90, cost as billed and uncached, run-to-run variance, and the box table.
- [ ] Each of the seven payslip findings is answered as held / did not hold / cannot be told.
- [ ] Wrong values were read by eye for every arm, and the box test was checked by drawing it.
- [ ] No key or receipt content printed or committed; `.bakeoff/` untracked; nothing committed or pushed.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order, GATE A respected
- [ ] Each task's validation passed
- [ ] Level 1-3 validation commands pass
- [ ] Report reviewed against the raw mismatches, not only the totals
- [ ] Research record, history 25 and the roadmap row written

---

## NOTES

**Why the model is asked to copy and a normaliser follows.** It keeps the instruction identical
for all four arms and puts date, amount and OIB handling in the parsers production already
trusts, so an arm is not marked down for a formatting choice.

**Why `files` runs on two samples.** For a photo it is byte-for-byte the `images` request. On
payslips both were sent and treated as two samples of one condition; here the 36 duplicate calls
are not bought.

**Why the arm order rotates.** The schema and rules are served from the prompt cache after the
first call, and an image request is slower than a text one. A fixed order would give one arm the
same neighbour every time.

**Expected ranges, to sanity-check against (estimates).** Schema and rules about 1,500-2,000 input
tokens; a receipt 500-1,500 as text and about 800 as one image; `crops` 3-6 bands. $0.008-0.02 per
call. Model latency 3-10 s; layout 2-5 s. Runs of one arm differing by 1-2 values.

**Ground truth in `scripts/bakeoff/ground-truth/` would be committed if this folder is ever
committed**, while `.agents/fixtures/expected/` is ignored. It holds business names, OIBs and
fiscal identifiers read from the receipts; the recorded Azure responses of the same receipts are
already in the repository under `api/src/providers/document-extraction/fixtures/`. The product
owner decides at commit time.

**What this plan does not decide.** Whether receipt-ocr should use an LLM. PRD §4.7 excludes one;
a result in an LLM arm's favour leads to a separate decision and plan.

**Confidence for one-pass execution: 7/10.** The risks are the quality of the ground-truth draft
(contained by GATE A), a scorer or normaliser quirk that marks down one arm (contained by Task 13),
and day-to-day changes in generation rate (contained by one sitting and interleaving).
