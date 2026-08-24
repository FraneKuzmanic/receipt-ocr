# Feature: Source-document field highlighting

The following plan should be complete, but it is important that you validate documentation, codebase
patterns and task sanity before you start implementing.

Pay special attention to the naming of existing utils, types and models. Import from the right files.

**Spec of record:** [`.agents/specs/source-field-highlighting.md`](../specs/source-field-highlighting.md).
Read it first. It contains the product reasoning, the four decisions already taken, and the evidence
gathered from the hosted database. This plan does not repeat that reasoning; it implements it.

## Feature Description

On the review page, draw the location of every extracted value directly onto the source receipt
image. Each extracted field gets an unfilled, coloured quadrilateral positioned exactly over the text
Azure read it from. Outline colour identifies which section of the review form the value belongs to,
and each form section carries a matching colour badge. Focusing a form input raises its outline;
clicking an outline focuses its input. On a phone, focusing an input opens the source panel and zooms
to the field.

Modelled on Azure Document Intelligence Studio's analysis view, with two deliberate departures: the
link is bidirectional (Studio has no editable form), and the active field is privileged (Studio draws
every box at equal weight, which is unusable at 390 px).

## User Story

As a business user reviewing an extracted receipt
I want to see exactly where on the photo each pre-filled value came from
So that I can verify or correct it without hunting for the number on the paper myself

## Problem Statement

A reviewer is asked to verify roughly fifteen values against a photograph of a crumpled thermal
receipt with no indication of where any value originated. Locating the number on the paper — not
reading it, not typing it — is the expensive part of review. When Azure reads the wrong number, the
value looks entirely plausible in the form and the only way to catch it is to find the true value on
the receipt. And nobody proofreads a 32-character ZKI hex string against a photo character by
character.

## Solution Statement

Project the bounding geometry Azure **already returns and we already persist** into a
provider-neutral, resolution-independent set of regions, expose it on a dedicated endpoint, and
render it as an SVG overlay whose coordinate system requires zero JavaScript measurement.

No Azure call. No reprocessing. No migration. No backfill. The geometry is a byproduct of extractions
already paid for, and the feature works retroactively on every receipt already in the database.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium — high on the client, low on the API
**Primary Systems Affected**: `shared` (one DTO), `api` (one projection module, one route, one
surgical refactor), `client` (review page and source panel)
**Dependencies**: **None.** No new npm package is added. This is deliberate and is a constraint, not
an oversight — see NOTES.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — YOU MUST READ THESE BEFORE IMPLEMENTING

- `.agents/specs/source-field-highlighting.md` — Why: the spec of record. Decisions, evidence, risks.
- `api/src/providers/document-extraction/azure-fields.ts` (whole file, 226 lines) — Why: the value
  mapper. The region mapper must resolve the **same** Azure field by the **same** alias precedence.
  Note `first()` at line 116 and the inline alias arrays at lines 47, 64, 71, 79, 86, 89, 96, 102.
- `api/src/providers/document-extraction/azure.ts` (lines 60–98, 132–134, 152–171) — Why: contains
  `stripContentMarkers` and `applyTextFallbacks`, both of which this feature modifies. Line 71 is
  where the offset-shift bug would originate.
- `api/src/providers/document-extraction/croatian.ts` (whole file, 40 lines) — Why: the six regex
  matchers that must start reporting offsets.
- `api/src/providers/document-extraction/types.ts` — Why: `ExtractionMetadata`,
  `LOW_CONFIDENCE_THRESHOLD`, the provider interface shape.
- `api/src/routes/receipts.ts` (lines 78–93 for the `/:id` pattern, 224–242 for `/:id/source`) —
  Why: the exact route/ownership/404 pattern the new endpoint must mirror.
- `api/src/repositories/receipts.ts` (lines 140–202) — Why: `findSourceById`, `findExtractionState`
  and `findReviewState` are the three-line template for the new `findProviderResultById`.
- `shared/src/api.ts` (whole file, 120 lines) — Why: every endpoint DTO lives here and is *derived*
  rather than redeclared. The new schema goes in this file. See GOTCHA-2 for why it cannot go
  anywhere else.
- `shared/src/receipt.test.ts` (lines 127–143) — Why: **the provider-independence guard**. It bans
  the literal strings `azure`, `prebuilt`, `documentintelligence`, `analyzeresult`, `boundingregion`
  and `polygon` from every `.ts` file in `shared/src`. See GOTCHA-1.
- `client/src/review/SourceDocumentPanel.tsx` (whole file, 84 lines) — Why: the component being
  extended. Note line 62: `object-contain`, which must go.
- `client/src/routes/ReviewPage.tsx` (lines 52–92 `ReviewField`, 210–436 `ReviewForm`) — Why: where
  `activeField` state is lifted to, and where the section legends gain badges.
- `client/src/api/client.ts` (lines 43–72, 132–135) — Why: the single authenticated `request()`
  wrapper. A raw `fetch` anywhere else fails `/validate` 6.9.
- `client/src/routes/ReviewPage.test.tsx` (lines 1–72) — Why: the exact mocking and render harness to
  mirror for new tests.
- `api/src/providers/document-extraction/azure-fields.test.ts` (lines 1–15) — Why: the `fixture()`
  helper that loads recorded Azure responses offline.
- `client/src/index.css` (lines 9–14) — Why: the `@theme` block. See GOTCHA-5 before adding colours
  here.
- `README.md` — the "Review and confirmation" and "Extraction" sections need updating.
- `.claude/commands/validate.md` — Phase 4 table, Phase 6, Phase 8 all need extending.

### Recorded fixtures available (offline, no network, no cost)

`api/src/providers/document-extraction/fixtures/`. Surveyed for this plan:

