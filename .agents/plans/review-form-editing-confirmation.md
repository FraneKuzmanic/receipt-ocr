# Feature: Review form, editing & confirmation

> **Roadmap task 09** (`.agents/ROADMAP.md` §4). Depends on 08. This plan should be complete, but
> validate documentation, codebase patterns and task sanity before implementing. Pay special
> attention to the names of existing utilities, types and models, and import from the right files.

## Feature Description

The human-confirmation step — the heart of the product. A receipt that reached `review` shows its
Azure-extracted values pre-populated in an editable form beside the original source document.
Warnings sit next to the fields they concern. The user corrects what OCR got wrong, saves, and
explicitly confirms. Confirmation is allowed with warnings outstanding, and `original_extraction`
stays frozen forever so machine output and human-confirmed values remain distinguishable.

## User Story

As a business user
I want to check and correct the values read from my receipt, then confirm them
So that the stored record matches what the receipt actually says, and I never have to type it all
from scratch

## Problem Statement

Extraction currently dead-ends. `client/src/routes/ReviewReadyPage.tsx` is a placeholder that says
"Your receipt is ready for the next step" and links home. The canonical data, the warnings computed
in Task 08 and the per-field confidence recorded in Task 07 are all persisted but unreachable — there
is no `PATCH /api/receipts/:id`, no `POST /api/receipts/:id/confirm`, and no way to see the source
document beside the data. Until this exists, OCR output can never become human-confirmed data, which
is the PoC's entire value proposition (PRD §1, §11.1).

## Solution Statement

Three layers, built bottom-up:

1. **`shared`** — one new derived response schema exposing low-confidence field names alongside the
   canonical receipt. Everything else (`updateReceiptRequestSchema`, `confirmReceiptResponseSchema`)
   already exists and must be reused, never redeclared.
2. **`api`** — `PATCH` and `POST /confirm` routes, a repository read for the data warning
   recomputation needs, and a one-line correctness fix in `computeWarnings` so a corrected field
   clears its `unparseable_*` warning.
3. **`client`** — a `ReviewPage` built on React Hook Form, with a normalization layer between the
   locale-formatted text the user types and the canonical strings the schema demands.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High — largest client-side surface in the roadmap, plus two new API routes
and a cross-task correctness fix.
**Primary Systems Affected**: `client/src/routes`, `client/src/review` (new), `client/src/api`,
`api/src/routes/receipts.ts`, `api/src/repositories/receipts.ts`, `api/src/validation/warnings.ts`,
`shared/src/api.ts`, both locale files.
**Dependencies**: `react-hook-form@^7.85.0` (new, client only). Deliberately **not**
`@hookform/resolvers` — see Decision D2.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — YOU MUST READ THESE BEFORE IMPLEMENTING

**The contract you are extending**

- `shared/src/receipt.ts` (lines 36–97) — Why: the two-tier schema split. `canonicalReceiptFieldsSchema`
  is tier 1 (user-editable), `canonicalReceiptSchema` is tier 2 (adds the server-owned envelope).
  **Do not flatten them.** Note `.strict()` on tier 1, which survives `.extend()` and `.partial()`.
- `shared/src/api.ts` (lines 70–89) — Why: `updateReceiptRequestSchema` and
  `confirmReceiptResponseSchema` **already exist**. Task 09 consumes them; it does not write them.
  Every DTO here is *derived* from the receipt schemas, never redeclared. Follow that.
- `shared/src/money.ts` (lines 36–60, 106–117) — Why: `parseAmount` is the only legal way to turn
  user-typed text into a canonical amount. It reads Croatian `1.234,56` and English `1,234.56`,
  returns `null` for anything unreadable, and **never throws**. `formatAmount` is for display only.
- `shared/src/datetime.ts` (lines 29–84) — Why: `parseIssueDate` / `parseIssueTime`, same contract.
  `parseIssueTime` deliberately does not pad `14:30` to `14:30:00`.
- `shared/src/warnings.ts` (whole file) — Why: warnings are `{ code, field }` where `field` is a
  dotted path such as `total` or `vatBreakdown.0.vatAmount`. The client owns the human copy.
- `shared/src/receipt.test.ts` (lines 82–116) — Why: **proves the form cannot bind the canonical
  schema directly.** It asserts `"1.234,56"`, `"100,50"`, `"€100.50"` and `"17.08.2026"` are all
  rejected, and that an unknown top-level key is `unrecognized_keys`.

**The API you are extending**

- `api/src/routes/receipts.ts` (whole file, 166 lines) — Why: the exact route pattern to mirror.
  Note `idSchema.safeParse(req.params["id"])` → `400 invalid_request`; `authenticated(async (req,
  res, auth) => …)`; `new ReceiptRepository(auth.client, auth.userId)`; `null` → `404 not_found`
  with no separate ownership check.
- `api/src/repositories/receipts.ts` (lines 143–215) — Why: `findExtractionState` is the pattern for
  a narrow internal read that never leaks into a DTO. `update()` writes `original_extraction`
  **only when `input.originalExtraction !== undefined`**, which is how Task 09 leaves it frozen for
  free — just never pass it.
- `api/src/validation/warnings.ts` (whole file, 111 lines) — Why: the pure engine Task 09 reuses.
  `computeWarnings({ fields, qr, unreadable })`. Task 08 D5 deliberately left the PATCH wiring here.
- `api/src/providers/document-extraction/types.ts` (lines 4–26) — Why: `LOW_CONFIDENCE_THRESHOLD =
  0.7` exists with the comment "Metadata for Task 09's low-confidence highlighting".
  `ExtractionMetadata.fields` is `Record<canonicalFieldName, { confidence, source }>`.
- `api/src/providers/document-extraction/azure-fields.ts` (lines 136–180, 218–225) — Why: proves
  `recordUnreadable()` is always followed by `return`, so **an unreadable field is never
  populated**. This is the evidence behind Decision D3.
- `api/src/services/receipt-extraction.ts` (lines 26–44) — Why: the one existing `computeWarnings`
  call site, and where `canonicalData`/`originalExtraction` are written together at extraction.
- `api/src/middleware/error-handler.ts` (whole file) — Why: `HttpError(status, code)`. Codes are
  stable machine strings, never prose, never infrastructure detail.
