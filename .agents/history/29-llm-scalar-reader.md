# Iteration 29 — An LLM as a third, parallel reader of scalar fields

**Date:** 2026-10-12
**Plan:** `.agents/plans/llm-scalar-reader.md` (handoff: `.agents/specs/llm-scalar-reader.md`)
**Commit:** _pending human review_
**Evidence the decision rests on:** `.agents/research/scalar-llm-reader-probe.md`

This is the first iteration that puts an LLM in the application. It amends PRD §4.7, §7.6, §8 and
ROADMAP §5 rule 10 in place.

## What was built

Every upload is now read a third time, for the 14 scalar fields only. `prebuilt-read` OCR text
goes to a `gpt-4.1` deployment on Azure OpenAI, which copies the fields as printed. The reader
starts with the two prebuilt models and is merged on the server, before `review`, by the fixed
per-field rule the probe measured. It is additive: off, failed, malformed or more than 3 s behind
the two-model result, it is logged and the two-model result is stored unchanged. With its four
variables absent the application behaves as it did before.

Beyond the values: agreement with the reader clears a low-confidence flag; a disagreement on an
exact-valued critical field raises the ordinary amber hint; a reader-supplied value is outlined
where its text is found among the reader's own OCR words; a buyer the reader cleared loses its
outline. No client file changed and no translation key was added.

## Files created / modified

**API, created** — `providers/document-extraction/`: `scalar-reader.ts`, `scalar-merge.ts`,
`word-search.ts`, each with its `.test.ts`; `fixtures/reader/*.json` (14).
**API, modified** — `providers/document-extraction/{azure,types,source-regions}.ts` and the
`azure` and `source-regions` tests; `config.ts`; `app.ts`; `index.ts`; `routes/receipts.ts` and
its test.
**Shared** — `receipt.test.ts` (the vocabulary guard).
**Scripts** — `score-extraction.ts` (`--reader`); new `bakeoff/product-parity.check.ts`;
`bakeoff/ground-truth/amelie-receipt.json` (marked verified).
**Configuration and docs** — `.env.example`, `render.yaml`, `PRD.md`, `README.md`,
`.claude/commands/validate.md`, `.agents/ROADMAP.md`, this file.

`.agents` is git-ignored at the monorepo root: this file needs `git add -f`. The plan was added in
the previous commit.

## Decisions made

The plan's settled decisions were implemented as written. Taken during execution:

- **`FLAGGED_DISAGREEMENT_FIELDS` is the plan's narrower list** (`documentNumber`, `issueDate`,
  `total`, `currency`), without `sellerName`. **Q12 is still the product owner's to confirm.**
- **The reader's errors never quote what was sent or received.** Beyond the plan's HTTP-status
  rule, a non-JSON answer and a schema failure are replaced by the fixed phrase
  `scalar reader: malformed answer`: a JSON syntax error's own message quotes the text it failed on.
- **`agreed` is computed on the reader's canonical value**, for every non-locked scalar including
  the buyer and reader-first fields.
- **`envelope` moved from `source-regions.ts` to `word-search.ts`** and is imported back, to avoid
  an import cycle; its body is unchanged.
- **`printedForms` lists fewer forms than the harness's `surfaceForms`.** The search key drops
  every character that is not a letter or digit, so the separator variants of a date or an amount
  collapse to one key.
- **The reader fixtures were formatted with Prettier**, as the existing fixtures are.
- **`scalarReaderConfigured()`** reads `config`; `index.ts` logs it on the startup line.

## Deviations from the plan

- **Task 0 was done by the agent.** Iterations 27 and 28 were committed as `7ad2388` and pushed
  with `git push github prototype/receipt-ocr` only (no subtree push, never `origin`), as decision
  Q1 says. `/execute` otherwise forbids committing; the plan's explicit task was followed, and the
  conflict was raised in the priming report before the run.
- **`agent-browser open` hung again** (90 s, no output). The browser run was driven over Chrome's
  DevTools port with a small script kept in the scratchpad.
