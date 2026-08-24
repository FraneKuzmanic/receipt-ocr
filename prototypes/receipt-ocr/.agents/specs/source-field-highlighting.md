# Feature Spec — Source-document field highlighting

**Status:** Draft for planning
**Date:** 2026-08-24
**Author:** drafted with the agent, from a client request
**Parent PRD:** [`PRD.md`](../../PRD.md) — this spec refines §7.9 (Review Form) and §11.5 (UX targets)
**Roadmap position:** iteration 15, outside the numbered task list (see [`ROADMAP.md`](../ROADMAP.md) §3)
**Next step:** `/plan-feature Source-document field highlighting`

---

## 1. Summary

On the review page, draw the location of every extracted value directly onto the source receipt.
Each extracted field is outlined with a coloured, unfilled quadrilateral positioned exactly over the
text Azure read it from. The outline colour identifies which section of the review form the value
belongs to, and each form section carries a matching colour badge, so a user can look at the photo
and immediately see what the machine understood, what it took each value from, and what it ignored
entirely.

The review form and the source document become two views of one thing rather than two things a
person has to correlate by eye.

---

## 2. Why this is worth building

The product's central claim is that OCR output is a draft and the human confirms it (PRD §2, core
principle 1). Today that human is asked to verify roughly fifteen values against a photograph of a
crumpled thermal receipt, with no indication of where on the receipt any given value came from. The
work of *finding* the number on the paper is currently the expensive part of review — not reading
it, and not typing it.

Three concrete failures this addresses:

- **Silent mis-attribution.** When Azure reads the wrong number — the cashier's till number as the
  document number, a line-item price as the total — the value looks perfectly plausible in the form.
  The only way to catch it is to locate the true value on the receipt. A box makes the mistake
  visible instantly, because the box is drawn somewhere obviously wrong.
- **Unverifiable fiscal fields.** JIR and ZKI are 32-character hex strings. Nobody proofreads one of
  those against a photo character by character. Being shown exactly which run of text on the receipt
  produced it is the only realistic verification a human can perform.
- **Invisible omissions.** A field left empty is currently indistinguishable from a field the model
  never looked for. Seeing which regions of the receipt carry no box at all tells the user where to
  look for what is missing.

This also directly serves PRD §11.5: *"Source document and review form should be easy to compare."*

---

## 3. Reference implementation: Azure Document Intelligence Studio

The client identified Studio's analysis view as the model to follow, and it is a good one. What
Studio does:

- Renders the analysed document as an image.
- Draws an unfilled, coloured quadrilateral over every extracted field's location.
- Colours the outline by the field's category, and shows the same colour as a badge beside the
  corresponding group in the results panel, so outline and value are linked by colour.

**What we take:** the unfilled coloured quadrilateral, the colour-by-category scheme, and the
matching badges beside each form section.

**What we deliberately change:** Studio is a developer inspection tool with a fixed, large viewport
and a read-only results panel. This is a phone-first correction tool. Two departures follow.

1. **The link is bidirectional and stateful.** Focusing a form input emphasises its box; clicking a
   box focuses its input. Studio has no editable form to link to, so it has nothing equivalent.
   This is the change that converts an inspection view into a correction aid.
2. **The active field is privileged.** All boxes are drawn, but at low emphasis, with the active
   one raised. Studio draws every box at equal weight, which is legible on a 1440 px inspection
   panel and unusable on a 390 px phone showing a 2736 px-wide photo.

---

## 4. Scope

### In scope

- Field-location overlays on **image** sources: JPEG, PNG, HEIC/HEIF.
- Boxes for every canonical field Azure located, including per-cell VAT breakdown and per-cell line
  items.
- Boxes for fields filled by our Croatian text fallbacks (`sellerOib`, `jir`, `zki`,
  `documentNumber`, `issueDate`, `issueTime`), resolved through Azure's per-word spans.
