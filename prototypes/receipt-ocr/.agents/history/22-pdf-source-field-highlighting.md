# Iteration 22 — PDF source-field highlighting

**Date:** 2026-09-04
**Plan:** `.agents/plans/pdf-source-field-highlighting.md`
**Commit:** _pending human review_

## Why this iteration exists

The user asked for the review page's source-field highlighting — shipped for photos in iteration 15
and refined in 16 — to work for PDF receipts too, "the same way like it does for the pictures", and
asked for research into whether that was realistic before any code was written.

## What the research found, and why it changed the shape of the work

**The server side was already finished, and had been since iteration 15.** `mapSourceRegions`
normalises Azure polygons by dividing by the page's own `width`/`height`. Azure reports **pixels for
photos and inches for PDFs**, so that division erases the unit before anything crosses the API
boundary — the design's stated keystone, written to cover PDFs from the start.
`source-regions.test.ts`'s first test is even named *"normalizes both pixel and inch coordinates"*
and already ran a PDF fixture through the mapper.

Running the real mapper over the stored fixtures during research:

| Fixture | Unit | Regions |
| --- | --- | --- |
| `primjer1-hr-nopdv` | inch | **17** |
| `primjer-pdf-racuna` | inch | **11** |
| `racuntaksi1` (photo, for comparison) | pixel | 10 |

PDFs already yielded *richer* highlighting than the feature that shipped. So this was never an
extraction or API problem — it was purely a question of what the client paints.