- **A headless page gets no focus events**, so the first outline check failed for every field,
  reader-supplied or not. With `Emulation.setFocusEmulationEnabled` it passed. Recorded in
  `/validate` 8.18.
- **`score-scalar-probe.ts` still prints `amelie (truth NOT verified)`.** The plan says to leave
  the scorer alone; its label is by sample list, not by the file's `verifiedBy`.
- **`/validate`'s "As of Iteration 17 there are twelve journeys" sentence was left**; it has not
  been maintained since.
- Otherwise none: no task was skipped.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | The two standing errors (`client/src/capture/downscale.ts:13-14`); none new |
| `prettier --check --end-of-line auto` on every changed and new file | Pass |
| `npx oxlint scripts/bakeoff scripts/score-extraction.ts` | Pass |
| Ad hoc strict `tsc` over `scripts/bakeoff/*.ts` and `scripts/score-extraction.ts` | Pass |
| `npm test` | Pass: 56 files, **661 tests** (53 files, 606 before) |
| `node --test scripts/bakeoff/*.check.ts` | Pass: 49 checks (46 before) |
| `npm run build` | Pass |
| `npm run test:integration` (hosted) | Pass: 27 tests; no orphan users |
| `npm run score:extraction` | **Byte-identical** to the baseline taken before any change |
| `npm run score:extraction -- --reader` | Runs; numbers below |
| `score-scalar-probe.ts` | Exits 0 |
| Product merge against harness merge, 16 receipts × 3 recorded runs | **0 differences over 48 receipt-runs** (values, disagreements, which fields the reader took) |
| `/validate` Phase 6, every check as written | Pass, including the new 6.25 and 6.26, **except 6.9** (standing, `pdfDocument.ts`). 6.4 "fails" by design |
| `/validate` 8.18 (new), live | Pass — see below |
| `git diff --check` | Pass |

**Not run:** `/validate` Phase 0 (no dependency changed); repository-wide `npm run format:check`
(red on CRLF files since iteration 23; changed files were checked); Phase 7a (no migration
changed); Phase 8 journeys 8.2–8.17 — no client file changed, and the review page, upload,
processing and source panel were exercised by 8.18's uploads, but the auth, history, export and
shell journeys were not repeated.

### Offline score, two models against two models plus the recorded reading

16 fixtures, 14 with a recorded reading.

| | Two models | With reader |
| --- | --- | --- |
| Seller name | 13/16 | 13/16 |
| Document number | 15/16 | 16/16 |
| Issue date / total / currency | 16/16 each | 16/16 each |
| No critical correction needed | 13/16 | 13/16 |
| Issue time | 15/16 | 16/16 |
| Seller OIB / buyer OIB | 15/16, 15/16 | 16/16, 16/16 |
| Buyer name / buyer address | 14/16, 14/16 | 16/16, 16/16 |
| Seller address | 11/16 | 11/16 |
| JIR / ZKI | 13/16, 12/15 | 14/16, 13/15 |
| Payment method | 12/16 | **16/16** |
| VAT breakdown | 11/13 | 11/13 |
| Warnings unexpected / missing | 0 / 0 | 0 / 1 |
| Low-confidence flags on correct values | 9 of 16 | **1 of 5** |
| — small images | 6 of 8 | 1 of 3 |

No field is lower. The one missing warning is `lira_trogir`'s
`missing_critical_field:documentNumber`: the reader fills the document number, so the warning is
correctly gone. `.agents/fixtures/expected-warnings.json` was not edited; it holds the two-model
expectation. The remaining flag on a correct value is `images:documentNumber`.

All 12 reader-supplied values across the 14 fixtures are found on the page and outlined,
including the bracketed `(NOVCANICE)` the harness's narrower key missed.

`ina-racun-sladoled`'s recorded reading disagrees with its fixture on `sellerOib`, `jir` and
`zki`. None is a flagged field and no value changes. The fixture and the probe read different
files of that receipt, which is why the offline score is a regression gate and not the probe's 198.

