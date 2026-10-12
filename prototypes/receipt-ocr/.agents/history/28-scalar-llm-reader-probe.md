# Iteration 28 — Scalar probe: an LLM as a parallel reader of scalar fields

**Date:** 2026-10-12
**Plan:** _none — the product owner asked for the probe to be run directly from the handoff_
(`.agents/specs/scalar-llm-reader-probe.md`)
**Commit:** _pending human review_
**Result:** `.agents/research/scalar-llm-reader-probe.md` — read that for the numbers and the
recommendation. This file records how the work went.

## What was built

Three harness modules and a check under `scripts/bakeoff/`, on top of the uncommitted iteration 27
work: the merge rule (`scalar-merge.ts`, `scalar-merge.check.ts`), a runner that starts production
and two OCR-then-model paths at the same moment for each receipt (`run-scalar-probe.ts`), and a
scorer that computes the tables and the decision bar (`score-scalar-probe.ts`). Four
configurations: `prebuilt-layout` or `prebuilt-read` text into `gpt-4.1` or `gpt-4.1-mini`.

Nothing under `api/`, `client/` or `shared/` changed. The application still has no LLM.

## Files created / modified

**Created** — `scripts/bakeoff/`: `scalar-merge.ts`, `scalar-merge.check.ts`,
`scalar-probe-records.ts`, `run-scalar-probe.ts`, `score-scalar-probe.ts`,
`ground-truth/amelie-receipt.json`. `.agents/research/scalar-llm-reader-probe.md`, this file.
**Modified** — `scripts/bakeoff/`: `model-input.ts` (`complete` takes the deployment), `layout.ts`
(`analyzeLayout` takes the model; `prebuilt-read` is not asked for markdown), `spend.ts`
(`gpt-4.1-mini` and `prebuilt-read` prices, read per record), `browser-downscale.mjs` (an optional
file name limits the run to one file), `README.md`. `.agents/ROADMAP.md`.
**Local only** — `.bakeoff/scalar-probe/` (records) and
`.bakeoff/plan-b/inputs/amelie-receipt.jpg` (Chrome-made; the four existing inputs were
checksummed before and after and did not change).

`.agents` is git-ignored at the monorepo root: the handoff, the research file and this file need
`git add -f`.

## Decisions made

- **No `/plan-feature`**, at the product owner's direction: planning is for implementations. The
  merge rule, the bar and the estimate were written into the research file before the first paid
  call instead.
- **The bar is the handoff's suggested one**, unchanged.
- **Runs 2 and 3 repeat the model calls only**, on run 1's text, to stay near the approved $1.
  Document Intelligence returned identical values in Plan B's three runs.
- **`amelie-receipt` is outside `SAMPLES`** (`PROBE_SAMPLES` in `scalar-probe-records.ts`), so the
  Plan B and iteration 25 scorers are untouched, and outside the totals and the bar until its
  truth is verified.
- **The spend guard counts Plan B's records, the probe's, and the $0.12 of Plan B that is on no
  disk**, against the one $5 cap.
- **A disagreement uses the harness comparator**, so `d. o.o.` against `d.o.o.` is not one.
- **With the on-the-page test, a value not on the page is "no reading"**, never "empty", so it
  cannot clear a buyer field.

## Deviations from the handoff

- **The estimate was stated, not separately approved.** The product owner had approved about $1
  and then asked for the probe to be run; the estimate ($1.07) was shown in the session and the
  run went ahead. It cost $0.83.
- **`amelie-receipt` was scored before its truth was verified**, on its own labelled line. The
  handoff says verify first. Every reader agrees with the draft's fiscal identifiers.
- **Prices were not checked** against a price page; they are the handoff's figures.
- **Iteration 27 was not committed first.** The handoff says to ask; nothing was committed in this
  session and 28 sits on top in the working tree.

## Validation results

| Check | Result |
| --- | --- |
| `npx oxlint scripts/bakeoff` | Pass |
| `npx prettier --check --end-of-line auto scripts/bakeoff` | Pass |
| Ad hoc strict `tsc` over `scripts/bakeoff/*.ts` and `scripts/score-extraction.ts` | Pass |
| `node --import tsx --test scripts/bakeoff/*.check.ts` | Pass, 46 checks (9 new) |
| `run-scalar-probe.ts` without `--confirm-spend` | Exits 1, no call |
| `run-plan-b.ts --summary` after the `spend.ts` change | Still $2.44 recorded |
| Smoke: one receipt, 7 calls | All returned; records read by eye |
| Scored runs: 112 parallel calls, 128 repeat model calls | None failed, none throttled; one `gpt-4.1` response held 84 s by the service |
| `score-scalar-probe.ts --verbose` | Exits 0 |

**Not run:** `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, the integration
tests, `npm run score:extraction`, `score-plan-b.ts`, `score.ts` and every browser journey. No
file under `api/`, `client/` or `shared/` changed; the shared harness modules that did change are
covered by the strict `tsc` above. `/validate` was not extended (iteration 25's precedent).

### Spend

| Paid run | Calls | Cost | Running total |
| --- | --- | --- | --- |
| Plan B (iteration 27) | | $2.56 | $2.56 |
| Smoke | 7 | $0.04 | $2.60 |
| Scored runs | 240 | $0.79 | **$3.39** |

Cap $5.

## Known gaps / follow-ups

- **Decided 2026-10-12: the product owner chose to go ahead**, as `prebuilt-read` + `gpt-4.1`
  with a grace timeout. The handoff for the implementation is
  `.agents/specs/llm-scalar-reader.md`; it needs the PRD §4.7, PRD §8 and ROADMAP §5 rule 10
  amendment as part of that iteration.
- **Verify `amelie-receipt`'s scalars** (`scripts/bakeoff/ground-truth/amelie-receipt.json`), in
  particular the seller name's spelling and the seat address.
- **More unseen receipts** before deciding whether the LLM should win any critical field.
- **Whether disagreements become flags, and whether LLM agreement clears a low-confidence flag**,
  are open for the implementation plan.
- **A value the LLM supplies has no position**; how the review screen outlines it is not measured.
- Stability with a fresh OCR call per run was not measured.