- Colour-by-section outlines, with matching badges on the review form's section legends.
- Bidirectional highlight: form field ↔ box.
- Mobile behaviour that makes a box on a full-page photo actually readable: opening the source
  panel and zooming to the active field.
- Croatian and English copy for everything new.

### Out of scope

- **PDF sources.** Decided below (§9). PDFs keep today's viewer and show an honest note.
- **Editing or drawing boxes.** This is a read-only visualisation. Users correct values in the form,
  never by moving a rectangle. Region-labelling is a training workflow, and custom model training is
  out of scope per PRD §4.7.
- **Highlighting the QR code region.** Azure returns a polygon for each detected barcode and we could
  outline it, but QR data never populates a canonical value (PRD §7.5, and the Task 08 history), so a
  box for it would point at something the form does not contain. Recorded as a possible follow-up.
- **Word-level or character-level highlighting.** Field granularity only.
- **Re-running extraction.** Nothing about this feature calls Azure. See §5.
- **Multi-page documents.** Every source analysed so far is single-page; multi-page arrives with PDF
  support, which is out of scope.
- **Changing what is extracted, or any warning rule.** The overlay is presentation only. It must not
  alter a single canonical value, warning, or confidence.

---

## 5. Evidence: the data already exists

This was verified against the hosted database, not assumed. `api/src/services/receipt-extraction.ts`
persists `raw: operation` — the complete Azure `AnalyzeOperationOutput` — into
`raw_provider_result`, and `api/src/providers/document-extraction/azure.ts` has always done so.

Across the ten most recently analysed receipts:

| Observation                                      | Result                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| Receipts with a complete `analyzeResult` retained | 10 of 10                                                                |
| Image sources                                     | `unit: "pixel"`, page dimensions such as 2736 × 3648, 1920 × 2560, 564 × 1500 |
| PDF sources                                       | `unit: "inch"`, page 8.25 × 11.6667                                     |
| Pages per document                                | 1, in every sample                                                      |
| Document fields carrying `boundingRegions`        | 7 of 8 on photos, 12 of 14 on PDFs                                      |
| The only field without one                        | `Items` — the array *container*. Every array **element** has a box       |
| Line-item sub-cells with boxes                    | `Description`, `Quantity`, `UnitPrice`, `Amount`, `Unit` — all of them  |
| Per-word geometry                                 | `pages[].words[]` each carry `span {offset, length}`, `polygon`, `confidence` |

**Three consequences, and they are the reason this feature is cheap:**

1. **No Azure call, no reprocessing, no cost.** The geometry is a byproduct of extractions already
   paid for.
2. **It works retroactively.** Every receipt in the database, including confirmed ones, can be
   highlighted the moment the code ships. No migration and no backfill.
3. **Nothing about the extraction pipeline changes.** `azure-fields.ts`, the warning engine and the
   canonical model are untouched. This is a new read-side projection over data we already keep.

### The coordinate contract

Confirmed against Microsoft's `analyze-document-response` documentation and against our own stored
results:

- `boundingRegions[]` is `{ pageNumber, polygon }`, `pageNumber` 1-indexed.
- `polygon` is eight numbers — four `(x, y)` points, clockwise from top-left, relative to the
  top-left of the page.
- Coordinates are in the page's `unit`: **pixels for images, inches for PDFs**.
- `pages[].width` / `height` are in that same unit, so a polygon divided by the page dimensions is a
  unitless fraction. **This is the design's keystone** — normalising server-side erases the
  pixel/inch distinction entirely and the client never learns which it was.
- Polygons are **not axis-aligned**. A real sample: `[1037,186, 1307,195, 1306,253, 1036,242]`, a
  quadrilateral skewed by about half a degree on a hand-held photo. Our stored `page.angle` values
  run from -0.25° to +0.40°. Boxes must therefore be drawn as true quadrilaterals, not CSS
  rectangles, or they will visibly fail to sit on the text.

---

## 6. Data design

### 6.1 The canonical region contract