### Live run (2026-10-12)

Local API (`PORT=3001`, startup line `scalarReader: true`) and Vite on 5173; one disposable
account; five uploads through the capture page in headless Chrome.

| Receipt | Upload to review | Extraction | Reader | Stored against the probe's merged values |
| --- | --- | --- | --- | --- |
| `lira_trogir` | 8.1 s | 7.0 s | 4.2 s | 12 of 14 equal; see below |
| `26515835` | 5.0 s | 3.5 s | 3.0 s | all 14 equal |
| Konzum | 5.3 s | 3.2 s | 3.1 s | all 14 equal |
| `amelie-receipt` | 7.4 s | 5.2 s | 3.8 s | all 14 equal |
| `primjer1-hr-nopdv` | 7.3 s | 5.6 s | 3.0 s | all 14 equal |

The reader finished before the two models on all five, so it added nothing to the wait. Every row
had `extraction_metadata.reader` set, 14 keys in `readerAnswer` and a page in
`readerAnalyzeResult`, and `original_extraction` equal to `canonical_data`.

- `26515835`: payment method filled; invented buyer name and address cleared; no buyer inputs,
  Add buyer shown (44 px); nothing amber.
- Konzum: currency and payment method filled; `total` amber by disagreement with the kuna value
  kept; `documentNumber` amber (low confidence); issue date empty with its existing warning.
- `primjer1-hr-nopdv`: buyer name and address filled, the block open, the buyer OIB carrying its
  existing check-digit warning.
- `amelie-receipt`: nothing taken from the reader; seller name and address amber from the model's
  own low confidence (0.44), not from their disagreement.
- **`lira_trogir` differed from the probe, and the difference is the two models', not the
  reader's.** This time they read the seller OIB and document number themselves and returned the
  venue (`Lira Trogir`) with a longer address, where the recorded run had the legal entity. Both
  are rule-4 fields, so the two-model value is kept either way. The reader filled the JIR and ZKI.
  No buyer OIB was read this time, so none was cleared. The same file, a different two-model
  reading: worth knowing before treating any single upload as the product's answer.

Browser, 1440 px and 390 px, `en` and `hr`, all five: no horizontal overflow, no raw translation
key, no console error; amber only with the existing hints. Each reader-supplied field
(`jir`, `zki`, two `paymentMethod`, `currency`, `buyerName`, `buyerAddress`) raised its own
emphasised outline. Looked at by eye: `GOTOVINA` on `26515835`, the JIR line on `lira_trogir`, the
buyer name on the PDF — each on its own text.

- **The Konzum currency is outlined on the first `EUR` on the page, beside an item line**, not
  beside the total. That is the agreed rule (first occurrence), and it is the wrong occurrence for
  a reviewer.
- The PDF on the phone layout draws its canvas a moment after "Show receipt" is opened; the first
  pass of the script did not wait long enough and reported no outlines. With a wait: 1 canvas, 19
  outlines.

**Reader off.** The API was restarted from Git Bash with `AZURE_OPENAI_DEPLOYMENT=` blanked:
startup line `scalarReader: false`; `26515835` reached `review` with `metadata.reader` null,
`readerAnswer` null, no reader-owned field, the invented buyer present and no payment method —
the two-model behaviour.

