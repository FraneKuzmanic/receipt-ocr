# Input-mode experiment

A measurement beside the product: nothing here is imported by `api/`, `client/` or `shared/`, and
the application has no LLM. It answers one question on receipts, after payslip-ocr answered it on
payslips: is it better to OCR a document and give the text to an LLM, or to hand the model the
document itself?

Plan: `.agents/plans/input-modes-experiment.md`. Result: `.agents/research/input-modes.md`.

## The arms

One `gpt-4.1` deployment, one system prompt, one field schema (`field-schema.ts`), one request.
Only the form of the document in the user message changes.

| Arm | The document is sent as |
| --- | --- |
| `ocr` | Document Intelligence `prebuilt-layout` markdown, as text; the layout call is made fresh for every run |
| `images` | one image per page, `detail: high`; a PDF's pages are rendered at 150 DPI first |
| `files` | a PDF as a `file` part. Runs for the 2 PDFs only: for a photo it is the same request as `images` |
| `crops` | each page as overlapping horizontal bands, twice as wide as tall |

The production engine (two Document Intelligence prebuilt models, merged) is replayed from its
recorded fixtures as a reference line, at no cost. It was tuned on these same receipts.

## Environment

Read from the root `.env`. None of these is read by the application at runtime except the two
Document Intelligence values, and none is listed in `.env.example`.

| Variable | From |
| --- | --- |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` | payslip-ocr's `.env` (the Foundry resource with the `gpt-4.1` deployment) |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY` | already in this project's `.env` |

## Commands

Run from `prototypes/receipt-ocr/`. A command that makes a paid call refuses to start without
`--confirm-spend`, prints an estimate first, and stops if the recorded spend plus that estimate
would pass the cap (`--cap=<usd>`, default 4).

```powershell
# Offline, free
node --import tsx --test scripts/bakeoff/normalize.check.ts scripts/bakeoff/compare.check.ts
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score.ts
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score.ts --verbose
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-input-modes.ts --summary
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-boxes.ts --summary
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-boxes.ts --draw=gradanin-gotovina-pos

# Paid
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-input-modes.ts --tag=probe --reps=1 --only=gradanin-gotovina-pos,primjer-pdf-racuna,lira_trogir --confirm-spend
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-input-modes.ts --reps=3 --confirm-spend
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-boxes.ts --confirm-spend
```

Other flags: `--only=<a,b>` limits the samples, `--force` redoes what is recorded.

Run the three runs in one sitting: the model's generation rate changes from day to day, and the
arms are interleaved receipt by receipt so that one day's rate applies to all of them.

## Records

Everything goes under `.bakeoff/`, which is git-ignored and **must stay so: it holds receipt
contents.**

```text
.bakeoff/input-modes/<arm>-r<rep>/<sample>.json     one model call: fields as printed, usage, latency
.bakeoff/input-modes/layout-r<rep>/<sample>.json    the ocr arm's layout call for that run
.bakeoff/input-modes/probe-…                        probe calls; counted in spend, never scored
.bakeoff/boxes/<sample>.json                        the box run
.bakeoff/report.json                                the scorer's numbers as data
```

## Scoring

The model copies values as printed. `normalize.ts` turns them into canonical values with the
parsers production uses, and `compare.ts` compares canonical values: amounts numerically, dates,
times, OIBs and currency exactly, JIR and ZKI ignoring case, other text ignoring case, spacing,
punctuation and diacritics. Scoring is per field instance. This is more lenient than
`npm run score:extraction`, so the reference line's numbers here are not the README's.

Ground truth is `.agents/fixtures/expected/<sample>.json` plus the additive keys in
`ground-truth/<sample>.json`. A key that is absent is not scored; a key that is `null` is scored,
and the arm must return nothing for it. `31231822` and `racun-mobilna-trgovina` have expected
values and no source file, so they are outside every arm.

`ground-truth/` holds values read from real receipts (business names, OIBs, fiscal identifiers).
