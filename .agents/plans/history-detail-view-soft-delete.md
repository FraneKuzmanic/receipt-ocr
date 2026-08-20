# Feature: History, detail view & soft delete

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **Roadmap task:** 10 — History, detail view & soft delete (PRD phase 3).
> **Depends on:** Task 09 (✅ complete, commit `9710a74`).

## Feature Description

The receipt loop currently ends at confirmation. A user photographs a receipt, watches it process,
reviews and confirms it — and then it disappears from the interface entirely. The row is in
Postgres, the source document is in private storage, but nothing in the UI can reach either one
again.

This task closes the loop. It adds the paged, owner-scoped list endpoint the PRD has specified since
§10.2, a mobile-first history screen that lists a user's receipts newest-first with a status filter,
navigation from any row into the existing review/detail screen alongside its original document, and a
soft delete that removes a receipt from history while the row survives with `deleted_at` set.

## User Story

As a business user
I want to see the receipts I have already processed, open any of them beside its original document, and remove ones I no longer need
So that a confirmed receipt stays findable and correctable after I leave the capture flow, instead of vanishing the moment I confirm it

## Problem Statement

Five concrete gaps exist today:

1. **No list endpoint.** `GET /api/receipts` has no route. Because `requireAuth` guards the whole
   `/api/receipts` prefix rather than individual routes, an **unauthenticated** request to it answers
   `401` (asserted by `api/src/app.test.ts:42`, and deliberately so — that is the test proving the
   guard sits on the prefix). A **signed-in** request passes the guard, matches no route, and falls
   through to the app-level handler as `404 not_found`. Task 05 explicitly deferred this endpoint to
   Task 10 (see ROADMAP Task 05 scope).
2. **No way to reach a past receipt.** The only routes into `/receipts/:id/review` are the capture
   flow's redirect and manually typing a URL. There is no index.
3. **No delete affordance.** `DELETE /api/receipts/:id` shipped in Task 05 and works, but no UI calls
   it and the client API module has no `deleteReceipt`.
4. **`failed` and `processing` receipts have no safe destination.** Once a list makes every receipt
   clickable, `ReviewPage` will be reachable for statuses it does not handle. It currently redirects
   only `processing`; a `failed` receipt renders an **empty review form** with a Confirm button that
   cannot work. Task 09's history flagged this as reachable-by-URL; a history list turns it into a
   routine one-tap path, which is what promotes it from a known gap into a Task 10 defect.
5. **A malformed currency code crashes any screen that formats money.** `canonicalReceiptFieldsSchema`
   constrains `currency` to `z.string().length(3)` — three *characters*, not three letters — and
   `ReviewPage`'s `currencyValidation` only checks `value.trim().length === 3`. `Intl.NumberFormat`
   requires three ASCII letters and throws `RangeError` otherwise. Verified against the built module:

   ```console
   $ node --input-type=module -e "import { formatAmount } from './shared/dist/money.js'; ..."
   EUR: 132,72 €
   null: 132,72
   1EU THROWS: RangeError
   ZZZ: 132,72 ZZZ
   ```

   A user who types `1EU` into the review form and saves it persists that value through the Zod
   schema *and* the database `receipts_currency_shape` check (`char_length(...) = 3`). The review form
   never formats money, so today nothing breaks. A history list that formats every row's total would
   throw during render and take down the whole list — one bad receipt hiding every good one.

## Solution Statement

Add the list endpoint using the DTOs Task 02 already defined, a repository method that pages with
PostgREST's `range` + exact `count`, and one new client route backed by a pure, tested display module.

The detail view **reuses `ReviewPage`** rather than introducing a second read-only screen — see
Decision D1, which deliberately departs from the roadmap's wording and explains why. Money formatting
is routed through a guarded helper so a malformed currency degrades to plain text instead of throwing.
Status labels are rendered from a template literal, which `/validate` Phase 6.5 provably cannot scan,
so a locale-parity test is added for exactly the reason `warnings.test.ts` exists.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: `api` (repository + receipts router), `client` (new route, API module, i18n, AppLayout nav), `shared` (**no changes** — see below)
**Dependencies**: None new. No new npm package is required or permitted.

### Shared workspace: deliberately unchanged

**Do not add or redeclare DTOs.** Task 02 already shipped, exported and unit-tested everything this
feature needs:

| Symbol | Location | Already tested by |
| --- | --- | --- |
| `listReceiptsQuerySchema` / `ListReceiptsQuery` | `shared/src/api.ts:56-64` | `shared/src/api.test.ts:46-68` |
| `listReceiptsResponseSchema` / `ListReceiptsResponse` | `shared/src/api.ts:66-75` | — |
| `RECEIPT_STATUSES` / `receiptStatusSchema` | `shared/src/receipt.ts:5-7` | `shared/src/receipt.test.ts` |
| `formatAmount` | `shared/src/money.ts:106-117` | `shared/src/money.test.ts` |

All are re-exported from the package root (`shared/src/index.ts:46-66`). Import from
`@receipt/shared`, never a deep path.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**API**

- `api/src/repositories/receipts.ts` (lines 192-202) — Why: `listCurrent()` is the method being
  replaced. Note the exact owner/soft-delete filter chain every read repeats.
- `api/src/repositories/receipts.ts` (lines 118-190) — Why: the `findById` / `findSourceById` /
  `findReviewState` shape, `uuidSchema.parse` on every id, and `ReceiptRepositoryError` wrapping.
- `api/src/repositories/receipts.ts` (lines 249-287) — Why: `mapReceiptRow` is the only row →
  canonical translation. It ignores the generated `total`/`seller_name` projections and reads money
  from validated JSON. Reuse it; never map a row by hand.
- `api/src/routes/receipts.ts` (lines 39-54) — Why: the exact `authenticated()` + `idSchema.safeParse`
  + `HttpError` idiom every route follows, and the comment explaining why there is no separate
  ownership check.
- `api/src/routes/receipts.ts` (lines 205-216) — Why: the existing `DELETE` route the new UI calls.
  It already exists and needs no change.
- `api/src/middleware/require-auth.ts` (lines 38-59) — Why: `authenticated()` passes `AuthContext` as
  a **handler argument**, never `req.auth`. `auth.client` is a per-request user-scoped Supabase client.
- `api/src/middleware/error-handler.ts` — Why: `HttpError(status, code)` and the stable
  `{ error: { code } }` body typed as `ApiErrorResponse`.
- `api/src/repositories/receipts.test.ts` (lines 38-97, 156-166) — Why: the `QueryDouble` test double
  and the existing `listCurrent` assertion. **This double must change** — see Task 4.
