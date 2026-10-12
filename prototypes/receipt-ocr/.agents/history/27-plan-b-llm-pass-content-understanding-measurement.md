# Iteration 27 — Plan B: an LLM pass and Content Understanding, measured against production

**Date:** 2026-10-09
**Plan:** `.agents/plans/plan-b-llm-pass-content-understanding-measurement.md`
**Commit:** _pending human review_
**Result:** `.agents/research/plan-b-engines.md` — read that for the numbers and the
recommendation. This file records how the work went.

## What was built

The iteration 25 harness under `scripts/bakeoff/`, extended. It is on schema v2 and the verified
ground truth, has one ground-truth loader for both scorers, a 15th sample (the Konzum receipt), and
four Plan B arms given the file the app would upload: the production provider called live, an LLM
on OCR text, an LLM repair pass on production's output under three fixed merge policies, and one
Content Understanding analyzer. One runner interleaves them; one scorer reports every column, the
grounded/ungrounded split of wrong values, run-to-run differences, latency, cost and a computed
decision bar.

Nothing under `api/`, `client/` or `shared/` changed. The application still has no LLM.

## Files created / modified

**Created** — `scripts/bakeoff/`: `truth.ts`, `inputs.ts`, `inputs.check.ts`, `production.ts`,
`repair.ts`, `repair.check.ts`, `content-understanding.ts`, `content-understanding.check.ts`,
`plan-b-records.ts`, `run-plan-b.ts`, `score-plan-b.ts`, `browser-downscale.mjs`,
`ground-truth/0f089468f365211452db4ccf6e8da466.json`. `.agents/research/plan-b-engines.md`, this
file.
**Modified** — `scripts/bakeoff/`: `field-schema.ts`, `normalize.ts`, `normalize.check.ts`,
`compare.ts`, `compare.check.ts`, `samples.ts`, `score.ts`, `spend.ts`, `run-input-modes.ts`,
`README.md`, and the 14 existing `ground-truth/*.json` (scalars removed). `.agents/ROADMAP.md`.
**Local only** — `.env` gained `AZURE_CONTENT_UNDERSTANDING_ENDPOINT`,
`AZURE_CONTENT_UNDERSTANDING_KEY` and `AZURE_CU_API_VERSION`, copied from payslip-ocr's `.env` by a
script that printed names only. `.bakeoff/plan-b/` (records and inputs; git-ignored).
**On the Foundry resource** — one analyzer, `receipt_planb_v2`, was created. The resource's
defaults already registered `gpt-4.1` and `text-embedding-3-large`; they were not changed.

`.agents` is git-ignored at the monorepo root: the plan, the research file and this file need
`git add -f`.

## Decisions made

B1–B8 were settled before the plan. GATE A was answered "Yes, probe then all 3 runs" on
2026-10-09, after the inputs table, the estimate, the decision bar, the policies and the
unseen choices were shown. Taken during execution:

- **Criterion 1 is evaluated per run**: the arm must beat production of the same run in every run.
- **"On the page"** is one function (`repair.ts`, `isGrounded`) for both uses, eligibility and the
  wrong-value split: the value as the model copied it, or a printed form of its canonical value,
  as a run of consecutive OCR words, a word being split at its colons.
- **A model value is offered to a policy only when the model returned it.** A currency the
  normaliser inferred from the date is not the model's; a value equal to production's is a no-op.
- **`buyerOib` and the other party fields are scored** as a fourth scalar group.
- **The Konzum receipt's items are its euro line.** Not owner-verified.
- **The old scorer leaves the Konzum receipt out**, since it replays production from fixtures.

## Deviations from the plan

- **Inputs come from a real browser, not from Node.** The probe showed production reading the
  Node-downscaled `gradanin-gotovina-pos` worse than the app does. `browser-downscale.mjs` runs
  the app's rule in headless Chrome; `inputs.ts` uses those files and keeps the Node rule as the
  fallback. Four photos are downscaled, not the two or three the plan expected.
- **Two probe receipts were run twice.** Their records on Node inputs were deleted after being
  read, so the spend walker no longer counts them (about $0.12, added by hand below).
- **One file beyond the plan's list**, `plan-b-records.ts` (record shapes, paths, the latency and
  cost table), because the runner and the scorer both need them; and `browser-downscale.mjs`.
