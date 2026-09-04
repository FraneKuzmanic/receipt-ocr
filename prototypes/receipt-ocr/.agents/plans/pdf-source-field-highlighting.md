# Feature: PDF source-document field highlighting

**Iteration:** 22
**Status:** Planned, not started
**Depends on:** iteration 15 (`source-field-highlighting`) and iteration 16
(`16-source-panel-zoom-inspect-popover`), both shipped.
**Supersedes:** the "images only in v1" decision in `.agents/specs/source-field-highlighting.md` §9.

---

## Feature Description

Extend the review page's source-field highlighting — coloured outlines drawn over the exact text
Azure read each value from — to PDF receipts, which iteration 15 deliberately excluded. A PDF must
behave exactly as a photo already does: outlines coloured by form section, focus a field to raise its
outline, click an outline to focus the field (desktop) or open the inspect popover (mobile), plus
zoom, pan and fit.

The user's framing: *"it has to function the same way like it does for the pictures, just for PDFs."*
That is the acceptance bar — not a reduced PDF-specific variant.

## Problem Statement

`SourceDocumentPanel` renders a PDF with `<object type="application/pdf">`, handing the document to
the browser's built-in viewer. That viewer is a sealed context: nothing can be drawn over it,
positioned against it, or measured inside it. So PDF receipts show a translated note
(`review.highlightsUnavailablePdf`) saying highlighting is unavailable, while every extracted value
sits unverifiable against its source.

The iteration 15 spec's stated reason for deferring was **sequencing, not cost**: the interaction
model (bidirectional linking, mobile behaviour, colour legibility) was unproven, so it should be
proven on the cheap image path first. Iterations 15 and 16 did exactly that and the model is now
settled. **The deferral's reason has expired, which is what makes this the right time.**

## Solution Statement

Replace `<object>` with a `<canvas>` rasterised by **pdf.js** (`pdfjs-dist`, legacy build), placed
inside the *existing* zoom/pan container so that every piece of interaction machinery — `sourceZoom`,
`SourceOverlay`, `RegionPopover`, auto-pan-to-focused-field, the aspect-ratio safety guard — is
reused unchanged rather than reimplemented. The API needs no change whatsoever.

---

## Feature Metadata

| Property | Value |
| --- | --- |
| Complexity | Medium — one new dependency, one new component, no API/schema/DB change |
| Primary risk | Bundle weight and a first-time-only dependency load |
| Server changes | **None** |
| Schema / migration | **None** |
| New user-facing copy | Pager label, page-render failure message |
| Retroactive | Yes — works on every PDF already in the database |

---

## EVIDENCE GATHERED DURING RESEARCH

Everything below was measured in this session, not assumed. It is recorded because it is what makes
this iteration small.

### 1. The entire server side is already built and already tested

`api/src/providers/document-extraction/source-regions.ts` normalises Azure polygons by dividing by
the page's own `width`/`height`. Azure reports **pixels for images and inches for PDFs**, and the
division erases the distinction — the client receives unitless 0–1 fractions either way. This was
the original design's keystone and it was written to cover PDFs from the start.

`source-regions.test.ts`'s first test is literally named *"normalizes both pixel and inch
coordinates"* and already runs `primjer-pdf-racuna` (a PDF) through the mapper.

Running the real mapper over the stored fixtures during this research:

| Fixture | Unit | Page size | Regions | Pages used |
| --- | --- | --- | --- | --- |
| `primjer-pdf-racuna` | inch | 8.25 × 11.6667 | **11** | 1 |
| `primjer1-hr-nopdv` | inch | 8.2639 × 11.6806 | **17** | 1 |
| `racuntaksi1` (photo, for comparison) | pixel | 632 × 865 | 10 | 1 |

`primjer1-hr-nopdv` produces regions for `sellerName`, `sellerAddress`, `sellerOib`, `buyerOib`,
`documentNumber`, `paymentMethod`, `subtotal`, `total`, `currency`, `issueDate`, `issueTime`, all
three `vatBreakdown.0.*` cells and all four `items.0.*` cells. **PDFs yield richer highlighting than
the photos this feature already ships for.** The payload is sitting there unused.

`SourceOverlay` already takes a `page` prop and filters regions by it. It needs no change either.