- `api/src/routes/receipts.integration.ts` (lines 22-79, 112-127) — Why: hosted-integration setup,
  the disposable-user + cleanup pattern, and the two `listCurrent()` call sites that must move to the
  new method.
- `api/src/app.ts` (lines 40-43) — Why: `requireAuth` guards the `/api/receipts` **prefix**. This is
  why `GET /api/receipts` currently answers 401 rather than 404, and why the new route needs no guard
  of its own.

**Shared (read only — do not edit)**

- `shared/src/api.ts` (lines 50-75) — Why: the query and response DTOs, and the comment explaining why
  `z.coerce.number()` is correct **only** here (counts, never money).
- `shared/src/receipt.ts` (lines 43-97) — Why: the two-tier schema split, and `currency` being length-3
  rather than letters-only, which is the root of the `RangeError` above.
- `shared/src/money.ts` (lines 106-117) — Why: `formatAmount` passes the **string** to
  `Intl.NumberFormat` to preserve precision, and throws on a malformed currency.

**Client**

- `client/src/api/client.ts` (lines 29-64) — Why: the single `request()` wrapper. Every call must go
  through it — Phase 6.9 fails the build on a raw `fetch` anywhere else under `client/src`.
- `client/src/api/client.ts` (lines 79-110) — Why: the exported-function shape to mirror
  (`encodeURIComponent` on ids, schema `.parse()` on every response body).
- `client/src/routes/ReviewPage.tsx` (lines 44-74) — Why: the load-effect idiom (`active` flag,
  `navigate(..., { replace: true })` on the wrong status) and where the `failed` redirect must go.
- `client/src/routes/ReviewPage.tsx` (lines 160-165, 351-353) — Why: the two `SourceDocumentPanel`
  mount sites. **Read but do not change** — see Decision D5.
- `client/src/routes/ProcessingPage.tsx` (lines 30-86, 108-134) — Why: the abort/cleanup pattern and
  the `failed` state's Retry affordance, which is where a `failed` receipt must land.
- `client/src/routes/HomePage.tsx` (lines 113-207) — Why: Tailwind conventions, `min-h-11` touch
  targets, `role="alert"` error blocks, `aria-live="polite"`.
- `client/src/review/reviewForm.ts` — Why: the **pattern to mirror** for the new pure display module —
  logic extracted out of the component so it is unit-testable without rendering.
- `client/src/routes/ReviewPage.test.tsx` (lines 1-60) — Why: `vi.mock("../api/client")`,
  `MemoryRouter` + `Routes`, `import "../i18n"`, and asserting on **rendered English copy**.
- `client/src/i18n/warnings.test.ts` — Why: the exact locale-parity test to mirror for status labels,
  and the reason it exists (Phase 6.5 cannot follow a template-literal key).
- `client/src/components/AppLayout.tsx` (lines 18-42) — Why: the header, the `session === null` guard,
  and `max-w-3xl` on `<main>`.
- `client/src/components/ErrorMessage.tsx`, `client/src/components/Spinner.tsx` — Why: reuse these;
  do not write new loading/error primitives.
- `client/src/App.tsx` (lines 12-29) — Why: route registration, and the comment explaining why the
  catch-all lives **inside** the protected branch.
- `client/src/i18n/locales/en.json`, `client/src/i18n/locales/hr.json` — Why: every key needs both.

**Project rules**

- `CLAUDE.md` — §1 think before coding, §2 simplicity, §3 surgical changes, §5 push back.
- `.agents/ROADMAP.md` §2 (locked decisions), §4 Task 10 (scope + DoD), §5 (standing rules).
- `.claude/commands/validate.md` — the full sweep, and the "Maintaining this file" section.
- `.agents/history/09-review-form-editing-confirmation.md` — the known gaps this task inherits.

### New Files to Create

- `client/src/history/receiptSummary.ts` — pure display helpers: guarded money formatting and
  status → route mapping.
- `client/src/history/receiptSummary.test.ts` — unit tests for the above, including the `RangeError`
  currency case.
