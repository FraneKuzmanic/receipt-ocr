# Iteration 16 — Desktop zoom/pan, mobile inspect popover & edited-field indicator

**Date:** 2026-08-24
**Plan:** none — user asked for direct implementation, skipping `/plan-feature` and `/execute`
(explicit instruction; the source-field-highlighting feature from iteration 15 was already reviewed
and working, this is user-directed follow-up polish on it).
**Commit:** see this task's commit.

## Why this iteration exists

The user exercised iteration 15's highlighting feature and reported three real problems, then asked
for a fourth improvement in discussion:

1. Small receipt photos made the highlighted rectangles too small to inspect on desktop — no way to
   zoom in.
2. On mobile, tapping a highlighted value focused the matching form input, which opened the software
   keyboard and pushed the crop preview off screen (a `position: fixed` strip anchored to the layout
   viewport, which the keyboard does not shrink).
3. Two follow-up bugs surfaced while testing the fix: zoomed outlines stopped being clickable
   (`setPointerCapture` on `pointerdown` retargets the eventual `click`), and dragging the zoomed
   image painted the browser's native text/image selection highlight.
4. A design discussion about whether a source outline should un-highlight once its field is edited —
   resolved as "no, keep it as provenance, but add a quiet visual cue for edited fields."

## What was built

**Desktop zoom/pan.** `client/src/review/sourceZoom.ts` is a small pure-math module (clamp, zoom
about an anchor, centre-on-point, region-visibility test) driving a `translate(x,y) scale(z)`
transform in `SourceDocumentPanel`. Zoom in / zoom out / fit-to-view buttons, wheel-to-zoom anchored
on the cursor, and click-drag panning once past fit. Focusing a form field auto-pans the zoomed image
so that field's outline is centred, using a box-inclusive visibility test (a centroid-only test was
tried first and found, in a real browser, to call a partially clipped outline "visible").

**Mobile: tap-to-inspect popover replaces the crop strip.** `ActiveRegionStrip` is deleted.
`RegionPopover` is a small non-focusing card: tapping an outline shows the field's label, its current
value, a low-confidence hint if relevant, and an explicit "Edit this field" action — only that action
moves focus into the input. This is the actual fix for the keyboard problem: nothing focuses on tap,
so the keyboard cannot open, and the source stays visible until the user chooses to edit.

**Two hit-testing bugs, both browser-only defects.** Pointer capture is now deferred to the first
real drag movement rather than taken on `pointerdown`, so a stationary tap still reaches the outline
underneath instead of being retargeted to the capturing container. `select-none` on the zoomed
viewport stops a drag from being read as a text-selection gesture.

**Edited-field indicator.** `GET`/`PATCH /api/receipts/:id` now also return `editedFields`: the
scalar canonical fields (never `vatBreakdown`/`items` — row indices can shift) whose current value
differs from `original_extraction`. The source overlay draws a dashed instead of solid outline for
an edited field; the mobile popover shows a small slate "Edited" pill. The outline's position is
unchanged — it is deliberately kept as a provenance marker even after a correction, per the design
discussion above.

## Files created / modified

**Shared** — `shared/src/api.ts` (`editedFields` added to `receiptDetailResponseSchema`).

**API** — `api/src/repositories/receipts.ts` (`findReviewState` now also reads
`original_extraction`); `api/src/routes/receipts.ts` (`editedFields` helper, wired into both
handlers); `api/src/routes/receipts.test.ts` (new, unit tests for the helper); one strengthened
assertion in `api/src/routes/receipts.integration.ts`.

**Client** — `client/src/review/sourceZoom.ts` (new), `SourceDocumentPanel.tsx` (zoom/pan, pointer
handling, popover wiring), `RegionPopover.tsx` (new), `SourceOverlay.tsx` (dashed outline for edited
fields), `regionSections.ts` (`fieldLabelKey` helper), `ActiveRegionStrip.{tsx,test.tsx}` deleted,
`ReviewPage.tsx` rewired to the new props. i18n: `review.zoomIn/zoomOut/zoomReset/zoomLevel`,
`review.inspectEdit/inspectClose/inspectEmpty/inspectPrompt/inspectEdited` in both locales.

## Decisions made

- Pointer capture deferred to first real move, not taken on `pointerdown` — see bug 3 above.
- Edited-field detection is scoped to flat scalar fields only, never nested VAT/item rows.
- Source outlines never un-highlight or move when a field is edited; only their line style changes.
  See the design discussion recorded in this session — provenance value outweighs the risk of a box
  looking "wrong" once corrected.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, exit 0 |
| `npm run lint` | Pass, zero errors |
| `npm run format:check` | Pass |
| `npm test` | Pass: **43 files, 392 tests** (was 372 at the end of iteration 15) |
| `npm run test:integration` (hosted) | Pass: 8 auth + 3 repository + 15 route, including the new `editedFields` assertion against a real DB row |
| Phase 7a (Docker migrations) | Skipped, legitimately — no file under `supabase/migrations/` changed |

Per the user's explicit instruction for this iteration, `.claude/commands/validate.md` was not
extended and the full Phase 6/8 sweep was not run — only the checks genuinely implicated by the diff.
Desktop zoom, pan, and the pointer-capture/click fixes were verified once in a real browser via
`agent-browser` (Chromium, 1440×1000 and 390×844, against a real Azure-extracted receipt); the
follow-up drag-selection fix and the edited-field indicator were **not** independently re-verified in
a browser — the user asked to handle browser verification themselves for the rest of this iteration.

## Known gaps / follow-ups

- The drag-selection fix (`select-none`) and the edited-field dashed-outline/popover-tag treatment
  have not been checked in a real browser by either party as of this commit.
- Wheel-to-zoom was confirmed to work via a real `WheelEvent` dispatched through the browser's own
  hit-testing, but Playwright's synthetic `mouse.wheel` in headless Chromium does not route through
  JS wheel handlers, so it could not be exercised end-to-end through the CLI tool used for the rest
  of this session's browser checks.
- No `.agents/plans/` file exists for this iteration (see Plan, above).
