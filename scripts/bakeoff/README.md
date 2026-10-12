# Extraction measurements

Measurements beside the product: nothing here is imported by `api/`, `client/` or `shared/`, and
the application has no LLM. Three experiments share this harness.

| Experiment | Question | Plan | Result |
| --- | --- | --- | --- |
| Input modes (iteration 25) | OCR a document and give the text to an LLM, or hand the model the document itself? | `.agents/plans/input-modes-experiment.md` | `.agents/research/input-modes.md` |
| Plan B (iteration 27) | Do an LLM, in either of two shapes, or Content Understanding beat the production engine on the same receipts? | `.agents/plans/plan-b-llm-pass-content-understanding-measurement.md` | `.agents/research/plan-b-engines.md` |
| Scalar probe (iteration 28) | Can an LLM be a third reader of the scalar fields, in parallel with production and merged by a fixed rule (`scalar-merge.ts`)? | `.agents/specs/scalar-llm-reader-probe.md` | `.agents/research/scalar-llm-reader-probe.md` |

One `gpt-4.1` deployment, one system prompt, one field schema (`field-schema.ts`, schema v2: no
`subtotal`), one comparator, one ground truth.

## Plan B arms

Every arm is given the file the app would upload (see Inputs).

| Arm | What it is |
| --- | --- |
| `production` | The product's own provider (`createAzureProvider().extract`), called live: two Document Intelligence prebuilt models merged, the Croatian rules, the QR code's JIR |
| `ocr` | Document Intelligence `prebuilt-layout` markdown, as text, into the model, which returns every field |
| `repair` | The model is given production's OCR text and production's 14 scalar values and returns the scalars as printed. `repair.ts` then merges under three fixed policies (`fill`, `weak`, `all`); a value that is not on the page is never merged. Items, VAT rows, positions and confidences stay production's |
| `cu` | Azure AI Content Understanding, one custom analyzer (`receipt_planb_v2`) built from the same field schema |

## Input-mode arms (iteration 25)

Only the form of the document in the user message changes.

| Arm | The document is sent as |
| --- | --- |
| `ocr` | `prebuilt-layout` markdown, as text; the layout call is made fresh for every run |
| `images` | one image per page, `detail: high`; a PDF's pages are rendered at 150 DPI first |
| `files` | a PDF as a `file` part. Runs for the 2 PDFs only: for a photo it is the same request as `images` |
| `crops` | each page as overlapping horizontal bands, twice as wide as tall |

Its scorer replays the production engine from recorded fixtures as a reference line, at no cost,
on full-resolution files. Those runs asked for `subtotal` too; the scorer ignores it.

## Inputs

The app re-encodes a photo above 2 MP or 1.5 MB as a 1,600 px JPEG before upload
(`client/src/capture/downscale.ts`). Plan B gives every engine that file. `inputs.ts` applies the
rule in Node, but a browser resamples a large photo differently and the engines read the two
differently, so the scored runs used files made in Chrome:

```powershell
node scripts/bakeoff/browser-downscale.mjs
# in another terminal; the page's title becomes "done"
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --virtual-time-budget=60000 --dump-dom http://localhost:5180/
```

It writes `.bakeoff/plan-b/inputs/<sample>.jpg` for the photos the rule changes (four of thirteen),
and `inputs.ts` uses a file it finds there. Stop the server afterwards. The iteration 25 arms were
given the source files unchanged.

## Environment

Read from the root `.env`. None of these is read by the application at runtime except the two
Document Intelligence values, and none is listed in `.env.example`.

| Variable | From |
| --- | --- |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` | payslip-ocr's `.env` (the Foundry resource with the `gpt-4.1` deployment) |
| `AZURE_CONTENT_UNDERSTANDING_ENDPOINT`, `AZURE_CONTENT_UNDERSTANDING_KEY`, `AZURE_CU_API_VERSION` | payslip-ocr's `.env` (the same resource). Plan B only. Not `AZURE_CU_ANALYZER_ID`: the analyzer id is fixed in `content-understanding.ts` |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY` | already in this project's `.env` |

The `production` arm imports the product's provider, which loads `api/src/config.ts`, so the
Supabase variables must be present too.

Content Understanding needs a completion and an embedding deployment registered in the resource's
defaults. The runner checks, and registers one only if it is missing, merged with what is there.
An analyzer that exists and differs from the code stops the run; `--recreate-analyzer` rebuilds it
and makes every `cu` record stale.

## Commands

