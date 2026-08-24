# Iteration 15 — Source-document field highlighting

**Plan:** `.agents/plans/source-field-highlighting.md`
**Spec:** `.agents/specs/source-field-highlighting.md`
**Commit:** uncommitted

## What was built

On the review page, every extracted field is now outlined on the source photo with a coloured,
unfilled quadrilateral positioned exactly over the text Azure read it from. Outline colour matches
the field's form section (seller/buyer/receipt/VAT/items), and each section legend carries a matching
colour badge. Focusing a form input raises its outline to full emphasis; clicking an outline focuses
the matching input. On a narrow viewport, focusing a field opens a fixed strip below the header,
zoomed to that field's location on the receipt, without moving anything else on the page.

The geometry is derived entirely from `raw_provider_result`, which the extraction pipeline has always
retained in full — no Azure call, no migration and no backfill were needed, and the feature works
immediately on every receipt already in the database. `GET /api/receipts/:id/regions` normalises
Azure's polygons to page-relative fractions server-side, so the client never measures anything to
draw the SVG overlay (`viewBox="0 0 1 1"`, `preserveAspectRatio="none"`). PDF receipts keep their
existing native viewer, with a translated note explaining that highlighting is unavailable there.

## Process note

This iteration was executed by one agent from `.agents/plans/source-field-highlighting.md`, which
deliberately stopped short of full validation, hosted integration coverage and real-browser checks
and handed off. This history file was completed by a second pass that ran that validation, found and
fixed defects it surfaced, and closed out the documentation. Both passes are folded into one record
below rather than kept as separate history files, since the roadmap's template describes one
completed task.

## Files created / modified

**Shared**

- `shared/src/api.ts`, `shared/src/index.ts` — `sourceRegionSchema` / `sourceRegionsResponseSchema`
  (field named `corners`, not `polygon` — the latter is banned by `shared/src/receipt.test.ts`'s
  provider-independence guard).

**API**

- `api/src/providers/document-extraction/field-aliases.ts` — new. The single alias table now shared
  by the canonical value mapper and the region mapper, so the two cannot resolve different Azure
  fields for the same canonical name.
- `api/src/providers/document-extraction/content-markers.ts` — new. `stripContentMarkers` moved out
  of `azure.ts`, now returns an index map (`toSourceOffset`) so a match found in marker-stripped text
  can be translated back to the true offset into Azure's original `content` string.
- `api/src/providers/document-extraction/source-regions.ts` — new. `mapSourceRegions` is the read-time
  projection: calls the real `mapAnalyzeResult` first and only emits a region for a field the value
  mapper actually populated (including `unreadableFields`), so a box can never point at a value the
  form does not show. Recomputes the Croatian text-fallback offsets fresh from the stored `content`
  on every call — nothing from extraction time is persisted for this purpose, which is what makes the
  feature retroactive.
- `api/src/providers/document-extraction/azure-fields.ts`, `azure.ts`, `croatian.ts` — refactored to
  read from `field-aliases.ts` and to report match offsets (`{ value, start, end }` via the regex `d`
  flag), with no change in extraction behaviour.
- `api/src/repositories/receipts.ts` — `findProviderResultById`.
- `api/src/routes/receipts.ts` — `GET /:id/regions`, owner-scoped and soft-delete-filtered by the
  existing repository pattern; degrades to `{ pages: [], regions: [] }` for a stored result with no
  analysable shape rather than erroring.
- `api/src/routes/receipts.integration.ts` — one added test proving the endpoint's ownership scoping
  and its graceful-empty behaviour against the hosted project.

**Client**

- `client/src/review/regionSections.ts` — canonical field path → form section → colour (plain hex
  values; Tailwind cannot see dynamically built class names).
- `client/src/review/SourceOverlay.tsx` — the SVG overlay.
- `client/src/review/ActiveRegionStrip.tsx` — the mobile crop strip.
- `client/src/review/SourceDocumentPanel.tsx` — accepts regions/active-field props; the image wrapper
  no longer uses `object-contain` (which would offset the overlay from the image); adds the EXIF
  aspect-ratio safety check; adds the PDF not-available note.
- `client/src/routes/ReviewPage.tsx` — fetches regions once per receipt; lifts `activeField`,
  `source` and `overlaySafe` state; wires focus/blur/click to the bidirectional link; adds section
  colour badges to each fieldset legend.