| Fixture                          | Unit  | Page      | Words | Fields (boxed) | `:barcode:` markers |
| -------------------------------- | ----- | --------- | ----- | -------------- | ------------------- |
| `racuntaksi1.json`               | pixel | 632×865   | 69    | 8 (8)          | **1**               |
| `26515835.json`                  | pixel | 1280×3066 | 68    | 10 (9)         | **1**               |
| `racun-mobilna-trgovina.json`    | pixel | 564×1500  | 116   | 8 (7)          | **1**               |
| `31231822.json`                  | pixel | 1920×2560 | 63    | 8 (7)          | 0                   |
| `images.json`                    | pixel | 387×516   | 134   | 12 (10)        | 0                   |
| `screenshot-20190705-1907152.json` | pixel | 1232×1616 | 97  | 8 (7)          | 0                   |
| `primjer-pdf-racuna.json`        | inch  | 8.25×11.6667 | 123 | 14 (12)      | 0                   |
| `mapper-edge-cases.json`         | —     | no pages  | 0     | 7 (0)          | 0                   |

The three fixtures with a marker are the regression case for GOTCHA-3. `primjer-pdf-racuna` is the
inch-unit case. `mapper-edge-cases` is the null-safety case.

### New Files to Create

- `api/src/providers/document-extraction/field-aliases.ts` — the single alias table consumed by both
  the value mapper and the region mapper.
- `api/src/providers/document-extraction/content-markers.ts` — marker stripping with an index map,
  needed by both extraction and the read-time projection.
- `api/src/providers/document-extraction/source-regions.ts` — the provider→canonical region
  projection.
- `api/src/providers/document-extraction/source-regions.test.ts` — offline fixture tests.
- `client/src/review/regionSections.ts` — canonical field path → form section → colour.
- `client/src/review/regionSections.test.ts` — path mapping including nested and unknown paths.
- `client/src/review/SourceOverlay.tsx` — the SVG overlay.
- `client/src/review/SourceOverlay.test.tsx` — rendering, emphasis, aria, EXIF suppression.
- `client/src/review/ActiveRegionStrip.tsx` — the fixed mobile crop of the active field.
- `client/src/review/ActiveRegionStrip.test.tsx` — visibility rules and transform maths.

### Relevant Documentation

- [Azure — Analyze document response, "Bounding Region"](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/analyze-document-response?view=doc-intel-4.0.0)
  - Specific section: *Element properties → Bounding Region*, and *Layout elements → Page*.
  - Why: defines that `polygon` is four `(x, y)` points clockwise from top-left, that coordinates are
    in the page `unit`, that **images use pixels and PDFs use inches**, and that only 4-vertex
    quadrilaterals are currently returned. Confirmed against our own stored data.
- [Azure — Analyze document response, "Spans"](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/analyze-document-response?view=doc-intel-4.0.0)
  - Specific section: *Element properties → Spans*.
  - Why: spans are character offsets into the top-level `content` string. This is the mechanism that
    gives the Croatian text fallbacks their geometry.
- [MDN — SVG `preserveAspectRatio`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/preserveAspectRatio)
  - Why: `none` is what lets a `0 0 1 1` viewBox stretch to the element box, which is the whole
    reason no JavaScript measurement is needed.
- [MDN — `vector-effect: non-scaling-stroke`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/vector-effect)
  - Why: under `preserveAspectRatio="none"` the axes scale unequally and a plain stroke renders
    visibly thicker on one axis. See GOTCHA-4.
- [MDN — `RegExp.prototype.hasIndices` (`d` flag)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/hasIndices)
  - Why: `match.indices[1]` gives a capture group's exact `[start, end)`. Node 24 supports it.

### Patterns to Follow

**Module resolution differs by workspace.** `api` and `shared` are `nodenext` — relative imports need
a `.js` extension in `.ts` source. `client` is `bundler` — extensionless. Cross-workspace imports use
`@receipt/shared`, never a relative path.

**DTOs are derived, never redeclared** (`shared/src/api.ts`):

```ts
export const updateReceiptRequestSchema = canonicalReceiptFieldsSchema.partial();
```

**Route + ownership** (`api/src/routes/receipts.ts:224`). There is deliberately no separate ownership
check; the repository filters on `user_id` and `deleted_at`, and RLS enforces the same rule:

```ts
router.get(
  "/:id/source",
  authenticated(async (req, res, auth) => {
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) throw new HttpError(400, "invalid_request");
    const repository = new ReceiptRepository(auth.client, auth.userId);
    const source = await repository.findSourceById(id.data);
    if (source === null) throw new HttpError(404, "not_found");
    // …
  }),
);
```

**Repository read** (`api/src/repositories/receipts.ts:162`):

```ts
const { data, error } = await this.#client
  .from("receipts")
  .select("status, extraction_metadata")
  .eq("id", uuidSchema.parse(id))
  .eq("user_id", this.#userId)
  .is("deleted_at", null)
  .maybeSingle();
if (error) throw new ReceiptRepositoryError("query_failed", error);
```

**Client API call** (`client/src/api/client.ts:132`) — always through `request()`, always parsed with
the shared schema:

```ts
export async function getReceiptSource(id: string): Promise<SourceDocumentResponse> {
  const response = await request(`/api/receipts/${encodeURIComponent(id)}/source`);
  return sourceDocumentResponseSchema.parse(await response.json());
}
```

**Error convention.** Stable machine `code`, never prose: `{ "error": { "code": "not_found" } }`. The
client translates it.

**No hardcoded user-facing strings, ever.** Keys are typed against
`client/src/i18n/locales/en.json`; an unknown key is a compile error. Every key needs `hr` and `en`.

**Comment style.** Comments in this codebase explain *why*, usually a decision or a trap, and are
written in full sentences. Match that; do not narrate what the code does.

---

## GOTCHAS — read all nine before writing a line

These are not hypothetical. Each was found while planning, and each produces either a build failure
or a confidently-wrong result rather than an obvious error.

**GOTCHA-1 — `shared/src` bans the word `polygon`.**
`shared/src/receipt.test.ts:132` greps every `.ts` in `shared/src` for
`/azure|prebuilt|documentintelligence|analyzeresult|boundingregion|polygon/i`. Naming the DTO field
`polygon` fails the test suite immediately. **Use `corners`.** Do not weaken the guard to accommodate
a name; `/validate`'s header forbids working around a check, and `corners` is more precise anyway
since there are always exactly four.