### 2. pdf.js page geometry agrees with Azure's, within the existing safety tolerance

Both PDF fixtures were loaded with pdf.js in Node and their page-1 viewport compared against the
`aspectRatio` the API returns:

| Fixture | pdf.js viewport | pdf.js ratio | API ratio | Δ |
| --- | --- | --- | --- | --- |
| `primjer-pdf-racuna` | 594.4954 × 840.22018 pt, `rotate=0` | 0.7075472 | 0.7071408 | **4.06e-4** |
| `primjer1-hr-nopdv` | 595.2756 × 841.8898 pt, `rotate=0` | 0.7070707 | 0.7074893 | **4.19e-4** |

The residual is Azure rounding its inch dimensions to 4–5 decimals, not a coordinate-system
mismatch. Both sit two orders of magnitude inside the **0.01 tolerance the image path's `overlaySafe`
guard already uses**, so that guard transfers verbatim — see Gotcha 3.

### 3. Use the **legacy** pdf.js build, not the modern one

`pdfjs-dist@6.3.289` (current latest, zero runtime dependencies, one *optional* `@napi-rs/canvas` for
Node-side rendering). The modern build **fails to even import on Node 24.19**:

```text
UnknownErrorException: hashOriginal.toHex is not a function
```

`Uint8Array.prototype.toHex` is from the very recent TC39 uint8array-base64/hex proposal. This
project is mobile-first for Croatian business users on real phones — the last real-device check was a
**Huawei P20 Pro**, not a current flagship — and the client sets no `build.target`, so it inherits
Vite's widely-available baseline, which the modern build exceeds. `pdfjs-dist/legacy/build/pdf.mjs`
is transpiled and polyfilled; it parsed both fixtures in the same Node that rejected the modern
build. It ships its own `pdf.d.mts`, so the deep import is typed.

### 4. Measured cost, replacing the spec's estimate

The iteration 15 spec guessed "roughly 350 KB-plus". Actual, gzipped:

| File | Modern | **Legacy (chosen)** | Loaded |
| --- | --- | --- | --- |
| `pdf.min.mjs` | 131 KB | **151 KB** | Main thread, on demand |
| `pdf.worker.min.mjs` | 375 KB | **392 KB** | Separate worker request, on demand |

Legacy costs +37 KB over modern — cheap insurance. **Both are dynamically imported, so a user who
only ever photographs receipts downloads none of it.** That is the answer to the spec's bundle
objection: the cost lands on PDF users only, and only on their first PDF.

### 5. CORS is not a blocker

`<img>` needs no CORS; pdf.js fetches bytes and does. Checked against the live project:

```text
$ curl -D- -H "Origin: https://receipt-ocr-client.onrender.com" \
    "https://<ref>.supabase.co/storage/v1/object/sign/receipt-sources/...”
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
```

The header is present on Supabase Storage responses. The plan still avoids range requests entirely
(Gotcha 2). No CSP is configured on the Render static site, so no `script-src`/`worker-src` work is
needed — but see Gotcha 6 on `isEvalSupported`.

### 6. Nothing existing breaks

`SourceDocumentPanel` has **no unit test** — only `SourceOverlay`, `RegionPopover`, `sourceZoom` and
`regionSections` are tested, and none of them change. `MAX_UPLOAD_BYTES` is 10 MB, so a PDF always
fits comfortably in one `ArrayBuffer`. `MAX_PDF_PAGES` is 10, which is why the pager below exists.

---

## DECISIONS TAKEN (by the user, during research)

| Decision | Choice | Reasoning |
| --- | --- | --- |
| Multi-page PDFs | **Pager + auto-jump to the focused field's page**, pager row hidden when the document has one page | Today's `<object>` scrolls all pages; rendering only page 1 would be a regression. Auto-jump is what stops a highlight from silently existing on an unseen page. |
| Zoom sharpness | **One render at ~2.5× fitted size (capped 2600 px), CSS-scaled thereafter** | Identical behaviour to the image path, which is literally what "same as pictures" asks for. A debounced re-render queue was rejected as unearned complexity. |
| pdf.js build | **Legacy** | Evidence 3. Not a user decision — an engineering call with measurements. |
| pdf.js failure | **Fall back to today's `<object>` plus the existing note** | Preserves current behaviour exactly on failure and reuses `review.highlightsUnavailablePdf` rather than deleting it. |

