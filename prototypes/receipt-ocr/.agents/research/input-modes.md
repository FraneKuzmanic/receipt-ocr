# OCR text or the document itself: what should the model be given? (receipts)

**Date:** 2026-10-08
**Question (product owner's manager):** does OCR first, then an LLM over the text, give better or
worse results than handing the original file to a multimodal LLM? Measured for input tokens,
latency, extraction accuracy and cost.
**Why again:** it was answered on 11 payslips the same day
(`prototypes/payslip-ocr/.agents/research/input-modes.md`, branch `prototype/payslip-ocr`). This
repeats it on receipts to see whether the findings hold on a second document type.
**Harness:** `scripts/bakeoff/` (see its `README.md`). Records in `.bakeoff/` (git-ignored).

> **The ground truth is not verified.** The extended ground truth (`scripts/bakeoff/ground-truth/`)
> was drafted by the agent from the receipt images and has not been checked by the product owner.
> Three questions about it are open (see Limits). Every number below is subject to that.

## Method

14 receipts (12 photos or screenshots, 2 single-page PDFs), three times each, through one
`gpt-4.1` deployment (chat completions `2024-10-21`, temperature 0, strict JSON schema). One system
prompt and one 17-field Croatian schema for every arm; the model is told to copy each value as
printed, and the harness normalises it with the parsers production uses. Only the user message
differs:

| Arm | The document is sent as |
| --- | --- |
| `ocr` | DI `prebuilt-layout` markdown as text. The layout call was made fresh for every run and its time and price are part of the arm |
| `images` | one image per page, `detail: high`; the PDFs' pages rendered at 150 DPI |
| `files` | the PDF as a `file` part. **Run for the 2 PDFs only**: for a photo it is the same request as `images` |
| `crops` | each page as overlapping horizontal bands, twice as wide as tall (3–6 bands a receipt), with one sentence saying so |
| `di` | reference: the production engine (`prebuilt-invoice` + `prebuilt-receipt`, merged, plus the Croatian rules), replayed from recorded fixtures. No call, no cost, one run |

The arms ran interleaved, receipt by receipt, sequentially, in one sitting (13:42–14:12), with the
arm that goes first rotating. 132 model calls and 42 layout calls; none failed, none was throttled.
A 10-call probe on three receipts ran first and is not scored.

Scoring is per field instance against `.agents/fixtures/expected/` plus the additive ground truth:
amounts numerically, dates, times, OIBs and currency exactly, JIR and ZKI ignoring case, other text
ignoring case, spacing, punctuation and diacritics. This is more lenient than
`npm run score:extraction`, so the `di` numbers here are not the README's.

## Results

Ranges are over the three runs.

| | `di` (reference) | `ocr` | `images` | `crops` |
| --- | --- | --- | --- | --- |
| Scalar fields (of 141) | 124 | **134** | 117–119 | 129–130 |
| Critical fields (of 70) | 66 | **67** | 60–61 | 65 |
| Fiscal: OIB, JIR, ZKI (of 38) | 33 | **35** | 25–27 | 31–32 |
| Time, subtotal, payment method (of 33) | 25 | 32 | 32 | **33** |
| VAT cells (of 36) | **35** | **35** | 24 | 32 |
| Item cells (of 175) | **167** | 160 | 139–145 | 158–159 |
| Item row count exact (of 13 receipts) | 13 | 12 | 12–13 | 13 |
| Receipts needing no critical correction (of 14) | **12** | 11 | 8–9 | 11 |
| Scored values that differ between runs | – | 0 | 28 | 4 |
| Input tokens, median per receipt | – | 2,235 | 2,318 | 4,931 |
| Output tokens, median per receipt | – | 289 | 339 | 370 |
| Latency p50 / p90 | 5.7 s median (README, another day) | 8.8 / 54.5 s | 7.2 / 9.3 s | 8.0 / 11.7 s |
| Model call alone, p50 | – | 5.2 s | 7.2 s | 7.7 s |
| Cost per receipt, as billed (cached input) | – | $0.0143 | $0.0048 | $0.0071 |
| Cost per receipt, without caching | – | $0.0170 | $0.0078 | $0.0120 |

`files`, on the 2 PDFs only (three runs, identical): 21/21 scalars, 8/8 item cells, 2,972 input
tokens, 5.4 s, $0.0038.

By source:

| | `di` | `ocr` | `images` | `files` | `crops` |
| --- | --- | --- | --- | --- | --- |
| 2 PDFs: scalars (of 21) | 21 | 21 | 21 | 21 | 21 |
| 2 PDFs: item cells (of 8) | 7 | 7 | 7 | 8 | 8 |
| 5 photos the service shrinks: scalars (of 52) | 42 | 51 | 48 | – | 50 |
| 5 photos the service shrinks: VAT cells (of 12) | 12 | 12 | 12 | – | 12 |
| 5 photos the service shrinks: item cells (of 44) | 38 | 32 | 34–36 | – | 37 |
| 7 photos it does not: scalars (of 68) | 61 | 62 | 48–50 | – | 58–59 |
| 7 photos it does not: VAT cells (of 24) | 23 | 23 | 12 | – | 20 |
| 7 photos it does not: item cells (of 123) | 122 | 121 | 98–102 | – | 113–114 |

"The service shrinks" means a short side above 768 px, the size `detail: high` scales an image to.
Five photos are above it and seven are below (328–632 px wide).

## What it shows

- **OCR first is the most accurate LLM arm on every group but one, and the only stable one.** It
  repeats itself exactly across three runs (0 scored values differ), where the whole image differs
  on 28.
- **A whole photo is the worst, and its errors are inventions, not formatting.** On
  `ina-racun-sladoled` (328 px wide) it returned the kuna line as the total (`136,68`, `kn`), a VAT
  rate of `14,5%`, and item names that are not on the receipt (`SLAD.KOKO`, `SLAD.LIDL Keks`),
  different ones in different runs. On `receipt123` it returned the document number `381/3/2017`,
  which is not on the receipt and begins like the schema's own example (`381/1/3`). Its JIR and ZKI are right on 7–8 of 12.
- **Bands close most of the gap, but not for the payslip reason.** `crops` recovers 12 of the 16
  scalar fields the whole image loses to OCR, and most of the VAT and item cells. But the gain is
  on the seven *small* photos (scalars 48–50 → 58–59 of 68), which the service does not shrink and
  where a band holds the same pixels as the whole image. On the five large photos, where bands do
  add resolution, the whole image was already close (48 against 50 of 52). So on receipts the
  benefit of bands is not explained by resolution.
- **The LLM arms beat the production engine on scalars, and lose to it on line items.** The scalar
  lead is almost all one field: payment method, which production reads on 6 of 14 and every LLM
  arm on 13–14. Without it, `di` is 118 of 127 and `ocr` 121. On item cells production is ahead
  (167 against 160), and it needs no critical correction on 12 receipts against 11.
- **OCR errors pass straight through the `ocr` arm.** Where the layout OCR misreads a character
  (`inareceipt`'s JIR and ZKI, `receipt123`'s seller line `fte bars`), the model copies the misread;
  its result there is identical to production's.
- **Input tokens: the same, not lower.** A receipt is about 500 tokens as text and about as much
  as one image; roughly 1,800 tokens of every request are the schema and rules. Bands cost twice
  the tokens.
- **Latency: the whole image is about 1.5 s faster at the median.** The model answers text in
  5.2 s and an image in 7.2 s; the layout call adds 2.3–2.7 s to the `ocr` arm.
- **The `ocr` arm inherits the OCR service's bad minutes.** In run 2, seven consecutive layout
  calls took 15 s to 260 s to analyse (uploads were normal, under 0.3 s). Runs 1 and 3 had none
  above 4.5 s; their `ocr` p50 / p90 is 8.4 / 10.7 s. No model call in any arm took over 15 s.
- **Cost: a whole image is a third of OCR first** as billed, and under half without caching. The
  $0.01 a page for layout is two thirds of the `ocr` arm's cost.

## Can the model say where a value is?

One run, every page as an image, and for each of the 15 scalar fields the value, its page and a
box in thousandths of the page; each box judged against where the layout OCR words (run 1) put
that value, the nearest occurrence counting.

| | Boxes judged | Centre on the value's text | Any overlap | IoU ≥ 0.5 | Median miss |
| --- | --- | --- | --- | --- | --- |
| All | 118 | 4 (3%) | 12 (10%) | 0 | 3.8 text heights down, 20% of the page across |
| 2 PDFs | 20 | 2 (10%) | 4 (20%) | 0 | 1.7 text heights, 6% |
| 12 photos | 98 | 2 (2%) | 8 (8%) | 0 | 6.0 text heights, 22% |

37 further values are not among the page's words and could not be judged. Drawn on
`gradanin-gotovina-pos` and `primjer-pdf-racuna`, the model's boxes sit near the right region of
the page but on the wrong line or in blank space, while the OCR positions sit on the values: the
measurement is right and the boxes are not usable.

## Did each payslip finding hold on receipts?

| # | Payslip finding | On receipts |
| --- | --- | --- |
| 1 | Accuracy order: `ocr` > `crops` > `files` > `images` | **Held** for `ocr` > `crops` > `images` (scalars 134 / 129–130 / 117–119). `files` cannot be placed: it applies to two PDFs, which every arm read perfectly |
| 2 | Bands close most of the gap because of resolution | **The effect held, the explanation did not.** Bands close most of the gap, but on the small photos where they add no resolution |
| 3 | A native PDF sent as a file scores like OCR | **Cannot be told.** Two clean one-page PDFs; all arms scored 21 of 21 scalars |
| 4 | A whole page costs fewer input tokens than its OCR text | **Did not hold.** About equal (2,318 against 2,235): a receipt has little text |
| 5 | Latency: no difference for a whole page | **Roughly held.** The whole image is about 1.5 s faster at the median (7.2 against 8.8 s) |
| 6 | Cost: a whole page is about half | **Held, more strongly.** About a third as billed ($0.0048 against $0.0143) |
| 7 | Asked for boxes, the model returns none usable | **Held.** 0 of 118 with IoU ≥ 0.5 |

In one sentence: on receipts, as on payslips, OCR first is the more accurate and the only
repeatable way to give the document to this model; handing it the photo is cheaper and slightly
faster and reads noticeably worse, inventing values on small or poor photos.

## Limits

- **Ground truth not verified**, and three questions are open:
  1. Two expected seller names are the venue (`caffe bar ANTIQUE`, `Lira Trogir`) where the schema
     asks for the company. On `lira_trogir` `ocr` and `crops` returned the company
     (`Obrt Lira vl. Lidija Radevenjić`) and are scored wrong.
  2. `receipt123`'s second VAT rate is expected as `0.3`; the receipt prints `3,00`, which `di`,
     `ocr` and `crops` all returned and are scored wrong for.
  3. `screenshot-20190705-1907152`'s first item is drafted as quantity `200.000` at `1.00`; every
     engine returned quantity 1 at 200.
  Deciding these the other way moves each affected arm by one to two values and does not change
  the order of the arms.
- 14 receipts, one model, three runs. A difference of one or two values is not a result.
- Two PDFs, one page each: the PDF split says almost nothing.
- **The `di` reference was tuned on these same 14 receipts** (iterations 18, 21, 23, 24); the LLM
  arms saw them cold. Payment method, where it does worst, had never been scored before.
- `31231822` and `racun-mobilna-trgovina` have expected values and no source file, so they are
  outside every arm.
- `sellerAddress` and the three buyer fields were asked for and are not scored (no ground truth).
  Item descriptions and some cells are left out of ground truth where the agent could not read
  them; each file's `notes` says which.
- The arms got the stored source files. The app downscales photos above 2 MP to 1,600 px before
  upload, which applies to `lira_trogir` and `receiptWithTaxMistake`.
- One band shape, not tuned. Why bands help on small photos was not investigated.
- `di` latency was not re-measured; 5.7 s is the README's median from 2026-09-14.
- Prices are list prices: gpt-4.1 $2.00 / $0.50 cached / $8.00 per 1M tokens, layout $0.01 a page.
- Direct input returns no confidence and no usable position, so it could not draw the review
  screen's source outlines whatever its accuracy.
- The comparator is more lenient than `npm run score:extraction`.

## What was changed after seeing results

- **The field schema was not changed** after the first paid call. One description was reworded
  before any call: `subtotal`'s alias `Međuzbroj` (a running total including VAT) became
  `Ukupno bez poreza`.
- **The normaliser was changed once, after the runs**, because it was marking down correct
  readings for how they were copied: an OIB with its label (`OIB: 62357811032`), a number with its
  unit or tax code (`1,00 kom`, `2,79 D1`, `0,95 EUR/kg`), a month-first date on the one US receipt
  (`02/24/17`), and `$`. The first scoring had `ocr` at 128 scalars and `crops` at 142–143 item
  cells; after the fix 134 and 158–159. `images` moved least (116–118 → 117–119 scalars). The
  check digit of an OIB is still verified, and an ambiguous date is still read day first.

## Spend

From the recorded `usage` and page counts, at list price:

| | Model calls | Model | Layout pages | Layout | Total |
| --- | --- | --- | --- | --- | --- |
| Probe | 10 | $0.08 | 3 | $0.03 | $0.11 |
| Three runs | 132 | $0.70 | 42 | $0.42 | $1.12 |
| Box run | 14 | $0.09 | – | – | $0.09 |
| **All** | 156 | $0.87 | 45 | $0.45 | **$1.32** |

Against a cap of $4. The model calls are on the payslip project's Foundry resource; the layout
calls are on this project's Document Intelligence resource.

## Harness

`scripts/bakeoff/`: `samples.ts`, `field-schema.ts`, `normalize.ts`, `compare.ts`, `model-input.ts`,
`layout.ts`, `ground.ts`, `spend.ts`, `run-input-modes.ts`, `run-boxes.ts`, `score.ts`, two
`.check.ts` files (15 checks) and `ground-truth/` (14 files). `model-input.ts`, `ground.ts` and the
two runners are ported from payslip-ocr's harness. Nothing under `api/`, `client/` or `shared/`
changed, and `npm run score:extraction` prints the same output as before.
