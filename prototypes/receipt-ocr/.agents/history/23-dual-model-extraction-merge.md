# Iteration 23 — Dual-model extraction merge

**Date:** 2026-09-04
**Plan:** _none — the user asked for an investigation and a recommendation first, chose the approach, then asked for it to be built_
**Commit:** _pending human review_

## Why this iteration exists

The user reported that extraction quality is not production-ready, listed defects across seven
receipts, and observed in Document Intelligence Studio that `prebuilt-receipt` reads line items, the
transaction time and tax information better than the `prebuilt-invoice` model this prototype uses,
while the invoice model reads the receipt number and payment method better. Their proposal was to run
both models and take, per field, whichever value carried the **higher confidence**.

The motivating case was `lira_trogir.jpg`, where the app extracts three line items instead of four.

## What was measured, before anything was built

All 14 sample receipts were sent live to both models (28 calls), and every response was replayed
through the production mapper and scored against ground truth. Four strategies were compared.

| Strategy | Score over 91 ground-truth field readings |
| --- | --- |
| invoice only (what shipped) | 76/91 — 83.5% |
| receipt only | 67/91 — 73.6% |
| **confidence arbitration (the proposal)** | **73/91 — 80.2%** |
| **per-field precedence merge (built)** | **78/91 — 85.7%** |

**Confidence arbitration was rejected on evidence, and this is the iteration's main finding.** The
two models disagreed on 16 field readings. In **12** of them no comparable confidence existed at all,
because the correct value came from a deterministic text fallback that carries no confidence. In the
**4** where both models reported a confidence, the more confident model was the wrong one **every
time** — and all four were `sellerName`, where the receipt model is confidently certain that a
venue's trading name is the seller: `Kavana Wagner` @0.972 over `Milenij hoteli` @0.919, `CINIA`
@0.827 over `INA` @0.784, `Radionica Zagreb` @0.975 over `AMPER` @0.885, `Horvat` @0.961 over `Ana
Horvat` @0.946. Azure's confidences are per-model and uncalibrated; comparing them across models
compares two different scales.

The merge therefore uses a fixed per-field precedence derived from measured win rates: the invoice
model reads identity (seller 11/13 vs 7/13, document number 12/13 vs 7/13, PDF issue dates), the
receipt model reads the transaction (`TransactionTime` where the invoice model returns none, a
`TaxDetails` recap carrying the taxable base the invoice model's table geometry loses, and line items
whose columns stay on their own row).

## Two hypotheses tested and discarded

1. **That the user's defect list reproduces on current code. Most of it does not.** The deployed tree
   was verified byte-identical to local `HEAD`, and fresh live calls return the correct OIB, time,
   currency and VAT for `ina-racun-sladoled`, the time and all three VAT rows for `22559270`, the tax
   base for `receiptWithTaxMistake`, and JIR/ZKI/time for `racuntaksi1` — all fixed by iteration 21.
   Only two items on the list are live: `gradanin-gotovina-pos`'s VAT and `lira_trogir`'s items. Both
   are fixed by the receipt model, so the report led to the right place regardless.
2. **That client-side downscaling degrades extraction.** The app re-encodes images above 2 MP or
   1.5 MB to a 1,600 px long edge, which neither the fixtures nor the first recordings reflected. Only
   4 of the 14 samples are downscaled at all, and re-recording those against both models reproduced
   the same pattern. Downscaling is not implicated.

## What was built

`api/src/providers/document-extraction/merge.ts` merges two models' readings of one document.
`issueTime`, `vatBreakdown` and `items` take the secondary model first; every other field takes the
primary first; either model may fill a gap the other left empty. The two calls run concurrently, so
the wall clock is the slower call rather than their sum.

**The second model is strictly additive.** It can never blank a value the first model read, and a
failed or timed-out secondary call is logged and discarded, leaving the primary result intact.
`AZURE_DI_SECONDARY_MODEL_ID` set empty disables the second call entirely.

Both raw responses are retained. `raw_provider_result` keeps the primary operation at the top level,
so anything already reading `analyzeResult` still works, and adds `secondaryAnalyzeResult` and a
`fieldModels` map. `mapStoredSourceRegions` reads that map and outlines each field from the response
that supplied it — necessary because the two models index item and VAT rows independently, so
outlining a four-item list against the other model's three rows would point every highlight at the
wrong line.

