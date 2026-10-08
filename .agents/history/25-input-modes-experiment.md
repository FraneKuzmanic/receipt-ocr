# Iteration 25 — Input-mode experiment (OCR text vs the document itself)

**Date:** 2026-10-08
**Plan:** `.agents/plans/input-modes-experiment.md` (handoff: `.agents/specs/input-modes-experiment.md`)
**Commit:** _pending human review_
**Result:** `.agents/research/input-modes.md` — read that for the numbers. This file records how
the work went.

## What was built

A measurement harness under `scripts/bakeoff/`, beside the product. It sends each of the 14
receipts that have a local source file to one `gpt-4.1` deployment in four forms (`ocr`, `images`,
`files`, `crops`), three times, scores the answers against one ground truth with one comparator,
and scores the production engine, replayed from fixtures, as a reference line. A separate run asks
the model for a bounding box per value. Nothing under `api/`, `client/` or `shared/` changed; the
application still has no LLM.

## Files created / modified

**Created** — `scripts/bakeoff/`: `README.md`, `samples.ts`, `field-schema.ts`, `normalize.ts`,
`compare.ts`, `model-input.ts`, `layout.ts`, `ground.ts`, `spend.ts`, `run-input-modes.ts`,
`run-boxes.ts`, `score.ts`, `normalize.check.ts`, `compare.check.ts`, `ground-truth/*.json` (14).
`.agents/research/input-modes.md`, this file.
**Modified** — `.agents/ROADMAP.md` (one row). `.env` gained the four `AZURE_OPENAI_*` variables,
copied from payslip-ocr's `.env` by a script that printed no value.
**Local only** — `.bakeoff/` (records; git-ignored, holds receipt contents).

## Decisions made

- **Input modes only.** The Content Understanding plan is shelved; the sample table, schema,
  comparator, ground truth and scorer are in the shape its Tasks 1, 2, 5 and 8 describe.
- **`files` runs on the two PDFs only**, because for a photo it is the same request as `images`.
- **The layout call is made fresh every run**, with production's own 500 ms polling rather than
  the SDK poller.
- **The model copies values as printed and a normaliser follows**, using production's parsers.
- **`subtotal` is scored only where the receipt prints it as its own labelled line.**

## Deviations from the plan

- **GATE A was passed without the ground truth being verified.** The product owner said
  "continue" without answering the three open questions or marking the files. The paid runs do not
  depend on ground truth and scoring is free to repeat, so the runs went ahead and every score
  table carries `GROUND TRUTH NOT VERIFIED`.
- **`spend.ts` is an extra file**, shared by the two runners (prices, recorded spend, the cap).
- **`gradanin-gotovina-pos`'s OIB `90000000002` passes the check digit**, so it is ground truth,
  not `null` as first drafted.
- **`26515835` gained `issueDate`**, printed on the receipt but missing from its expected file.
- **The normaliser was changed after the runs** (labelled OIB, a number with its unit, the US
  receipt's month-first date, `$`). Recorded in the research file with the before and after.
- The paid probe was first blocked by the permission system and ran after the product owner
  allowed it.

## Validation results

| Check | Result |
| --- | --- |
| `npx oxlint scripts/bakeoff` | Pass |
| `npx prettier --check --end-of-line auto scripts/bakeoff` | Pass |
| Ad hoc `tsc --ignoreConfig --strict --noUncheckedIndexedAccess` over the harness | Pass (`scripts/` is covered by no tsconfig) |
| `node --import tsx --test …normalize.check.ts …compare.check.ts` | Pass, 15 checks |
| `npm run score:extraction` before against after | Byte-identical |
| `git status --short` | Only `scripts/bakeoff/` |
| Probe: 10 model calls, 3 layout calls | All returned 17 keys; PDF file part accepted |
| Three runs: 132 model calls, 42 layout calls | None failed, none throttled |
| Box run: 14 calls; drawn on two receipts | Measurement confirmed by eye |

Not run: `npm run typecheck`, `npm test`, `npm run build`, integration tests and the browser
journeys. No file they cover changed, which `git status` shows. `/validate` was not extended: the
harness is outside the product, and its checks and commands are in `scripts/bakeoff/README.md`.

Spend: **$1.32** of a $4 cap (model $0.87, layout $0.45).

## Known gaps / follow-ups

- **Verify the ground truth** and decide the three open questions (two seller names, the
  `receipt123` VAT rate, the `screenshot` item quantity); then re-score, which is free.
- **Why bands help on small photos is unexplained.** It is not resolution: those photos are below
  the size the service shrinks to.
- **Run 2's layout calls stalled for 15–260 s on seven consecutive receipts.** Not investigated;
  production uses other models on the same resource.
- **Payment method: production reads 6 of 14**, every LLM arm 13–14. It had never been scored.
- `scripts/bakeoff/ground-truth/` holds values read from real receipts and is not git-ignored; the
  product owner decides at commit time.
- The existing expected files may be wrong in two places (`receipt123` rate and seller name); they
  were left untouched.
