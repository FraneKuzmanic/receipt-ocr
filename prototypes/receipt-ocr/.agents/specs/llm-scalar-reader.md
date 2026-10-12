# Handoff — Iteration 29: an LLM as a third, parallel reader of scalar fields

**Written:** 2026-10-12, by the session that ran the iteration 28 probe.
**For:** a fresh agent. Run `/prime`, read this file, then `/plan-feature` from it.
**Kind of work:** a product change. This is the first iteration that puts an LLM in the
application. Read `.agents/research/scalar-llm-reader-probe.md` (the evidence) and
`.agents/history/28-scalar-llm-reader-probe.md` before planning.

## The decision

On 2026-10-12 the product owner saw the probe's result and decided to go ahead. What follows is
what was decided and measured; the plan designs the implementation, it does not reopen these.

## Settled — do not relitigate

1. **Shape.** A third reader beside the two Azure prebuilt models: `prebuilt-read` OCR of the
   uploaded file, its plain text into `gpt-4.1`, which returns the 14 scalar fields as printed.
   It starts at the same moment as the two prebuilt calls. The model is shown the document text
   only, never production's reading.
2. **Items and VAT rows stay production's.** The LLM is never asked for them.
3. **Everything is merged on the server before the receipt reaches `review`.** Nothing changes on
   the form afterwards except what the user edits. No progressive fill.
4. **The merge rule**, as measured (`scripts/bakeoff/scalar-merge.ts` and its `.check.ts` are the
   reference implementation and its tests):
   1. A field the QR code supplied or agrees with is production's.
   2. Buyer name, address and OIB are the LLM's, **including empty** (this narrows iteration 23's
      "a second reader never blanks a value" for those three fields only).
   3. Payment method and issue time are the LLM's when it has one, else production's.
   4. Every other scalar is production's when it has one, else the LLM's.
   5. Under rule 4, both have a value and they differ: production's is kept.