- **Three scoring fixes after the probe, before the scored runs**: an OIB failing its check digit
  is kept as printed; a JIR without hyphens gets them; a value glued to its label is found on the
  page. Listed in the research file. Nothing was changed after the scored runs.
- **`cuConfidences` and `cuSources` are one function**, `cuDetails`.
- **`guardSpend`'s third argument is now dollars**, as the plan asked; `run-input-modes.ts` was
  updated to pass them. Its `--summary` still walks all of `.bakeoff/`, so it now includes Plan B's
  records in "recorded spend".
- **Task 3's `score:extraction` gotcha did not bite.** The output is byte-identical before the
  comparator change, after it, and at the end. No README number moved, so `README.md` is unchanged.
- **`agent-browser` hung on `open`** for three minutes with no output; headless Chrome was started
  directly instead.

## Validation results

| Check | Result |
| --- | --- |
| `npx oxlint scripts/bakeoff` | Pass |
| `npx prettier --check --end-of-line auto scripts/bakeoff` | Pass |
| `npx tsc --ignoreConfig --strict --noUncheckedIndexedAccess --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target esnext --skipLibCheck --types node scripts/bakeoff/*.ts scripts/score-extraction.ts` | Pass (`scripts/` is covered by no tsconfig) |
| `node --env-file-if-exists=.env --import tsx --test` over the five `.check.ts` files | Pass, 37 checks |
| `npm run score:extraction`, before against after | Byte-identical |
| `npm run typecheck` | Pass |
| `npm test` | Pass: 53 files, 606 tests |
| `npm run lint` | The same two pre-existing errors (`client/src/capture/downscale.ts:13-14`); none new |
| `node … scripts/bakeoff/score.ts` (iteration 25, re-scored) | Runs, exits 0 |
| `run-plan-b.ts` without `--confirm-spend` | Exits 1, no call |
| `score-plan-b.ts` with no records | Exits 1, names what is missing |
| `/validate` 6.19, 6.1b; `git check-ignore .bakeoff .env`; `git diff -- .env.example api client shared package.json` | Pass; ignored; empty |
| Secrets grep over the new files | Nothing |
| Probe: 20 calls on three receipts | All arms returned; analyzer built first time; read by eye |
| Three runs: 180 calls | None failed, none throttled, no stalled submit |
| `score-plan-b.ts` | Exits 0, six columns, three runs each |

**Not run:** `npm install` on a clean checkout (no dependency changed), repository-wide
`npm run format:check` (red on CRLF files since iteration 23; the harness was checked), `npm run
build`, the hosted integration tests, `/validate` 7a and every Phase 8 browser journey. No file
they cover changed, which `git status` shows. `/validate` was not extended: the harness is outside
the product (iteration 25's precedent), and its checks and commands are in
`scripts/bakeoff/README.md`. `/validate` 6.9 is still red on `pdfDocument.ts`, untouched.

### Spend

| Paid run | Calls | Cost | Running total |
| --- | --- | --- | --- |
| Probe, three receipts, Node inputs | 12 | $0.17 | $0.17 |
| Probe again, two receipts, Chrome inputs | 8 | $0.11 | $0.28 |
| Three runs, 15 receipts | 180 | $2.28 | **$2.56** |

Cap $5. The summary reports $2.44 because the two deleted probe records ($0.12) are not on disk.

## Known gaps / follow-ups

- **The decision is the product owner's.** The research file recommends a fill-only LLM pass if an
  LLM is adopted at all; adopting one needs a PRD §4.7 and ROADMAP §5 rule 10 amendment.
- **Verify items and VAT rows**, including the Konzum receipt's euro-or-kuna question, then
  re-score (free). Criterion 2 rests on them.
- **The grounding test rejects a correct value printed in brackets or across two lines.** Left
  unchanged on purpose; a decision for whoever builds the pass.
- **Production on the unseen receipt**: kuna total, no currency, a shop number as the document
  number. One receipt, but it is the only untuned one, and it argues for more unseen receipts
  before any further rule work.
- **Production read the Node-downscaled files worse than Chrome's.** The app only ever sends a
  browser's, but it shows the engine is sensitive to resampling.
- The analyzer `receipt_planb_v2` stays on the Foundry resource; deleting it is free and manual.
- `scripts/bakeoff/ground-truth/` holds values read from real receipts and is not git-ignored, as
  in iteration 25.
- `agent-browser open` hanging was not investigated.