**The iteration 15 spec's reason for deferring had expired.** Its §9 argued sequencing, not cost:
the interaction model was unproven, so prove it cheaply on the image path first. Iterations 15 and 16
did exactly that. What got carried forward afterwards was the verdict ("no overlay is possible over
the native PDF viewer") rather than the argument. See the ROADMAP amendment.

Four things were measured rather than assumed:

- **pdf.js geometry agrees with Azure's.** pdf.js's page viewport ratio versus the API's
  `aspectRatio` differs by **4.06e-4** and **4.19e-4** on the two fixtures — Azure rounding its inch
  dimensions, two orders of magnitude inside the 0.01 tolerance the image path's `overlaySafe` guard
  already uses. That guard therefore transfers verbatim.
- **The modern pdf.js build cannot be used.** It calls `Uint8Array.prototype.toHex`, a very recent
  proposal, and throws `UnknownErrorException: hashOriginal.toHex is not a function` on import — in
  Node 24.19, and by extension on the older phones this product targets. The legacy build is
  transpiled, costs +37 KB, and parsed both fixtures in the same Node that rejected the modern one.
- **Cost, against the spec's "roughly 350 KB-plus" guess:** 151 KB + a 392 KB worker, gzipped, both
  dynamically imported.
- **CORS is not a blocker.** Supabase Storage returns `Access-Control-Allow-Origin: *`, checked
  against the live project.

## What was built

`ZoomableSourceViewport` is the shared shell: zoom, pan, wheel, pointer handling, the overlay, the
popover and the auto-pan-to-focused-field, extracted verbatim from `ImageSource`. `ImageSource` and
the new `PdfSource` now differ only in what they paint inside the transformed div — an `<img>` or a
`<canvas>` — and in the pager. This was deliberate over writing a PDF twin: that pointer code
contains the deferred pointer capture, the `select-none` drag fix and the non-passive wheel listener,
each a real browser-only defect fixed in iteration 16, and each of which a copy would silently drift
away from while still passing every jsdom test.

`pdfDocument.ts` is the only module that knows pdf.js exists. `pdfRender.ts` holds the two pure
functions worth unit-testing: `renderScale` and `pageForField`. `PdfSource` composes them.

A PDF that fails to render falls back to the previous `<object>` viewer plus the existing
`review.highlightsUnavailablePdf` note, so a failure degrades to today's behaviour rather than to a
broken panel. That key was kept, not deleted, and its copy narrowed to "this PDF receipt".

## Decisions made

- **Multi-page: a pager with auto-jump** (user's choice). Rendering only page 1 would have regressed
  against the `<object>` viewer, which scrolls all pages. Focusing a field switches to the page its
  outline is on — without that, a highlight can exist on a page the user is not looking at, which
  reads as the feature being broken.
- **Zoom sharpness: one raster at 2.5x the fitted size, capped at 2600 px, CSS-scaled after**
  (user's choice). Identical to the image path, which is what "the same way as pictures" asks for.
  A debounced re-render queue would need cancellation and flicker handling for text that is already
  crisp to ~250%.
- **`PdfSource` loads only once visible.** Not in the plan; found in the browser. `ReviewPage` mounts
  the panel twice and hides one with CSS — free for an `<img>`, but two fetches, two workers and two
  parses for a PDF. An `IntersectionObserver` on the panel's own box fixes it and additionally defers
  the phone's copy until "Show receipt" is opened. Verified: 0 canvases while collapsed, 1 after.
- **The container's aspect ratio comes from pdf.js, not the API.** If the two disagree the document
  is still painted correctly and the *outlines* are withheld — never the reverse. An outline that
  cannot be proved to sit on its text is worse than no outline.
- **No canvas polyfill in the test setup**, guarded by a new `/validate` check. jsdom paints nothing,
  so such a test would assert only that a blank element exists.

## Files created / modified

**Created** — `client/src/review/{ZoomableSourceViewport.tsx,PdfSource.tsx,pdfDocument.ts,
pdfRender.ts,pdfRender.test.ts}`, `.agents/plans/pdf-source-field-highlighting.md`, this file.

**Modified** — `client/src/review/SourceDocumentPanel.tsx` (routes PDFs to `PdfSource`, keeps the
`<object>` fallback, `ImageSource` now uses the shared shell), `client/src/i18n/locales/{en,hr}.json`
(three pager keys; `highlightsUnavailablePdf` reworded), `client/package.json` + `package-lock.json`
(`pdfjs-dist@6.3.289`), `README.md`, `.claude/commands/validate.md`, `.agents/ROADMAP.md`.

**Unchanged, deliberately** — the API, the shared schemas, the database, the extraction pipeline and
every warning rule. No migration, no backfill. The feature is retroactive to every PDF already stored.

## Deviations from the plan

- **The visibility gate was added** (see Decisions). The plan did not anticipate the duplicate mount.
- **`isEvalSupported: false` could not be passed** — pdf.js 6 removed the option along with its use
  of `eval`, so the CSP concern it addressed no longer exists. `disableRange`/`disableStream` are
  still passed as planned.
- **`destroy()` lives on the loading task, not the document proxy**, in v6.
- **Task 9's "no pdf.js chunk on a photo-only review" was proven against the production build**, not
  the dev server: Vite serves every module unbundled in dev, so a network check there proves nothing.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, exit 0 |
| `npm test` | Pass: **49 files, 485 tests** (was 477; +8 from `pdfRender.test.ts`) |
| `npm run build` | Pass; pdf.js split into its own chunk |
| `npm run lint` | 2 errors in `client/src/capture/downscale.ts` — **pre-existing**, identical at baseline, file untouched by this diff |
| `npm run format:check` | 169 files — **pre-existing** CRLF condition on this Windows checkout (166 at baseline). The six changed files pass `prettier --check --end-of-line auto` |
| `/validate` 6.20, 6.21 | New checks, both pass |

Bundle cost, measured by building with and without the change:

| | Baseline | After |
| --- | --- | --- |
| Main entry (gzip) | 264.60 KB | **266.09 KB** (+1.5 KB) |
| pdf.js | — | **148 KB** in a separate chunk, reached only by `import(...)` |

Not run, deliberately, per the standing instruction to validate what the change implicates:
`npm run test:integration` and Phase 7 (no API, schema or migration change), and the Phase 6 security
sweep beyond the two new checks (nothing here touches secrets, auth, logging or money).

### Real-browser verification

Chromium via `agent-browser`, disposable `uicheck-22-` account, against **live Azure extractions** of
both PDF fixtures plus a photo control. Storage objects removed and the user deleted afterwards; zero
`uicheck-22-` users remain.

**Desktop, 1440x1000, `primjer1-hr-nopdv`:**

- 17 outlines rendered, matching the API's 17 exactly. One `<canvas>`, no `<object>`.
- Canvas bitmap 1150x1626 for a 460x650 CSS box — exactly 2.5x, as designed.
- Rendered ratio 0.707084 vs the API's 0.707489: **Δ 4.05e-4**, no distortion.
- **Every one of the 17 outlines contains text** (8–33% dark-pixel density sampled from the canvas);
  none sits on blank paper.
- Focusing `total` raised exactly one outline. Clicking a different outline's **interior** at real
  screen coordinates, through the browser's own hit-testing, focused `sellerName` — the check that
  caught iteration 15's `fill="none"` defect.
- Zoom to 225%: transform applied, bitmap unchanged, text visibly crisp, outlines still aligned.

**`primjer-pdf-racuna`:** 11 outlines, matching the API; all contain text.

**Mobile, 390x844:** with the disclosure closed, **0 canvases** — the PDF is not fetched until
"Show receipt" is opened, after which exactly 1 canvas and 11 outlines appear. Tapping an outline
opened the inspect popover ("Seller name / Ana Horvat", Close + Edit this field) with
`document.activeElement` still `BODY`, so **no keyboard was raised**, and
`document.documentElement.scrollHeight` was identical before and after (3122).

**Multi-page**, a two-page PDF built from the two fixtures with `pdf-lib` and extracted live (14
regions on page 1, 8 on page 2): pager reads "Page 1 of 2" with Previous disabled and only page 1's
14 outlines drawn. Focusing `buyerName`, whose value is on page 2, switched to "Page 2 of 2" with 8
outlines and Next disabled. Previous returned to page 1.

**Photo control (`racuntaksi1`), the shared-shell regression risk:** 0 canvases, rendered-vs-natural
ratio distortion **4e-6**, the SVG's bounding box exactly matching the image's, 10 outlines in the
visible panel. Unchanged.

## Known gaps / follow-ups

- **The `onUnavailable` fallback has not been exercised in a browser.** Both fixtures render, so the
  `<object>` fallback path is reasoned about and typed but never seen. Corrupting a stored PDF to
  force it was judged not worth polluting the hosted project.
- **A `/Rotate 90` PDF is untested.** Both fixtures are `rotate=0`. The ratio guard is what covers
  this: pdf.js applies rotation to its viewport while Azure's behaviour is unknown, so a disagreement
  withholds the outlines rather than misplacing them. That is the intended failure, but it is
  unverified against a real rotated document.
- **UI upload through the browser could not be driven** in this session. Playwright's disk-backed
  `File` produced `TypeError: Failed to fetch` on `POST /api/receipts`, while the same multipart body
  built in-page succeeded (422) and `curl` succeeded through the same Vite proxy — an automation
  artifact, unrelated to this change and reproducible before it. Receipts were created through the
  API with a real token instead; every rendering check still ran in the browser.
- **Journey 8.14 in `/validate` still describes the mobile crop strip** that iteration 16 deleted and
  replaced with the popover. Pre-existing staleness, noted rather than fixed, since rewriting a
  neighbouring journey is outside this diff.
- **No unit test covers `PdfSource` or `ZoomableSourceViewport`.** Deliberate: jsdom computes no
  layout, performs no hit-testing and paints no canvas, so the only honest coverage is
  `pdfRender.ts`'s pure functions plus the browser journey. `SourceDocumentPanel` had no unit test
  before this either.
- **Text selection and search inside the PDF are not offered.** This is a highlighting surface, not a
  PDF reader; "Open in a new tab" still gives the real document.