### Three bugs the second model exposed

Each was masked by the single-model path and is fixed independently of model choice.

- **A time was padded with seconds the receipt never printed.** The mapper preferred Azure's
  normalized `valueTime` (`12:17` → `12:17:00`), violating this project's own documented rule that
  seconds are never padded on. The printed `content` now wins.
- **A document number could be the letter `a`.** The label pattern matches the `račun` inside
  `Datum izdavanja računa:`, whose trailing `a` satisfied the value group. Live on four receipts,
  invisible only because `InvoiceId` usually won first. A capture with no digit is now discarded.
- **`parseVatRate("25%:")` returned null.** A trailing colon defeated it — and that is exactly the
  format the receipt model's `TaxDetails` returns, so the taxable base went with it.

## Files created / modified

**Created** — `api/src/providers/document-extraction/merge.ts` and `merge.test.ts`,
`api/src/providers/document-extraction/fixtures/secondary/*.json` (14 receipt-model responses),
`api/src/providers/document-extraction/fixtures/lira_trogir.json`,
`.agents/fixtures/expected/lira_trogir.json`, this file.

**Modified** — `api/src/providers/document-extraction/{azure,azure-fields,croatian,receipt-amount,
source-regions,types}.ts` and their tests, `api/src/routes/receipts.ts`, `api/src/config.ts`,
`scripts/score-extraction.ts`, `.env.example`, `README.md`, `.claude/commands/validate.md`,
`.agents/ROADMAP.md`.

## Decisions made

- **Confidence is never compared across models.** Recorded above; `/validate` 6.22 now guards the
  reintroduction of this seductive and measurably wrong idea.
- **The invoice model stays primary.** It is the better of the two alone (83.5% vs 73.6%) and reads
  the fields a person is most likely to have to retype by hand.
- **`lira_trogir` was added to the corpus with ground truth, including its failures.** Its left edge
  is cropped in the photo, so OCR sees the labels `KI` and `IR` rather than `ZKI` and `JIR` and the
  identifier fallbacks cannot anchor. Recording it lowers the headline rates and is kept anyway,
  because a corpus of clean scans reports the health of the scans.
- **`items`, `subtotal` and `paymentMethod` remain unscored.** No ground-truth file has ever carried
  them, which is why "93% accuracy" said nothing about the very field the user reported. Scoring them
  needs a decision about matching OCR-faithful description text and was not smuggled into this
  change; it is the top follow-up.

## Deviations

None from what the user chose. The scope grew by the three bug fixes, which were discovered while
measuring and would otherwise have capped whichever model was chosen.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, exit 0 |
| `npm test` | Pass: 49 files, **490 tests** (13 new) |
| `npx oxlint .` | Pass for every file this change touches |
| `npm run score:extraction` | 16 fixtures scored; see below |
| `/validate` 6.19, 6.22, 6.23 | Pass |

Scored corpus, now 16 receipts and replaying the production merge rather than one model:

| Metric | Before (15, invoice only) | After (16, merged) |
| --- | --- | --- |
| Issue date | 15/15 | 15/15 |
| Total | 15/15 | **16/16** |
| Document number | 15/15 | 15/16 |
| Currency | 15/15 | 15/16 |
| Seller name | 14/15 | 14/16 |
| **Issue time** | 7/7 | **8/8** |
| VAT breakdown | 9/12 | 9/13 |
| No critical-field correction | 14/15 | 14/16 |

The two new denominators are `lira_trogir`, which is the hardest receipt in the set and was not
previously measured at all. On the two live-defect receipts the merge is decisive:
`gradanin-gotovina-pos` now matches ground truth on **all seven** fields, its VAT recap coming from
the secondary model; and `lira_trogir` gains its issue time, its VAT rate/base/amount and **all four
line items with correct quantity, unit price and total**, where the invoice model returned three rows
with one row's quantity attached to another's unit price.

**Not run, deliberately**, per the user's instruction to validate what the change implicates:
`npm run build` (no client code changed), Phase 7 integration and the Phase 8 browser journeys.