- `client/src/api/client.ts` — `getReceiptRegions`.
- i18n: `review.highlightsUnavailablePdf` in both `en.json` and `hr.json`.

**Docs**

- `README.md` — the new endpoint, the review-page paragraph on how highlighting works and degrades,
  and the extraction-section paragraph on where the geometry comes from.
- `.claude/commands/validate.md` — Phase 4 rows for the five new/extended test files, Phase 6.17 (the
  regions response is always forced through the strict shared schema before it can reach a client),
  and Phase 8.14 (the end-to-end journey, including why none of it is safely assertable from jsdom).
- `.agents/ROADMAP.md` — iteration 15 recorded in the iterations table.

## Decisions made

- **Regions follow `original_extraction`, not the user's edited value.** After a correction, a
  field's outline keeps marking where OCR actually read from. This is deliberate: it is what makes a
  mis-attribution visible, and it is provenance rather than a claim about the current form value.
- **No overlay on/off toggle.** Left as an open question in the spec; a real dense receipt did not
  make the case for one, but this should be revisited if a user reports the overlay feels noisy.
- **`origin: "text"` regions render identically to `origin: "model"` ones** — no dashed-outline
  distinction was added. The field exists in the API contract for future use if this turns out to
  matter.
- **PDF highlighting stays out of scope for this iteration**, exactly as the spec decided: the native
  `<object>` PDF viewer is a sealed context nothing can be drawn over, and the interaction model
  (bidirectional linking, mobile centering) was unproven and better proven cheaply on the image path
  first.

## Deviations from the plan

None in shape — all 19 tasks from the plan were implemented essentially as specified, including the
two corrections made during planning review (recomputing fallback offsets at read time rather than
threading them from extraction; deriving populated regions from the real value mapper rather than
from alias resolution alone). The deviations that did happen were defects found during validation,
not plan changes, and are recorded below since they are the substantive news from this iteration.

## Validation results

### Automated

| Check | Result |
| --- | --- |
| `npm run lint` | Pass, zero errors (after two fixes below) |
| `npm run typecheck` | Pass, exit 0 |
| `npm run format:check` | Pass |
| `npm test` | Pass: **41 files, 372 tests** (was 358 before this iteration) |
| `npx vitest run --project shared/api/client` | 137 / 103 / 132 — sums to the full-suite total, no stale project name |
| `npm run build` | Pass; only the pre-existing >500 kB JS bundle advisory |
| `npm run test:integration` (hosted) | Pass: 8 auth + 3 repository + **15** route (was 14; added the regions-endpoint test) |
| Phase 7a (Docker migrations) | Skipped, legitimately — no file under `supabase/migrations/` changed |
| `/validate` 6.5, 6.9, 6.15 | Pass (the checks this diff actually implicates; the full Phase 6 sweep was not re-run since nothing else in this diff touches secrets, logging, money types, or route ordering beyond `/regions`, which sits safely past `/:id/source`) |

### Defects found only by driving a real browser, and fixed

Three real bugs were found in this pass. None were caught by 371 passing unit tests, and each is the
same class of failure this project has hit before: jsdom computes no layout and performs no real
pointer-event hit-testing, so a component can look completely correct in every test and be broken in
a way only visible on screen.

1. **The desktop image was silently distorted on tall receipts.** Code review (not yet the browser)
   caught this: the image wrapper carried both `aspect-ratio` and `max-h-[65dvh]` with an explicit
   `w-full` width. When the height cap actually binds — true for the tallest fixture in the dataset,
   564×1500 — CSS cannot satisfy a fixed width, a fixed max-height and an aspect-ratio all at once,
   and the browser stretches the image non-uniformly to fill the mismatched box. The SVG overlay
   would have scaled by the identical factor, so the *boxes* would still have lined up — but the
   *photo* would look visibly squashed to the user, on exactly the receipt shape this product exists
   to handle. Fixed by giving the wrapper an explicit `width: min(100%, 65dvh * ratio)`, which
   resolves `height = width / ratio` unambiguously instead of relying on flex shrink-to-fit
   behaviour. Verified in a real browser against the 564×1500 fixture: rendered ratio matched natural
   ratio to five decimal places, and the box's height landed exactly at the 65dvh budget.