5. **No on-the-page (grounding) test in the merge.** It cost a correct value and bought nothing.
6. **Additive, never load-bearing** (iteration 23's rule for the second model, applied again). An
   LLM-path error, timeout or malformed answer is logged and the two-model result stands
   unchanged. A grace timeout after production's result is required: one `gpt-4.1` call of 192
   was held by the service for 84 s. The probe's data: the LLM path finished before production on
   15 of 16 receipts and within 2 s on all 16.
7. **`gpt-4.1`, not `gpt-4.1-mini`** (no faster, and it swapped a JIR and a ZKI on `read` text).
   **`prebuilt-read`, not `prebuilt-layout`** (same merged accuracy, 1.3 s faster, $0.0085 cheaper).
8. **Latency budget:** 1–3 s added is acceptable; the probe measured 0.0 s at p50 and p90.

## The amendment this iteration must make, explicitly

Adopting an LLM contradicts three written rules. The plan must amend each in the same commit, with
the probe as the stated reason, and record it in the ROADMAP amendments:

- **PRD §4.7** ("LLM-based extraction, verification, or fallback" out of scope) and **§7.6**
  ("LLM fallback is not part of the initial PoC", "sole OCR/document extraction platform").
- **PRD §8** "Explicitly excluded dependencies: LLM SDKs". The harness calls the Azure OpenAI
  REST endpoint with `fetch` and needs no SDK; say which the product uses.
- **ROADMAP §5 rule 10** ("No … LLMs") and the README's statements that the app has no LLM.
- `/validate` and `shared/src/receipt.test.ts` guard provider vocabulary; check what they would
  now flag.

## Open — the plan must decide, and ask the product owner where marked

1. **(ask)** Is a rule-5 disagreement shown as an amber flag on the field? On `read` text 7 of
   9–11 such flags a run landed on a wrong production value and 2–4 on a right one. ROADMAP's
   iteration 26 amendment applies: a flag that fires on correct values teaches users to ignore it.
2. **(ask)** Does LLM agreement clear one of production's low-confidence flags? It would clear
   8–9 of the 10 that sit on correct values, and 0–2 of the 4 on wrong ones.
3. **Provenance and highlighting.** A value the LLM supplies has no position and no confidence.
   `ExtractionFieldMetadata.source` is `"model" | "text" | "inferred" | "qr"`; decide what an
   LLM-supplied value records, what `fieldModels` records, and whether source-region highlighting
   locates it by text match in the `prebuilt-read` words (the harness's `ground.ts` does this) or
   shows no outline. Not measured by the probe.
4. **Where it lives.** `DocumentExtractionProvider` (`api/src/providers/document-extraction/`) is
   the PRD §6.3 seam; `azure.ts` already runs the secondary model with `SECONDARY_GRACE_MS`
   (10 s) and `merge.ts` holds the per-field precedence. Decide whether the LLM reader is a third
   leg inside that provider or a step beside it, keeping Azure and model vocabulary out of
   `shared/`, the database canonical column, the API surface and the UI (ROADMAP §5 rule 7).
5. **The grace value.** 2 s after production kept 16 of 16; the existing secondary grace is 10 s.
6. **Configuration.** New server-only variables for the Azure OpenAI endpoint, key, deployment and
   API version (names in `scripts/bakeoff/README.md`; the values are in this project's `.env`
   already), plus a way to switch the reader off, as `AZURE_DI_SECONDARY_MODEL_ID=none` does.
   `.env.example` holds names only; `render.yaml` and the Render dashboard need them; `/validate`
   6.1, 6.1b and 6.6 check them. **The deployed app must keep working if they are absent.**
7. **What is stored.** `raw_provider_result` keeps both prebuilt responses today. Decide whether
   the `prebuilt-read` response and the model's answer are kept (debugging, the PRD §7.10
   provenance rule) and what the logging redaction (`api/src/logger.ts`) must cover: receipt text
   now goes to a second service and must not reach a log.
8. **Retry and stored rows.** `POST /api/receipts/:id/retry` re-runs extraction; receipts stored
   before this iteration have no LLM reading. No backfill is expected; say so.
9. **The prompt and schema** are `SYSTEM` and the scalar fields of `RECEIPT_FIELDS` in
   `scripts/bakeoff/field-schema.ts`, and normalisation is `scripts/bakeoff/normalize.ts`. They
   are harness files importing from `api/`; the product needs its own copies or a shared home.
   Reword nothing without re-measuring: the measured accuracy is of that wording.
10. **Privacy note.** Receipt text is sent to Azure OpenAI on the same Azure tenant as Document
    Intelligence. PRD §9.4 should say so.

## Evidence in one table (15 receipts with verified scalars, 209 scored, 3 runs)

| | Scalars right | No critical correction (of 15) | Correct production values broken | Added wait p50 / p90 | Extra cost a receipt |
| --- | --- | --- | --- | --- | --- |
| Production | 183 | 13 | – | – | – |
| `read+gpt-4.1`, merged | 198 | 13 | 0 | 0.0 / 0.0 s | about $0.004–0.006 |

The 15 corrections: payment method on five receipts with an unlabelled tender line; the wrong
buyer on `26515835` and the buyer OIB on `lira_trogir` cleared; the buyer of `primjer1-hr-nopdv`
filled; `lira_trogir`'s seller OIB, JIR and ZKI; Konzum's currency; a time printed without seconds.

## What this does not fix — do not promise it

- Receipts needing no critical correction stay 13 of 15: rule 4 keeps production's value on every
  critical field. On the two receipts production was not tuned on (Konzum, `amelie-receipt`) the
  LLM alone read 28 of 28 scalars, production 22, the merge 24. Loosening rule 4 is **out of
  scope** until more unseen receipts are scored.
- In-sample: the rule was chosen on these 15 receipts. 198 is an upper estimate.
- Run-to-run stability was measured on fixed OCR text, not on a fresh OCR call per run.

## Verifying the implementation

- `npm run score:extraction` replays recorded fixtures offline and is the regression gate for the
  two-model path; it has no LLM reading recorded. Decide whether the LLM answer becomes a recorded
  fixture so the merged result is scored offline (the probe's records under
  `.bakeoff/scalar-probe/` hold `prebuilt-read` responses and model answers for all 16 receipts,
  from the app's own upload files), and keep the two-model score unchanged when the reader is off.
- Unit tests must cover the merge rule (port `scalar-merge.check.ts`), a failed, slow and
  malformed LLM path each leaving the two-model result intact, and the reader switched off.
- A browser journey on real uploads belongs in `/validate` Phase 8. Paid calls are on limited
  Azure credit: estimate first, keep them few, record them in the history file.
- `scripts/bakeoff/score-scalar-probe.ts` re-scores the probe for free and is the number to
  compare the shipped behaviour against.

## State of the repository

- **Iterations 27 and 28 are uncommitted**, both harness-only, in the working tree. Ask the
  product owner whether to commit them first; 29 should be its own commit.
- `.agents/` is git-ignored at the monorepo root: specs, plans, history and research need
  `git add -f`.
- **`amelie-receipt`'s scalar truth is still the agent's draft** (`scripts/bakeoff/ground-truth/
  amelie-receipt.json`, `verifiedBy: null`). The product owner was asked to verify it and had not
  answered when this was written. It has no recorded fixture.
- Spend so far: $3.39 of the $5 cap that covered iterations 27 and 28. This iteration has no
  agreed budget for paid validation yet; ask.
- Standing reds that are not this iteration's: `/validate` 6.9 on
  `client/src/review/pdfDocument.ts`, two lint errors in `client/src/capture/downscale.ts`,
  repository-wide `format:check` on CRLF files.
- Local ports: `.agents/history/25-separate-local-ports.md` says 3002/5174, the code and README
  say 3001/5173, and `.env` sets `PORT=3002`, which the Vite proxy does not follow. Start the API
  with `PORT=3001` for a browser check (`/validate` 8.17), or settle it.

## Out of scope

- The LLM winning any critical field; any change to items or VAT extraction.
- Vision input, Content Understanding, `gpt-4.1-mini`, `prebuilt-layout`.
- Changing the client's 2 s poll interval (a separate, free improvement worth its own note).
- Backfilling receipts already stored.