**GOTCHA-2 — the region schema must live in `shared/src/api.ts`, not a new module.**
`/validate` Phase 6.8 bans `z.number(` in every `shared/src/*.ts` **except `api.ts`**, to keep money
off floats. Coordinates are genuinely numbers, so a new `shared/src/regions.ts` would fail 6.8 on its
first run. `api.ts` is already exempt and is already where every endpoint DTO lives. Both reasons
point the same way.

**GOTCHA-3 — the marker-stripping offset shift.**
`azure.ts:71` calls the fallback matchers with `stripContentMarkers(analyzeResult.content)`, which
deletes `:barcode:`, `:formula:`, `:selected:` and `:unselected:`. Word `span.offset` values index
into the **unstripped** content. An offset taken from the stripped string is short by the total
length of every marker removed before it, so a JIR box lands on the wrong line — further off the more
markers precede it. Stripping must return an index map. Running the matchers on unstripped content is
**not** an acceptable shortcut: the markers exist precisely because they corrupt the matches (see the
Task 08 history). Three fixtures contain exactly one marker; use them.

**GOTCHA-4 — SVG stroke under `preserveAspectRatio="none"`.**
The two axes scale by different factors, so a uniform `stroke-width` renders visibly thicker on one
axis. Every stroked element needs `vector-effect="non-scaling-stroke"`, which also keeps the outline
a constant screen width at 390 px and 1440 px alike.

**GOTCHA-5 — Tailwind cannot see dynamically built class names.**
`stroke-${section}` or `bg-${colour}` will be purged from the production bundle and work only in dev.
Region colours must be plain hex values in a TypeScript map, applied as an inline `stroke` attribute
on the SVG and an inline `style` background on the badge. Do **not** add these five colours to the
`@theme` block and reach for utility classes.

**GOTCHA-6 — `object-contain` breaks the overlay.**
`SourceDocumentPanel.tsx:62` uses `max-h-[65dvh] w-full object-contain`, which letterboxes the image
inside its element box. The image's real rectangle is then not the element's rectangle and every box
is offset. Replace with a wrapper carrying the page's intrinsic `aspect-ratio`, image at
`w-full h-auto block`, and apply any height cap to the wrapper.

**GOTCHA-7 — `SourceDocumentPanel` is rendered twice.**
`ReviewPage.tsx` mounts it at line 234 (mobile `<details>`) and line 433 (desktop `<aside>`). Both
instances already fetch their own signed URL — a pre-existing inefficiency, **not yours to fix**
(CLAUDE.md §3). But do not make it worse: fetch regions **once** in `ReviewForm` and pass them down
as a prop to both instances.

**GOTCHA-8 — the projection runs at READ time, so nothing may depend on extraction-time state.**
`mapSourceRegions` receives only a stored `analyzeResult` that may have been written months ago. Any
value computed during extraction and not persisted is simply unavailable to it. In particular the
Croatian fallback offsets must be **recomputed** from the stored `content`, not handed in.

This is what makes the feature retroactive, which is its main claim. A design that computed offsets
during extraction would work perfectly for new receipts and silently produce no fiscal-field boxes
for every receipt already in the database — a partial failure that passes every unit test, because
fixtures and fresh uploads both take the working path. **Test the projection against a fixture only;
never against a live extraction, which would hide this.**

**GOTCHA-9 — an Azure field being present does not mean the form has a value.**
`assignText` assigns only when `content` is non-empty (`azure-fields.ts:130`); `assignAmount` only
when `parseAmount` succeeds (line 143); `currency` only when the symbol **and** the code are both
present (line 91). So resolving an alias through `first()` proves nothing about what the user sees.

Emitting a region per resolved alias would therefore draw a `currency` box over the total on every
receipt whose currency Azure could not determine — pointing at a location for a field the form shows
as empty, on a screen whose whole purpose is helping a person trust what they are shown.

The projection therefore asks the **real value mapper** which fields were populated, rather than
re-deriving that judgement. `unreadableFields` are deliberately included: a box over text we found
but could not parse is exactly what helps a user retype it, and that field is already amber from its
warning. Regions reflect `original_extraction`, so they keep marking where OCR read even after the
user edits the value — that is provenance, and it is what makes a mis-attribution visible.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — the contract and the alias table

The shared DTO, and the refactor that makes the value mapper and region mapper structurally unable to
disagree about which Azure field a canonical value came from.

### Phase 2: Core — the server-side projection

Geometry normalisation, text-span resolution for the Croatian fallbacks, and region deduplication.
All offline-testable against recorded fixtures.

### Phase 3: Integration — repository, route, client transport

### Phase 4: Client rendering and interaction

Overlay, colours, bidirectional linking, mobile zoom.

### Phase 5: Testing, documentation and validation

---

## STEP-BY-STEP TASKS

Execute in order, top to bottom. Run each task's VALIDATE before moving on.

### Task 1 — CREATE `api/src/providers/document-extraction/field-aliases.ts`

- **IMPLEMENT**: One exported table of canonical field → ordered Azure alias list, plus the VAT cell
  and line-item cell alias tables. Transcribe **exactly** from `azure-fields.ts`; do not tidy,
  reorder or "improve" any list — alias order is behaviour.

  ```ts
  export const FIELD_ALIASES = {
    sellerName: ["VendorAddressRecipient", "VendorName", "MerchantName"],
    sellerAddress: ["VendorAddress", "MerchantAddress"],
    sellerOib: ["VendorTaxId"],
    buyerName: ["CustomerName"],
    buyerAddress: ["CustomerAddress"],
    buyerOib: ["CustomerTaxId"],
    documentNumber: ["InvoiceId"],
    paymentMethod: ["PaymentTerm"],
    subtotal: ["SubTotal", "Subtotal"],
    total: ["InvoiceTotal", "Total"],
    currency: ["InvoiceTotal", "Total"],
    issueDate: ["InvoiceDate", "TransactionDate"],
    issueTime: ["TransactionTime"],
    vatBreakdown: ["TaxDetails", "TotalTax"],
    items: ["Items"],
  } as const;

  export const VAT_CELL_ALIASES = {
    rate: ["TaxRate", "Rate"],
    taxableBase: ["NetAmount", "TaxableAmount", "TaxableBase"],
    vatAmount: ["Amount", "TaxAmount"],
  } as const;

  export const ITEM_CELL_ALIASES = {
    description: ["Description"],
    quantity: ["Quantity"],
    unitPrice: ["UnitPrice", "Price"],
    total: ["Amount", "TotalPrice"],
  } as const;
  ```