2. **An inactive region's clickable area was a 1px line, not its box.** Inactive polygons were drawn
   with `fill="none"`; a browser only dispatches pointer events where something is actually painted,
   so only the thin stroke — not the interior — was clickable. `fireEvent.click` in the existing unit
   test dispatches directly on the DOM node and does not perform real hit-testing, so this passed
   every test while being nearly unusable in practice. Caught by clicking the visual centre of a real
   rendered box in Chromium and finding nothing happened. Fixed by always painting a (possibly fully
   transparent) fill and setting `pointer-events: all` explicitly, and locked in with a new test that
   asserts both properties — a static guard against the specific regression, since jsdom still cannot
   prove real clickability.

3. **The mobile crop strip centred the wrong point — always the middle of the whole photo, never the
   focused field.** The original `translateY` formula assumed the strip's viewport was the same
   height as the full receipt image, when the two are unrelated: a 954px-tall rendered image inside a
   236px-tall strip. The Y translate math resolved to exactly `H/2` regardless of which field's
   `centerY` was passed in — provably, algebraically, once traced through. On screen this meant every
   field showed a blank grey box, because the transformed image was positioned far below the strip's
   clipping window. Fixed by measuring the strip's real pixel size via a callback ref (not
   `useLayoutEffect` keyed on the active region, which was tried first and found to miss the strip's
   own mount — a second, related bug in the same code) and solving the `scale ∘ translate` composition
   in real pixels rather than ambiguous box-relative percentages. Verified for a field near the top of
   the receipt and a field near the bottom of the receipt, both correctly centred and legible; also
   verified that `document.documentElement.scrollHeight` is unchanged whether the strip is shown or
   hidden, confirming the whole point of using `position: fixed` — no layout shift.

### Real-browser verification performed

Chromium via `agent-browser`, disposable `uicheck-15-` account, cleaned up afterward (storage objects
removed, user deleted, cascade confirmed via `receipts` row count).

- Uploaded `racun-mobilna-trgovina.jpg` (the tallest, most extreme fixture — 564×1500, and one of the
  three fixtures carrying a `:barcode:` marker, so it also exercises the marker-offset-shift path) and
  let it go through a real Azure extraction.
- **Desktop, 1440×1000.** 32 regions rendered; image rendered ratio matched natural ratio (no
  distortion, post-fix); SVG bounding box matched the image's bounding box exactly; focusing `total`
  raised exactly one polygon to active emphasis; clicking a different, inactive polygon's interior
  (post-fix) correctly focused `sellerName`.
- **Mobile, 390×844.** Focusing `sellerName` showed the crop strip correctly zoomed on "Semovcanka
  Nova j.d.o.o."; focusing `total` (much lower on the receipt) correctly re-centred on "103,69";
  `scrollHeight` identical with the strip shown and hidden.
- **PDF.** Uploaded `primjer-pdf-racuna.pdf`; the native PDF viewer rendered unchanged; the translated
  "Field highlighting is not available for PDF receipts." note appeared beneath it; no overlay was
  attempted; no console errors.

### Not verified in this pass

- **A genuine EXIF-rotated phone photo.** The aspect-ratio safety check (client-side, comparing
  `naturalWidth/naturalHeight` against the API's `aspectRatio`) is implemented and unit-tested, but a
  screenshot or re-saved file typically has EXIF orientation stripped, so this specific guard has not
  been exercised against a real mis-oriented image. It joins the existing real-device checklist.
- **Croatian-language pass of the highlighting UI specifically.** The section legends and the PDF note
  use existing, already-parity-tested translation keys, so this is lower risk than most unverified
  items, but it was not looked at directly in this session.
- **A receipt genuinely analysed before this feature existed**, as opposed to one analysed during this
  session's own testing. The retroactivity claim rests on `mapSourceRegions` deriving everything from
  `raw_provider_result` with no dependency on anything written at extraction time — true by
  construction and by the fixture tests, which use recordings made months before this feature — but
  was not spot-checked against a specific old row in the browser.

## Known gaps / follow-ups

- PDF highlighting remains out of scope (spec decision, not a defect).
- No overlay on/off toggle (open question in the spec, left open).
- The EXIF real-device check above joins the existing real-device checklist inherited from earlier
  iterations, with no owning task.
- Orientation-change mid-review on mobile (rotating the phone while the crop strip is open) is not
  specifically handled — the strip's measured viewport size is taken once per mount via the callback
  ref and is not re-measured on resize. Low risk (rotating mid-form-fill is an unusual interaction)
  and deliberately not addressed, to avoid adding a `ResizeObserver` for a case with no evidence it
  matters in practice.