Regions cross the API boundary in an application-owned shape. No Azure vocabulary may appear in it —
PRD §6.2, ROADMAP §5 rule 7, and `shared/src/receipt.test.ts` fails the build over it.

Conceptually:

```ts
interface SourceRegion {
  /** Canonical dotted field paths this region covers, e.g. ["total", "currency"]. */
  fields: string[];
  /** 1-indexed source page. */
  page: number;
  /** Four (x, y) pairs, each a fraction of page width/height in [0, 1]. */
  polygon: number[];
  /** Whether the location came from the model's own field or from a text-span match. */
  origin: "model" | "text";
}

interface SourceRegionsResponse {
  /** Page aspect ratios, so the client can size the overlay without measuring the image. */
  pages: { page: number; aspectRatio: number }[];
  regions: SourceRegion[];
}
```

Two deliberate details:

- **`fields` is a list, not a single name.** `currency` is read from the same Azure field as `total`,
  so both canonical fields resolve to one identical polygon. Drawing two coincident rectangles would
  produce a visibly doubled border. One region owning both names is the honest representation, and
  it makes either input emphasise the same box.
- **The field path convention is the one already in use.** `total`, `vatBreakdown.0.rate`,
  `items.2.unitPrice` — byte-identical to the paths `ReceiptWarning.field` and `lowConfidenceFields`
  already use. A region therefore joins to a warning and to a confidence flag by plain key equality,
  with no translation layer.

### 6.2 API surface

A dedicated endpoint, derived on demand:

```text
GET /api/receipts/:id/regions   →   200 SourceRegionsResponse
```

Owner-scoped and soft-delete-filtered by the same repository call every other receipt route uses, so
another user's id returns `404`, never `403`, with no new ownership check to keep in sync.

**Why a separate endpoint rather than extending `GET /api/receipts/:id`:**

- It keeps a parse of the full provider result off the editing hot path. `GET /:id` and `PATCH /:id`
  return the same body and `PATCH` fires on every save; neither should pay to re-derive geometry that
  cannot have changed.
- The source panel is already a lazily-mounted component doing its own fetch for the signed URL.
  Regions are needed exactly when and where it mounts, and never on the history list.
- It mirrors `GET /:id/source`, so it is the shape a reader already expects.

**Why derived on demand rather than written into `extraction_metadata` at extraction time:** deriving
needs no migration, no backfill and no reprocessing, and it works for every receipt already in the
database. If profiling later shows the parse is hot, it can be memoised into `extraction_metadata`
without changing the response contract — the projection function is the same code either way.

### 6.3 Field coverage

The region mapper must resolve the *same* Azure field, by the *same* alias precedence, as
`azure-fields.ts` did when it produced the value. If the two disagree the box points at text the form
does not contain — a wrong answer that looks right.

**This is the single sharpest correctness risk in the feature.** The alias table must be extracted
into one shared constant consumed by both the value mapper and the region mapper, so they are
structurally incapable of drifting. Duplicating the list and keeping them in sync by discipline is
not acceptable.

| Canonical field         | Located from                                                       | Origin        |
| ----------------------- | ------------------------------------------------------------------ | ------------- |
| `sellerName`            | `VendorAddressRecipient` → `VendorName` → `MerchantName`            | model         |
| `sellerAddress`         | `VendorAddress` → `MerchantAddress`                                 | model         |
| `sellerOib`             | `VendorTaxId`, else the `OIB` text match                            | model or text |
| `buyerName`             | `CustomerName`                                                      | model         |
| `buyerAddress`          | `CustomerAddress`                                                   | model         |
| `buyerOib`              | `CustomerTaxId`                                                     | model         |
| `documentNumber`        | `InvoiceId`, else the document-number text match                    | model or text |
| `issueDate`             | `InvoiceDate` → `TransactionDate`, else the date text match         | model or text |
| `issueTime`             | `TransactionTime`, else the time text match                         | model or text |
| `subtotal`              | `SubTotal` → `Subtotal`                                             | model         |
| `total`                 | `InvoiceTotal` → `Total`                                            | model         |
| `currency`              | shares `total`'s region                                             | model         |
| `paymentMethod`         | `PaymentTerm`                                                       | model         |
| `jir`                   | the `JIR` text match only                                           | text          |
| `zki`                   | the `ZKI` text match only                                           | text          |
| `vatBreakdown.N.*`      | `TaxDetails[N]` sub-fields                                          | model         |
| `items.N.*`             | `Items[N]` sub-fields — confirmed present on all cells              | model         |