- `api/src/middleware/require-auth.ts` (lines 41–59) — Why: `authenticated()` passes the proven
  identity as an argument. There is no `req.auth`.
- `api/src/routes/receipts.integration.ts` (lines 1–90) — Why: the hosted integration test pattern —
  disposable users with a `taskNN-` email prefix, an injected stub `DocumentExtractionProvider`,
  `createApp({ extractionProvider })`, cleanup in `afterAll`.

**The client you are extending**

- `client/src/routes/ReviewReadyPage.tsx` (whole file, 19 lines) — Why: **this is what you replace.**
  It is mounted at `receipts/:id/review`.
- `client/src/routes/HomePage.tsx` (whole file, 208 lines) — Why: the richest existing component.
  Copy its idioms: `useTranslation()`, `void asyncFn()` in handlers, Tailwind `min-h-11` touch
  targets, `role="alert"` error blocks, `aria-live="polite"`, `max-w-lg` mobile column.
- `client/src/routes/ProcessingPage.tsx` (lines 19–28, 88–135) — Why: async action + error-state
  pattern, and the `ApiError` status check idiom.
- `client/src/api/client.ts` (whole file, 81 lines) — Why: **every** API call goes through
  `request()`. It attaches the bearer token, signs out on 401, and parses `ApiError.code`. Adding a
  raw `fetch` anywhere else fails `/validate` Phase 6.9.
- `client/src/routes/ProcessingPage.test.tsx` (whole file) — Why: the component test pattern —
  `vi.mock("../api/client")`, `import "../i18n"`, `MemoryRouter` + `Routes`, assertions against
  **rendered English copy**, not test ids.
- `client/src/components/{Spinner,ErrorMessage}.tsx` — Why: reuse both. Do not build new ones.
- `client/src/i18n/locales/en.json` + `hr.json` — Why: `warnings.*` messages for all seven codes
  **already exist** in both languages. Task 09 adds a `review.*` namespace only.
- `client/src/i18n/warnings.test.ts` — Why: it already guarantees every `WARNING_CODES` entry has
  both translations, precisely because the review form renders them from a template literal that
  `/validate` Phase 6.5 cannot follow.

### New Files to Create

- `client/src/review/reviewForm.ts` — pure `toFormValues` / `toPatch` normalization. No React.
- `client/src/review/reviewForm.test.ts` — unit tests for the above.
- `client/src/review/SourceDocumentPanel.tsx` — signed-URL image/PDF viewer with expiry recovery.
- `client/src/routes/ReviewPage.tsx` — the form itself.
- `client/src/routes/ReviewPage.test.tsx` — component tests.

### Files to Delete