- **PATTERN**: `azure-fields.ts:24-32` (`TEXT_FIELD_ALIASES`), extended to cover every field.
- **GOTCHA**: `currency` deliberately duplicates `total`'s aliases — `azure-fields.ts:89-94` reads
  the currency code off the same `InvoiceTotal` field. That duplication is the truth and is what
  makes the two fields share one region later.
- **VALIDATE**: `npm run typecheck`

### Task 2 — REFACTOR `api/src/providers/document-extraction/azure-fields.ts` to consume the table

- **IMPLEMENT**: Replace every inline alias array with a lookup into `FIELD_ALIASES`,
  `VAT_CELL_ALIASES` and `ITEM_CELL_ALIASES`. Delete the now-unused local `TEXT_FIELD_ALIASES`.
  **Behaviour must be identical.**
- **PATTERN**: keep `first()` (line 116) exactly as it is; only its argument changes.
- **GOTCHA**: `TextField` (line 34) is derived from `TEXT_FIELD_ALIASES`. Re-derive it from the new
  table without widening it to fields that are not text.
- **VALIDATE**: `npx vitest run --project api` — every existing extraction test must pass with **no
  test file edited**. If a test needs changing, the refactor changed behaviour; revert and redo.

### Task 3 — ADD the region DTO to `shared/src/api.ts`

- **IMPLEMENT**: Append (do not create a new file — GOTCHA-2):

  ```ts
  /**
   * Where on the source document a canonical value was read from.
   *
   * Coordinates are fractions of page width and height, which is what lets the client draw them
   * with no measurement at all and keeps the provider's pixel-vs-inch distinction from ever
   * reaching the browser. `fields` is a list because more than one canonical field can resolve to
   * one location — `total` and `currency` are read from the same place.
   */
  export const sourceRegionSchema = z
    .object({
      fields: z.array(z.string()).min(1),
      page: z.number().int().min(1),
      corners: z.array(z.object({ x: z.number(), y: z.number() }).strict()).length(4),
      origin: z.enum(["model", "text"]),
    })
    .strict();

  export type SourceRegion = z.infer<typeof sourceRegionSchema>;

  export const sourceRegionsResponseSchema = z
    .object({
      pages: z.array(
        z.object({ page: z.number().int().min(1), aspectRatio: z.number().positive() }).strict(),
      ),
      regions: z.array(sourceRegionSchema),
    })
    .strict();

  export type SourceRegionsResponse = z.infer<typeof sourceRegionsResponseSchema>;
  ```

- **IMPORTS**: `z` is already imported at line 1.
- **GOTCHA**: the field is `corners`, never `polygon` — GOTCHA-1. Also export both from the package
  root, following how every other schema is re-exported.
- **VALIDATE**: `npx vitest run --project shared` — `receipt.test.ts` provider-independence must
  still pass. Then confirm the money guard: `node -e "..."` from `/validate` 6.8.

### Task 4 — UPDATE `croatian.ts` so the matchers report offsets

- **IMPLEMENT**: Add the `d` flag to all six patterns. Change the internal `capture()` to return
  `{ value, start, end } | null` using `match.indices[1]`, and change all six `find*` functions to
  return that shape (name the type `CroatianMatch`). `findIssueDate` and `findIssueTime` still run
  the captured text through `parseIssueDate`/`parseIssueTime` and return `null` when it fails — but
  `start`/`end` refer to the **raw matched text**, which is what we want a box drawn around.
- **PATTERN**: `croatian.ts:14-16`.
- **GOTCHA**: do **not** derive the offset with `match[0].indexOf(match[1])` — it silently finds the
  wrong occurrence when the capture also appears earlier in the match. `match.indices[1]` is exact.
- **VALIDATE**: `npx vitest run --project api croatian` — update `croatian.test.ts` to read `.value`,
  and add assertions that `start`/`end` slice the original content back to the matched text.

### Task 5 — EXTRACT marker stripping into `content-markers.ts` with an index map

- **IMPLEMENT**: Move `stripContentMarkers` out of `azure.ts` into a new
  `api/src/providers/document-extraction/content-markers.ts`, and change it to return
  `{ text: string; toSourceOffset: (strippedIndex: number) => number }`. Build a small array of
  `{ at, delta }` cumulative shifts while stripping; `toSourceOffset` adds the cumulative delta for
  the largest `at <= strippedIndex`. Update `applyTextFallbacks` in `azure.ts` to take the whole
  object and read `.value` from each matcher.
- **PATTERN**: `azure.ts:132-134` and `152-171`.
- **GOTCHA**: it moves to its own module because **both** `azure.ts` (extraction) and
  `source-regions.ts` (read) need it, and `source-regions.ts` must not import `azure.ts` — that would
  drag the Azure SDK client into a pure projection module.
- **GOTCHA**: this is GOTCHA-3. A test using only marker-free fixtures passes against a broken
  implementation. Assert against `racuntaksi1`, `26515835` and `racun-mobilna-trgovina`, each of
  which carries exactly one marker.
- **GOTCHA**: **nothing new is persisted by this task.** `ProviderExtractionResult` does not gain a
  field and the extraction pipeline's stored output is byte-identical. Fallback offsets are
  recomputed at read time (Task 6) — see GOTCHA-8.