A field with no locatable region simply has no box. Missing stays missing (PRD §7.7); the overlay
must never guess a position.

### 6.4 Text-fallback regions

`applyTextFallbacks` fills six fields by regex over Azure's concatenated `content` string. Those
carry no `boundingRegions` of their own, but every word in `pages[].words[]` carries both a
`span {offset, length}` into that same `content` and a `polygon`. A match's character range therefore
resolves to a set of words, and those words' polygons resolve to a box.

Three requirements, each of which is a way to get this silently wrong:

1. **The matchers must report offsets, not just values.** `croatian.ts` currently returns
   `expression.exec(content)?.[1]`, discarding position. Adding the `d` (`hasIndices`) flag to each
   pattern makes `match.indices[1]` give the capture group's exact `[start, end)` directly. Deriving
   the offset by searching for the captured substring inside the full match is fragile and must not
   be used.

2. **The marker-stripping offset shift must be corrected.** `azure.ts` calls the matchers with
   `stripContentMarkers(content)`, which deletes `:barcode:`, `:formula:`, `:selected:` and
   `:unselected:` markers. Word spans index into the **unstripped** content. An offset taken from the
   stripped string is therefore short by the total length of every marker removed before it, and a
   box built from it lands on the wrong text — plausibly, and further down the receipt the more
   markers precede it. Stripping must produce an index map alongside the text so a stripped offset
   can be translated back. Running the matchers on the unstripped content instead is not an
   acceptable shortcut: the markers exist precisely because they corrupt the matches.

3. **Multi-word spans need an envelope.** A single-word match keeps that word's exact quadrilateral.
   A match spanning several words takes the axis-aligned bounding box of all their points. This
   slightly over-covers skewed multi-word text, which is the correct trade: an outline marginally
   larger than the text still points unambiguously at it, whereas a tighter shape risks clipping.

Regions from this path are marked `origin: "text"`, which the UI may use to render them slightly
differently, and which makes the two location mechanisms distinguishable in debugging.

---

## 7. Rendering

### 7.1 The overlay

An inline `<svg>` absolutely positioned over the `<img>`, both inside a wrapper whose aspect ratio is
fixed to the page's:

```text
wrapper   position: relative; aspect-ratio: <from pages[].aspectRatio>
  img     width: 100%; height: 100%; display: block
  svg     position: absolute; inset: 0; viewBox="0 0 1 1"; preserveAspectRatio="none"
    polygon points="…"  (normalised 0–1 coordinates, straight from the API)
```

`viewBox="0 0 1 1"` with `preserveAspectRatio="none"` means the normalised coordinates map onto the
image box directly, with **no JavaScript measurement at any point** — no `ResizeObserver`, no
`naturalWidth` arithmetic, no recalculation on resize, rotation, or font-size change. The overlay is
correct at every viewport by construction. This is the main reason to normalise server-side.

Two mechanical consequences:

- **The current `object-contain` sizing must go.** `object-contain` letterboxes the image inside its
  box, so the image's real rectangle is not the element's rectangle and the overlay would be offset.
  The wrapper takes the intrinsic aspect ratio instead, and any height cap applies to the wrapper.
- **Strokes need `vector-effect="non-scaling-stroke"`.** Under `preserveAspectRatio="none"` the two
  axes scale by different factors, which would render a uniform stroke as visibly thicker on one
  axis. `non-scaling-stroke` keeps the outline a constant width in screen pixels, which is also what
  keeps a 1.5 px border legible on both a 390 px phone and a 1440 px desktop.