---

## CONTEXT REFERENCES

### Read these before writing a line

| File | Why |
| --- | --- |
| `client/src/review/SourceDocumentPanel.tsx` | The whole change lives here. Note `ImageSource` holds *all* zoom/pan/overlay/popover logic; the `<img>` is one leaf inside a transformed div. |
| `client/src/review/sourceZoom.ts` | `FIT`, `clampPan`, `zoomAbout`, `centreOn`, `isRegionVisible`. Reused untouched. |
| `client/src/review/SourceOverlay.tsx` | Already page-filtered. Untouched. |
| `client/src/review/RegionPopover.tsx` | Untouched. |
| `client/src/routes/ReviewPage.tsx` | Two `SourceDocumentPanel` call sites (`interaction="popover"` at ~L328, `interaction="focus"` at ~L506). |
| `.agents/specs/source-field-highlighting.md` §9 | The decision this iteration overturns, and why. |
| `.agents/history/15-source-field-highlighting.md` | The three browser-only defects. Their shapes recur here. |

### New files

| File | Purpose |
| --- | --- |
| `client/src/review/pdfDocument.ts` | Thin pdf.js wrapper: dynamic import, worker wiring, `loadPdf(url)`, `renderPage(doc, page, scale)`. The only module that knows pdf.js exists. |
| `client/src/review/PdfSource.tsx` | The PDF sibling of `ImageSource`. |
| `client/src/review/pdfRender.test.ts` | Pure-math tests for render scale and page selection. |

---

## GOTCHAS — read all seven

**1. Do not build a second zoom/pan implementation.** `ImageSource` is ~250 lines of hard-won
pointer handling: deferred pointer capture (iteration 16 bug 3), `select-none`, the non-passive wheel
listener, the `ResizeObserver`, `suppressClick`. `PdfSource` must reuse that container, not
reimplement it. **The two components should differ only in what they paint inside the transformed
div and in the pager.** If the diff grows beyond that, extract the shared shell instead of
duplicating it — a copy-paste of that pointer logic will drift and re-break in exactly the ways
iteration 16 already fixed.

**2. Fetch the bytes yourself; do not hand pdf.js a URL.** Call `fetch(url)` → `arrayBuffer()` →
`getDocument({ data })`. Passing a URL lets pdf.js attempt HTTP range/streaming requests, whose
preflight and `Content-Range` exposure are extra CORS surface for no benefit on a ≤10 MB file. Also
pass `disableRange: true, disableStream: true` defensively.

**3. Reuse the aspect-ratio safety guard — do not skip it.** The image path sets `overlaySafe` by
comparing the decoded image's ratio to the API's `aspectRatio`, and suppresses the overlay on
mismatch. Do the identical check with `page.getViewport({ scale: 1 })`. Evidence 2 shows it passes
with room to spare on real PDFs, and it fails *safe* on the case nobody has tested: a page with
`/Rotate 90`, where pdf.js applies rotation and Azure's behaviour is unknown. On mismatch, render the
page with no outlines and show the existing unavailable note. **Never draw a box you cannot prove
sits on its text.**

**4. `getViewport({ scale })` must drive both the canvas bitmap and its CSS size.** Set
`canvas.width/height` from the scaled viewport and let CSS size it to the container (`block size-full`,
exactly as the `<img>` does). Getting this wrong distorts the page and silently offsets every outline
— the same class of failure as iteration 15's defect 1.

**5. Cancel in-flight renders on unmount and on page change.** `page.render()` returns a task with
`.cancel()`. Without it, switching pages fast or leaving the route mid-render throws
`RenderingCancelledException` into a dead component, or paints page 2 onto a canvas already showing
page 3. Ignore `RenderingCancelledException`; surface anything else.

**6. Pass `isEvalSupported: false`.** pdf.js otherwise uses `eval` for some font programs. There is
no CSP on the Render static site today, but adding one later must not silently break receipt viewing.