### Second session, 2026-09-14 — conflict resolution, quantity fix, pre-commit validation

This iteration was stashed and restored onto the committed PDF-highlighting work, which had also
been numbered 22; this one was renumbered to 23, and its `/validate` checks to 6.22 and 6.23. The two
had never been tested together, so everything below ran against the combined tree.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, exit 0 |
| `npm test` | Pass: 51 files, **515 tests** (498 combined, +17 for quantities) |
| `npm run build` | Pass; pdf.js still in its own lazy chunk |
| `npm run test:integration` | Pass against the **hosted** project: 27 tests, including the source-regions route this iteration changed |
| `npm run score:extraction` | Unchanged from the table above, as expected — items are unscored |
| `oxlint` on changed files | Pass |
| `prettier --check --end-of-line auto` on changed files | Pass, after reformatting one line of `merge.ts` |
| `/validate` 6.19–6.23 | Pass |
| **Live smoke test** | Both samples extracted through the real `createAzureProvider` against the S0 resource: `prebuilt-invoice` and `prebuilt-receipt` both answered, the secondary supplied `issueTime`, `items` and (on `gradanin-gotovina-pos`) the VAT recap, and `mapStoredSourceRegions` projected 17 and 26 regions across the two responses |

Still not run: the Phase 8 browser journeys. No live `lira_trogir` photo was available locally, so
its four-item outlines are proven by the fixture-based `source-regions.test.ts`, not in a browser.

### Third session, 2026-09-14 — the two regressions the smoke test found, measured and fixed

The second session committed and deployed with the smoke test's two findings listed as follow-ups.
The user rightly rejected that: the iteration's purpose was better accuracy **without** giving up
speed, so a possible regression in either is a blocker to measure, not a gap to note. Both were
investigated against the pre-iteration behaviour.

**Quantities: a real regression on 3 of 14 receipts, caused by taking `items` whole.** Replaying both
models' recorded responses showed the lists identical on 9 receipts, the receipt model better on 2
(`lira_trogir`; `26515835`, where the invoice model listed two subtotal lines as purchases), and the
invoice model better on 3 — both PDFs and the taxi screenshot, where the receipt model returns each
row's total with no quantity or unit price. Fix: `fillItemCells` borrows an empty cell from the other
model **only when both read the same rows** (equal length, equal line total per row), and records it
as `items.N.cell` in `fieldModels`; `mapStoredSourceRegions` now honours that per-path entry, so the
borrowed cell is still outlined from the response that read it. Corpus result: 104 → 111 item cells,
and no receipt loses a cell the invoice model alone produced other than the two false subtotal rows.