### 7.2 EXIF orientation — the one thing that can silently break this

Browsers apply a JPEG's EXIF orientation tag when rendering, rotating the displayed image relative to
its stored pixel buffer. Azure reports page dimensions from its own decode. If the two disagree, every
box is rotated or transposed relative to what the user sees, and the feature is confidently,
uniformly wrong.

Our stored samples are all portrait with plausible dimensions, which is consistent with orientation
having been handled — but that is inference, not proof, and the receipts came from a small number of
devices.

**Required mitigation:** on image load, compare `img.naturalWidth / img.naturalHeight` against the
`aspectRatio` the API returned. Matching within a small tolerance means the overlay is trustworthy;
transposed means EXIF rotation was applied and the overlay must be suppressed rather than drawn
wrong. Silence beats a confident lie, and this check costs four lines.

This must be verified with a real photo from a real phone in a real browser. It is precisely the
class of defect the ROADMAP records twice already — the `inert` drawer and the collapsed spinner
glyph — where jsdom computes no layout and every unit test passes against broken rendering.

### 7.3 Colour by section

The review form already has exactly five sections, and they become the five categories. The badge
next to each section legend reuses that section's existing translated label, so the legend needs no
new copy and cannot drift from the form.

| Section  | Existing key     | Colour family                                    |
| -------- | ---------------- | ------------------------------------------------ |
| Seller   | `review.seller`  | violet                                           |
| Buyer    | `review.buyer`   | teal                                             |
| Receipt  | `review.receipt` | blue — the app accent, for the critical fields   |
| VAT      | `review.vat`     | fuchsia                                          |
| Items    | `review.items`   | green                                            |

**Amber is reserved and must not be used for any category.** The whole app already reads amber as
"this field needs your attention" (iteration 13, and the `ReviewField` component). A category
happening to be amber would collide with the one convention the review screen has.

Hues must be checked against real thermal-receipt photography — white and grey paper, sometimes
yellowed, often blown out by flash — not against a white mockup.

---

## 8. Interaction and accessibility

### 8.1 Desktop

- All regions draw at low emphasis: thin outline, no fill, section colour.
- Hovering or focusing a form input raises its region: thicker stroke, full-opacity colour, and a
  faint tint fill so it separates from a busy receipt.
- Clicking a region focuses its form input and scrolls it into view. Where a region owns several
  fields, the first is focused.
- The section badges are a key, not a control. Filtering by section is a plausible refinement and is
  deliberately deferred until someone asks for it.

### 8.2 Mobile

On a phone the source panel is a collapsed `<details>` and a full-page photo makes a box around a
price a handful of pixels tall. Without a zoom the feature would technically ship and practically be
unusable on the product's primary device, which PRD §11.5 will not accept.

Focusing a form input therefore: opens the source panel if closed, brings it into view, and zooms the
image so the active region occupies a comfortable share of the panel. A "fit" control returns to the
whole receipt, and zoom is capped so the user cannot get lost in a magnified blur.

**A layout-shift hazard to design around, not discover.** The `<details>` panel is rendered *above*
the fieldsets. Expanding it on focus pushes every input downward, moving the very field the user just
focused out from under their thumb — a worse experience than no feature. The panel must therefore
either occupy reserved space, become sticky while a field is active, or the focused input must be
re-scrolled into view after expansion. Whichever is chosen must be verified in a real browser at
390 px, because this is a layout behaviour and jsdom will report success regardless.

Zoom transitions must respect `prefers-reduced-motion`.

### 8.3 Accessibility

- The SVG overlay is `aria-hidden`. It is a visual aid, and every piece of information it conveys is
  already available through the form: the label names the field, `aria-describedby` carries warnings
  and low-confidence hints. Inventing an ARIA pattern for decorative geometry would add noise, not
  access.
- Clicking a region is therefore a **pointer-only enhancement**. Nothing may be reachable only by
  clicking a box. Keyboard and screen-reader users lose no capability.
