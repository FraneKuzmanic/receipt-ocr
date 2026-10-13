# Iteration 30 — Source outlines missing until a reload

**Date:** 2026-10-13
**Plan:** _none — the product owner reported a live defect and asked for a diagnosis and a fix_
**Commit:** _see `git log` for this file_

## What was reported

While uploading the fixture receipts by hand after iteration 29, `26515835` and `receipt123`
opened in review with no outlines on the source image. A reload brought them back; uploading the
same receipt again sometimes showed them and sometimes did not.

## Cause

The review page makes two independent requests: the source image and the outline regions.
`ImageSource` in `client/src/review/SourceDocumentPanel.tsx` decided whether outlines were safe to
draw once, inside the image's `onLoad`, by comparing the image's ratio with the page ratio from
the regions response. When the image loaded first there was no page ratio yet, the answer was
"not safe", and it was never asked again.

The race has existed since iteration 15. Why it surfaced now is inferred, not measured: iteration
29 made the regions response slower (a third OCR response is loaded and the reader's values are
searched among its words), and the two receipts reported are small images, which load fastest.

PDFs were not affected: `PdfSource` already derives the comparison on every render.

## What was built

`ImageSource` keeps the loaded image's ratio in state and compares it with the declared ratio on
every render, so the outlines appear in whichever order the two requests finish. The suppression
for a ratio that disagrees (an EXIF orientation mismatch) is unchanged.

## Files created / modified

**Client** — `review/SourceDocumentPanel.tsx`; new `review/SourceDocumentPanel.test.tsx`.
**Docs** — `.agents/ROADMAP.md`, this file.

## Validation results

| Check | Result |
| --- | --- |
| New test, image-first case, before the fix | **Failed** (the reproduction) |
| `npx vitest run --project client SourceDocumentPanel ReviewPage` | Pass, 13 tests |
| `npm run typecheck` | Pass |
| `prettier --check --end-of-line auto` on the two changed files | Pass |
| `npx oxlint client/src/review` | Pass |

**Not run:** the full `npm test`, build, integration tests, every `/validate` Phase 6 check and
every browser journey. Direct iteration; only the client panel changed. `/validate` was not
extended.

## Known gaps / follow-ups

- **Not confirmed in a real browser.** The product owner checks `receipt123` and `26515835`
  against the running app.
- The explanation of why the race began to lose after iteration 29 is an inference; the regions
  endpoint's latency was not measured before and after.
- Iteration 29's open items stand: Q12 (`sellerName` in the flagged list) and the four
  `AZURE_OPENAI_*` variables on Render.
