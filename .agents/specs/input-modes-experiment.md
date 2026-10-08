# Handoff — the input-mode experiment, repeated on receipt-ocr

**Written:** 2026-10-08, by the session that ran it on payslip-ocr
**For:** the agent that runs it here
**Status:** not started. Nothing below is built in receipt-ocr yet.

## The question

The product owner's manager asked: is it better to OCR a document first and give the text to an
LLM, or to hand the original file to a multimodal LLM? Measure four things for each: **input
tokens, latency, extraction accuracy, cost**.

It was answered for payslips. The product owner now wants the same experiment on receipts, to see
whether the findings hold on a second document type. Payslips are dense tables in small print,
the hardest case for reading pixels; receipts are short, larger print, and often bad photos.

## What payslip-ocr found (11 documents, `gpt-4.1`, three runs per arm)

| | `ocr` | `images` | `files` | `crops` |
| --- | --- | --- | --- | --- |
| Scalar fields (of 273) | 272–273 | 235–238 | 247–248 | 266–268 |
| Pay-component cells (of 180) | 179 | 64–84 | 112–114 | 157–169 |
| Other table cells (of 188) | 165–167 | 117–120 | 132–133 | 177–180 |
| Input tokens, median per document | 6,417 | 5,449 | 5,449 | 9,592 |
| Latency p50 | 9.6 s | 10.4 s | 10.0 s | 11.3 s |
| Cost per document, as billed | $0.026 | $0.012 | $0.012 | $0.017 |

- OCR first is the most accurate. A whole page as one image is far worse; the page as
  higher-resolution bands closes most of the gap, so **resolution was most of it**.
- A native PDF sent as a file scores like OCR, because the service reads its text layer.
- Asked for a bounding box per value, `gpt-4.1` returned 0 usable boxes of 232.

Full record, method and limits: `prototypes/payslip-ocr/.agents/research/input-modes.md` on branch
`prototype/payslip-ocr`. Read it before designing anything.

## The four arms

Same model, same system prompt, same field schema, same request settings. Only the form the
document takes in the user message changes.

| Arm | The document is sent as |
| --- | --- |
| `ocr` | DI `prebuilt-layout` markdown, as text |
| `images` | one image per page, `detail: high`; PDF pages rendered at 150 DPI first |
| `files` | the source file as it is: a PDF as a `file` part, an image as an image |
| `crops` | each page as overlapping horizontal bands, twice as wide as tall, with one sentence saying so |

For an image source `images` and `files` are the same request. They differ only for PDFs.

The bounding-box test is a separate, single run: every page as an image, and for each scalar
field the value, page and a box; each box judged against where the OCR words put that value.

## What to reuse

On branch `prototype/payslip-ocr`, under `prototypes/payslip-ocr/scripts/bakeoff/`:

| File | What it is |
| --- | --- |
| `model-input.ts` | The request (`complete`), `imagePart`, `renderPdfPages`, `pageBands`. Port as is, minus the payslip system prompt |
| `run-input-modes.ts` | The runner: arms interleaved per sample, records per arm and run, a tokens/latency/cost summary split by source kind |
| `run-boxes.ts` | The box test and its judging (IoU, centre on text, miss distance) |
| `run-layout.ts` | The `prebuilt-layout` call that produces the markdown and word polygons, cached |
| `ground.ts` | Finds a value among OCR words; the box test's ground truth |
| `score.ts` | The payslip scorer. Its `matches` (amounts to the cent, diacritic-insensitive text) is the comparison rule to keep |

**These files are uncommitted at the time of writing.** If they are not on the branch, they are in
that working tree; ask the product owner to commit them before switching branches, because the
modified tracked files there (`package.json`, `score.ts`) block a checkout.

## An overlapping plan already exists: read it first

`.agents/plans/content-understanding-bakeoff.md` (654 lines, not executed: there is no
`scripts/bakeoff/` here yet) plans a different experiment, Content Understanding against the
current DI pipeline, over the same receipts. Its foundations are the ones this experiment needs:

| Its task | What it gives this experiment |
| --- | --- |
| 1, `samples.ts` | The sample table: 14 receipts with a source file |
| 2, `field-schema.ts` | The Croatian receipt field schema, 17 fields with descriptions |
| 5, `compare.ts` | The field comparator and score aggregation |
| 8, `ground-truth/` and `score.ts` | Ground truth extended to items, subtotal, payment method, OIB, JIR, ZKI, which today are barely scored |
| 9, GATE A | The product owner checks the extended ground truth and approves the spend before any paid call |

Build those once and use them for both experiments. Do not write a second schema or a second
comparator: two schemas would make the two experiments' numbers incomparable. Ask the product
owner whether the two experiments run as one piece of work or one after the other.

## What is different here, and must be built

1. **receipt-ocr has no LLM.** Its engine is two Document Intelligence prebuilt models,
   `prebuilt-invoice` and `prebuilt-receipt`, merged per field (history/23). There is no prompt,
   no field schema with descriptions and no `scripts/bakeoff/`. So every LLM arm is new here, and
   **the production engine is the reference line**, the role Content Understanding had for
   payslips. Its scores come from `npm run score:extraction` at $0.
