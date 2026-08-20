# Feature: CSV & JSON export

The following plan should be complete, but it is important that you validate documentation, codebase
patterns and task sanity before you start implementing.

Pay special attention to the naming of existing utils, types and models. Import from the right files:
cross-workspace imports use `@receipt/shared`, never a relative path, and `api`/`shared` use
`nodenext` resolution so **relative imports need a `.js` extension even in `.ts` source**.

## Feature Description

Task 11 of `.agents/ROADMAP.md`. The authenticated user can download their **confirmed,
non-deleted** receipts as CSV or JSON from the history screen. This is the last link in the PoC's
value chain — it proves the canonical record is useful to a downstream system that does not exist
yet, which is the whole reason PRD §6.2 insisted on a provider-independent model.

The export formats are a **published contract**, not an implementation detail: the CSV column names
and the JSON `schemaVersion` get documented in `README.md` because a future accounting integration
will read them.

## User Story

As a business user
I want to export my confirmed receipt data as CSV or JSON
So that I can reuse it in accounting preparation before any direct integration exists

## Problem Statement

Confirmed receipts are currently trapped in the PoC. A user can capture, review, correct, confirm and
revisit a receipt, but there is no way to get the structured result out. PRD §11.1 lists export as
step 10 of MVP success, and PRD §11.2 requires both CSV and JSON to work.

Two failure modes make a naive implementation actively harmful rather than merely incomplete:

1. **Spreadsheet formula injection.** Seller names come from OCR of an attacker-influencable
   document. A seller name of `=cmd|'/c calc'!A1` becomes executable content when the CSV is opened
   in Excel (PRD §7.12, §9.3).
2. **Silent data loss.** Croatian diacritics mangled by Excel's default codepage, a total exported as
   `100.5` instead of `100.50`, or a result set silently truncated by PostgREST's row cap would each
   produce an export that looks fine and is wrong.

## Solution Statement

Add `GET /api/receipts/export?format=csv|json`, backed by a new repository read that returns every
confirmed, non-deleted receipt owned by the caller. A small pure `api/src/export/receipts.ts` module
turns that list into either a CSV document (UTF-8 BOM, CRLF, RFC 4180 escaping, OWASP formula
neutralization on text columns) or a versioned JSON body derived from the existing canonical schema.

The client downloads through the existing authenticated API wrapper and hands the bytes to the
browser as an object URL, because a plain `<a href>` cannot carry a bearer token.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium — the endpoint is small, but the correctness details (row cap,
encoding, neutralization, route ordering) are where this task can silently fail.
**Primary Systems Affected**: `shared/src/api.ts`, `api/src/export/` (new), `api/src/repositories/receipts.ts`,
`api/src/routes/receipts.ts`, `client/src/api/client.ts`, `client/src/routes/HistoryPage.tsx`, both locale files, `README.md`
**Dependencies**: None. No new npm package — CSV generation is ~40 lines and a library would be a
larger surface than the code it replaces (CLAUDE.md §2).

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: YOU MUST READ THESE BEFORE IMPLEMENTING

- `api/src/routes/receipts.ts` (lines 28–66) — Why: **route registration order matters here.**
  `router.get("/:id")` is registered at line 51 and `idSchema` is `z.uuid()`, so an `/export` route
  registered *after* it would be matched as `:id = "export"` and rejected `400 invalid_request`.
  Task 10's history file flags this explicitly.
- `api/src/routes/receipts.ts` (lines 32–41) — Why: the exact `authenticated(...)` + `safeParse` +
  `HttpError` shape every route in this file follows. Mirror it.
- `api/src/repositories/receipts.ts` (lines 203–241) — Why: `listPage()` is the query pattern to
  mirror — owner filter, `deleted_at` filter, `count: "exact"`, `.order()`, `.range()`. Note its
  `PGRST103` handling: an out-of-range `.range()` is an **error**, not an empty result.
- `api/src/repositories/receipts.ts` (lines 288–307) — Why: `mapReceiptRow` is the only sanctioned
  row → `CanonicalReceipt` conversion. Never build a receipt object by hand.
- `shared/src/receipt.ts` (lines 43–97) — Why: the two-tier schema split. The export DTO must be
  **derived** from `canonicalReceiptSchema` with `.omit()`, never redeclared (`shared/src/api.test.ts`
  enforces this philosophy for the PATCH body).
- `shared/src/api.ts` (lines 98–101) — Why: `EXPORT_FORMATS` and `exportFormatSchema` **already
  exist** from Task 02. Do not recreate them; extend this file beneath them.
- `shared/src/index.ts` (lines 46–66) — Why: every new shared export must be added to this barrel.
  A symbol not listed here is not importable as `@receipt/shared`.
- `shared/src/money.ts` (lines 10–15, 100–117) — Why: canonical money is a string with trailing zeros
  preserved. The export must pass `total` through **untouched**. Never call `formatAmount` in an
  export — it is for display, and `100.50` must export as exactly `100.50`.
- `client/src/api/client.ts` (lines 38–67) — Why: `request()` is the single authenticated fetch path.
  `/validate` Phase 6.9 fails the build if any other file calls `fetch(`. The export download **must**
  go through this function.