**Logs.** No receipt value in either API log (seller names, an OIB, payment wording and the
prompt's tag were searched for); no `scalar reader unavailable` line.

**Clean-up.** The account, its 6 rows and its 6 stored sources were deleted; orphan check `[]`;
ports freed.

### Paid calls

Estimated before uploading at about $0.13 for five receipts. Made: 5 × (two prebuilt pages, one
`prebuilt-read` page, one completion) and 1 × two prebuilt pages for the reader-off check: 22
calls, **about $0.15 at list prices**. Token usage was not captured, so this is the estimate, not
a reading of the invoice. No cap applied to this iteration (decision Q8).

## Acceptance criteria

All met: merge applied and stored; product merge equal to the harness on 48 receipt-runs; failed,
slow and malformed readers leave the two-model result unchanged; the API starts and extracts
without the variables; two-model score byte-identical; items and VAT untouched; flags as decided
with no new copy; outlines and the cleared-buyer case; no receipt text in a log; no model
vocabulary in `shared/`, `client/` or an API response; documents amended; no dependency added.

## Review session (2026-10-12, separate from the implementing session)

Re-run once: typecheck, `npm test`, build, the harness checks, hosted integration (27 tests, no
orphan users), both scoring runs and every `/validate` Phase 6 check. All pass except the three
standing reds. No browser journey was repeated: no client file changed and 8.18 was run live above.

Three reviews of the uncommitted diff: standards and spec (the two-axis skill) and a correctness
pass. No hard standards violation, nothing missing against the plan, no scope creep. Two findings
were fixed, each with a test:

- **An impossible month-first date could fail an extraction.** The reader's fallback for
  `02/24/17` built the ISO string by hand, so `02/30/17` became `2017-02-30`, which the canonical
  schema rejects when the row is written. It now goes back through `parseIssueDate`.
- **A failed extraction logged `scalar reader unavailable`.** The abort in `extract`'s `finally`
  rejected the in-flight reader, whose catch logged the dead-reader line although the reader was
  healthy. The line is now skipped when the extraction itself was aborted.

Raised and left, because each is a settled decision or needs one:

- `sameValue` ignores punctuation on `documentNumber`, so `381/1/3` and `38/11/3` count as
  agreement. It is the measured comparator; tightening it means measuring again.
- The reader's grace relies on the reader honouring its abort signal; the wait is not raced. The
  shipped reader honours it, as the secondary model's does.
- The outline search key drops punctuation, so a short form (`1.6.26` → `1626`, a total `5.00` →
  `5`) can match unrelated text earlier on the page. Outlines only, never values.
- `--reader` scoring skips a missing reader fixture without naming it (`receiptsMerged` counts).
- The reader reads the same OCR engine the prebuilt models sit on, so agreement on a misread
  character clears a flag it should not. Accepted with Q4.
- Small duplications (`currencyCode`, the text keys, the "all four set" test) were not refactored.

## Known gaps / follow-ups

- **For the product owner:** confirm Q12 (`sellerName` in the flagged list or not); `/commit`;
  enter the four `AZURE_OPENAI_*` variables on `receipt-ocr-api` in the Render dashboard; after
  the deploy, upload one receipt and check Render's log for `scalarReader: true` and no
  `scalar reader unavailable` line. A tab open across the deploy needs no reload.
- **Until those variables are entered the deployed app runs with the reader off.**
- **Receipts needing no critical correction stay 13 of 15.** The two models win every critical
  field. Loosening that needs more unseen receipts first.
- **A value printed more than once is outlined at its first occurrence** (the Konzum `EUR`).
  Preferring the occurrence nearest a related field would be a new rule; not built.
- **The two-model reading of one file varies between uploads** (`lira_trogir`).
- **Buyer clearing depends on the reader finishing**, so a retry can change whether an invented
  buyer shows.
- **The reader's payment wording is stored as copied**, without the two-model path's "names a
  payment method" test; a reader-supplied buyer OIB is not check-digit validated before it
  replaces the two models' (the existing warning still fires).
- **Agreement and disagreement are fixed at extraction**; an edit does not bring a cleared flag
  back.
- **`raw_provider_result` now holds a third OCR response** per receipt; its size was not measured.
- **Run-to-run stability with a fresh OCR call** was seen on five uploads, not measured.
- **The Azure OpenAI resource is on limited credit.** When it ends, every upload logs the
  warning and extraction continues with two models.
- Standing reds, untouched: `/validate` 6.9, the two lint errors, repository-wide `format:check`.
- Items and VAT rows remain unverified ground truth (iteration 26's follow-up).