2. **A field schema with Croatian descriptions has to be written** (the plan's Task 2), from
   `shared/src/receipt.ts` (`canonicalReceiptFieldsSchema`): seller and buyer name, address and
   OIB; `documentNumber`, `issueDate`, `issueTime`; `subtotal`, `total`, `currency`,
   `paymentMethod`, `jir`, `zki`; and the tables `vatBreakdown` and `items`. The payslip bake-off
   found the wording of these descriptions is the highest-leverage thing in the pipeline, and one
   ambiguous description cost more than a weaker model. Write it once, before any run, and use the
   identical schema in all four arms. Do not tune it against one arm's output.
3. **A scorer for LLM-shaped output** (the plan's Tasks 5 and 8). `scripts/score-extraction.ts` only replays recorded DI
   responses through the production mapper. The golden set is `.agents/fixtures/expected/*.json`
   (16 files, canonical values: ISO dates, decimal strings). Score per field instance, report
   critical fields (`sellerName`, `documentNumber`, `issueDate`, `total`, `currency`) apart, and
   score `vatBreakdown` and `items` cells apart from scalars. A fixture that goes unscored must
   fail the run, not be skipped.
4. **No Azure OpenAI configuration.** receipt-ocr's `.env` has only the Document Intelligence
   endpoint and key. The `gpt-4.1` deployment is on the payslip project's Foundry resource:
   `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`,
   `AZURE_OPENAI_API_VERSION` in `prototypes/payslip-ocr/.env`. Ask the product owner before
   copying them; never print or commit them.
5. **The source files are local only**: `.agents/fixtures/receipts/`, git-ignored, 14 files
   (12 images, 2 PDFs: `primjer-pdf-racuna.pdf`, `primjer1-hr-nopdv.pdf`). Two fixtures,
   `31231822` and `racun-mobilna-trgovina`, have expected values and no source, so they are
   outside this experiment; say so in the report rather than dropping them silently. With only
   two PDFs, the PDF-against-photo split will say little about PDFs here.

## Decisions to make with the product owner before spending

- How this relates to the Content Understanding bake-off plan (above).
- Whether the `ocr` arm's layout call is run fresh. On payslips its time and price were taken
  from a recording three weeks old, which the write-up had to state as a limit. A fresh call per
  run is the cleaner comparison; it costs DI's layout price per page.
- The budget and the number of paid runs. The payslip experiment cost about $1.98 in model calls
  for 143 calls. The Azure resource runs on limited student credit: estimate before each paid
  run, record every run and a running total, and ask before going past what was agreed.

## Things learned the hard way

- **PDF file input works on chat completions** at `2024-10-21`:
  `{ type: "file", file: { filename, file_data: "data:application/pdf;base64,…" } }`. The service
  passes the text layer plus a picture of each page, so it is not a vision-only test.
- **HEIC is not accepted as an image.** Send a JPEG.
- **Image tokens are low.** A whole page is roughly 700–1,000 tokens, because the service scales
  it to about 768 px on its short side. That is also why whole-page accuracy was poor.
- **The schema and rules are most of the input** (about 4,400 of 6,400 tokens on payslips) and
  are served from the prompt cache after the first call. Report cost both as billed and without
  caching.
- **An image request is slower per call than a text one** (first token 1.7 s against 0.7 s, and
  slower per token), which cancelled the time saved by skipping OCR.
- **Runs of one arm differ by 1–2 fields.** Three runs per arm; a smaller difference is not a
  result.
- **The generation rate changes from day to day**, so run the arms interleaved, sample by sample,
  in one sitting. `crops` was run a few hours after the others on payslips, and its latency is
  less comparable for it.
- **Check the scorer before trusting a low score.** The payslip scorer could not read a period
  the schema asked to be copied as printed, which would have penalised two arms. Read a few wrong
  values by eye for every arm.
- **Check the box test by drawing it.** The first result was 0 of 19; drawing the model's boxes
  and the OCR positions on the page showed the measurement was right and the model wrong.
- `@napi-rs/canvas` and `pdfjs-dist` render and crop in Node. pdfjs-dist installs the canvas; it
  is not a declared dependency.

## Report

Write the result to `.agents/research/input-modes.md` here, in the shape of the payslip record:
method, the results table over runs, the split by source kind (PDF against photo), what it shows,
limits, spend, and what changed in the harness. Then state plainly, for the manager, whether each
payslip finding held on receipts: accuracy order of the arms, the resolution effect, the PDF
effect, tokens, latency, cost, and boxes.

## Rules that apply

- `CLAUDE.md` in this directory, and this project's task workflow.
- Do not commit, push or deploy unless the product owner asks. `github` is this project's mirror
  and drives its live deploy; `origin` is Azure DevOps.
- No change to `api/`, `client/` or `shared/`. This is a measurement beside the product.
- `.agents` is git-ignored at the repository root; a new file under it needs `git add -f`.