- **VALIDATE**: `npx vitest run --project api azure` — existing extraction tests must pass unchanged.

### Task 6 — CREATE `api/src/providers/document-extraction/source-regions.ts`

- **IMPLEMENT**: `mapSourceRegions(analyzeResult): SourceRegionsResponse`. Note the **single**
  argument — see GOTCHA-8.
  1. Call `mapAnalyzeResult(analyzeResult)` — the real value mapper. Its `fields` keys are the
     canonical fields the machine actually populated, and `unreadableFields` are the ones whose
     source text it found but could not normalise. **Only these get regions** (GOTCHA-9).
  2. Build `pages[]` from `analyzeResult.pages`, `aspectRatio = width / height`. Skip a page missing
     either dimension.
  3. For each canonical field from step 1, resolve its Azure field through `FIELD_ALIASES` with the
     same `first()` semantics, read `boundingRegions[0]`, normalise each `(x, y)` by that page's
     width/height, clamp to `[0, 1]`, emit `origin: "model"`.
  4. For `vatBreakdown` and `items`, iterate `valueArray` and emit a region per **cell** using
     `VAT_CELL_ALIASES` / `ITEM_CELL_ALIASES`, with paths `vatBreakdown.N.rate`, `items.N.unitPrice`
     and so on. The array container itself has no box — confirmed — so do not look for one. When
     `mapVatBreakdown` took its no-`valueArray` branch (`azure-fields.ts:196-197`) there is one
     synthetic row, and its `vatBreakdown.0.vatAmount` region is the whole `TaxDetails`/`TotalTax`
     field's box.
  5. Re-derive the Croatian text fallbacks exactly as `applyTextFallbacks` does: strip markers from
     `analyzeResult.content` (keeping the index map), run the six matchers, and for any canonical
     field that did **not** get a model region in step 3, translate the match offsets back to source
     offsets and resolve them against `pages[].words[]` — collect words whose span overlaps
     `[start, end)`; a single word keeps its exact quadrilateral, several words take the
     axis-aligned envelope of all their points. Emit `origin: "text"`. The "did not already get a
     model region" test reproduces `applyTextFallbacks`'s `fields[name] !== undefined` precedence
     exactly, which is why the two cannot disagree.
  6. Deduplicate: regions on the same page whose corners match to 5 decimal places merge into one
     with the union of their `fields`.
  7. Parse the result through `sourceRegionsResponseSchema` before returning, so a malformed
     projection fails here rather than in the browser.
- **IMPORTS**: `sourceRegionsResponseSchema` from `@receipt/shared`; alias tables from
  `./field-aliases.js`; `mapAnalyzeResult` from `./azure-fields.js`; `stripContentMarkers` from
  `./content-markers.js`; the matchers from `./croatian.js`; `AnalyzeResultOutput` type from
  `@azure-rest/ai-document-intelligence`.
- **GOTCHA**: never divide by a zero or missing page dimension. `mapper-edge-cases.json` has no
  `pages` at all and must yield `{ pages: [], regions: [] }` rather than throwing.
- **GOTCHA**: a field present but with no `boundingRegions` (the `Items` container) yields no region.
  Missing stays missing — never synthesise a position (PRD §7.7).
- **VALIDATE**: `npx vitest run --project api source-regions`

### Task 7 — CREATE `api/src/providers/document-extraction/source-regions.test.ts`

- **IMPLEMENT**: Offline fixture tests. Mirror the `fixture()` helper from
  `azure-fields.test.ts:1-15`. Cover at minimum:
  - every corner of every region is within `[0, 1]`, for a pixel fixture and the inch fixture;
  - the inch fixture (`primjer-pdf-racuna`) and a pixel fixture produce structurally identical
    output — proving the unit distinction is erased;
  - `total` and `currency` appear on **one** region, not two;
  - VAT and item cells each get their own region with correctly indexed paths;
  - `racuntaksi1` fiscal fields resolved by text fallback land on the right words **despite** its
    `:barcode:` marker (GOTCHA-3);
  - `mapper-edge-cases` yields empty pages and empty regions without throwing;
  - the output JSON contains no Azure vocabulary.
- **PATTERN**: `azure-fields.test.ts`.
- **VALIDATE**: `npx vitest run --project api source-regions`

### Task 8 — ADD `findProviderResultById` to `api/src/repositories/receipts.ts`

- **IMPLEMENT**: Select `raw_provider_result` filtered by `id`, `user_id` and `deleted_at is null`,
  returning `null` when absent.
- **PATTERN**: `findExtractionState`, `api/src/repositories/receipts.ts:162-178`.
- **GOTCHA**: return the raw JSON untouched. Do not validate it against a schema — it is a provider
  artefact whose shape we do not own, and the projection is already defensive.
- **VALIDATE**: `npm run typecheck`

### Task 9 — ADD `GET /api/receipts/:id/regions` to `api/src/routes/receipts.ts`

- **IMPLEMENT**: Register beside `/:id/source`. Validate the id, load the provider result, `404` when
  null, project it, respond. When the stored result has no analysable shape, respond
  `{ pages: [], regions: [] }` — an old or failed receipt is not an error.
- **PATTERN**: `api/src/routes/receipts.ts:224-242`.
- **GOTCHA**: do **not** add an ownership check; the repository filter plus RLS already enforce it,
  and a third copy is a third thing to keep in sync.
- **GOTCHA**: no PDF special-casing here. The route stays dumb; the client decides not to render.
- **GOTCHA**: `/export` must remain registered before `/:id` (`/validate` 6.15). `/:id/regions` has
  two segments and cannot be shadowed by `/:id`, so its position is free — put it next to `/:id/source`
  for readability.
- **VALIDATE**: `npx vitest run --project api` and `npm run typecheck`

### Task 10 — ADD `getReceiptRegions` to `client/src/api/client.ts`

- **IMPLEMENT**: Mirror `getReceiptSource` exactly; parse with `sourceRegionsResponseSchema`.
- **PATTERN**: `client/src/api/client.ts:132-135`.
- **GOTCHA**: must go through `request()`. A raw `fetch` outside this module fails `/validate` 6.9.
- **VALIDATE**: `npx vitest run --project client client.test`