Run from `prototypes/receipt-ocr/`. A command that makes a paid call refuses to start without
`--confirm-spend`, prints an estimate first, and stops if the recorded spend plus that estimate
would pass the cap (`--cap=<usd>`; Plan B's default is 5 and counts `.bakeoff/plan-b/` only,
iteration 25's is 4).

```powershell
# Offline, free
node --env-file-if-exists=.env --import tsx --test scripts/bakeoff/normalize.check.ts scripts/bakeoff/compare.check.ts scripts/bakeoff/inputs.check.ts scripts/bakeoff/repair.check.ts scripts/bakeoff/content-understanding.check.ts
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score-plan-b.ts
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score-plan-b.ts --verbose
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-plan-b.ts --summary
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score.ts
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score.ts --verbose
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-input-modes.ts --summary
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-boxes.ts --summary
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-boxes.ts --draw=gradanin-gotovina-pos

# Paid: Plan B
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-plan-b.ts --tag=probe --reps=1 --only=gradanin-gotovina-pos,primjer-pdf-racuna,lira_trogir --confirm-spend
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-plan-b.ts --reps=3 --confirm-spend

# Scalar probe: offline, then paid (cap 5, counted together with Plan B's records)
node --env-file-if-exists=.env --import tsx scripts/bakeoff/score-scalar-probe.ts --verbose
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-scalar-probe.ts --summary
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-scalar-probe.ts --reps=3 --confirm-spend

# Paid: iteration 25
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-input-modes.ts --tag=probe --reps=1 --only=gradanin-gotovina-pos,primjer-pdf-racuna,lira_trogir --confirm-spend
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-input-modes.ts --reps=3 --confirm-spend
node --env-file-if-exists=.env --import tsx scripts/bakeoff/run-boxes.ts --confirm-spend
```

Other flags: `--only=<a,b>` limits the samples, `--force` redoes what is recorded, and for Plan B
`--arms=<a,b>` limits the arms. A call that fails prints `FAILED` and is not recorded, so running
the same command again fills the gap.

Run the three runs in one sitting: the services' speed changes from day to day, and the arms are
interleaved receipt by receipt so that one sitting's speed applies to all of them.

## Records

Everything goes under `.bakeoff/`, which is git-ignored and **must stay so: it holds receipt
contents.**

```text
.bakeoff/plan-b/production-r<rep>/<sample>.json     the provider's result, its metadata, QR and raw responses
.bakeoff/plan-b/layout-r<rep>/<sample>.json         the ocr arm's layout call for that run
.bakeoff/plan-b/ocr-r<rep>/<sample>.json            one model call: fields as printed, usage, latency
.bakeoff/plan-b/repair-r<rep>/<sample>.json         one model call: the 14 scalars as printed, usage, latency
.bakeoff/plan-b/cu-r<rep>/<sample>.json             one analysis: the operation verbatim, latency, submit attempts
.bakeoff/plan-b/probe-…                             probe calls; counted in spend, never scored
.bakeoff/plan-b/inputs/<sample>.jpg                 the file sent, for a photo the upload rule changes
.bakeoff/plan-b/report.json                         score-plan-b.ts's numbers as data

.bakeoff/scalar-probe/production-r1/<sample>.json   scalar probe: production, in the parallel run
.bakeoff/scalar-probe/text-<source>-r1/<sample>.json                   its layout or read call
.bakeoff/scalar-probe/llm-<source>-<deployment>-r<rep>/<sample>.json   one scalar-only model call

.bakeoff/input-modes/<arm>-r<rep>/<sample>.json     iteration 25: one model call
.bakeoff/input-modes/layout-r<rep>/<sample>.json    iteration 25: the ocr arm's layout call
.bakeoff/boxes/<sample>.json                        iteration 25: the box run
.bakeoff/report.json                                score.ts's numbers as data
```

## Scoring

A model copies values as printed. `normalize.ts` turns them into canonical values with the parsers
production uses, and `compare.ts` compares canonical values: amounts numerically; dates, times,
OIBs and currency exactly; JIR and ZKI ignoring case; a payment method by its category; names and
addresses ignoring case, spacing and punctuation **but not diacritics**. Scoring is per field
instance. This is more lenient than `npm run score:extraction`, which compares most fields exactly,
so production's numbers here are not the README's.

Ground truth (`truth.ts`) is `.agents/fixtures/expected/<sample>.json`, whose scalars the product
owner verified, plus what `ground-truth/<sample>.json` adds: line items, and the whole truth of the
one receipt with no expected file. **Line items and VAT rows are not verified**, and both scorers
say so until every `ground-truth/` file names who verified it (`verifiedBy`). A key that is absent
is not scored; a key that is `null` is scored, and the arm must return nothing for it.

15 samples. `0f089468f365211452db4ccf6e8da466` has no recorded fixture, so it is in Plan B and
outside `score.ts` and `npm run score:extraction`; it is the one receipt the production rules were
not written against. `31231822` and `racun-mobilna-trgovina` have expected values and no source
file, so they are outside every arm.

"On the page" (`repair.ts`, `isGrounded`) means the value is found among that run's OCR words as a
run of consecutive words, as the model copied it or in a printed form of its canonical value. It
decides which model values the repair policies may merge, and which wrong values count as invented.

`ground-truth/` holds values read from real receipts (business names, fiscal identifiers).