- **Colour is never the sole channel** (WCAG 1.4.1). A region's meaning is carried by the form field
  it is linked to; the badge carries its section's text label; the active region is distinguished by
  stroke weight and fill as well as by hue.
- The existing global `:focus-visible` outline policy applies unchanged to any new control.

### 8.4 Internationalisation

Every new string ships in `hr` and `en` (PRD §7.13). New copy is small: the PDF-unavailable note, the
zoom/fit control labels, and an overlay toggle if one is added. Section badges reuse existing keys.
Locale parity is enforced by `client/src/i18n/i18n.test.ts`.

---

## 9. PDFs

Today `SourceDocumentPanel` renders a PDF with `<object type="application/pdf">`, which hands the
document to the browser's own viewer. That viewer is a sealed context: **nothing can be drawn over
it**, positioned against it, or measured inside it. There is no overlay solution for PDFs that keeps
the current viewer.

The three real options, and why v1 takes the first:

| Option                              | What it costs                                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Images only in v1** *(chosen)*    | Nothing. The overlay is a pure addition to the image path, and PDFs behave exactly as they do today plus an honest note.                                                        |
| Render PDFs with pdf.js             | A lazily-loaded dependency of roughly 350 KB-plus, its own worker, and page navigation and zoom code, on top of a bundle already carrying a >500 KB advisory. Roughly doubles the feature. |
| Rasterise PDFs server-side          | A native binary (pdfium/poppler) on Render's free tier, extra storage per receipt, and a backfill for existing PDFs.                                                            |

The decisive argument is not size but sequencing: the interaction model — bidirectional linking,
mobile zoom, colour legibility on real receipts — is unproven. Proving it on the image path, which is
also the phone-capture path the PRD calls primary, costs nothing extra. Committing to a PDF rendering
stack before knowing whether the interaction works would be building the expensive half first.

**Required in v1:** a PDF source shows a clear, translated note that field highlighting is not
available for PDF receipts. It must not fail silently, and it must not look broken.

---

## 10. Risks

| Risk                                                                | Impact | Mitigation                                                                                                                                                    |
| ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXIF orientation makes every box wrong, confidently and uniformly    | High   | Compare `naturalWidth/naturalHeight` against the API's aspect ratio on load; suppress the overlay on mismatch. Verify with a real phone photo in a real browser. |
| Region mapper and value mapper resolve different Azure aliases       | High   | One shared alias table consumed by both. Not two lists kept in sync by discipline.                                                                              |
| Marker-stripping offset shift puts fallback boxes on the wrong text  | High   | Return an index map from stripping; unit-test a receipt whose content contains a `:barcode:` marker before a fiscal field.                                     |
| Boxes drawn as rectangles look wrong on skewed photos                | Medium | Draw true quadrilaterals. Our real samples are skewed by up to 0.4°.                                                                                            |
| The overlay makes a dense receipt harder to read, not easier         | Medium | Low emphasis by default with only the active region raised; verify on the busiest real receipt available, not a clean sample.                                   |
| Expanding the mobile panel on focus pushes the focused field away    | Medium | Designed for in §8.2, and verified at 390 px in a real browser.                                                                                                 |
| Azure field names leak into the API or UI                            | High   | The projection is canonical by construction; `shared/src/receipt.test.ts` and `/validate` guard it. Add a check that the regions response contains no Azure name. |
| Colour choices fail on real receipt photography                      | Low    | Check against genuine photos including flash-blown and yellowed paper.                                                                                          |

---

## 11. Definition of done

- [ ] A photographed Croatian receipt in review draws an unfilled, correctly-positioned outline over
      every field the form shows a value for.
- [ ] Outlines are true quadrilaterals and visibly sit on skewed text on a hand-held photo.
- [ ] Focusing a form input raises its outline; clicking an outline focuses its input.
- [ ] `total` and `currency` share exactly one outline, not two coincident ones.
- [ ] VAT cells and line-item cells each carry their own outline.
- [ ] `jir`, `zki` and `sellerOib` carry outlines when filled by the Croatian text fallbacks, and
      those outlines sit on the right text on a receipt whose content contains a `:barcode:` marker.