**7. jsdom has no canvas and will not render a PDF.** `HTMLCanvasElement.prototype.getContext`
returns `null` there. Do **not** add a canvas polyfill to `client/src/test/setup.ts` to chase
coverage — it buys a passing test that proves nothing, which is precisely the trap
`.agents/history/12`, `14` and `15` each recorded. Unit-test the pure math in `pdfRender.test.ts` and
prove the rendering in a real browser (Task 9).

---

## STEP-BY-STEP TASKS

### Task 1 — Add the dependency

`npm install pdfjs-dist@6.3.289 --workspace client`. Confirm `@napi-rs/canvas` lands as an *optional*
dependency and is never imported from client code — it is Node-only rendering support and must not
reach the browser bundle.

**Verify:** `npm run build` succeeds; `client/dist/assets/` gains no pdf chunk in the entry bundle
(it must be a lazily-loaded chunk).

### Task 2 — CREATE `client/src/review/pdfDocument.ts`

The only module that imports pdf.js. Exports:

- `loadPdfDocument(url: string)` — `fetch` → `arrayBuffer` → dynamic
  `import("pdfjs-dist/legacy/build/pdf.mjs")`, set `GlobalWorkerOptions.workerSrc` from
  `new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()` (Vite emits it
  as a hashed asset), then `getDocument({ data, isEvalSupported: false, disableRange: true,
  disableStream: true }).promise`. Returns `{ numPages, getPageViewport(n), renderPage(n, scale, canvas) }`
  so no pdf.js type escapes this file.
- Set `workerSrc` exactly once (module-level guard), not per document.

**Verify:** typecheck passes; the deep import resolves types from `legacy/build/pdf.d.mts`.

### Task 3 — CREATE `client/src/review/pdfRender.ts` (pure, testable)

Two functions, no DOM:

- `renderScale(viewportWidthAtScale1: number, cssWidth: number, dpr: number)` → the scale for
  `getViewport`, computed as `(cssWidth * dpr * QUALITY) / viewportWidthAtScale1`, clamped so the
  bitmap's width never exceeds `MAX_CANVAS_WIDTH`. Constants `QUALITY = 2.5`, `MAX_CANVAS_WIDTH = 2600`.
- `pageForField(regions, field, fallback)` → the page number carrying the focused field's region, or
  the fallback. This is the auto-jump rule.

**Verify:** `pdfRender.test.ts` covers a narrow phone viewport, a wide desktop one, `dpr` 1/2/3, the
cap actually binding on a large page, and `pageForField` for a hit, a miss and a null field.

### Task 4 — CREATE `client/src/review/PdfSource.tsx`

Same props as `ImageSource` minus `alt`, plus nothing else. Structure:

1. Load the document once per `url` (Task 2), track `numPages`.
2. `currentPage` state, defaulting to 1.
3. Compute `overlaySafe` by comparing the current page's scale-1 viewport ratio against the API's
   `aspectRatio` for that page (Gotcha 3), and drive the container's `aspectRatio`/`width` style from
   it — reusing the `min(100%, 65dvh * ratio)` formula that fixed iteration 15's distortion bug.
4. Render the current page to a `<canvas>` on `[doc, currentPage, viewport.width]`, at
   `renderScale(...)`, cancelling any in-flight task (Gotcha 5).
5. Place `<SourceOverlay>` as a sibling of the canvas inside the transformed div, passing
   `page={currentPage}` — everything else identical to `ImageSource`.
6. Pager row below the viewport, rendered only when `numPages > 1`: prev / `Page N of M` / next, 44 px
   targets, `aria-label`led, disabled at the ends.
7. Auto-jump: when `activeField` changes, `setCurrentPage(pageForField(...))` before the existing
   auto-pan effect runs.

**Reuse, do not copy:** the zoom container, pointer handlers, wheel listener, `measureRef`,
`ResizeObserver`, `suppressClick`, `RegionPopover` and the zoom-button row are all identical to
`ImageSource`. Extract them into a shared shell component (`ZoomableSourceViewport`) that takes the
painted surface as `children` and the pager as an optional slot, then have **both** `ImageSource` and
`PdfSource` use it. See Gotcha 1.

### Task 5 — UPDATE `client/src/review/SourceDocumentPanel.tsx`

Route `isPdf` to `<PdfSource>` instead of `<object>`. Keep `<object>` + `review.highlightsUnavailablePdf`
as the fallback branch when the PDF fails to load or the aspect-ratio guard fails. Keep the "Open
original" link exactly as it is.