- `client/src/routes/HistoryPage.tsx` — the history list route.
- `client/src/routes/HistoryPage.test.tsx` — component tests.
- `client/src/i18n/receiptStatuses.test.ts` — locale parity for the template-literal status labels.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [PostgREST pagination via supabase-js `.range()`](https://supabase.com/docs/reference/javascript/range)
  - Specific section: `range(from, to)` — 0-based and **inclusive**.
  - Why: `page`/`limit` must convert to an inclusive index pair. Off-by-one here silently drops or
    duplicates a row across page boundaries.
- [supabase-js `select()` count option](https://supabase.com/docs/reference/javascript/select)
  - Specific section: `{ count: 'exact' }`.
  - Why: supplies `ListReceiptsResponse.total`. Verified in the installed source at
    `node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts:121` — *"When using `count` with
    `.range()` or `.limit()`, the returned `count` is the total number of rows"*, i.e. the count is of
    the filtered set **before** paging, which is exactly what a page-count needs.
- [`Intl.NumberFormat` currency option](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat#currency)
  - Specific section: "currency" — must be a well-formed ISO 4217 code (three ASCII letters);
    otherwise a `RangeError` is thrown.
  - Why: the root cause of the crash described in the Problem Statement.
- [React Router `useSearchParams`](https://reactrouter.com/api/hooks/useSearchParams)
  - Why: **optional** — read before deciding whether filter/page state belongs in the URL. See D6;
    the recommendation is local component state for this PoC.

### Patterns to Follow

**Module resolution differs by workspace — this breaks the build if you get it wrong:**

```ts
// api/ and shared/ use nodenext — relative imports need .js even in .ts source
import { ReceiptRepository } from "../repositories/receipts.js";

// client/ uses bundler resolution — extensionless is correct
import { ErrorMessage } from "../components/ErrorMessage";

// cross-workspace is ALWAYS the package name, never a relative path
import { listReceiptsResponseSchema, type ListReceiptsResponse } from "@receipt/shared";
```

**Route handler shape** (`api/src/routes/receipts.ts:39-54`):

```ts
router.get(
  "/:id",
  authenticated(async (req, res, auth) => {
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) throw new HttpError(400, "invalid_request");

    const repository = new ReceiptRepository(auth.client, auth.userId);
    const receipt = await repository.findById(id.data);
    if (receipt === null) throw new HttpError(404, "not_found");
    // ...
  }),
);
```

Note: `auth.client` is a Supabase client carrying the **caller's own token**, so RLS evaluates every
query as that user. Never reach for `SUPABASE_SECRET_KEY` on a request path.

**Repository read — every read repeats the same owner + soft-delete filter** (`receipts.ts:118-129`):

```ts
.eq("user_id", this.#userId)
.is("deleted_at", null)
```

**Error convention** — a stable machine code, never prose (`README.md` "API"):

```json
{ "error": { "code": "not_found" } }
```

**Client API function** (`client/src/api/client.ts:79-82`):

```ts
export async function getReceipt(id: string, signal?: AbortSignal): Promise<ReceiptDetailResponse> {
  const response = await request(`/api/receipts/${encodeURIComponent(id)}`, { signal });
  return receiptDetailResponseSchema.parse(await response.json());
}
```

**Component load effect** (`client/src/routes/ReviewPage.tsx:51-64`):

```ts
useEffect(() => {
  if (!id) return;
  let active = true;
  void getReceipt(id)
    .then((next) => {
      if (!active) return;
      // ...
    })
    .catch(() => active && setFailed(true));
  return () => {
    active = false;
  };
}, [id, navigate]);
```

**Translation keys are compiler-checked.** `client/src/i18n/index.ts:14-18` augments i18next's
`CustomTypeOptions` against `en.json`, so an unknown literal key is a **type error**. A key built from
a template literal is not checked — which is precisely why the parity tests exist.

**Touch targets:** every interactive element carries `min-h-11` (44 px, PRD §11.5).

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

No shared-package work. The foundation is the repository read and the pure client display module —
both independently testable before any UI exists.

**Tasks:**

- Replace `listCurrent()` with a paged, filterable `listPage()` returning `{ items, total }`.
- Teach the `QueryDouble` test double to model a chain that terminates in `.range()`.
- Create the pure `receiptSummary` module (guarded money formatting, status → route).

### Phase 2: Core Implementation

**Tasks:**

- `GET /api/receipts` route: parse the query with `listReceiptsQuerySchema`, delegate to `listPage`.
- `getReceipts` and `deleteReceipt` in the client API module.
- `HistoryPage`: list, status filter, paging, empty/loading/error states, two-step delete.

### Phase 3: Integration

**Tasks:**

- Register `/receipts` in `App.tsx`.
- Add signed-in navigation to `AppLayout`.
- Add `history.*` copy to `en.json` and `hr.json`.
- Fix `ReviewPage`'s missing `failed` redirect (now reachable from the list).

### Phase 4: Testing & Validation

**Tasks:**

- Unit tests: repository paging/filtering, pure display helpers, status locale parity.
- Component tests: `HistoryPage` rendering, filtering, paging, delete.
- Hosted integration tests: paging, filter, soft-delete disappearance, cross-user isolation.
- Documentation: `README.md`, `.claude/commands/validate.md`, `.agents/ROADMAP.md`, history file.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. REFACTOR `api/src/repositories/receipts.ts` — replace `listCurrent` with `listPage`

- **IMPLEMENT**: Delete `listCurrent()` (lines 192-202) and add in its place:

  ```ts
  export interface ListReceiptsOptions {
    readonly page: number;
    readonly limit: number;
    readonly status?: ReceiptStatus;
  }

  export interface ReceiptPage {
    readonly items: CanonicalReceipt[];
    readonly total: number;
  }
  ```

  ```ts
  /**
   * PRD §10.2 — the authenticated user's non-deleted receipts, newest first.
   *
   * `count: "exact"` counts the filtered set before paging, which is what the caller needs to
   * render a page count. `range` is 0-based and inclusive on both ends.
   */
  async listPage(options: ListReceiptsOptions): Promise<ReceiptPage> {
    const from = (options.page - 1) * options.limit;
    const filtered = this.#client
      .from("receipts")
      .select("*", { count: "exact" })
      .eq("user_id", this.#userId)
      .is("deleted_at", null);

    const { data, error, count } = await (
      options.status === undefined ? filtered : filtered.eq("status", options.status)
    )
      .order("created_at", { ascending: false })
      .range(from, from + options.limit - 1);

    if (error) throw new ReceiptRepositoryError("query_failed", error);
    return { items: data.map(mapReceiptRow), total: count ?? 0 };
  }
  ```

- **PATTERN**: owner + soft-delete filters exactly as `findById` (`receipts.ts:118-129`); error
  wrapping exactly as every other method.
- **IMPORTS**: `ReceiptStatus` and `CanonicalReceipt` are already imported at `receipts.ts:9-13`.
- **GOTCHA**: Sort is `created_at desc`, **not** `issue_date`. The list *displays* issue date, so this
  looks inconsistent — it is deliberate. `issue_date` is a nullable generated text column with no
  index, whereas `receipts_active_user_created_at_idx` is a partial index on
  `(user_id, created_at desc) where deleted_at is null`
  (`supabase/migrations/20260817122048_create_receipts.sql:114-116`) that this query uses exactly.
  PRD §10.2 says only "newest first". Record this in the history file.
- **GOTCHA**: Build the conditional filter with a **ternary at the call site**, as written above,
  rather than `let query = ...; query = query.eq(...)`. PostgREST's builder generics change type as
  filters are applied, and reassigning a `let` can fail to typecheck under TypeScript 7 strict.
- **GOTCHA**: `count` is typed `number | null`; `?? 0` is required.
- **VALIDATE**: `npm run typecheck`

### 2. UPDATE `api/src/repositories/receipts.test.ts` — make `QueryDouble` model a `.range()`-terminated chain

- **IMPLEMENT**: The double currently makes `order()` terminal (returns a `Promise`), which cannot
  model `.order(...).range(...)`. Make the double **thenable** instead, so any chain resolves when
  awaited regardless of which call is last:
  - Widen `QueryResult` to `{ data: ReceiptRow | ReceiptRow[] | null; error: unknown; count?: number | null }`.
  - Change `order` to `return this.record("order", args);` (returns `this`).
  - Add `range(...args: unknown[]): this { return this.record("range", args); }`.
  - Add a `then` method so `await query…` resolves:

    ```ts
    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
    ```

- **IMPLEMENT**: Replace the `"lists only current user rows newest first"` test (lines 156-166) with
  paging coverage:
  - page 2 / limit 20 records `{ method: "range", args: [20, 39] }` — the inclusive-bound assertion.
  - the owner filter, the `is("deleted_at", null)` filter and the `order` args are still recorded.
  - `count` flows through to `total` (assert `{ items: [...], total: 42 }` from a double returning
    `count: 42`).
  - a `status` option records `{ method: "eq", args: ["status", "confirmed"] }`, and omitting it
    records no such call.
- **PATTERN**: `receipts.test.ts:38-97` — keep `repositoryWith()` unchanged.
- **GOTCHA**: `single()` / `maybeSingle()` must keep returning `Promise.resolve(this.result)`. They
  resolve a plain object, so adding `then` to the class cannot cause recursive unwrapping.
- **GOTCHA**: The existing assertion `expect(query.calls).toContainEqual({ method: "order", args: [...] })`
  still holds once `order` records-and-returns-`this` — do not delete it.
- **VALIDATE**: `npx vitest run --project api src/repositories/receipts.test.ts`

### 3. ADD the list route to `api/src/routes/receipts.ts`

- **IMPLEMENT**: Register **before** the existing `router.get("/:id", …)` for readability (they cannot
  actually collide — `/` and `/:id` are distinct — but keep the index first):

  ```ts
  /** PRD §10.2. Owner scoping and soft-delete filtering live in the repository, as everywhere else. */
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

- **IMPORTS**: add `listReceiptsQuerySchema` to the existing `@receipt/shared` import at line 4.
- **GOTCHA**: `listReceiptsQuerySchema` is `.strict()`, so an unknown query parameter is a `400`. That
  is intended.
- **GOTCHA**: Do **not** validate the response with `listReceiptsResponseSchema` server-side; no
  existing route does, and the client parses it. Keep the convention.
- **GOTCHA — for Task 11, not now:** `GET /api/receipts/export` will be shadowed by `/:id` unless it
  is registered before it. Note this in the history file so Task 11 does not lose an afternoon.
- **GOTCHA — an existing test must keep passing unchanged.** `api/src/app.test.ts:42` asserts that
  `GET /api/receipts` **without a token** returns `401`. Adding a route here must not change that:
  `requireAuth` runs on the prefix before the router, so the guard still fires first. If that test
  starts returning `404` or `200`, the guard has slipped and it is a security regression, not a test
  to update.
- **VALIDATE**: `npm run typecheck; npx vitest run --project api`

### 4. UPDATE `api/src/routes/receipts.integration.ts` — migrate the two `listCurrent()` call sites

- **IMPLEMENT**: Lines 113 and 124 use `listCurrent()` purely to assert no row was created. Replace:

  ```ts
  const before = (await new ReceiptRepository(userA, userAId).listPage({ page: 1, limit: 100 })).total;
  // …
  await expect(
    new ReceiptRepository(userA, userAId).listPage({ page: 1, limit: 100 }).then((p) => p.total),
  ).resolves.toBe(before);
  ```

- **GOTCHA**: This edits a Task 05 file. It is a required consequence of removing `listCurrent`, not an
  unrelated improvement — record it under "Deviations" in the history file.
- **VALIDATE**: `npm run typecheck`

### 5. ADD hosted integration coverage to `api/src/routes/receipts.integration.ts`

- **IMPLEMENT**: One new `it(...)` block, placed after the soft-delete test, covering:
  - `GET /api/receipts` as user A returns `200`, parses with `listReceiptsResponseSchema`, and
    contains **only** user A's receipts (assert none of user B's ids appear).
  - Ordering is newest-first by `createdAt` (assert descending across at least two rows).
  - `?status=confirmed` returns only confirmed rows; `?status=processing` returns a different set.
  - `?limit=1&page=1` and `?limit=1&page=2` return different single receipts, and `total` is the same
    unpaged number in both.
  - **A page beyond the end returns an empty `items` array with `200`** — see the gotcha below.
  - A soft-deleted receipt (the suite already deletes `uploadedReceiptId`) does **not** appear.
  - `?status=nonsense` returns `400 invalid_request`.
- **PATTERN**: `receipts.integration.ts:81-141` — `request(app).get(...).set("Authorization", …)`.
- **GOTCHA — verify, do not assume:** PostgREST's behaviour when `range` starts past the last row has
  historically varied between an empty `200` and a `416 Requested Range Not Satisfiable`. Run this
  assertion against the hosted project **first**. If it errors rather than returning empty, handle it
  in `listPage` by returning `{ items: [], total: count ?? 0 }` for that specific PostgREST error code
  rather than letting it become a 500 — and document the behaviour you actually observed in the
  history file.
- **GOTCHA**: These tests write to the real project. Every receipt created must have its source path
  pushed to `sourcePaths` so `afterAll` cleans it up (`receipts.integration.ts:75-79`).
- **VALIDATE**: `npm run test:integration` — confirm it prints **HOSTED** before any test runs.

### 6. CREATE `client/src/history/receiptSummary.ts`

- **IMPLEMENT**: Two pure functions, no React:

  ```ts
  import { formatAmount, type CanonicalReceipt } from "@receipt/shared";

  /**
   * `Intl.NumberFormat` throws a RangeError unless the currency is three ASCII letters, while the
   * canonical schema only guarantees three *characters* — a user can save "1EU" through the review
   * form. Formatting a list must never let one malformed receipt blank the whole page, so an
   * unusable code degrades to the amount plus the raw code rather than throwing.
   */
  export function formatReceiptTotal(
    total: string | null | undefined,
    currency: string | null | undefined,
    locale: string,
  ): string | null {
    if (total === null || total === undefined) return null;
    try {
      return formatAmount(total, { locale, currency });
    } catch {
      const plain = formatAmount(total, { locale }) ?? total;
      return currency ? `${plain} ${currency}` : plain;
    }
  }

  /**
   * `processing` and `failed` receipts have no review form to show: the processing route owns the
   * spinner, the failure message and the retry action.
   */
  export function receiptRoute(receipt: Pick<CanonicalReceipt, "id" | "status">): string {
    return receipt.status === "processing" || receipt.status === "failed"
      ? `/receipts/${receipt.id}/processing`
      : `/receipts/${receipt.id}/review`;
  }
  ```

- **PATTERN**: mirrors `client/src/review/reviewForm.ts` — pure module, imported by the component,
  tested without rendering.
- **GOTCHA**: `formatAmount` must receive the **string**. Never `Number(total)`; Phase 6.8 and
  `Big.strict` exist to stop exactly that.
- **VALIDATE**: `npm run typecheck`

### 7. CREATE `client/src/history/receiptSummary.test.ts`

- **IMPLEMENT**: Cases —
  - `formatReceiptTotal("132.72", "EUR", "hr")` returns a currency-formatted string containing `132,72`.
  - `formatReceiptTotal("132.72", null, "hr")` formats without a currency and does not throw.
  - **`formatReceiptTotal("132.72", "1EU", "hr")` does not throw** and includes both the amount and
    `1EU`. This is the regression test for the crash in the Problem Statement.
  - `formatReceiptTotal(null, "EUR", "hr")` returns `null`.
  - Trailing zeros survive: `formatReceiptTotal("100.50", null, "en")` contains `100.50`.
  - `receiptRoute` maps all four statuses to the right destination.
- **PATTERN**: `client/src/review/reviewForm.test.ts`.
- **GOTCHA**: Assert with `toContain` on the digits rather than an exact string — `Intl` output uses a
  narrow no-break space (U+202F / U+00A0) before the currency symbol in several locales, and an exact
  match will fail confusingly on a different ICU build.
- **VALIDATE**: `npx vitest run --project client src/history/receiptSummary.test.ts`

### 8. ADD `getReceipts` and `deleteReceipt` to `client/src/api/client.ts`

- **IMPLEMENT**:

  ```ts
  export async function getReceipts(
    query: { page?: number; status?: ReceiptStatus } = {},
    signal?: AbortSignal,
  ): Promise<ListReceiptsResponse> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set("page", String(query.page));
    if (query.status !== undefined) params.set("status", query.status);
    const search = params.toString();

    const response = await request(`/api/receipts${search === "" ? "" : `?${search}`}`, { signal });
    return listReceiptsResponseSchema.parse(await response.json());
  }

  export async function deleteReceipt(id: string): Promise<void> {
    await request(`/api/receipts/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  ```

- **IMPORTS**: add `listReceiptsResponseSchema`, `type ListReceiptsResponse` and `type ReceiptStatus`
  to the existing `@receipt/shared` import block at lines 1-14.
- **GOTCHA**: `limit` is deliberately **not** sent — the server's default of 20 is the single source of
  truth, and the response echoes `limit` back for the page-count calculation.
- **GOTCHA**: `DELETE` returns `204` with no body. Do not call `.json()` on it.
- **VALIDATE**: `npm run typecheck; npx vitest run --project client src/api/client.test.ts`

### 9. ADD `history.*` copy to `client/src/i18n/locales/en.json` and `hr.json`

- **IMPLEMENT**: One `history` block in **both** files, plus two `common` navigation keys. English:

  ```json
  "history": {
    "title": "Your receipts",
    "empty": "You have not saved any receipts yet.",
    "emptyAction": "Scan your first receipt",
    "filterLabel": "Status",
    "filterAll": "All",
    "noDate": "No date",
    "noSeller": "Unknown seller",
    "noNumber": "No receipt number",
    "noTotal": "No total",
    "delete": "Delete",
    "confirmDelete": "Delete this receipt",
    "cancelDelete": "Keep it",
    "deleting": "Deleting",
    "previous": "Previous",
    "next": "Next",
    "pageOf": "Page {{page}} of {{pages}}",
    "count": "{{count}} receipts",
    "status": {
      "processing": "Processing",
      "review": "Needs review",
      "confirmed": "Confirmed",
      "failed": "Failed"
    },
    "errors": {
      "load": "Your receipts could not be loaded. Try again.",
      "delete": "This receipt could not be deleted. Try again."
    }
  }
  ```

  And in `common`: `"navCapture": "Scan"`, `"navHistory": "Receipts"`.

- **IMPLEMENT**: The Croatian file needs the same keys. Suggested values — **verify the diacritics
  render correctly after writing**: `title` "Vaši računi", `empty` "Još nemate spremljenih računa.",
  `emptyAction` "Skenirajte svoj prvi račun", `filterLabel` "Status", `filterAll` "Svi", `noDate` "Bez
  datuma", `noSeller` "Nepoznat prodavatelj", `noNumber` "Bez broja računa", `noTotal` "Bez iznosa",
  `delete` "Obrišite", `confirmDelete` "Obrišite ovaj račun", `cancelDelete` "Zadržite ga",
  `deleting` "Brišemo", `previous` "Prethodna", `next` "Sljedeća", `pageOf` "Stranica {{page}} od
  {{pages}}", `count` "{{count}} računa", statuses "U obradi" / "Za pregled" / "Potvrđen" /
  "Neuspješno", errors "Nije moguće učitati vaše račune. Pokušajte ponovno." / "Nije moguće obrisati
  ovaj račun. Pokušajte ponovno.", `common.navCapture` "Skeniranje", `common.navHistory` "Računi".
- **GOTCHA — mojibake.** `/validate` Phase 6.11 exists because a previous task shipped `"PokuÅ¡ajte"`.
  Write these files with a UTF-8-aware tool (the `Write`/`Edit` tools, **not** a PowerShell heredoc,
  which reads UTF-8 through the legacy ANSI codepage on this machine). Run Phase 6.11 immediately
  after this task, not at the end.
- **GOTCHA**: Key **order and nesting must match** between the two files for readability, though the
  parity test only compares key sets.
- **VALIDATE**:
  `npx vitest run --project client src/i18n/i18n.test.ts` then the Phase 6.11 mojibake check.

### 10. CREATE `client/src/i18n/receiptStatuses.test.ts`

- **IMPLEMENT**: Mirror `client/src/i18n/warnings.test.ts` exactly, over `RECEIPT_STATUSES` and
  `history.status.*`: every status has a non-empty `hr` and `en` message, and there is no orphan
  message with no matching status.
- **GOTCHA — this test is load-bearing, and the reason is specific.** `HistoryPage` renders its badge
  with ``t(`history.status.${receipt.status}`)``. `/validate` Phase 6.5 scans only **literal**
  `t("…")` calls, so it cannot see this key and cannot tell you when one is missing. The i18next
  `CustomTypeOptions` augmentation cannot type-check a template literal either. Without this test, a
  status with no translation reaches the user as the raw string `history.status.failed`. This is the
  same gap `warnings.test.ts` and `authErrors.test.ts` were written to close.
- **VALIDATE**: `npx vitest run --project client src/i18n/receiptStatuses.test.ts`

### 11. CREATE `client/src/routes/HistoryPage.tsx`

- **IMPLEMENT**: A mobile-first list — **a list of cards, not a table** (ROADMAP Task 10 scope:
  "A list, not a cramped desktop table").

  State: `page`, `status` (`ReceiptStatus | ""`), `data: ListReceiptsResponse | null`,
  `failed: boolean`, `pendingDelete: string | null`, `deleteFailed: boolean`, `reloadToken: number`.

  Load effect keyed on `[page, status, reloadToken]`, mirroring `ReviewPage.tsx:51-64` with an
  `active` flag; set `data` to `null` first so the spinner shows on a filter change.

  Render order:
  1. `<h1>{t("history.title")}</h1>`.
  2. Status filter — a `<select>` with a visible `<label>`, options `history.filterAll` plus
     `RECEIPT_STATUSES.map(...)`. Changing it resets `page` to 1. `min-h-11`.
  3. `data === null && !failed` → `<Spinner />`.
  4. `failed` → `<ErrorMessage message={t("history.errors.load")} onRetry={() => setReloadToken(v => v + 1)} />`.
  5. `data.items.length === 0` → the empty state with a `<Link to="/">{t("history.emptyAction")}</Link>`.
  6. Otherwise `<ul>` of `<li>` cards. Each card contains a `<Link to={receiptRoute(receipt)}>`
     wrapping the receipt summary, then a **sibling** delete control.
  7. Paging footer: Previous / `history.pageOf` / Next, each `min-h-11`, disabled at the bounds.
     Total pages = `Math.max(1, Math.ceil(data.total / data.limit))`.

  Each card shows, with a fallback for every nullable field:
  `receipt.issueDate ?? t("history.noDate")`, `receipt.sellerName ?? t("history.noSeller")`,
  `receipt.documentNumber ?? t("history.noNumber")`,
  `formatReceiptTotal(receipt.total, receipt.currency, i18n.resolvedLanguage ?? "hr") ?? t("history.noTotal")`,
  and the status badge ``t(`history.status.${receipt.status}`)``.

  Two-step delete (see D3):

  ```tsx
  {pendingDelete === receipt.id ? (
    <>
      <button type="button" className="min-h-11 …" onClick={() => void remove(receipt.id)}>
        {t("history.confirmDelete")}
      </button>
      <button type="button" className="min-h-11 …" onClick={() => setPendingDelete(null)}>
        {t("history.cancelDelete")}
      </button>
    </>
  ) : (
    <button type="button" className="min-h-11 …" onClick={() => setPendingDelete(receipt.id)}>
      {t("history.delete")}
    </button>
  )}
  ```

  `remove(id)` calls `deleteReceipt(id)`, clears `pendingDelete`, then bumps `reloadToken`. If the
  reloaded page comes back empty and `page > 1`, step back one page.

- **PATTERN**: `HomePage.tsx:113-207` for Tailwind and `role="alert"`; `ProcessingPage.tsx:108-134`
  for the action-button styling.
- **GOTCHA**: Never nest the delete `<button>` inside the `<Link>` — interactive elements cannot nest,
  and Testing Library's `getByRole` will find the wrong node.
- **GOTCHA**: Every user-visible string goes through `t()`. No exceptions (PRD §7.13, ROADMAP §5.8).
- **GOTCHA**: Use `useTranslation()`'s `i18n.resolvedLanguage` for the money locale, exactly as
  `AppLayout.tsx:14` does for `document.documentElement.lang`.
- **GOTCHA**: Do not add a raw `fetch` — Phase 6.9 fails the build.
- **VALIDATE**: `npm run typecheck; npm run lint`

### 12. UPDATE `client/src/App.tsx` — register the history route

- **IMPLEMENT**: Inside the `<ProtectedRoute>` branch, above the catch-all:
  `<Route path="receipts" element={<HistoryPage />} />`
- **GOTCHA**: It must stay **inside** the protected branch. The comment at `App.tsx:18-19` explains
  why the catch-all lives there; the same reasoning applies to every new route.
- **VALIDATE**: `npm run typecheck`

### 13. UPDATE `client/src/components/AppLayout.tsx` — signed-in navigation

- **IMPLEMENT**: Add a second row inside `<header>`, rendered only when `session !== null`, holding two
  `<Link>`s: `/` → `t("common.navCapture")` and `/receipts` → `t("common.navHistory")`. Each
  `min-h-11`, laid out with `flex gap-2`.
- **GOTCHA**: A second row rather than more items in the existing bar. At 375 px that bar already holds
  the app name, the language switcher and Sign out; two more inline links overflow horizontally, which
  Phase 8.4 check 5 explicitly fails on.
- **IMPORTS**: `Link` from `react-router` — the package is already imported for `Outlet`. **Never**
  `react-router-dom` (ROADMAP §2 locked decision).
- **VALIDATE**: `npm run typecheck; npm run lint`

### 14. FIX `client/src/routes/ReviewPage.tsx` — redirect a `failed` receipt

- **IMPLEMENT**: At line 57, widen the redirect condition:

  ```ts
  if (next.status === "processing" || next.status === "failed") {
    navigate(`/receipts/${id}/processing`, { replace: true });
  } else setReceipt(next);
  ```

- **GOTCHA**: This is **in scope for Task 10 specifically** because the history list makes a `failed`
  receipt reachable in one tap. Before this task it was only reachable by typing a URL, which is why
  Task 09 recorded it as a known gap rather than fixing it. `receiptRoute` already sends `failed`
  rows to the processing route, so this is defence in depth for a directly-typed URL and a receipt
  that fails between list render and navigation.
- **GOTCHA**: Keep the change to the condition only. Do **not** touch the `SourceDocumentPanel` mounts
  or anything else in this file — see D5.
- **VALIDATE**: `npx vitest run --project client src/routes/ReviewPage.test.tsx`

### 15. CREATE `client/src/routes/HistoryPage.test.tsx`

- **IMPLEMENT**: `vi.mock("../api/client", …)` stubbing `getReceipts` and `deleteReceipt`. Render
  inside `MemoryRouter`. Cases:
  1. **Renders a receipt's summary** — seller, document number, issue date, formatted total and the
     translated status label all appear.
  2. **Empty state** — `total: 0, items: []` renders `history.empty` copy and the scan link.
  3. **Load failure** — a rejected `getReceipts` renders the error with a working retry that calls
     `getReceipts` a second time.
  4. **Status filter** — choosing "Confirmed" calls `getReceipts` with
     `expect.objectContaining({ status: "confirmed", page: 1 })`.
  5. **Paging** — with `total: 45, limit: 20`, Next calls `getReceipts` with `page: 2`; Previous is
     disabled on page 1.
  6. **Two-step delete** — the first click does **not** call `deleteReceipt`; the confirm click does,
     and the list reloads afterwards.
  7. **A malformed currency does not break the list** — one item with `currency: "1EU"` still renders
     its seller name. This is the component-level guard for the `RangeError`.
  8. **Row destination by status** — a `failed` receipt's link `href` ends `/processing`, a
     `confirmed` one's ends `/review`.
- **PATTERN**: `client/src/routes/ReviewPage.test.tsx:1-60` and `ProcessingPage.test.tsx`.
- **GOTCHA**: Assert on **rendered English copy** (`"Confirmed"`), not on translation keys — that is
  what proves the key resolved rather than falling through.
- **GOTCHA**: `import "../i18n";` at the top, or every label renders as a raw key.
- **VALIDATE**: `npx vitest run --project client src/routes/HistoryPage.test.tsx`

### 16. UPDATE `README.md`

- **IMPLEMENT**:
  - Add `GET /api/receipts` to the API table with its query parameters and response shape.
  - Add a **History and soft delete** subsection under the existing receipt sections: the
    `created_at desc` sort decision and why it is not `issue_date`; the default page size of 20; that
    soft-deleted receipts leave history but the row persists with `deleted_at`; and the guarded money
    formatting and why it exists.
  - Update the **Status** blockquote at the top from Task 09 to Task 10.
  - Add the new i18n parity test to the Internationalization section's list of load-bearing tests.
- **GOTCHA**: Phase 6.6 machine-checks the README — every `npm run` script mentioned must exist, every
  script must be mentioned, every backticked file path must resolve, every local link must resolve,
  and the Configuration table must match `.env.example` **exactly**. No new env var is added by this
  task, so that last part should be untouched.
- **GOTCHA**: Prettier does not format `*.md` and must not be made to (ROADMAP §2, Phase 3).
- **VALIDATE**: Phase 6.6's node one-liner from `.claude/commands/validate.md`.

### 17. UPDATE `.claude/commands/validate.md`

- **IMPLEMENT**:
  - **Phase 4 table** — add a row for each new test file: `client/src/history/receiptSummary.test.ts`
    (guarded money formatting; the `RangeError` currency regression; status → route),
    `client/src/routes/HistoryPage.test.tsx` (list, filter, paging, two-step delete, per-status
    destinations), `client/src/i18n/receiptStatuses.test.ts` (status label parity), and amend the
    `api/src/repositories/receipts.test.ts` row to mention paging bounds and the exact count.
  - Add a sentence under the existing "load-bearing" notes explaining that the status-label test joins
    the warning and auth-error tests for the same template-literal reason.
  - **Phase 8** — add journey **8.11**: sign in, upload two receipts, confirm one; open `/receipts`;
    verify newest-first order, that the status filter isolates each of the four states, that paging
    works with `limit=1`, that a row opens the right destination per status, that soft delete removes
    it from the list while the row keeps `deleted_at` (check the real row), that the list is usable at
    375 px with 44 px targets and no horizontal overflow, and that it renders correctly in Croatian.
  - **Phase 9** — delete the Task 10 row.
  - Update the Phase 8 header sentence from "seven journeys" to eight.
- **GOTCHA**: **Hand-extend this file. Never re-run `/ultimate_validate_command`** — it overwrites
  rather than merges and would silently delete ~140 lines earned from real incidents (see the
  "Maintaining this file" section).
- **VALIDATE**: read the file back and confirm Phase 9 no longer lists Task 10.

### 18. UPDATE `.agents/ROADMAP.md` and CREATE `.agents/history/10-history-detail-view-soft-delete.md`

- **IMPLEMENT**: Set Task 10 to ✅ in the progress table with plan and history links; update the
  **Status** line at the top. Write the history file using the template in ROADMAP §1, recording at
  minimum: D1–D6 below with their reasoning, the `created_at` vs `issue_date` sort decision, the
  PostgREST out-of-range behaviour actually observed, the `listCurrent` → `listPage` migration and its
  Task 05 test edit, the two Task 09 gaps deliberately left open (D5), the Task 11 route-ordering
  warning about `/export` vs `/:id`, and real validation output.
- **VALIDATE**: `git status` shows both files modified/created.

---

## TESTING STRATEGY

### Unit Tests

Vitest across three projects (`shared` node, `api` node, `client` jsdom), driven by the root
`vitest.config.ts`. New coverage:

| File | Protects |
| --- | --- |
| `api/src/repositories/receipts.test.ts` (extended) | Paging converts page/limit to inclusive `range` bounds; the exact count becomes `total`; the status filter is applied only when supplied; owner and soft-delete filters survive |
| `client/src/history/receiptSummary.test.ts` | A malformed 3-character currency degrades instead of throwing; trailing zeros survive; every status maps to the right route |
| `client/src/routes/HistoryPage.test.tsx` | Summary rendering, empty/loading/error states, status filter, paging, two-step delete, per-status destinations |
| `client/src/i18n/receiptStatuses.test.ts` | Every `RECEIPT_STATUSES` entry has non-empty `hr` and `en` copy, with no orphans |

### Integration Tests

`npm run test:integration` against the **hosted** project — required on every task. Extends
`api/src/routes/receipts.integration.ts` with the list endpoint: owner isolation, newest-first order,
status filtering, paging with a stable `total`, an out-of-range page, soft-delete disappearance, and a
`400` for an invalid status.

**Phase 7a (Docker) is expected to be skippable**: `supabase/migrations/` does not change, and the
partial index this query needs — `receipts_active_user_created_at_idx` on
`(user_id, created_at desc) where deleted_at is null` — already exists from Task 03. Confirm no
migration file changed before claiming the skip, and **report the skip with its reason**; a phase that
was not run is not a passing phase.

### Edge Cases

- A page past the last row (see the PostgREST gotcha in Task 5).
- `limit=1` with several receipts, to prove page boundaries do not drop or duplicate a row.
- A receipt with every displayable field `null` — every column needs its fallback copy.
- A receipt with `currency: "1EU"` — must not throw.
- A total of `100.50` — must not render as `100.5`.
- Deleting the only receipt on page 2 — the view must not strand the user on an empty page.
- A `failed` and a `processing` receipt in the list — both must route to `/processing`, not `/review`.
- User B's receipts must never appear for user A, and `?status=` must not widen that.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness. Run from the repository
root (`prototypes/receipt-ocr/`) in **Windows PowerShell 5.1**, where `&&` is a parser error — chain
with `;` or run separately. `npm run <script>` chains internally via cmd.exe, so scripts using `&&`
are fine.

### Level 1: Syntax & Style

```
npm run lint
npm run typecheck
npm run format:check
```

`npm run typecheck` is the **authoritative** gate — oxlint has no type-aware rules. Do not pipe it
through `Select-Object`/`head`/`tail`; the pipe masks the exit code and `tsc --build` signals failure
with exit code 2.

### Level 2: Unit Tests

```
npm test
npx vitest run --project shared
npx vitest run --project api
npx vitest run --project client
```

The per-project runs matter: `npm test` runs every project regardless of its configured `name`, so
only a per-project run catches a stale project name.

### Level 3: Integration Tests

```
npm run test:integration
```

Confirm the runner prints **HOSTED** and the project host before any test executes. Phase 7a
(`npm run test:integration:local` + Docker) is required only if `supabase/migrations/` changed.

### Level 4: Manual Validation

Run the full `/validate` Phase 6 security block, then Phase 8. Before starting any server:

```powershell
foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "cleaned port $p" } else { "port $p free" } }
```

**If Vite reports any port other than 5173, stop.** A stale Vite answers on 5173 while the new one
moves to 5174+, and every check below would pass against old code.

```
npm run dev:api
npm run dev --workspace @receipt/client -- --host 0.0.0.0 --strictPort
```

Then walk journey 8.11 as written in Task 17, plus:

```powershell
try { Invoke-WebRequest -Uri "http://localhost:3001/api/receipts" -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected: still `401` unauthenticated — adding a route here must not weaken the prefix guard.

### Level 5: Additional Validation (Optional)

- `agent-browser` (already a dev dependency) can drive journey 8.11, as Task 09 did.
- The Supabase MCP server can confirm a soft-deleted row still exists with `deleted_at` set — the one
  assertion the UI cannot make about itself.

---

## ACCEPTANCE CRITERIA

Derived from ROADMAP Task 10's definition of done and PRD §7.11 / §10.2 / §10.7 / §11.2.

- [ ] `GET /api/receipts` returns only the authenticated user's non-deleted receipts, newest first
- [ ] The status filter works for all four states, and an unknown status is `400 invalid_request`
- [ ] Paging works across more than one page; `total` is the unpaged count of the filtered set
- [ ] Opening a receipt from history shows its structured data and its original document
- [ ] A `processing` or `failed` receipt opens the processing route, never an empty review form
- [ ] Soft delete removes the receipt from history while the row persists with `deleted_at` set
- [ ] Empty, loading and error states all render, and the error state offers a working retry
- [ ] Verified readable and tappable at 375 px — 44 px targets, no horizontal overflow
- [ ] Every new user-facing string exists in both `hr` and `en`, with no mojibake
- [ ] A receipt with a malformed 3-character currency does not break the list
- [ ] No Azure field name appears in any new response or UI surface
- [ ] Nothing in the new code can block confirmation (Phase 6.13 still passes)
- [ ] All validation commands pass with zero errors; hosted integration passes
- [ ] `README.md`, `.claude/commands/validate.md`, `.agents/ROADMAP.md` and the history file are updated

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + hosted integration)
- [ ] No linting or type checking errors
- [ ] Manual journey 8.11 confirms the feature works in a real browser
- [ ] Acceptance criteria all met
- [ ] Phase 9 no longer lists Task 10; Phase 8 lists journey 8.11
- [ ] History file records decisions, deviations, real validation output and remaining gaps

---

## NOTES

### Decisions this plan makes

**D1 — The detail view reuses `ReviewPage`; no separate read-only screen is built.**
The roadmap's Task 10 scope says "Detail view reusing the review screen for `review` records and a
**read-oriented view for `confirmed` ones**". That wording predates Task 09, which deliberately decided
the opposite: its D6 made `PATCH` legal in both `review` **and** `confirmed`, precisely so a user can
still correct a receipt after confirming it, and `ReviewPage` already renders a "Receipt confirmed"
banner for that state. Building a read-only view now would contradict a locked decision from the
previous task, put the UI and the API in disagreement (the screen would forbid what the endpoint
allows), and create a second place where every canonical field's rendering must be kept in sync.
PRD §7.11 asks only to "open receipt detail" and "view original source" — it never requires read-only.
Per CLAUDE.md §2 and §5, this plan reuses the existing screen and records the departure. **If the
human wants a read-only confirmed view, it should be an explicit, separately justified decision.**

**D2 — Sort by `created_at desc`, not `issue_date desc`.**
The list *displays* issue date, so this reads oddly at first. But `issue_date` is a nullable generated
text column with no index, and a receipt whose date OCR failed would sort unpredictably. `created_at`
is non-null, monotonic, and backed by the partial index Task 03 built for exactly this query.
PRD §10.2 specifies only "newest first".

**D3 — Two-step inline delete, not `window.confirm`.**
`window.confirm` is one line, but jsdom does not implement it (it logs "Not implemented" and returns
`undefined`), so every delete test would need a spy, and the native dialog cannot be styled for a
44 px mobile target. A two-step inline control is translatable, testable through the rendered UI, and
consistent with how the rest of this app handles confirmation.

**D4 — Filter and page live in component state, not the URL.**
`useSearchParams` would make a filtered page shareable and survive a reload. That is genuinely nicer,
but nothing in the PRD or the roadmap asks for it, and ROADMAP §5.2 forbids speculative additions.
Local state is fewer moving parts. Revisit if Task 12's QA shows people expect the back button to
restore a filter.

**D5 — Two Task 09 follow-ups are deliberately NOT taken in this task.**
Task 09's history nominated Task 10 for both. On inspection, neither traces to Task 10's definition of
done, and CLAUDE.md §3 requires every changed line to trace to the request:

- **`SourceDocumentPanel` is mounted twice** (mobile `<details>` + desktop `<aside>`), so a review load
  issues two signed URLs. Collapsing it to one instance requires restructuring the review grid so a
  single panel can appear above the form on mobile and beside it on desktop — the toggle button and
  the panel end up in different grid children, and the mobile reveal position changes. That is a
  redesign of a layout Task 09 hand-validated at 375 px, to save one request for a resource the user
  already owns, with a 300-second TTL. Not proportionate here. Task 10 routes *to* this screen; it does
  not rebuild it.
- **`GET /api/receipts/:id` runs two queries** (`findById` + `findReviewState`) and is polled every
  2 s. The fix is cheap and safe, but it is a performance change to a Task 09 endpoint that Task 10
  does not otherwise touch.

Both belong in one small cleanup commit, or in Task 12's hardening pass. **Carry both forward in the
Task 10 history file so they are not lost.** By contrast, the `failed`-receipt redirect (Task 14) *is*
taken, because the history list is what makes that broken screen reachable in one tap.

**D6 — `limit` is server-defaulted and echoed back, not client-specified.**
The client sends only `page` and `status`; `listReceiptsQuerySchema` supplies `limit: 20` and the
response echoes it. One source of truth for page size, and the page-count arithmetic uses the same
number the server actually applied.

### Risks

- **PostgREST out-of-range paging behaviour is unverified** and is the single most likely surprise.
  Test it against the hosted project early (Task 5) rather than discovering it in manual validation.
- **The conditional status filter may fight TypeScript 7's inference** over PostgREST's builder
  generics. The ternary-at-the-call-site form in Task 1 avoids the reassignment that usually causes it.
- **Croatian copy is the usual mojibake risk.** Write the locale files with UTF-8-aware tooling and run
  Phase 6.11 immediately, not at the end of the task.
- **The `QueryDouble` change touches a shared test fixture.** If it is made thenable incorrectly, other
  repository tests fail in confusing ways. Run the repository suite immediately after Task 2 before
  moving on.

### Confidence Score

**8/10** for one-pass success.

Strong: every DTO already exists, is exported and is tested; the repository, route, client-API and
component patterns are all established and cited with line numbers; the migration and index already
support the query, so no schema work is needed; and the two genuine defects (the `failed` redirect and
the currency `RangeError`) were found and reproduced during planning rather than left to be discovered
at validation time.

Residual risk sits in the three unknowns above — PostgREST's out-of-range response, PostgREST builder
generics under TypeScript 7, and mobile layout at 375 px, which only a real browser settles.