### Task 11 — CREATE `client/src/review/regionSections.ts`

- **IMPLEMENT**: `sectionOf(fieldPath): Section | null` mapping a canonical dotted path to one of
  `seller | buyer | receipt | vat | items`; a `vatBreakdown.` prefix is `vat`, an `items.` prefix is
  `items`, unknown paths return `null`. Plus `SECTION_COLOURS: Record<Section, string>` of plain hex
  values, and the existing i18n key per section (`review.seller`, `review.buyer`, `review.receipt`,
  `review.vat`, `review.items` — all already present in both locale files, so the legend needs **no
  new copy**).
- **GOTCHA**: **amber is reserved** for "needs attention" across the whole app. No section may be
  amber or orange. Suggested families: seller violet, buyer teal, receipt the app accent blue
  (`#1d4ed8`), VAT fuchsia, items green — verify each against a real flash-lit thermal receipt, not a
  white mockup.
- **GOTCHA**: hex strings, not Tailwind classes — GOTCHA-5.
- **VALIDATE**: `npx vitest run --project client regionSections`

### Task 12 — CREATE `client/src/review/SourceOverlay.tsx`

- **IMPLEMENT**: An absolutely-positioned `<svg viewBox="0 0 1 1" preserveAspectRatio="none">`
  rendering one `<polygon>` per region for the given page. Props: `regions`, `page`, `activeField`,
  `onSelect`. Inactive: thin stroke in the section colour, no fill. Active (any of the region's
  `fields` matches `activeField`): thicker stroke, full opacity, faint tint fill. Clicking a polygon
  calls `onSelect(region.fields[0])`.
- **GOTCHA**: `vector-effect="non-scaling-stroke"` on every polygon — GOTCHA-4.
- **GOTCHA**: the `<svg>` is `aria-hidden="true"`. Every piece of information it carries is already
  in the form, which has real labels and `aria-describedby`. Clicking is a **pointer-only
  enhancement**; nothing may be reachable only this way.
- **GOTCHA**: an unknown section (`sectionOf` returns `null`) renders in a neutral grey rather than
  crashing or being dropped silently.
- **VALIDATE**: `npx vitest run --project client SourceOverlay`

### Task 13 — UPDATE `client/src/review/SourceDocumentPanel.tsx`

- **IMPLEMENT**: Accept `regions`, `activeField` and `onSelect` props. Replace the `object-contain`
  image with an aspect-ratio wrapper (GOTCHA-6) sized from `regions.pages[0].aspectRatio`, with the
  height cap on the wrapper. Render `SourceOverlay` inside it for image sources only. For a PDF
  source, keep today's `<object>` viewer unchanged and render a translated note that highlighting is
  not available for PDF receipts.
- **IMPLEMENT — the EXIF guard**: on the image's `onLoad`, compare
  `img.naturalWidth / img.naturalHeight` against the API's `aspectRatio`. If they disagree beyond a
  small tolerance, **suppress the overlay entirely**. Browsers apply EXIF rotation and Azure reports
  its own decode; a mismatch means every box would be rotated. Silence beats a confident lie.
- **GOTCHA**: keep the existing single image-error retry (`retriedImage`, lines 16, 63-69) working.
- **VALIDATE**: `npx vitest run --project client ReviewPage`

### Task 13a — CREATE `client/src/review/ActiveRegionStrip.tsx`

The mobile answer to "a box on a full-page photo at 390 px is a few pixels tall". It is a **crop**,
not an interactive zoom, which is both the better interaction and the smaller one.

- **IMPLEMENT**: A `position: fixed` strip pinned below the app header, rendered **only** at the
  narrow breakpoint and **only** while `activeField` is set and its region is known. Inside: a fixed
  height (about `28dvh`) box with `overflow: hidden`, containing the same image and the same
  `SourceOverlay`, wrapped in one element that carries a single
  `transform: scale(k) translate(...)` with `transform-origin: 0 0`, computed so the active region's
  centroid lands in the middle of the strip. Pick `k` so the region occupies a comfortable share of
  the strip width, clamped to a sane maximum. Include the section colour and the field's translated
  label so the strip says what it is showing.
- **PATTERN**: reuse `SourceOverlay` unchanged — the strip transforms a wrapper containing both the
  image and the SVG, so they scale together and no overlay maths changes.
- **GOTCHA**: transform the **wrapper**, never the image and the SVG separately — separate transforms
  drift apart under rounding and the outline slides off the text.
- **GOTCHA**: pin it below the header, not the bottom. The on-screen keyboard occupies the lower part
  of the viewport while the user is typing in the very field the strip is explaining.
- **GOTCHA**: it must not cover the bottom tab bar or trap scroll. `aria-hidden`, like the overlay —
  it duplicates nothing the form does not already announce.
- **GOTCHA**: honour `prefers-reduced-motion` for the transition between fields.
- **VALIDATE**: `npx vitest run --project client ActiveRegionStrip`, then **a real browser at 390 px**
  — jsdom computes no layout and will pass against a strip that renders at 4 px or covers the form.

### Task 14 — UPDATE `client/src/routes/ReviewPage.tsx`

- **IMPLEMENT**: In `ReviewForm`, fetch regions **once** (GOTCHA-7) and hold `activeField` state.
  Pass both to each `SourceDocumentPanel`. `ReviewField` gains `onFocus` to set `activeField` and
  `onBlur` to clear it, and renders its section's colour badge — put the badge on each `<legend>`,
  not on every input. Wire `onSelect` to focus the matching input by its element id.
- **IMPLEMENT — mobile**: render `<ActiveRegionStrip>` (Task 13a). Do **not** touch the existing
  `<details>` panel's behaviour; it stays exactly as it is for browsing the whole receipt.