### Task 6 — ADD i18n copy (`en.json` + `hr.json`)

- `review.pdfPage` — `"Page {{current}} of {{total}}"` / `"Stranica {{current}} od {{total}}"`
- `review.pdfPreviousPage`, `review.pdfNextPage` — button `aria-label`s
- `review.pdfRenderFailed` — shown with the `<object>` fallback

`review.highlightsUnavailablePdf` is **kept**, not deleted — it is now the fallback's message.

**Verify:** `client/src/i18n/i18n.test.ts` parity test passes.

### Task 7 — UPDATE `README.md`

In the review-page section, replace "highlighting is unavailable for PDFs" with how PDFs now render,
the fallback behaviour, and the note that the geometry comes from the same already-stored Azure
result — no reprocessing, retroactive to every PDF in the database.

### Task 8 — UPDATE `.claude/commands/validate.md`

Hand-extend, never regenerate. Add:

- Phase 4 rows for `pdfRender.test.ts`.
- A Phase 6 check that pdf.js is imported **only** from `client/src/review/pdfDocument.ts` — the
  provider-isolation habit applied to a rendering dependency.
- A Phase 6 check that `client/src/test/setup.ts` contains no canvas polyfill (Gotcha 7).
- Phase 8 journey: open a PDF receipt, confirm outlines, focus/click linking, zoom, and the pager.

### Task 9 — Real-browser verification (mandatory, not optional)

Per `.agents/history/15`, three real defects in this exact component were invisible to a full passing
unit suite. Drive a real browser with `agent-browser`, against both PDF fixtures:

- [ ] Desktop 1440×1000: outlines land on their text; count matches the API's region count.
- [ ] Canvas rendered ratio equals the page's natural ratio (no distortion).
- [ ] Focusing a field raises exactly one outline; clicking an outline's **interior** (not its stroke)
      focuses the right input.
- [ ] Zoom to 250% — text legible; pan works; fit restores.
- [ ] Mobile 390×844: tapping an outline opens the popover and does **not** raise the keyboard.
- [ ] `scrollHeight` unchanged whether the popover is open or closed.
- [ ] A photo receipt still behaves exactly as before (the shared-shell extraction is the risk here).
- [ ] Network tab: no pdf.js chunk is fetched on a photo-only review.

A synthetic multi-page PDF must be produced for the pager (no multi-page sample exists in the
corpus — `pdf-lib` is already an API dependency and can concatenate the two existing fixtures).

---

## TESTING STRATEGY

| Layer | Covers | Notes |
| --- | --- | --- |
| `pdfRender.test.ts` | `renderScale`, `pageForField` | Pure functions, the only part jsdom can honestly prove |
| Existing `sourceZoom`, `SourceOverlay`, `RegionPopover` tests | Unchanged behaviour | Must stay green — the shared-shell extraction is the thing that could break them |
| `i18n.test.ts` | `hr`/`en` parity for four new keys | Existing test, no change |
| Real browser | Everything else | Task 9. Canvas rendering, hit-testing and layout are provable nowhere else |

No API test changes. No integration test changes. No migration.

---

## Definition of done

- [ ] A PDF receipt shows coloured outlines over its extracted values, matching the photo experience.
- [ ] Focus → outline and outline → focus both work, on desktop and mobile.
- [ ] Zoom, pan and fit work on a PDF.
- [ ] A multi-page PDF shows a pager; focusing a field switches to its page.
- [ ] A single-page PDF shows **no** pager row.
- [ ] pdf.js is fetched only when a PDF is actually opened.
- [ ] A PDF that fails to render falls back to today's `<object>` viewer and an honest message.
- [ ] The image path is byte-for-byte unchanged in behaviour.
- [ ] `npm run lint`, `typecheck`, `format:check`, `test`, `build` all pass.
- [ ] Task 9's browser checklist is complete.

## Out of scope

- Text selection or search inside the PDF. This is a highlighting surface, not a PDF reader.
- Re-rendering at zoom for crisper text (decided against; revisit only if it reads as blurry).
- Any change to extraction, warnings, the canonical model, the API or the database.
- Highlighting the QR/barcode region — still deferred, unchanged from iteration 15.