- `client/src/routes/HistoryPage.tsx` (lines 58–108) — Why: the layout, `min-h-11` touch-target
  convention, `ErrorMessage`/`Spinner` usage and where the export controls belong.
- `client/src/routes/HistoryPage.test.tsx` (lines 1–50) — Why: the `vi.mock("../api/client", ...)`
  pattern. **Adding a new export to that module means adding it to the mock factory**, or every
  existing test in the file breaks with an undefined import.
- `client/src/api/client.test.ts` (lines 24–51) — Why: the `respondWith` / `vi.stubGlobal("fetch")`
  test harness to reuse for the new client function.
- `api/src/routes/receipts.integration.ts` (lines 1–80) — Why: the hosted-integration harness —
  disposable `task05-` users, a stubbed extraction provider, `sourcePaths` cleanup in `afterAll`.
- `api/src/middleware/error-handler.ts` (lines 9–19) — Why: `HttpError(status, code)`; failures carry
  a stable machine code, never prose.
- `supabase/config.toml` (line 18) — Why: **`max_rows = 1000`**. A single unbounded PostgREST select
  is silently capped at 1000 rows. See Gotcha 2.

### New Files to Create

- `api/src/export/receipts.ts` — pure CSV and JSON serialization for confirmed receipts
- `api/src/export/receipts.test.ts` — unit tests for column order, escaping, neutralization, encoding
- `client/src/history/download.ts` — object-URL download helper and export filename builder
- `client/src/history/download.test.ts` — unit tests for the helper
- `.agents/history/11-csv-json-export.md` — written by `/execute` at the end, per ROADMAP §1

### Relevant Documentation — YOU SHOULD READ THESE BEFORE IMPLEMENTING