- **GOTCHA — the layout-shift trap, and why the strip exists.** The `<details>` panel is rendered at
  line 230, **above** the fieldsets. Auto-expanding it on focus pushes every input downward and
  moves the field out from under the user's thumb — worse than shipping no feature at all. Every
  in-flow remedy (reserved space, sticky, re-scroll after expanding) fights that symptom. A strip
  positioned `fixed` is **out of flow**, so it cannot shift anything by construction, and it is also
  less code than an interactive pan/zoom. Do not re-litigate this into "just open the details".
- **GOTCHA**: a region fetch failure must not break review. Fall back to today's behaviour.
- **VALIDATE**: `npx vitest run --project client ReviewPage`

### Task 15 — ADD i18n copy

- **IMPLEMENT**: Add to both `en.json` and `hr.json` under `review.*`: the PDF-unavailable note, the
  zoom "fit" control label, and an accessible label for the overlay region group if one is needed.
  Section badge labels **reuse** the existing `review.seller` / `review.buyer` / `review.receipt` /
  `review.vat` / `review.items` keys.
- **GOTCHA**: write Croatian diacritics with a tool that preserves UTF-8. `/validate` 6.11 exists
  because a previous task shipped `"PokuÅ¡ajte"` and every other check passed.
- **VALIDATE**: `npx vitest run --project client i18n` and `/validate` 6.5 and 6.11.

### Task 16 — ADD integration coverage

- **IMPLEMENT**: In `api/src/routes/receipts.integration.ts`, assert the regions endpoint returns
  `404` for another user's receipt and for a soft-deleted one, and that its body contains no Azure
  vocabulary. Mirror the existing assertion at line 345.
- **VALIDATE**: `npm run test:integration`

### Task 17 — UPDATE documentation and `/validate`

- **IMPLEMENT**:
  - `README.md`: the new endpoint in the API table; a paragraph under "Review and confirmation"
    covering the overlay, the normalised-coordinate contract, the EXIF guard and the PDF limitation.
  - `.claude/commands/validate.md`: rows in the Phase 4 table for each new test file; a Phase 6 check
    that the regions projection emits no Azure vocabulary; a Phase 8 journey (§8.14) for the
    highlighting flow at 1440 px and 390 px in both languages.
  - `.agents/ROADMAP.md`: add iteration 15 to the "Iterations outside the numbered task list" table.
- **GOTCHA**: hand-extend `validate.md`. Never re-run `/ultimate_validate_command` — it overwrites
  and would delete roughly 140 lines earned from real incidents.
- **GOTCHA**: Prettier does not touch `*.md` and must not start. Tables are hand-aligned.
- **VALIDATE**: `/validate` 6.6 (documentation matches code).

### Task 18 — Real-browser verification

- **IMPLEMENT**: Free ports first, confirm Vite reports **5173** under `--strictPort`, then drive a
  real Chromium session. Verify at 1440 px and 390 px, in both languages:
  outlines sit on the text of a skewed hand-held photo; `total` and `currency` share one outline;
  focus raises the right outline; clicking an outline focuses the right input; at 390 px the crop
  strip shows the right field zoomed and **nothing on the page moves** when it appears; a PDF shows
  the note and nothing broken.
- **IMPLEMENT — prove retroactivity**: open a receipt analysed **before** this branch and confirm it
  shows both model and fiscal-field boxes. This is the check that would have caught GOTCHA-8.
- **IMPLEMENT — the EXIF check**: upload a photo taken on a real phone (not a screenshot, not a
  re-saved file — EXIF orientation is usually stripped by both) and confirm the boxes land correctly,
  or that the guard suppresses them.
- **GOTCHA**: a stale Vite on 5173 makes every check pass against old code. See `/validate` 8.1.
- **VALIDATE**: full `/validate`.

---

## TESTING STRATEGY

### Unit tests

Vitest across three projects (`shared` node, `api` node, `client` jsdom). New coverage:

| File | Protects |
| --- | --- |
| `api/src/providers/document-extraction/source-regions.test.ts` | Normalised corners stay in `[0,1]`; pixel and inch fixtures produce structurally identical output; `total`+`currency` share one region; VAT and item cells are indexed correctly; text-fallback regions survive a `:barcode:` marker; a fixture with no pages yields empty output without throwing; no Azure vocabulary in the projection |
| `api/src/providers/document-extraction/croatian.test.ts` (extended) | Matchers report offsets that slice the original content back to the matched text |
| `api/src/providers/document-extraction/azure.test.ts` (extended) | Marker stripping returns a correct index map; fallback spans are source-relative |
| `client/src/review/regionSections.test.ts` | Nested, top-level and unknown field paths map to the right section; unknown returns null rather than throwing |
| `client/src/review/SourceOverlay.test.tsx` | One polygon per region, correct section colour, active emphasis, `aria-hidden`, click selects the first field, unknown section renders neutrally |
| `client/src/review/ActiveRegionStrip.test.tsx` | Renders only with an active field that has a known region; hidden with no active field, no region, or a PDF source; the transform centres the region's centroid; `aria-hidden` |
| `client/src/routes/ReviewPage.test.tsx` (extended) | Regions fetched once; focusing an input marks the right region active; a region fetch failure leaves review working |

### Integration tests

`npm run test:integration` against the hosted project: regions endpoint `404` for a non-owner and for
a soft-deleted receipt; no Azure vocabulary in the response body.

### Edge cases that must be tested

- A receipt whose `raw_provider_result` is `null` (a `failed` receipt) — endpoint returns empty, UI
  renders normally.
- A receipt analysed before this feature existed — must work with no backfill. This is the whole
  retroactivity claim; prove it against a real old row.
- A PDF source — note shown, no overlay, no error.
- An image whose aspect ratio disagrees with the API's — overlay suppressed, not drawn wrong.
- A field with a value but no locatable region — no box, no crash, nothing invented.
- A page dimension of zero or missing — no division by zero.
- The narrowest supported viewport (320 px) — no horizontal overflow.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```
npm run lint
npm run typecheck
npm run format:check
```

### Level 2: Unit Tests