**Latency: not caused by the second model — a pre-existing polling defect the second model made
visible.** A live A/B (invoice-only vs both models, alternating order, all 14 samples) put the
combination at a median 8.3 s against 7.7 s — the difference entirely the doubled upload. But every
call waited a fixed ~7.1 s (invoice) or ~4.1 s (receipt) after upload regardless of document, while
Azure's own timestamps showed 1–3 s of analysis. `@azure/core-lro` replaces its `intervalInMs` with
the response's `retry-after`, and Azure sends `retry-after: 7` counting down (4 for the receipt
model). Polling every 250 ms showed results ready at 2.3–6.5 s and 1.8–4.0 s. Iteration 18 had
measured exactly this ("7.1 s polling") and adopted 8 s as the baseline without finding the cause.
Fix: `analyzeWithAzure` polls `analyzeResults/{resultId}` on its own 500 ms interval, and uploads raw
bytes instead of a base64 JSON body (a third smaller; the screenshot's upload went 8.0 → 5.7 s).

Measured live, before = the pre-iteration path (invoice only, SDK poller, base64), after = the
production provider, two rounds over all 14 samples:

| | Before | After |
| --- | --- | --- |
| Median | 8.0 s | **5.7 s** |
| p90 | 12.1 s | 11.5 s |
| Receipts faster | — | 13 of 14 |

The exception was the 3.5 MB 10 MP original (17.4 → 20.9 s), whose two concurrent uploads compete on
a home uplink; downscaled to the 1,600 px the client actually sends, three rounds went 9.1–9.8 s →
5.4–7.2 s. The receipt model contributed on all 31 "after" runs, which also exercised the new polling
code end to end against Azure.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 51 files, **518 tests** |
| `npm run score:extraction` | Identical to the table above on every scored field |
| `oxlint` / `prettier --end-of-line auto` on changed files | Pass |
| `/validate` 6.6, 6.22 | Pass |

Not re-run: `npm run test:integration`, which passed in the second session — this round changed no
route, and the regions route's integration case projects an empty stored result the change does not
touch.

**Two pre-existing failures found and deliberately not fixed**, because neither is caused by this
change and fixing them would bury it in unrelated diff:

- `npx oxlint .` fails on `client/src/capture/downscale.ts:13-14`
  (`unicorn(prefer-add-event-listener)`) — verified present on a clean tree. Repository-wide lint has
  been red since iteration 18, unnoticed because recent iterations lint only their changed files.
- `npm run format:check` reports **165 files** on a clean tree, a repository-wide line-ending
  mismatch: the files are CRLF on disk while Prettier's configured `endOfLine` expects otherwise.
  `prettier --check --end-of-line auto` passes. This needs one deliberate normalization commit.

### Fourth session, 2026-09-14 — independent validation and four fixes

The committed iteration was validated against its own documentation: typecheck, all 518 tests and
`score:extraction` reproduced the recorded results, and a live upload of `gradanin-gotovina-pos.jpg`
through the local stack was checked from storage to browser. It reached review in 6.8 s. Both
responses and `fieldModels` were stored, and the regions endpoint returned 26 outlines, 16 of them
projected from the secondary response. The review page drew all 26, and focusing the taxable base
raised the outline on the printed recap's `300,00`. Every item row matched the printed receipt. The
disposable user and its stored object were removed.

Replaying the fixtures also confirmed that the secondary's `issueTime` does not undo iteration 21's
taxi-receipt fix: the receipt model reads `racuntaksi1` as `23:59:47`.

Four defects were found and fixed:

- **A `failed` Azure operation had become non-retryable.** The custom poller mapped it to
  `provider_rejected`, which the UI presents as "upload another receipt" with no Retry. The SDK poller
  it replaced threw on `failed`, which the provider classified as retryable `provider_unavailable`.
  Restored, with a test.
- **A stalled secondary delayed every extraction to the full timeout.** Both calls shared one abort
  controller and the result awaited both, so a hung receipt-model call cost up to 60 s on Render. The
  secondary now has its own controller, still aborted by the overall timeout, and is abandoned
  `SECONDARY_GRACE_MS` (10 s) after the primary returns. Tested with fake timers. 5 s was first
  proposed and rejected by the user: it was reasoned from analysis times rather than measured, and a
  too-short grace silently discards the secondary's fields, while a long one costs latency only when
  a call genuinely stalls. The actual gap between the two calls' completions is unmeasured.
- **The README's setup silently disabled the second model.** `.env.example` ships
  `AZURE_DI_SECONDARY_MODEL_ID=` blank, and `??` treated blank as "disabled". Blank now means the
  default, as it does for `AZURE_DI_MODEL_ID`; `none` disables the call. Render sets the value
  explicitly, so production was never affected.
- **The README contradicted the score.** It said JIR/ZKI "1 of 2" beside "1 of 3", described three VAT
  misses where there are four, and quoted p95 5 s where the harness reports 8 s. It also omitted that
  2 of the 16 scored receipts have no secondary fixture and are scored invoice-only.

Rewriting the VAT paragraph from the actual per-receipt misses corrected this file's own "VAT 9/12 →
9/13" reading. `inareceipt`'s inline recap is now read by the secondary, but its rate is dropped
because the receipt model returns `25%)`, a trailing-punctuation case the `25%:` fix did not cover.
`receiptWithTaxMistake` moved from a match to a formatting miss (`25` against ground truth `25.00`,
for a receipt that prints `25%`).

**The `25%)` rate was then fixed at the user's request.** The `25%:` fix had stripped only a trailing
`%`/`:` in the shared amount cleaner. Generalizing it there was rejected, because a trailing `)` is
meaningful to money: `(12,50)` is a negative amount. Instead `parseVatRate` cuts the value at its
percent sign, since nothing after `%` belongs to a rate. `score:extraction`: VAT breakdown **9/13 →
10/13**, with `inareceipt` fully matching; every other field unchanged. The grace period, first set to
5 s, was raised to 10 s at the user's direction (see above).

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npx vitest run --project api` | Pass: 20 files, **195 tests** (+3); full `npm test` was 518 before the change |
| `npm run score:extraction` | VAT breakdown 10/13 (was 9/13); all other fields unchanged |
| `oxlint` / `prettier --end-of-line auto` on changed files | Pass |
| Config resolution | Unset and blank → `prebuilt-receipt`; `none` → disabled; a custom id passes through |
| `/validate` 6.6 | Pass |

Not re-run: `npm run build` (no client change) and integration tests (no route change).

## Known gaps / follow-ups

- ~~**`inareceipt`'s VAT rate is dropped** because the receipt model returns `25%)`.~~ **Resolved in
  the fourth session.**
- **The gap between the two models' completion times is unmeasured**, so `SECONDARY_GRACE_MS` (10 s)
  is a judgement, not a measurement. Large uploads, which compete for one uplink, are the likeliest
  case to exceed it; a secondary cut short only logs a warning, so it would lose accuracy silently.

- ~~**A quantity of `3,000` is read as `3000`, not `3`.**~~ **Resolved 2026-09-14, and not by the
  locale rule proposed here.** The corpus disproved that rule: `screenshot-20190705-1907152` prints
  the same three-decimal quantity with a **dot** (`1.000` beside a line total of `1.00`), which a
  "comma is decimal on Croatian receipts" rule would leave broken — and in Croatian grouping a dot
  *does* mean thousands. The real distinction is the field, not the locale: no receipt prints money
  to three decimals, while POS systems routinely print quantities that way, and the corpus holds four
  three-decimal quantities against zero thousands-grouped ones. `shared/src/quantity.ts` adds
  `parseQuantity`, which reads that one ambiguous shape as a decimal and otherwise defers to
  `parseAmount`, whose money behaviour is untouched. It lives in `shared` because **the review form
  had the same bug on save**: `toPatch` sent a quantity back through `parseAmount`, so even a
  correctly extracted `3.000` would have become `3000` the first time the user pressed Save. Receipts
  already stored with a wrong quantity are not backfilled.
- ~~**The Azure resource is on the F0 free tier**, which rate-limited the recording run repeatedly
  (`429`, retry-after 1–15 s). Two calls per receipt will throttle in production; this needs S0
  pay-as-you-go.~~ **Resolved 2026-09-14:** the resource was moved to S0. Verified by behaviour
  rather than by portal access: a 3-page PDF sent to `prebuilt-read` returned all 3 pages, where F0
  analyses only the first 2. This checks the key in the local `.env`; Render's API service must use
  the same resource for the deployment to benefit. The degrade-safely path stays — a throttled
  secondary call is still dropped and the primary result stands.
- **`items`, `subtotal` and `paymentMethod` have no ground truth**, so the headline score still says
  nothing about them.
- **`lira_trogir`'s JIR, ZKI, seller OIB, document number and currency are all missing.** The photo
  crops the label column, and neither model returns an `InvoiceId` at full resolution — though the
  downscaled variant's invoice call did return both the document number and the OIB, which suggests
  resolution affects field detection in ways worth a separate look.
- **`inareceipt`'s JIR/ZKI remain OCR-corrupted** and `primjer1-hr-nopdv`'s 0%-VAT recap still has no
  agreed canonical mapping — both carried over from iteration 21.
- ~~**Taking `items` whole from one model can drop the other's quantities.**~~ **Resolved in the
  third session below.**
- ~~**Wall-clock extraction took 10.8 s and 14.9 s.**~~ **Resolved in the third session below —
  extraction is now faster than before this iteration.**
- **Upload remains the variable part of latency.** Both models still upload the document separately;
  Azure offers no way to analyse one upload with two models. A `urlSource` pointing at the stored
  object would remove the API's upload entirely but make the Azure call wait for the Storage write,
  which iteration 18 deliberately runs concurrently. Not measured; only worth it if production uploads
  from Render prove slow.