- [ ] A field with no locatable region simply has no outline; nothing is invented.
- [ ] Each form section shows a colour badge matching its outlines, in both languages.
- [ ] At 390 px, focusing a field opens the source panel, zooms to the field, and does **not** push
      the focused input out from under the user. Verified in a real browser.
- [ ] A PDF receipt shows the translated not-available note and nothing broken.
- [ ] `GET /api/receipts/:id/regions` returns `404` for another user's receipt and for a
      soft-deleted one.
- [ ] No Azure field name appears in the regions response, anywhere.
- [ ] No canonical value, warning, confidence flag or extraction record changes as a result of this
      feature.
- [ ] An image whose rendered aspect ratio disagrees with the API's suppresses the overlay rather
      than drawing it wrong.
- [ ] Full `/validate` passes, including a new Phase 8 journey for this flow.

---

## 12. Decisions taken

Recorded so they are not relitigated during planning.

| Decision                    | Choice                                            | Rationale                                                                                                                             |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PDF support                 | Images in v1; PDF a separate follow-up            | No overlay is possible over the native PDF viewer, and every alternative is large. The interaction model is unproven; prove it on the phone-capture path first. |
| Display model               | All regions at low emphasis, active one raised     | Keeps Studio's overview while making the feature useful for correcting a specific value on a dense receipt.                            |
| Mobile ambition             | Open the panel and zoom to the active field        | A box on a full-page photo at 390 px is a few pixels tall. Without zoom the primary device gets a decoration, against PRD §11.5.        |
| Text-fallback fields        | Give them regions via word spans                   | JIR, ZKI and OIB are the fields a human can least verify by eye and the ones most specific to Croatian receipts. Confirmed feasible.    |
| Where geometry comes from   | Derived from retained `raw_provider_result`        | Already present for every existing receipt. No Azure call, no migration, no backfill, no reprocessing cost.                            |
| Coordinate normalisation    | Fractions of page width/height, server-side        | Erases the pixel-vs-inch distinction, and lets the client render with zero measurement.                                                |
| API shape                   | A dedicated `GET /:id/regions`                     | Keeps the provider-result parse off the `GET`/`PATCH` editing hot path; mirrors `/source`; loads exactly where the source panel mounts. |
| Field path convention       | Reuse the warning/low-confidence dotted paths      | A region joins to a warning and a confidence flag by key equality, with no translation layer.                                          |

---

## 13. Open questions for planning

1. **Is an overlay on/off toggle needed?** A user who finds the boxes noisy has no escape today. A
   toggle is small, but so is the risk of adding a control nobody uses. Decide from looking at a real
   dense receipt with the overlay on.
2. **Should `origin: "text"` regions look different?** A dashed outline would honestly signal "we
   found this by matching text, not because the model located it". It may equally be a distinction
   only we care about.
3. **Confirmed receipts.** The overlay is presumably as useful when revisiting a confirmed record as
   when reviewing a fresh one, but that should be an explicit decision rather than a side effect.
4. **Edited values.** Once a user corrects `total`, its region still marks where the *original* OCR
   value was read. Keeping it is probably right — it is provenance, and it is what makes a
   mis-attribution visible — but the box will no longer match the text in the input, and that should
   be a deliberate choice.
5. **The exact mobile mechanism** for avoiding the layout shift in §8.2 — reserved space, sticky
   panel, or re-scroll after expansion.

---

## 14. PRD references

§6.2 (provider-independent canonical model) · §7.6 (Azure stays behind the adapter) · §7.7 (never
invent data) · §7.9 (review form; source easy to compare; low-confidence visually noticeable) ·
§7.13 (i18n) · §9.1 and §9.3 (ownership, private source access) · §11.5 (UX targets) · §13 (future
considerations — learning from correction patterns).