```
npm test
npx vitest run --project shared
npx vitest run --project api
npx vitest run --project client
```

### Level 3: Integration Tests

```
npm run test:integration
```

Phase 7a (Docker migrations) is **legitimately skippable here** — this feature changes no file under
`supabase/migrations/`. Report the skip and its reason; do not count it as green.

### Level 4: Manual Validation

`npm run build`, then the full `/validate` Phase 6 and Phase 8 sweeps, including the new §8.14
journey and the real-browser checks in Task 18.

### Level 5: Additional Validation

The Supabase MCP server can confirm retroactivity directly — check that an old receipt's stored
provider result still projects to regions.

---

## ACCEPTANCE CRITERIA

Taken from the spec's Definition of Done; all must hold.

- [ ] A photographed Croatian receipt in review draws a correctly-positioned unfilled outline over
      every field the form shows a value for.
- [ ] Outlines are true quadrilaterals and visibly sit on skewed text on a hand-held photo.
- [ ] Focusing an input raises its outline; clicking an outline focuses its input.
- [ ] `total` and `currency` share exactly one outline.
- [ ] VAT cells and line-item cells each carry their own outline.
- [ ] `jir`, `zki` and `sellerOib` carry outlines when filled by text fallbacks, and land on the right
      text on a receipt containing a `:barcode:` marker.
- [ ] A field with no locatable region has no outline; nothing is invented.
- [ ] Each form section shows a colour badge matching its outlines, in both languages.
- [ ] At 390 px, focusing a field shows the fixed crop strip zoomed to that field, and **nothing on
      the page shifts position**. Verified in a real browser.
- [ ] A receipt analysed **before** this feature shipped shows fiscal-field boxes, proving the
      fallback offsets are recomputed at read time and not read from persisted state.
- [ ] A PDF receipt shows the translated note and nothing broken.
- [ ] `GET /api/receipts/:id/regions` returns `404` for another user's and for a deleted receipt.
- [ ] No Azure field name appears in the regions response.
- [ ] No canonical value, warning, confidence flag or extraction record changes.
- [ ] An image whose rendered aspect ratio disagrees with the API's suppresses the overlay.
- [ ] A receipt analysed before this feature works with no backfill.
- [ ] Full `/validate` passes, with a new Phase 8 journey.

---

## COMPLETION CHECKLIST

- [ ] All 19 tasks completed in order (1–13, 13a, 14–18)
- [ ] Each task's VALIDATE passed immediately
- [ ] `npm run lint`, `typecheck`, `format:check`, `test`, `build` all clean
- [ ] `npm run test:integration` passes; 7a skip reported with its reason
- [ ] Real-browser verification done at 1440 px and 390 px in both languages
- [ ] EXIF behaviour checked with a genuine phone photo
- [ ] README, `validate.md` and ROADMAP updated
- [ ] History file written to `.agents/history/15-source-field-highlighting.md`

---

## NOTES

**Why no new dependency.** Normalising coordinates server-side and rendering with a `0 0 1 1` viewBox
removes every reason to reach for a canvas or overlay library. The client does no measurement, so
there is no `ResizeObserver`, no `naturalWidth` arithmetic and no recalculation on resize or rotation
— the overlay is correct at every viewport by construction. The bundle already carries a >500 KB
advisory; adding to it for geometry this simple would be poor value.

**Why PDFs are out.** `<object type="application/pdf">` is a sealed browser context — nothing can be
drawn over it, positioned against it, or measured inside it. The alternatives are pdf.js (~350 KB+
lazily loaded, plus a worker and page navigation) or server-side rasterisation (a native binary on
Render's free tier, extra storage, a backfill). The decisive argument is sequencing, not size: the
interaction model is unproven, and proving it on the image path — which is also the phone-capture
path the PRD calls primary — costs nothing extra. Committing to a PDF rendering stack first would be
building the expensive half before knowing the cheap half works.

**Why a separate endpoint.** It loads exactly where the source panel mounts, never on the history
list, and it keeps the region projection out of the `GET /:id` / `PATCH /:id` body that fires on
every save. It mirrors `/:id/source`, so it is the shape a reader already expects.

Note that **the performance argument for this is weak and should not be leaned on**: stored provider
results were measured at 28 KB average and 46 KB maximum across the current 22 rows, so re-deriving
on each read is cheap and the parse was never going to be hot. The separation is about coupling and
lazy loading, not cost. If that ever changes, the projection can be memoised into
`extraction_metadata` at extraction time without altering the response contract — but only after
measuring, not on suspicion.

**The alias refactor is the load-bearing part.** If the region mapper and the value mapper ever
resolve different Azure fields, the box points at text the form does not contain — a wrong answer
that looks right, on a screen whose entire purpose is helping a human catch wrong answers that look
right. One table, two consumers, no discipline required.

**Two spec §13 questions are now decided.** The mobile mechanism is the fixed crop strip (Task 13a),
chosen because being out of flow dissolves the layout-shift problem rather than mitigating it, and
because a crop is less code than an interactive pan/zoom. And regions follow `original_extraction`,
so a box keeps marking where OCR read even after the user edits the value — spec §13 question 4,
resolved in GOTCHA-9.

**Still genuinely open**, and cheap to settle by looking at a real dense receipt in a real browser:
whether an overlay on/off toggle is needed, and whether `origin: "text"` regions should look
different (a dashed outline would be honest about how they were found, or it may be a distinction
only we care about). Record whichever way in the history file.

**Confidence: 8/10** for the code landing in one pass. The API side is close to mechanical and fully
testable offline against eight recorded fixtures, and this revision removed the one place where its
design was incoherent. The residual risk is entirely in the client and is not the kind unit tests
reduce: EXIF orientation cannot be proven without a genuine phone photo, and the crop strip is
layout behaviour in jsdom's blind spot — the same blind spot that shipped the `inert` drawer and the
4 px spinner glyph. Budget real-browser time for Tasks 13, 13a, 14 and 18 rather than expecting the
unit tests to settle them.