- [OWASP — CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
  - Section: mitigation
  - Why: defines the trigger set and the current recommended prefix. Confirmed August 2026: the
    vulnerable leading characters are `=`, `+`, `-`, `@`, **Tab (0x09) and Carriage Return (0x0D)**,
    and the recommended neutralizer is a leading **single quote `'`**.
- [Symfony CVE-2021-41270 — Prevent CSV Injection via formulas](https://symfony.com/blog/cve-2021-41270-prevent-csv-injection-via-formulas)
  - Why: a real-world CVE showing the earlier tab-prefix mitigation being *insufficient* after OWASP
    added `\t` and `\r` to the list. Do not implement the tab-prefix approach.
- [RFC 4180 — Common Format and MIME Type for CSV Files](https://www.rfc-editor.org/rfc/rfc4180)
  - Sections 2.5–2.7
  - Why: field quoting rules — a field containing `"`, `,`, CR or LF is wrapped in double quotes and
    embedded quotes are doubled. Section 2.1 specifies CRLF line breaks.
- [MDN — URL.createObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)
  - Why: the client download mechanism, including the `revokeObjectURL` requirement to avoid leaking
    the blob for the lifetime of the document.
- [PostgREST — Pagination and count / max-rows](https://docs.postgrest.org/en/v12/references/api/pagination_count.html)
  - Why: explains that `db-max-rows` caps a response **without erroring**, which is the silent
    truncation risk in Gotcha 2.

### Patterns to Follow

**API route shape** — `api/src/routes/receipts.ts:32`:

```ts
router.get(
  "/",
  authenticated(async (req, res, auth) => {
    const query = listReceiptsQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, "invalid_request");

    const page = await new ReceiptRepository(auth.client, auth.userId).listPage(query.data);
    res.json({ ...page, page: query.data.page, limit: query.data.limit });
  }),
);
```

`authenticated()` passes the proven identity as a **third parameter** — there is no `req.auth`, by
design (`README.md`, "Authentication"). `auth.client` is a Supabase client already carrying the
caller's own token, so RLS applies to every query.

**Repository query shape** — `api/src/repositories/receipts.ts:204`:

```ts
const filtered = this.#client
  .from("receipts")
  .select("*", { count: "exact" })
  .eq("user_id", this.#userId)
  .is("deleted_at", null);
```

Owner scoping and soft-delete filtering live in the repository, never in the route.

**Derived DTOs, never redeclared** — `shared/src/api.ts:85`:

```ts
export const updateReceiptRequestSchema = canonicalReceiptFieldsSchema.partial();
```

**Client API function shape** — `client/src/api/client.ts:87`:

```ts
export async function getReceipts(
  query: { page?: number; status?: ReceiptStatus } = {},
  signal?: AbortSignal,
): Promise<ListReceiptsResponse> {
  const params = new URLSearchParams();
  ...
  const response = await request(`/api/receipts${search === "" ? "" : `?${search}`}`, { signal });
  return listReceiptsResponseSchema.parse(await response.json());
}
```

**Touch targets** — every interactive control carries `min-h-11` (44 px, PRD §11.5). Task 09 shipped
a defect here; do not repeat it.

**Translation keys** — no hardcoded user-facing string, ever. Keys are typed against
`client/src/i18n/locales/en.json`, so an unknown key is a compile error, and `i18n.test.ts` enforces
`hr`/`en` parity.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — the published contract

Define the export contract in `shared` so both the API and the README describe the same thing.

**Tasks:**

- Add `EXPORT_SCHEMA_VERSION`, the derived per-receipt export schema and the JSON envelope schema to
  `shared/src/api.ts`, beneath the existing `EXPORT_FORMATS`.
- Re-export them from `shared/src/index.ts`.

### Phase 2: Core Implementation — serialization and the query

**Tasks:**

- Add `listConfirmedForExport()` to `ReceiptRepository`, paging internally so PostgREST's
  `max_rows = 1000` cannot truncate the result.
- Create `api/src/export/receipts.ts` with `CSV_COLUMNS`, `toCsv()` and `toJsonExport()`.

### Phase 3: Integration — endpoint and UI

**Tasks:**

- Register `GET /export` in the receipts router **above** `GET /:id`.
- Add `exportReceipts()` to the client API module and a `download.ts` helper.
- Add the two export controls to `HistoryPage`, with `hr`/`en` copy.

### Phase 4: Testing, documentation & validation

**Tasks:**

- Unit tests for serialization, the repository query, the client function and the page controls.
- Hosted integration tests proving scope and route ordering against the real project.
- README export-contract section; `/validate` Phase 4 rows, Phase 8 journey 8.12, Phase 9 row removed.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom.

### UPDATE `shared/src/api.ts`

- **IMPLEMENT**: Beneath the existing `EXPORT_FORMATS` / `exportFormatSchema` block (line 98–101),
  add:
  - `export const EXPORT_SCHEMA_VERSION = 1;`
  - `exportedReceiptSchema = canonicalReceiptSchema.omit({ userId: true, deletedAt: true })` — the
    exported view of one receipt. `userId` is the caller's own id and is noise in their own export;
    `deletedAt` is always `null` for an exported row by definition of the scope.
  - `jsonExportResponseSchema = z.object({ schemaVersion: z.literal(EXPORT_SCHEMA_VERSION), receipts: z.array(exportedReceiptSchema) }).strict()`
  - Inferred types `ExportedReceipt` and `JsonExportResponse`.
- **PATTERN**: `shared/src/api.ts:23` (`createReceiptResponseSchema` uses `.pick()`) and
  `shared/src/api.ts:85` (PATCH body uses `.partial()`). Derive; never redeclare.
- **IMPORTS**: `canonicalReceiptSchema` is already imported at the top of the file.
- **GOTCHA**: Do **not** add an `exportedAt` timestamp. PRD §7.12 asks only for "a simple
  schema/export version"; a timestamp is unrequested scope (CLAUDE.md §2).
- **GOTCHA**: `schemaVersion` is `z.literal(1)`, not `z.number()` — the version is a constant of this
  contract, and a literal makes an accidental change a type error.
- **VALIDATE**: `npx tsc --build`

### UPDATE `shared/src/index.ts`

- **IMPLEMENT**: Add `EXPORT_SCHEMA_VERSION`, `exportedReceiptSchema`, `jsonExportResponseSchema`,
  `type ExportedReceipt` and `type JsonExportResponse` to the existing `./api.js` export block
  (lines 46–66), keeping its alphabetical-ish grouping of values then types.
- **GOTCHA**: A symbol missing from this barrel is not importable as `@receipt/shared` and the failure
  looks like a module resolution bug.
- **VALIDATE**: `npx tsc --build`

### UPDATE `shared/src/api.test.ts`

- **IMPLEMENT**: Add cases proving (a) `exportedReceiptSchema` rejects a body carrying `userId`
  (`unrecognized_keys`, because `.strict()` survives `.omit()`), (b) `jsonExportResponseSchema`
  rejects a wrong `schemaVersion`, (c) a receipt with every optional field absent is accepted, and
  (d) a `total` of `"100.50"` survives a parse round trip with its trailing zero intact.
- **PATTERN**: the existing forged-`userId` test in this file.
- **VALIDATE**: `npx vitest run --project shared`

### UPDATE `api/src/repositories/receipts.ts`

- **IMPLEMENT**: Add `async listConfirmedForExport(): Promise<CanonicalReceipt[]>` — every confirmed,
  non-deleted receipt owned by this user, newest first. Page internally in a loop with a page size
  constant (e.g. `const EXPORT_PAGE_SIZE = 500;`), accumulating until a page returns fewer rows than
  requested:

  ```ts
  const items: CanonicalReceipt[] = [];
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    const { data, error } = await this.#client
      .from("receipts")
      .select("*")
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + EXPORT_PAGE_SIZE - 1);

    if (error) throw new ReceiptRepositoryError("query_failed", error);
    items.push(...data.map(mapReceiptRow));
    if (data.length < EXPORT_PAGE_SIZE) return items;
  }
  ```

- **PATTERN**: `listPage()` at line 204 — same owner and soft-delete filters, same `mapReceiptRow`.
- **GOTCHA (the important one)**: `supabase/config.toml:18` sets `max_rows = 1000`. A single
  unbounded `.select("*")` is **silently capped** at 1000 rows — no error, just a short answer. The
  loop above removes the cap from the correctness argument entirely, at the cost of ~10 lines. Keep
  `EXPORT_PAGE_SIZE` **below** `max_rows` or the loop's termination test breaks.
- **GOTCHA**: The second `.order("id")` is not decoration. Paging without a total ordering can repeat
  or skip a row when two receipts share a `created_at`; the id tiebreak makes the loop provably
  correct.
- **GOTCHA**: Terminating on `data.length < EXPORT_PAGE_SIZE` means the loop never issues an
  out-of-range `.range()`, so it cannot hit the `PGRST103` case `listPage()` has to handle.
- **VALIDATE**: `npx vitest run --project api`

### UPDATE `api/src/repositories/receipts.test.ts`

- **IMPLEMENT**: With the existing query-builder stub, assert `listConfirmedForExport()` (a) applies
  the `user_id`, `deleted_at is null` and `status = confirmed` filters, (b) issues a **second** range
  request when the first returns a full page and stops when a short page arrives, and (c) maps rows
  through `mapReceiptRow`.
- **PATTERN**: the existing `listPage` tests in this file, including how they assert filter calls.
- **VALIDATE**: `npx vitest run --project api`

### CREATE `api/src/export/receipts.ts`

- **IMPLEMENT**: A pure module — no I/O, no Express, no Supabase.

  ```ts
  export const CSV_COLUMNS = [
    "id", "status",
    "sellerName", "sellerAddress", "sellerOib",
    "buyerName", "buyerAddress", "buyerOib",
    "documentNumber", "issueDate", "issueTime",
    "subtotal", "total", "currency", "vatBreakdown",
    "paymentMethod", "jir", "zki",
    "confirmedAt", "createdAt", "updatedAt",
  ] as const;
  ```

  - `toJsonExport(receipts: CanonicalReceipt[]): JsonExportResponse` — strips `userId` and
    `deletedAt`, wraps in `{ schemaVersion: EXPORT_SCHEMA_VERSION, receipts }`. Parse the result
    through `jsonExportResponseSchema` so the contract is enforced at runtime, not just at compile
    time.
  - `toCsv(receipts: CanonicalReceipt[]): string` — header row from `CSV_COLUMNS`, then one row per
    receipt, joined with **CRLF**, prefixed with a **UTF-8 BOM (`﻿`)**.
  - `vatBreakdown` serializes as compact `JSON.stringify(...)` of the array, or `""` when absent.
  - Two private helpers:
    - `neutralizeFormula(value: string): string` — returns `'` + value when the first character is
      one of `= + - @ \t \r`, else the value unchanged.
    - `escapeCsvField(value: string): string` — wraps in `"` and doubles embedded `"` when the value
      contains `"`, `,`, `\r` or `\n`.
  - Apply `neutralizeFormula` to **text columns only**: `sellerName`, `sellerAddress`, `sellerOib`,
    `buyerName`, `buyerAddress`, `buyerOib`, `documentNumber`, `currency`, `vatBreakdown`,
    `paymentMethod`, `jir`, `zki`. Do **not** apply it to `id`, `status`, `issueDate`, `issueTime`,
    `subtotal`, `total`, `confirmedAt`, `createdAt`, `updatedAt`.
  - `null`/`undefined` renders as an empty field — never `"null"`, never `0`.
- **IMPORTS**: `import { EXPORT_SCHEMA_VERSION, jsonExportResponseSchema, type CanonicalReceipt, type JsonExportResponse } from "@receipt/shared";`
- **GOTCHA (money)**: Write `receipt.total` through **verbatim**. Do not call `formatAmount`, do not
  call `Number()`, do not reformat. `100.50` must export as exactly `100.50` — `/validate` Phase 6.8
  greps for this class of mistake and the roadmap DoD names it.
- **GOTCHA (why text-only neutralization)**: a negative total is canonically `-12.50`, which starts
  with `-`. Neutralizing it to `'-12.50` would turn a number into text and break arithmetic in the
  consuming spreadsheet. Money, dates and timestamps are all validated by
  `canonicalReceiptSchema` before they reach here (`AMOUNT_PATTERN`, `z.iso.date()`,
  `z.iso.datetime()`), so they are structurally incapable of carrying a formula. `currency` **is**
  neutralized — it is only `z.string().length(3)`, and `=AB` fits.
- **GOTCHA (BOM)**: Excel on Windows reads a BOM-less UTF-8 CSV in the system ANSI codepage and
  mangles `š č ć ž đ`. The roadmap DoD is literally "CSV opens correctly in a spreadsheet with
  Croatian characters intact", so the BOM is required, not cosmetic.
- **GOTCHA (escaping order)**: neutralize **first**, then escape. Escaping first would leave the
  injected `'` outside the quotes.
- **VALIDATE**: `npx vitest run --project api`

### CREATE `api/src/export/receipts.test.ts`

- **IMPLEMENT**: Cases:
  1. Header row matches `CSV_COLUMNS` in order and follows the BOM.
  2. A seller name of `=cmd|'/c calc'!A1` is emitted with a leading `'`.
  3. Each of `+`, `-`, `@`, `\t`, `\r` as a leading character is neutralized.
  4. A negative `total` of `-12.50` is **not** neutralized and appears verbatim.
  5. `total: "100.50"` appears as exactly `100.50`.
  6. A seller name containing `"` and `,` is quoted with the quote doubled.
  7. Croatian diacritics survive; the output starts with `﻿`.
  8. Rows are joined with `\r\n`.
  9. A receipt with every optional field absent produces the right number of empty fields.
  10. `vatBreakdown` round-trips as parseable JSON; an absent breakdown is an empty field.
  11. `toJsonExport` omits `userId` and `deletedAt`, sets `schemaVersion: 1`, and preserves nested
      `vatBreakdown` and `items`.
  12. **No Azure vocabulary** appears in either output for a representative receipt (roadmap DoD).
- **PATTERN**: plain Vitest `describe`/`it` with inline fixtures, as in `api/src/validation/warnings.test.ts`.
- **VALIDATE**: `npx vitest run --project api`

### UPDATE `api/src/routes/receipts.ts`

- **IMPLEMENT**: Register the export route **immediately after `router.get("/")` and before
  `router.get("/:id")`** (i.e. insert at what is currently line 43, above the `/:id` comment block):

  ```ts
  /**
   * PRD §10.9. Registered above `/:id` deliberately: Express matches in registration order, so
   * a later registration would be captured by `/:id` and rejected as a malformed UUID.
   */
  router.get(
    "/export",
    authenticated(async (req, res, auth) => {
      const format = exportFormatSchema.safeParse(req.query["format"]);
      if (!format.success) throw new HttpError(400, "invalid_request");

      const receipts = await new ReceiptRepository(auth.client, auth.userId).listConfirmedForExport();
      const filename = `receipts-${new Date().toISOString().slice(0, 10)}.${format.data}`;
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      if (format.data === "csv") {
        res.type("text/csv; charset=utf-8").send(toCsv(receipts));
        return;
      }
      res.json(toJsonExport(receipts));
    }),
  );
  ```

- **PATTERN**: `router.get("/")` at line 32.
- **IMPORTS**: add `exportFormatSchema` to the existing `@receipt/shared` import (line 4); add
  `import { toCsv, toJsonExport } from "../export/receipts.js";` (note the `.js` extension —
  `api` is `nodenext`).
- **GOTCHA (the one Task 10's history warns about)**: if this route lands below `/:id`, every request
  to `/api/receipts/export` returns `400 invalid_request` because `z.uuid()` rejects `"export"`. The
  bug is easy to miss because the response is a plausible-looking 400 rather than a crash.
- **GOTCHA**: a missing or unknown `format` is `400 invalid_request` — do not default to CSV. An
  unrequested default hides a client bug.
- **GOTCHA**: the filename is built from an ISO date, not from any user-controlled value, so no
  header-injection escaping is required. Keep it that way.
- **VALIDATE**: `npm run typecheck; npm run lint`

### UPDATE `api/src/routes/receipts.integration.ts`

- **IMPLEMENT**: Against the hosted project, add tests proving:
  1. `GET /api/receipts/export?format=csv` returns `200`, `Content-Type` starting `text/csv`, and a
     body whose first character is `﻿` — **this is also the route-ordering regression test**,
     since a shadowed route answers `400`.
  2. `GET /api/receipts/export?format=json` returns `200` with `schemaVersion: 1`, and parses under
     `jsonExportResponseSchema`.
  3. **Scope**: a confirmed receipt appears; a `review` receipt does not; a soft-deleted confirmed
     receipt does not; user B's confirmed receipt does not appear in user A's export.
  4. `?format=xml` and a missing `format` both return `400 invalid_request`.
  5. No token returns `401`.
- **PATTERN**: the existing describe blocks in this file; reuse `tokenA`/`tokenB` and register any new
  storage object in `sourcePaths` so `afterAll` cleans it up.
- **GOTCHA**: these tests write to the **real** project. Every created user must be deleted in
  `afterAll`, and Storage objects do not cascade with the user — add their paths to `sourcePaths`.
- **VALIDATE**: `npm run test:integration`

### UPDATE `client/src/api/client.ts`

- **IMPLEMENT**: Add at the end of the file:

  ```ts
  export async function exportReceipts(format: ExportFormat): Promise<Blob> {
    const response = await request(`/api/receipts/export?format=${format}`);
    return await response.blob();
  }
  ```

- **IMPORTS**: add `type ExportFormat` to the existing `@receipt/shared` import block.
- **GOTCHA**: this **must** go through `request()`. `/validate` Phase 6.9 fails the build on a raw
  `fetch(` anywhere else in `client/src`, and more importantly a plain `<a href="/api/receipts/export">`
  or `window.open` sends **no `Authorization` header** and would simply 401.
- **GOTCHA**: return the `Blob` rather than text — it carries the server's content type, and the
  browser's saved file then has the right type without the caller restating it.
- **VALIDATE**: `npx vitest run --project client`

### CREATE `client/src/history/download.ts`

- **IMPLEMENT**: Two small functions:

  ```ts
  export function exportFilename(format: ExportFormat, now: Date): string {
    return `receipts-${now.toISOString().slice(0, 10)}.${format}`;
  }

  export function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  ```

- **PATTERN**: `client/src/history/receiptSummary.ts` — a small pure-ish module beside the page that
  uses it, unit-tested independently.
- **GOTCHA**: `URL.revokeObjectURL` is not optional — without it the blob is retained for the lifetime
  of the document.
- **GOTCHA**: the `Date` is a **parameter**, not `new Date()` inside, so the filename is testable
  without faking timers.
- **VALIDATE**: `npx vitest run --project client`

### CREATE `client/src/history/download.test.ts`

- **IMPLEMENT**: Assert `exportFilename` for both formats against a fixed date, and that `saveBlob`
  creates an anchor with the right `download` attribute, clicks it, and revokes the URL.
- **GOTCHA**: **jsdom does not implement `URL.createObjectURL` or `revokeObjectURL`** — they are
  `undefined` and calling them throws `TypeError`. Stub both with `vi.stubGlobal` / `vi.spyOn` and
  restore in `afterEach`, matching the `vi.unstubAllGlobals()` teardown already used in
  `client/src/api/client.test.ts:48`.
- **VALIDATE**: `npx vitest run --project client`

### UPDATE `client/src/i18n/locales/en.json` and `hr.json`

- **IMPLEMENT**: Add under `history`:
  - `exportTitle` — "Export" / "Izvoz"
  - `exportCsv` — "Download CSV" / "Preuzmi CSV"
  - `exportJson` — "Download JSON" / "Preuzmi JSON"
  - `exporting` — "Preparing" / "Priprema"
  - `exportHint` — "Confirmed receipts only." / "Samo potvrđeni računi."
  - `errors.export` — "The export could not be created. Try again." / "Izvoz nije bilo moguće
    stvoriti. Pokušajte ponovno."
- **GOTCHA (encoding)**: write these with the `Write`/`Edit` tools, **not** a shell heredoc. Task 07,
  08 and 10 each shipped mojibake (`PokuÅ¡ajte`) from a tool that assumed the wrong source encoding.
  `/validate` Phase 6.11 catches the single-corruption signature; Task 10's double corruption slipped
  past it. Verify the Croatian diacritics `š č ć ž đ` render correctly after the edit.
- **GOTCHA**: keys must be added to **both** files or `client/src/i18n/i18n.test.ts` fails. Translate
  the missing key; never delete it from the other file to make the test pass.
- **VALIDATE**: `npx vitest run --project client`

### UPDATE `client/src/routes/HistoryPage.tsx`

- **IMPLEMENT**: An export block near the top of the section (below the title/count, above the status
  filter): a small heading, `exportHint`, and two `min-h-11` buttons — CSV and JSON. Local state
  `exporting: ExportFormat | null` and `exportFailed: boolean`. On click: call `exportReceipts`,
  `saveBlob(blob, exportFilename(format, new Date()))`, and on rejection set `exportFailed`, rendered
  through the existing `ErrorMessage` with `t("history.errors.export")`.
- **PATTERN**: the two-step delete block at lines 145–176 — the same `disabled` + busy-label idiom.
- **IMPORTS**: `exportReceipts` from `../api/client`; `exportFilename`, `saveBlob` from
  `../history/download`; `type ExportFormat` from `@receipt/shared`.
- **GOTCHA**: both buttons stay **enabled regardless of the current status filter and row count**.
  The export scope is always confirmed + non-deleted (PRD §7.12) and is deliberately *not* wired to
  the filter; `exportHint` is what tells the user that. Gating the button on a confirmed count would
  need a second request for no benefit.
- **GOTCHA**: disable only the button that is currently running, so a failed CSV attempt does not
  block a JSON attempt.
- **VALIDATE**: `npx vitest run --project client`

### UPDATE `client/src/routes/HistoryPage.test.tsx`

- **IMPLEMENT**: Extend the `vi.mock("../api/client", ...)` factory with `exportReceipts: vi.fn()`
  and mock `../history/download`. Add cases: a CSV click calls `exportReceipts("csv")` and passes the
  blob to `saveBlob` with a `.csv` filename; a JSON click does the same for JSON; a rejected export
  renders the translated error and leaves the other button usable.
- **GOTCHA**: **forgetting to add `exportReceipts` to the existing mock factory breaks every other
  test in this file**, because `vi.mock` with a factory replaces the whole module.
- **VALIDATE**: `npx vitest run --project client`

### UPDATE `README.md`

- **IMPLEMENT**:
  1. Add the endpoint to the API table (after the `DELETE` row):
     `` | `GET` | `/api/receipts/export` | Yes | `200` CSV or JSON for confirmed, non-deleted receipts; requires `format=csv\|json` | ``
  2. Add an **"Export"** subsection under the History section documenting: the exact `CSV_COLUMNS`
     list in order, that line items are excluded from CSV v1 while JSON keeps them, that
     `vatBreakdown` is a compact JSON string in CSV and nested in JSON, the UTF-8 BOM and CRLF
     choices and why, the formula-neutralization rule and why money/date columns are exempt, and
     `schemaVersion: 1`.
  3. Update the "What `@receipt/shared` exports" table row for `shared/src/api.ts` with the new
     symbols.
  4. Replace the sentence "The export body's `schemaVersion` is deliberately **absent** until Task
     11." — it is now present.
  5. Update the status blockquote at the top to Task 11.
- **GOTCHA**: `/validate` Phase 6.6 mechanically checks that every backticked file path and local link
  in the README resolves and that documented env vars match `.env.example`. It will fail on a typo'd
  path.
- **GOTCHA**: **Prettier does not format `*.md` in this repo, deliberately.** Keep the API table's
  hand-alignment consistent with its neighbours by hand.
- **VALIDATE**: run the Phase 6.6 node one-liner from `.claude/commands/validate.md`

### UPDATE `.claude/commands/validate.md`

- **IMPLEMENT**:
  1. Phase 4 table: add rows for `api/src/export/receipts.test.ts`, `client/src/history/download.test.ts`,
     and the extended `shared/src/api.test.ts` — each saying what it protects.
  2. Phase 8: add **journey 8.12 — export**: sign in, confirm a receipt, download CSV and JSON from
     history; open the CSV in a spreadsheet and verify Croatian characters; verify a seller name
     starting with `=` is neutralized; verify `100.50` is exactly `100.50`; verify a `review` receipt
     and a soft-deleted receipt are both absent; verify both languages.
  3. Phase 9: **delete the Task 11 row**.
  4. Add a Phase 6 check that the export route is registered before `/:id` — a grep asserting the
     index of `"/export"` in `api/src/routes/receipts.ts` is lower than the index of `"/:id"`. This is
     the "new class of mistake" this task discovered, which the file's own maintenance rules require
     adding.
- **GOTCHA**: **Do not re-run `/ultimate_validate_command`.** It overwrites this file and its template
  has none of Phases 0, 6, 7 or 9 — roughly 140 lines earned from real incidents would be lost.
- **VALIDATE**: read the file back and confirm Phase 9 no longer lists Task 11

### UPDATE `.agents/ROADMAP.md` and CREATE `.agents/history/11-csv-json-export.md`

- **IMPLEMENT**: Mark Task 11 ✅ in the progress table with plan and history links; update the
  **Status:** line at the top. Write the history file using the template in ROADMAP §1, recording the
  decisions table (D1–D8 in NOTES below), deviations, real validation output and known gaps.
- **GOTCHA**: While writing the history, **correct the stale "Uncommitted — awaiting human review"
  line in `.agents/history/10-history-detail-view-soft-delete.md`** to its real commit `5e1b11b`.
  It is a one-line factual correction to the project record, not adjacent-code improvement.
- **VALIDATE**: `git status` shows the expected file set and nothing unexpected

---

## TESTING STRATEGY

Vitest across three projects (`shared` node, `api` node, `client` jsdom), plus a hosted Supabase
integration suite. React Testing Library for component behaviour.

### Unit Tests

- **`shared`** — the export DTO is derived, rejects a forged `userId`, pins `schemaVersion`, and
  preserves trailing-zero money through a parse round trip.
- **`api`** — serialization is the bulk of the coverage: column order, RFC 4180 escaping, OWASP
  neutralization (including the negative-total exemption), BOM, CRLF, empty fields, VAT
  serialization, and the JSON envelope. Repository tests cover the filters and the internal paging
  loop against a stubbed query builder.
- **`client`** — `exportReceipts` attaches the bearer token via `request()` and returns a blob;
  `download.ts` builds the right filename and revokes its object URL; `HistoryPage` wires the two
  buttons and renders a translated failure.

### Integration Tests

`npm run test:integration` against the hosted project — required on every task. Proves route ordering
(a shadowed route answers 400, not 200), format validation, ownership, and that `review` and
soft-deleted receipts are excluded. Phase 7a (Docker) is **skippable here and the skip must be
reported**: this task changes no file under `supabase/migrations/`.

### Edge Cases

- Zero confirmed receipts → CSV is BOM + header row only; JSON is `{ schemaVersion: 1, receipts: [] }`.
- Seller name `=cmd|'/c calc'!A1`, and leading `+`, `-`, `@`, `\t`, `\r`.
- Negative total `-12.50` — must **not** be neutralized.
- Seller name containing `"`, `,` and an embedded newline.
- Croatian diacritics `š č ć ž đ` end to end.
- A receipt with every optional field null.
- A receipt with multiple VAT rates, and one with none.
- A receipt with line items — present in JSON, absent from CSV.
- More than `EXPORT_PAGE_SIZE` confirmed receipts (unit-tested against the stub; not created live).
- `?format=` missing, empty, or `xml`.
- Unauthenticated request.

---

## VALIDATION COMMANDS

Run from `prototypes/receipt-ocr/`. PowerShell 5.1 — `&&` is a parser error; chain with `;`.

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
npm run build
npm run test:integration
```

Then every Phase 6 check in `.claude/commands/validate.md`, including the new route-order check.
Phase 7a is skipped — no migration changed — and the skip is reported, not counted as green.

### Level 4: Manual Validation

Follow `/validate` Phase 8.1 port hygiene **first** — a stale Vite on 5173 makes every check below
pass against old code:

```
foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "cleaned port $p" } else { "port $p free" } }
```

Then journey 8.12: sign in, upload and confirm a real Croatian receipt, download both formats from
history, open the CSV in a spreadsheet and verify diacritics and that `100.50` reads as `100.50`,
edit a seller name to start with `=` and re-export to see the neutralization, verify a `review` and a
soft-deleted receipt are absent, and repeat the visible flow in Croatian at 375 px.

### Level 5: Additional Validation

The Supabase MCP server can confirm the exported set matches the database directly:

```sql
select id, status, deleted_at from receipts where user_id = '<uuid>' order by created_at desc;
```

---

## ACCEPTANCE CRITERIA

Roadmap Task 11 definition of done, plus this plan's additions:

- [ ] CSV opens correctly in a spreadsheet with Croatian characters intact
- [ ] A seller name beginning with `=`, `+`, `-` or `@` is neutralized in the CSV output
- [ ] JSON contains no Azure-specific property name
- [ ] Exports exclude non-confirmed receipts, soft-deleted receipts, and other users' receipts
- [ ] A total of `100.50` exports as exactly `100.50` — no float artifacts
- [ ] Column names and schema version are documented in `README.md`
- [ ] `GET /api/receipts/export` is registered above `/:id` and an automated test proves it
- [ ] A negative total is **not** formula-neutralized
- [ ] The export query cannot be silently truncated by `max_rows`
- [ ] Download works with a bearer token — no unauthenticated `<a href>` path
- [ ] Both export controls are translated in `hr` and `en` with 44 px touch targets
- [ ] `/validate` passes; Phase 7a skip is reported with its reason

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + hosted integration)
- [ ] No linting or type-checking errors
- [ ] Manual journey 8.12 confirms the feature in a real browser and a real spreadsheet
- [ ] Acceptance criteria all met
- [ ] README, `/validate` and ROADMAP updated; history file written

---

## NOTES

### Decisions this plan makes (record these in the history file)

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | `/export` registered **above** `/:id` | Express matches in registration order; `idSchema` is `z.uuid()`, so a later registration yields a misleading `400 invalid_request`. Task 10's history predicted this. |
| D2 | Repository pages internally rather than one unbounded select | `supabase/config.toml:18` sets `max_rows = 1000`, which truncates **silently**. ~10 lines removes the cap from the correctness argument. |
| D3 | CSV `vatBreakdown` is one column holding compact JSON | PRD §7.12 allows "flattened or serialized consistently". Indexed columns (`vat1Rate`…) need an arbitrary cap and produce ragged rows; parallel pipe-joined columns pair by position and break silently when one rate lacks a base. JSON is lossless, uncapped, and identical to what the JSON export emits. |
| D4 | Formula neutralization applies to **text columns only** | A negative total is canonically `-12.50`; prefixing it with `'` turns a number into text and breaks spreadsheet arithmetic. Money, date and timestamp columns are schema-validated (`AMOUNT_PATTERN`, `z.iso.*`) and cannot carry a formula. `currency` **is** neutralized — `z.string().length(3)` admits `=AB`. |
| D5 | UTF-8 **BOM** and **CRLF** line endings | The DoD is "opens correctly in a spreadsheet with Croatian characters intact"; Excel on Windows reads BOM-less UTF-8 in the ANSI codepage and mangles `š č ć ž đ`. CRLF is RFC 4180 §2.1. |
| D6 | `schemaVersion` is the integer `1`, typed `z.literal(1)` | PRD §7.12 asks for "a simple schema/export version". A literal makes an accidental change a compile error. |
| D7 | JSON omits `userId` and `deletedAt`, derived with `.omit()` | `userId` is the caller's own id; `deletedAt` is `null` by definition of the scope. Deriving keeps the "DTOs are never redeclared" invariant that makes a forged `userId` a schema rejection. |
| D8 | Client downloads via `request()` → `Blob` → object URL | A plain `<a href>` or `window.open` sends no `Authorization` header and would 401. Also required by `/validate` Phase 6.9, which forbids a raw `fetch(` outside the API module. |

### Deliberately out of scope

- **No `exportedAt` timestamp** in the JSON envelope — unrequested (CLAUDE.md §2).
- **Export does not follow the history status filter.** PRD §7.12 fixes the scope at confirmed +
  non-deleted; `exportHint` communicates this. Wiring the filter would be inventing a requirement.
- **Line items stay out of CSV v1** (PRD §7.12 says they are not required); they remain in JSON.
- **No CSV library.** `csv-stringify` or similar is a larger dependency surface than the ~40 lines it
  would replace, and the neutralization rule is custom regardless.
- **No streaming.** A PoC user's confirmed receipts fit comfortably in memory; streaming would be
  speculative complexity.

### Known context carried in from earlier tasks

- Task 09/10 left two open cleanups — the double `SourceDocumentPanel` mount and the two-query
  `GET /api/receipts/:id`. **Both stay untouched here** (CLAUDE.md §3); they belong to Task 12.
- Task 09 measured an Azure latency tail of 65 s against two 60 s timeouts. Unrelated to export, owned
  by Task 12, but it will make the manual journey's upload step occasionally fail — retry rather than
  treating it as an export defect.
- The status note in `.agents/history/10-history-detail-view-soft-delete.md` says "Uncommitted"; the
  work is in fact commit `5e1b11b`. Correct it while writing this task's history.

### Confidence

**8.5/10** for one-pass success. The endpoint and serialization are small and fully specified. The
residual risk is concentrated in the manual spreadsheet check (Level 4), which depends on a live
Azure extraction that Task 09 measured as occasionally exceeding its own timeout, and in the locale
file encoding, which has now bitten three consecutive tasks.