- `client/src/routes/ReviewReadyPage.tsx` — orphaned by this change, so removing it is required by
  CLAUDE.md §3 ("Remove imports/variables/functions that YOUR changes made unused"). Remove its
  `reviewReady.*` keys from both locale files in the same edit.

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [React Hook Form — `useForm`](https://react-hook-form.com/docs/useform)
  - Sections: `defaultValues`, `values`, `reset`, `formState.isDirty`
  - Why: pre-population comes from the server and must be re-synced after every successful save.
- [React Hook Form — `register`](https://react-hook-form.com/docs/useform/register#options)
  - Section: the `validate` option
  - Why: this replaces `zodResolver`. `validate` returns `true` or a message string; we return an
    i18n **key** and translate at render.
- [React Hook Form — `useFieldArray`](https://react-hook-form.com/docs/usefieldarray)
  - Why: `vatBreakdown` and `items` need add/remove. Note the `key` must be `field.id`, never the
    array index.
- [React Hook Form — `handleSubmit`](https://react-hook-form.com/docs/useform/handlesubmit)
  - Why: it only calls your submit handler when every `validate` passed.
- [PRD §7.9 Review Form](../../PRD.md) and [PRD §10.4–10.5](../../PRD.md)
  - Why: the authoritative requirement list, including "Allow confirmation with unresolved warnings".

### Patterns to Follow

**Route handler shape** — from `api/src/routes/receipts.ts:33-45`:

```ts
router.get(
  "/:id",
  authenticated(async (req, res, auth) => {
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) throw new HttpError(400, "invalid_request");

    const repository = new ReceiptRepository(auth.client, auth.userId);
    const receipt = await repository.findById(id.data);
    if (receipt === null) throw new HttpError(404, "not_found");

    res.json(receipt);
  }),
);
```

**Derived DTO, never redeclared** — from `shared/src/api.ts:78`:

```ts
export const updateReceiptRequestSchema = canonicalReceiptFieldsSchema.partial();
```

**Client API function** — from `client/src/api/client.ts:74-77`:

```ts
export async function getReceipt(id: string, signal?: AbortSignal): Promise<CanonicalReceipt> {
  const response = await request(`/api/receipts/${encodeURIComponent(id)}`, { signal });
  return canonicalReceiptSchema.parse(await response.json());
}
```

**Translated error from an API code** — from `client/src/routes/HomePage.tsx:98-106`:

```ts
if (caught instanceof ApiError && caught.code) {
  const code = uploadErrorCodeSchema.safeParse(caught.code);
  if (code.success) { setError(t(`upload.${code.data}`)); return; }
}
setError(t("capture.errors.generic"));
```

**Naming conventions**: camelCase for TS symbols, snake_case for database columns and error codes,
kebab-case for filenames except React components which are PascalCase. Cross-workspace imports
always use `@receipt/shared`, never a relative path. `api`/`shared` use `nodenext` resolution so
relative imports need a `.js` extension in `.ts` source; `client` uses `bundler` resolution and must
**not** have extensions.

---

## DESIGN DECISIONS

These resolve what the roadmap left open. Record them in the history file at the end of the task.

### D1 — Explicit save, not debounced autosave

ROADMAP Task 09 says "Debounced autosave or explicit save — pick one, keep it simple, record the
choice." **Choose explicit save.** Four reasons, in order of weight:

1. **Autosave fights normalization.** A half-typed date `17.0` or amount `1.23` fails
   `parseIssueDate`/`parseAmount`, so autosave would flash a validation error mid-keystroke.
2. **The PATCH response returns recalculated warnings.** Autosaving means warnings appear and vanish
   while the user is still typing — the opposite of the "draw the user's attention" purpose in
   PRD §7.8.
3. **Saving rewrites the field's displayed text** (`1.234,56` → `1234.56`), which is hostile mid-edit.
4. CLAUDE.md §2 — it is simply less code.

A "Save" button plus a "you have unsaved changes" hint driven by `formState.isDirty` covers it.

### D2 — React Hook Form, without `@hookform/resolvers`

Verified against npm: `react-hook-form@7.85.0` declares `peerDependencies: { react: "^16.8.0 || ^17
|| ^18 || ^19" }`, so React 19.2.8 is supported.

`@hookform/resolvers` is **deliberately excluded**. The obvious idiom — `zodResolver(
canonicalReceiptFieldsSchema)` — is actively wrong here, because that schema requires values that
are *already normalized*: `total` must match `^-?\d+(\.\d+)?$` and `issueDate` must be ISO. A
Croatian user typing `1.234,56` or `17.08.2026.` would be told their own receipt's format is
invalid. `shared/src/receipt.test.ts:82-100` asserts exactly those rejections.

The real validation question is "can this be normalized?", which `parseAmount` / `parseIssueDate`
already answer and are already unit-tested. RHF's native `register(name, { validate })` consumes them
directly. This also avoids adding a package that declares ~28 optional peer dependencies to a repo
whose `/validate` Phase 0 forbids `--legacy-peer-deps`.

**Risk to check first (Task 1 below):** TypeScript 7 has already rejected two libraries in this repo
(`typescript-eslint`, `decimal.js` — see README "Toolchain notes"). Prove RHF typechecks before
building on it.

### D3 — `unparseable_*` warnings clear once the field is filled

`computeWarnings` currently emits `unparseable_date` / `unparseable_amount` purely from the stored
`unreadable` list. Recomputed after an edit, that warning would **never clear**, directly failing
this task's DoD ("edit → warning recalculation") and Task 08's ("Correcting the total clears that
warning").

Fix it in `computeWarnings`, where the rule lives: emit `unparseable_*` only while the field is
still empty. This is a clarification, not a behaviour change, because at extraction time an
unreadable field is *always* empty — `azure-fields.ts:143-147` calls `recordUnreadable()` and
returns without ever assigning `fields[canonical]`.

One existing assertion pins the old behaviour and must be updated:
`api/src/validation/warnings.test.ts:59-66` pairs `completeFields` (which has
`issueDate: "2025-03-31"`) with `unreadable: ["issueDate"]` — a combination extraction cannot
produce. Rewrite it to assert the realistic pairing plus the new resolution behaviour. This is a
deliberate, justified edit to a Task 08 file; note it in the history's "Deviations" section.

### D4 — Low confidence crosses the API as field names, never as metadata

Task 09 must render missing/low-confidence fields distinctly (PRD §7.9), but `extraction_metadata`
contains `provider: "azure-document-intelligence"` and `modelId: "prebuilt-invoice"`. Shipping it
would violate ROADMAP §5 rule 7 and this task's own DoD.

Expose a computed projection instead: `lowConfidenceFields: string[]`, built server-side from
`ExtractionMetadata.fields` using the existing `LOW_CONFIDENCE_THRESHOLD = 0.7`. Provider-neutral,
minimal, exactly what the UI needs.

**Gotcha this creates:** `canonicalReceiptSchema` is `.strict()`, so adding a key to the
`GET /api/receipts/:id` body makes the *client's existing* `canonicalReceiptSchema.parse()` in
`getReceipt` throw. `getReceipt` must be switched to the new `receiptDetailResponseSchema` in the
same change. `ProcessingPage` only reads `.status`, so it is functionally unaffected — but it will
break loudly if you forget.

### D5 — Inputs hold canonical strings; either locale is accepted on input

The `total` input shows `100.50`, not `100,50 €`. Round-tripping through `formatAmount` (which
produces `Intl` currency output) and back would be lossy and would fight the user. Display
formatting belongs to the read-oriented history view (Task 10) and export (Task 11). The input
**accepts** `1.234,56` and normalizes it on save; it simply does not *render* that way.

### D6 — Status guards on both new routes

- **PATCH** is allowed only in `review` and `confirmed`. Rejecting `processing` is not
  cosmetic: `extractReceipt` overwrites `canonical_data` when it finishes
  (`receipt-extraction.ts:36-44`), so an edit accepted during `processing` would be silently
  destroyed. `failed` is rejected because manual data entry for a receipt with no extraction is not
  in scope. Both → `409 edit_not_allowed`.
- **PATCH never changes `status`.** Editing a confirmed receipt leaves it confirmed.
- **Confirm** transitions `review` → `confirmed`. Already-`confirmed` returns `200` with the
  existing values (idempotent), so a retried request after a dropped response does not surface a
  spurious error to the user. Anything else → `409 confirm_not_allowed`.
- **Neither route reads `warnings`.** Not for a guard, not for a count, not at all. `/validate`
  Phase 6.13 greps for this; the durable guarantee is that the code never mentions it.

### D7 — Server merges partial patches

PRD §10.4's own example body carries only three fields, and `updateReceiptRequestSchema` is
`.partial()`. But `ReceiptRepository.update()` replaces the whole `canonical_data` JSON. The route
must therefore merge: `{ ...storedFields, ...body }`. The client sends the complete field set
anyway; the merge is what makes a genuinely partial request from any other caller correct.

Note the semantics `.partial()` gives you for free: an explicit `total: null` clears the field, an
absent `total` key preserves it.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Prove the new dependency works under TypeScript 7, then land the shared contract and the pure
functions everything else depends on.

**Tasks:** install and typecheck-spike `react-hook-form`; add `receiptDetailResponseSchema` to
`shared/src/api.ts`; fix `computeWarnings`; write `client/src/review/reviewForm.ts`.

### Phase 2: Core Implementation

**Tasks:** repository read for confidence + QR + stored fields; `PATCH` and `POST /confirm` routes;
client API functions; the `ReviewPage` component and `SourceDocumentPanel`.

### Phase 3: Integration

**Tasks:** swap the route in `App.tsx`, delete `ReviewReadyPage`, add the `review.*` i18n namespace
in both languages, switch `getReceipt` to the new schema.

### Phase 4: Testing & Validation

**Tasks:** unit tests for `reviewForm`, component tests for `ReviewPage`, hosted integration tests
for both routes, and the mandatory `/validate` extension (Phase 4 table rows, a new Phase 8.10
journey, deleting the Task 09 row from Phase 9, and a new Phase 6.14 check).

---

## STEP-BY-STEP TASKS

Execute in order, top to bottom. Each task is atomic and independently validatable.

### 1. ADD `react-hook-form` and prove it typechecks

- **IMPLEMENT**: `npm install react-hook-form@^7.85.0 --workspace @receipt/client --save-exact` to
  match the pinned style of `client/package.json` (`react: "19.2.8"`, not `^19`). Then write a
  three-line throwaway `.ts` that calls `useForm<{ a: string }>()` and typecheck it.
- **PATTERN**: `client/package.json:11-21` — runtime deps are exact-pinned.
- **GOTCHA**: TypeScript 7 is the native Go port and has already rejected `typescript-eslint` and
  `decimal.js` in this repo (README "Toolchain notes"). If `tsc --build` errors inside
  `react-hook-form`'s `.d.ts`, **stop and report** rather than working around it with `any` or
  `skipLibCheck`; fall back to the plain-`useState` option and record the deviation.
- **GOTCHA**: `npm install` must stay clean — never `--legacy-peer-deps` or `--force`
  (`/validate` Phase 0).
- **VALIDATE**: `npm install; npm run typecheck` — exit 0. Delete the throwaway file afterwards.

### 2. ADD `receiptDetailResponseSchema` to `shared/src/api.ts`

- **IMPLEMENT**: after `createReceiptResponseSchema`, derive:
  ```ts
  /**
   * PRD §10.3 / §10.4 — the review surface.
   *
   * `lowConfidenceFields` is a computed projection of extraction metadata, not the metadata
   * itself: the raw record carries provider and model names, which must never cross this
   * boundary (PRD §6.2, ROADMAP §5 rule 7). Canonical field names only.
   */
  export const receiptDetailResponseSchema = canonicalReceiptSchema.extend({
    lowConfidenceFields: z.array(z.string()),
  });
  export type ReceiptDetailResponse = z.infer<typeof receiptDetailResponseSchema>;
  ```
- **PATTERN**: `shared/src/api.ts:22-29` — derive with `.pick()`/`.extend()`, never redeclare.
- **IMPORTS**: `canonicalReceiptSchema` is already imported at `shared/src/api.ts:4`.
- **GOTCHA**: do **not** add this to `canonicalReceiptSchema` itself. That schema is also the
  persistence-mapping shape in `mapReceiptRow` (`api/src/repositories/receipts.ts:218-237`), and
  `lowConfidenceFields` is not a stored column.
- **GOTCHA**: `shared/src/receipt.test.ts:127-143` bans the words `azure`, `prebuilt`,
  `documentintelligence`, `analyzeresult`, `boundingregion`, `polygon` anywhere in `shared/src`.
  Keep the doc comment free of them.
- **VALIDATE**: `npx vitest run --project shared; npm run typecheck`

### 3. UPDATE `shared/src/api.test.ts` for the new schema

- **IMPLEMENT**: assert `receiptDetailResponseSchema` accepts a receipt with
  `lowConfidenceFields: []`, rejects the object when the key is missing, and still rejects an
  unknown top-level key (proving `.strict()` survived `.extend()`).
- **PATTERN**: `shared/src/receipt.test.ts:112-116` — the `unrecognized_keys` assertion.
- **VALIDATE**: `npx vitest run --project shared`

### 4. FIX `computeWarnings` so a corrected field clears its warning

- **IMPLEMENT**: in `api/src/validation/warnings.ts`, inside the `for (const field of input.unreadable
  ?? [])` loop at line 31, skip fields that now hold a value:
  ```ts
  for (const field of input.unreadable ?? []) {
    // An unreadable field is always empty at extraction time (the mapper returns without
    // assigning it), so this is a no-op there. It matters on recomputation after an edit:
    // once the user supplies a value, the "could not read this" warning is resolved and must
    // not persist for the life of the receipt.
    if (!isMissing(input.fields[field as keyof CanonicalReceiptFields] as string | null | undefined))
      continue;
    ...
  }
  ```
  Keep the existing `issueDate`/`issueTime` and `total`/`subtotal` branches unchanged. Prefer a
  small typed helper over the double cast if it reads better — the four names are a closed set.
- **PATTERN**: `isMissing` already exists at `api/src/validation/warnings.ts:63-65`.
- **GOTCHA**: warning **order** is asserted by existing tests
  (`warnings.test.ts:42-48`). Do not reorder the rules.
- **VALIDATE**: `npx vitest run --project api` — expect exactly one pre-existing failure, fixed next.

### 5. UPDATE `api/src/validation/warnings.test.ts` for D3

- **IMPLEMENT**: rewrite the assertion at lines 57–68. Replace the unrealistic
  `completeFields` + `unreadable: ["issueDate"]` pairing with the combination extraction actually
  produces — the field absent *and* flagged — then add the resolution case:
  ```ts
  it("distinguishes unreadable source content from absent values, and clears once corrected", () => {
    const unreadableDate = { ...completeFields, issueDate: undefined };
    expect(computeWarnings({ fields: unreadableDate, unreadable: ["issueDate"] })).toContainEqual({
      code: "unparseable_date", field: "issueDate",
    });
    // The user corrects it in the review form; recomputation must drop the warning without OCR
    // running again (ROADMAP Task 09 DoD).
    expect(
      warningsByCode(computeWarnings({ fields: completeFields, unreadable: ["issueDate"] }),
        "unparseable_date"),
    ).toEqual([]);
    // …same pair for total / unparseable_amount…
    expect(computeWarnings({ fields: completeFields, unreadable: [] })).toEqual([]);
  });
  ```
- **GOTCHA**: `warnings.test.ts:137` also passes `unreadable: ["issueDate", "total"]` with
  `fields: {}` — that one is already realistic (both absent) and must keep passing untouched.
- **VALIDATE**: `npx vitest run --project api` — green.

### 6. ADD a repository read for everything recomputation needs

- **IMPLEMENT**: in `api/src/repositories/receipts.ts`, add a focused read returning the stored
  canonical fields, the QR record and the extraction metadata in one query:
  ```ts
  export interface ReceiptReviewState {
    readonly status: ReceiptStatus;
    readonly fields: CanonicalReceiptFields;
    readonly qrExtraction: Json | null;
    readonly extractionMetadata: Json | null;
  }

  async findReviewState(id: string): Promise<ReceiptReviewState | null> { … }
  ```
  Select `status, canonical_data, qr_extraction, extraction_metadata`, filtered by
  `.eq("user_id", this.#userId).is("deleted_at", null)`, and parse `canonical_data` through
  `canonicalReceiptFieldsSchema`.
- **PATTERN**: mirror `findExtractionState` at `api/src/repositories/receipts.ts:143-159` exactly,
  including `.maybeSingle()` and the `ReceiptRepositoryError("query_failed", error)` wrapping.
- **GOTCHA**: the owner and soft-delete filters are the ownership check. Never add a separate one.
- **GOTCHA**: keep this internal. `ReceiptReviewState` must not appear in any response body — the
  route projects out of it.
- **VALIDATE**: `npm run typecheck; npx vitest run --project api`

### 7. ADD `lowConfidenceFields` projection + apply it to `GET /api/receipts/:id`

- **IMPLEMENT**: a small exported helper in `api/src/routes/receipts.ts` (or
  `api/src/validation/confidence.ts` if it reads better) that walks
  `extraction_metadata.fields` defensively — the column is `Json`, so treat every level as unknown —
  and returns the canonical field names whose `confidence` is a number below
  `LOW_CONFIDENCE_THRESHOLD`. Then extend the existing `GET /:id` handler to respond with
  `{ ...receipt, lowConfidenceFields }`.
- **IMPORTS**: `LOW_CONFIDENCE_THRESHOLD` from `../providers/document-extraction/types.js`.
- **GOTCHA**: `confidence` is `number | null`; `null` is **not** low confidence, it is unknown
  confidence. Only a real number strictly below the threshold counts.
- **GOTCHA**: return `[]` — never `undefined` — for `processing`, `failed`, or any receipt whose
  metadata is absent or malformed. The schema requires the key.
- **GOTCHA**: never spread `extraction_metadata` itself into a response.
- **VALIDATE**: `npm run typecheck`, then after task 12: `npm run test:integration`

### 8. ADD `PATCH /api/receipts/:id`

- **IMPLEMENT**: in `createReceiptsRouter`:
  ```ts
  router.patch("/:id", authenticated(async (req, res, auth) => {
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) throw new HttpError(400, "invalid_request");

    const body = updateReceiptRequestSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "invalid_request");

    const repository = new ReceiptRepository(auth.client, auth.userId);
    const state = await repository.findReviewState(id.data);
    if (state === null) throw new HttpError(404, "not_found");
    if (state.status !== "review" && state.status !== "confirmed") {
      throw new HttpError(409, "edit_not_allowed");
    }

    const fields = { ...state.fields, ...body.data };           // D7
    const warnings = computeWarnings({ fields, qr, unreadable }); // from stored state
    const receipt = await repository.update(id.data, { canonicalData: fields, warnings });
    if (receipt === null) throw new HttpError(404, "not_found");

    res.json({ ...receipt, lowConfidenceFields: … });
  }));
  ```
- **IMPORTS**: `updateReceiptRequestSchema` from `@receipt/shared`; `computeWarnings` from
  `../validation/warnings.js`.
- **GOTCHA — the whole point of the task**: the `update()` call passes **only** `canonicalData` and
  `warnings`. Passing `originalExtraction` would destroy the machine-vs-human distinction that
  PRD §6.4 requires. It stays frozen precisely because `update()` skips any key that is `undefined`
  (`receipts.ts:180`).
- **GOTCHA**: do not pass `status` — PATCH never changes it (D6).
- **GOTCHA**: parse the stored `qr_extraction` `Json` into `FiscalQrData` shape defensively before
  handing it to `computeWarnings`; a malformed column must degrade to `null`, not throw.
- **GOTCHA**: `.strict()` on `updateReceiptRequestSchema` means a body containing `userId` is a
  `400`, not a silently-ignored field. Do not add a manual delete of `userId` — that would imply
  the type system was not already handling it.
- **VALIDATE**: `npm run typecheck; npm run lint`

### 9. ADD `POST /api/receipts/:id/confirm`

- **IMPLEMENT**: mirror the retry route's shape (`receipts.ts:86-118`). Read state, then:
  `confirmed` → respond `200` with the stored `{ id, status, confirmedAt }` (idempotent);
  `review` → `update(id, { status: "confirmed", confirmedAt: new Date().toISOString() })` and
  respond `200`; anything else → `409 confirm_not_allowed`.
- **GOTCHA — non-negotiable (PRD §7.8, ROADMAP §5 rule 6)**: this handler must not read `warnings`
  at all. No count, no length check, no conditional. A warning outstanding is a normal, expected
  confirmation.
- **GOTCHA**: respond with exactly `confirmReceiptResponseSchema`'s three keys, not the whole
  receipt. The DTO already exists at `shared/src/api.ts:83-87`.
- **VALIDATE**: `npm run typecheck; npm run lint`

### 10. UPDATE `client/src/api/client.ts`

- **IMPLEMENT**: switch `getReceipt` to return `ReceiptDetailResponse` parsed with
  `receiptDetailResponseSchema`, and add:
  ```ts
  export async function updateReceipt(id, patch: UpdateReceiptRequest): Promise<ReceiptDetailResponse>
  export async function confirmReceipt(id): Promise<ConfirmReceiptResponse>
  export async function getReceiptSource(id): Promise<SourceDocumentResponse>
  ```
  `updateReceipt` sends `method: "PATCH"`, `headers: { "Content-Type": "application/json" }`,
  `body: JSON.stringify(patch)`.
- **PATTERN**: `client/src/api/client.ts:66-81`.
- **GOTCHA**: every call goes through the module-local `request()`. A raw `fetch` in a component
  fails `/validate` Phase 6.9 and would skip the bearer token and the 401 sign-out.
- **GOTCHA**: `ProcessingPage` calls `getReceipt` and only reads `.status`, so the return-type change
  is source-compatible — but the *runtime* parse now requires `lowConfidenceFields`, so task 7 must
  already be done or polling will throw.
- **VALIDATE**: `npm run typecheck; npx vitest run --project client`

### 11. CREATE `client/src/review/reviewForm.ts`

- **IMPLEMENT**: two pure functions and the form-values type. No React, no i18n.
  ```ts
  export interface ReviewFormValues { /* every field a string; arrays of string records */ }

  /** Server → form. null/undefined become "" so inputs stay controlled. */
  export function toFormValues(receipt: CanonicalReceiptFields): ReviewFormValues

  /** Form → wire. Assumes RHF validation passed. Empty string becomes null: missing stays
      missing (PRD §7.7), never "" and never 0. */
  export function toPatch(values: ReviewFormValues): CanonicalReceiptFields
  ```
  In `toPatch`: trim text fields; run amounts through `parseAmount`, `issueDate` through
  `parseIssueDate`, `issueTime` through `parseIssueTime`; uppercase and trim `currency`; drop
  wholly-empty rows from `vatBreakdown` and `items`; a resulting empty array becomes `null`.
- **IMPORTS**: `parseAmount`, `parseIssueDate`, `parseIssueTime`, `type CanonicalReceiptFields` from
  `@receipt/shared`. No `.js` extension — `client` uses `bundler` resolution.
- **GOTCHA**: `toPatch` must return a value that `canonicalReceiptFieldsSchema.parse()` accepts.
  Assert that in the tests rather than assuming it.
- **GOTCHA**: never substitute a default for a missing value. No `?? 0`, no `?? today`.
- **VALIDATE**: `npx vitest run --project client`

### 12. CREATE `client/src/review/reviewForm.test.ts`

- **IMPLEMENT**: cover the round trip `toFormValues(toPatch(...))`; `"100.50"` surviving with its
  trailing zero; Croatian `1.234,56` → `1234.56`; `17.08.2026.` → `2026-08-17`; `""` → `null` for
  every field type; `"  "` → `null`; an all-empty VAT row dropped; `eur` → `EUR`; and a final
  `expect(canonicalReceiptFieldsSchema.safeParse(toPatch(values)).success).toBe(true)`.
- **PATTERN**: `shared/src/money.test.ts` for table-driven amount cases.
- **VALIDATE**: `npx vitest run --project client`

### 13. CREATE `client/src/review/SourceDocumentPanel.tsx`

- **IMPLEMENT**: fetch `getReceiptSource(id)` on mount. Render `<img>` for image content types and,
  for `application/pdf`, an `<object>`/`<iframe>` plus an always-present "open in a new tab" link
  (mobile Safari will not inline a PDF). Show `Spinner` while loading and `ErrorMessage` with a
  retry on failure.
- **GOTCHA — signed URLs expire in 300 seconds** (`README.md`, "Receipt uploads"). A careful review
  easily outlasts that. Handle `<img onError>` by re-fetching the URL **once**, and expose a manual
  "reload" affordance; do not poll on a timer.
- **GOTCHA**: never render the signed URL as visible text, and never log it — `api/src/logger.ts`
  redacts `*.signedUrl` for a reason (PRD §9.4).
- **GOTCHA**: `alt` text must come from `t()`, like `HomePage.tsx:125`.
- **VALIDATE**: `npm run typecheck; npm run lint`

### 14. CREATE `client/src/routes/ReviewPage.tsx`

- **IMPLEMENT**: load the receipt via `getReceipt(id)`. While `status === "processing"`, redirect to
  the processing route. Build the form with:
  ```ts
  const { register, control, handleSubmit, reset, formState } =
    useForm<ReviewFormValues>({ values: toFormValues(receipt) });
  const vat = useFieldArray({ control, name: "vatBreakdown" });
  const items = useFieldArray({ control, name: "items" });
  ```
  Per-field validation via `register(name, { validate })` returning an i18n **key**, translated at
  render. Submit → `updateReceipt(id, toPatch(values))` → `reset(toFormValues(response))` so the
  form re-syncs to normalized values and `isDirty` clears. Confirm → `confirmReceipt(id)`.
  Layout: single `max-w-lg` column on mobile with the source panel behind a "Show receipt" toggle;
  two columns with a sticky source panel at `lg:`.
- **PATTERN**: `HomePage.tsx` for structure, Tailwind idiom, `min-h-11` targets and `role="alert"`.
- **GOTCHA**: use `values:` rather than `defaultValues:` so the form re-initializes when the fetched
  receipt arrives; `defaultValues` is captured once and would leave every input blank.
- **GOTCHA**: `useFieldArray` rows must key on `field.id`, never the array index — removing a row
  otherwise corrupts the inputs below it.
- **GOTCHA — the confirm button is never disabled by warnings.** Disable it only while a request is
  in flight or the form is dirty-and-unsaved. Any code path where a warning blocks confirmation is a
  bug (PRD §7.8).
- **GOTCHA**: attach warnings by matching `warning.field` to the RHF field path. Nested paths arrive
  dotted (`vatBreakdown.0.vatAmount`), which is already RHF's own path format.
- **GOTCHA**: render warnings with `t(\`warnings.${warning.code}\`)`. `/validate` Phase 6.5 cannot
  follow a template literal — that is exactly why `client/src/i18n/warnings.test.ts` exists.
- **GOTCHA**: after a successful confirm, stay on the page and render a confirmed state. Do **not**
  invent a `/history` route; Task 10 owns it.
- **GOTCHA**: no hardcoded user-facing string, anywhere, including `aria-label`s and the legends on
  the VAT and items sections (PRD §7.13).
- **VALIDATE**: `npm run typecheck; npm run lint; npm run format:check`

### 15. ADD the `review.*` i18n namespace to both locale files

- **IMPLEMENT**: add a `review` block to `en.json` and `hr.json` with identical key sets — section
  headings, every field label, save/confirm/saving/confirmed copy, the unsaved-changes hint, the
  add/remove row actions, the source-panel toggle and alt text, `review.lowConfidence`, and
  `review.errors.{amount,date,time,currency,save,confirm,load}`.
- **GOTCHA — mojibake**: this has bitten the project twice (Task 07 shipped `"PokuÅ¡ajte ponovno"`;
  Task 08 shipped `"RaÄun"` in a test fixture). Write Croatian diacritics (`č ć ž š đ`) with a tool
  that writes real UTF-8, then run the Phase 6.11 scan before moving on.
- **GOTCHA**: `warnings.*` messages already exist for all seven codes in both files. Do not
  duplicate them under `review.*`.
- **VALIDATE**:
  `npx vitest run --project client` (parity via `i18n.test.ts`), then `/validate` Phase 6.11 verbatim.

### 16. UPDATE `client/src/App.tsx` and DELETE `ReviewReadyPage`

- **IMPLEMENT**: point `receipts/:id/review` at `ReviewPage`; delete
  `client/src/routes/ReviewReadyPage.tsx` and its import; remove the `reviewReady` block from both
  locale files.
- **GOTCHA**: `ProcessingPage.tsx:59` navigates to `/receipts/${id}/review` — that path stays
  identical, so nothing else changes.
- **GOTCHA — do not touch adjacent dead code.** `home.apiStatus` / `home.apiOnline` /
  `home.apiOffline` are already unused (the API status card was removed in Task 06). They are
  **pre-existing**, so CLAUDE.md §3 says mention them, not delete them. Note them in the history
  file's follow-ups instead.
- **VALIDATE**: `npx vitest run --project client; npm run build`

### 17. CREATE `client/src/routes/ReviewPage.test.tsx`

- **IMPLEMENT**: with `vi.mock("../api/client")`, cover:
  1. fields pre-populate from the fetched receipt;
  2. a warning renders next to its field, asserted against rendered English copy;
  3. editing `documentNumber` and saving calls `updateReceipt` with the corrected value;
  4. a save response with fewer warnings removes the stale one from the DOM;
  5. **confirm succeeds while a warning is displayed**, and the confirm control is never disabled by
     one;
  6. typing `abc` in `total` blocks submission and shows the translated amount error;
  7. typing Croatian `1.234,56` submits `"1234.56"`;
  8. a `lowConfidenceFields` entry marks its input distinctly.
- **PATTERN**: `client/src/routes/ProcessingPage.test.tsx` — `MemoryRouter` + `Routes`, `import
  "../i18n"`, `@testing-library/user-event` for typing.
- **GOTCHA**: assert on accessible names and rendered copy, not `data-testid`. That is what catches a
  missing translation.
- **VALIDATE**: `npx vitest run --project client`

### 18. EXTEND `api/src/routes/receipts.integration.ts`

- **IMPLEMENT**: add hosted cases — PATCH persists a corrected `documentNumber` and returns
  recalculated warnings; **`original_extraction` still holds the pre-edit machine values after both
  a PATCH and a confirm** (read the row directly with the admin client to prove it); confirm from
  `review` sets `status` and `confirmedAt`; confirm again is idempotent; confirm on a `processing`
  receipt is `409`; PATCH on a `processing` receipt is `409`; a PATCH body carrying `userId` is
  `400`; another user's receipt is `404` for both routes.
- **PATTERN**: the existing file's disposable-user + injected-provider setup, lines 17–73. Use a
  `task09-` email prefix so `/validate` Phase 7b's orphan sweep finds strays.
- **GOTCHA**: these run against the **hosted** project. Register new source object paths in
  `sourcePaths` so `afterAll` removes them — Storage does not cascade on user delete.
- **VALIDATE**: `npm run test:integration`

### 19. UPDATE `.claude/commands/validate.md` — mandatory, by hand

- **IMPLEMENT**: four edits.
  1. **Phase 4 table** — one row per new test file, saying what it protects.
  2. **New Phase 6.14** — a check that the edit and confirm paths never write
     `original_extraction`:
     ```
     node -e "const fs=require('fs'); const s=fs.readFileSync('api/src/routes/receipts.ts','utf8'); if(/originalExtraction/.test(s)) throw new Error('a receipt route writes original_extraction; machine values must stay frozen'); console.log('ok');"
     ```
  3. **New Phase 8.10 journey** — pre-populated form → correct a wrong document number → save →
     warning recalculates → confirm **with a warning outstanding** succeeds → `original_extraction`
     unchanged → both languages → 375 px one-handed.
  4. **Phase 9** — delete the Task 09 row.
- **GOTCHA**: never re-run `/ultimate_validate_command`. It overwrites this file and would delete
  roughly 140 lines of hard-won checks (see "Maintaining this file").
- **VALIDATE**: run every command you added and confirm each prints `ok`; deliberately break the
  6.14 input once to confirm it throws.

### 20. UPDATE `README.md`

- **IMPLEMENT**: add `PATCH /api/receipts/:id` and `POST /api/receipts/:id/confirm` to the API
  table; add a "Review and confirmation" section covering D1 (explicit save), D2 (RHF without a
  resolver, and why), D4 (`lowConfidenceFields` as a projection), D5 (canonical strings in inputs),
  D6 (status guards) and the 300-second source-URL expiry; update the status blockquote to Task 09.
- **GOTCHA**: `/validate` Phase 6.6 parses this file — every `` `path` `` must resolve, every `npm
  run` script must exist, and every `.env.example` variable must appear in the Configuration table.
  No new variables here, so that part is unchanged.
- **GOTCHA**: Prettier does not format `*.md` and must not start. Hand-align any table you touch.
- **VALIDATE**: the Phase 6.6 node command from `validate.md`.

### 21. WRITE `.agents/history/09-review-form-editing-confirmation.md` and update the roadmap

- **IMPLEMENT**: follow the template in ROADMAP §1. Record D1–D7 in "Decisions made", the
  `warnings.ts` / `warnings.test.ts` edit under "Deviations from the plan", the pre-existing dead
  `home.api*` keys under "Known gaps", and real validation output. Mark Task 09 ✅ in the §3
  progress table with plan and history links, and update the status line in §"Status" at the top.
- **VALIDATE**: both links resolve; the progress table stays hand-aligned.

---

## TESTING STRATEGY

### Unit Tests

Vitest, three projects (`shared` node, `api` node, `client` jsdom). New coverage:

- `client/src/review/reviewForm.test.ts` — the normalization boundary, table-driven.
- `client/src/routes/ReviewPage.test.tsx` — behaviour through the rendered DOM.
- `api/src/validation/warnings.test.ts` — extended for D3.
- `shared/src/api.test.ts` — extended for `receiptDetailResponseSchema`.

### Integration Tests

`api/src/routes/receipts.integration.ts` against the hosted Supabase project
(`npm run test:integration`), which is required on every task. Phase 7a (Docker) is **skippable
here — this task changes no migration** — but the skip must be reported, never counted as green.

### Edge Cases

Every one of these must have a test:

- A field the user clears entirely → `null`, never `""`.
- `"100.50"` round-trips with its trailing zero intact.
- Croatian `1.234,56` and English `1,234.56` both normalize to `1234.56`.
- `"17.08.2026."` (trailing full stop) → `2026-08-17`.
- `14:30` does not gain `:00`.
- Unparseable amount blocks submit with a translated message instead of silently nulling the field.
- A wholly-empty VAT row is dropped; a partially-filled one is kept.
- Confirm with a warning outstanding succeeds.
- PATCH during `processing` is `409` (the extraction race).
- `original_extraction` unchanged after both PATCH and confirm.
- `userId` in a PATCH body → `400`.
- Another user's receipt → `404` on both routes.
- A `lowConfidenceFields` entry renders distinctly; `confidence: null` does **not** count as low.
- An expired signed URL recovers via a single re-fetch.

---

## VALIDATION COMMANDS

Run `/validate` in full at the end. During implementation:

### Level 1: Syntax & Style

```
npm run lint
npm run typecheck
npm run format:check
```

`typecheck` is the authoritative gate — oxlint has no type-aware rules. Do not pipe `typecheck`
through `head`/`tail`; the pipe masks its exit code.

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

Confirm the runner prints the **hosted** target before any test runs. Then check for orphaned
`task09-` users with the sweep command in `/validate` Phase 7b.

### Level 4: Manual Validation

Free the ports first — a stale Vite answers on 5173 while the new one moves to 5174 and every check
below silently passes against old code:

```powershell
foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "cleaned port $p" } else { "port $p free" } }
```

Then `npm run dev:api` and `npm run dev --workspace @receipt/client -- --host 0.0.0.0 --strictPort`,
confirm Vite reports **5173**, and walk Phase 8.10: upload a real receipt from
`C:\Users\Frane\Desktop\računi\`, correct a value, save, watch the warning recalculate, confirm with
a warning outstanding, then verify in the row that `original_extraction` still holds the machine
values. Repeat in Croatian. Check 375 px width for one-handed use and no horizontal overflow.

### Level 5: Additional Validation

The Supabase MCP tools (`execute_sql`, `list_tables`) can inspect `original_extraction` versus
`canonical_data` on a real row directly — the fastest way to prove the freeze holds end to end.

---

## ACCEPTANCE CRITERIA

Straight from ROADMAP Task 09's definition of done, plus this plan's own:

- [ ] A receipt in `review` shows pre-populated fields matching the extraction.
- [ ] Editing a wrong document number and saving persists the corrected value.
- [ ] A warning is visible next to its field, in both languages.
- [ ] Confirming with an unresolved warning succeeds.
- [ ] After confirmation, `original_extraction` still holds the pre-edit machine values.
- [ ] Nothing transitions to `confirmed` without an explicit user action.
- [ ] Component tests cover pre-population, edit → warning recalculation, and confirm.
- [ ] A corrected unreadable field clears its `unparseable_*` warning (D3).
- [ ] No Azure vocabulary in any response body or in `shared/src`.
- [ ] Money is a decimal string end to end; no `parseFloat`, no `Number()` on a money path.
- [ ] Every user-facing string is translated in `hr` and `en`, with no mojibake.
- [ ] `/validate` passes, with Phase 7a's skip named and justified.

---

## COMPLETION CHECKLIST

- [ ] All 21 tasks completed in order, each validated immediately
- [ ] `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build` green
- [ ] `npm run test:integration` green against hosted, no orphaned `task09-` users
- [ ] Every Phase 6 check passes, including the new 6.14
- [ ] Phase 8.10 walked by hand in both languages at 375 px
- [ ] `.claude/commands/validate.md` extended by hand (Phase 4 rows, 6.14, 8.10, Phase 9 row removed)
- [ ] `README.md` updated and Phase 6.6 passes
- [ ] History file written; ROADMAP §3 marks Task 09 ✅ with both links
- [ ] Uncommitted `CLAUDE.md` and untracked `.mcp.json` kept **out** of this task's commit

---

## NOTES

**Why this task is larger than it looks.** The API half is small — two routes and a repository read,
maybe 120 lines. The client half is the largest single component in the project: ~17 scalar inputs,
two field arrays, warning attachment, low-confidence marking, a source viewer with an expiring URL,
and a responsive layout that has to work one-handed at 375 px. Budget accordingly, and build the
pure `reviewForm.ts` first so the component is assembling tested pieces rather than inventing
normalization inline.

**The one irreversible mistake.** If `original_extraction` is ever overwritten, the machine-versus-
human distinction PRD §6.4 requires is gone for that receipt and cannot be reconstructed. It stays
safe only because `ReceiptRepository.update()` skips `undefined` keys — which means the protection is
the *absence* of a line of code. That is why task 19 adds a grep for it: absence is exactly the kind
of guarantee a future edit deletes by accident.

**Considered and rejected.**

- *`zodResolver` over the canonical schema* — rejected in D2; it would reject valid Croatian input.
- *Debounced autosave* — rejected in D1; it fights normalization and makes warnings flicker.
- *Formatting money with `formatAmount` inside inputs* — rejected in D5; lossy round trip. It belongs
  in Task 10's read view and Task 11's export.
- *Returning `extraction_metadata` on the API* — rejected in D4; it carries provider and model names.
- *Non-idempotent confirm* — rejected in D6; a retried request after a dropped response would show a
  spurious error for an operation that actually succeeded.
- *A `/history` redirect after confirm* — rejected; Task 10 owns that route.

**Out of scope, however tempting** (PRD §4.6–4.8, ROADMAP §5 rule 10): OIB checksum validation
(PRD §13 lists it as future), duplicate detection, buyer-OIB matching, company verification, LLM
assistance, and the history list itself (Task 10).

**Confidence: 8/10** for one-pass success. The API half and the pure functions are well-specified
and low-risk. The two points of residual risk are (1) `react-hook-form` under TypeScript 7 — hence
the spike in task 1, which fails fast and cheap — and (2) the review layout needing more iteration
than a plan can specify, since "easy to compare against the source" is a judgement call that only
looks right in a browser.
