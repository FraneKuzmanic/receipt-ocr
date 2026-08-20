# Task 10 — History, detail view & soft delete

**Date:** 2026-08-20
**Plan:** `.agents/plans/history-detail-view-soft-delete.md`
**Commit:** `5e1b11b`

## What was built

Authenticated users can now open a paged receipt history from the signed-in header, filter by every
receipt status, open a row in its appropriate existing detail route, and soft-delete it through a
two-step control. `GET /api/receipts` uses the established owner and non-deleted filters, exact
filtered counts and newest-first `created_at` paging. History is a mobile card list, not a table.

The list treats malformed three-character currency codes as display errors rather than page errors:
it falls back to a locale-formatted plain amount plus the raw code. It also preserves canonical
trailing zeroes when no currency is known. `failed` direct review URLs now redirect to processing,
where retry belongs.

## Files created / modified

**API**

- `api/src/repositories/receipts.ts`
- `api/src/repositories/receipts.test.ts`
- `api/src/repositories/receipts.integration.ts`
- `api/src/routes/receipts.ts`
- `api/src/routes/receipts.integration.ts`

**Client**

- `client/src/api/client.ts`
- `client/src/api/client.test.ts`
- `client/src/history/receiptSummary.ts`
- `client/src/history/receiptSummary.test.ts`
- `client/src/routes/HistoryPage.tsx`
- `client/src/routes/HistoryPage.test.tsx`
- `client/src/routes/ReviewPage.tsx`
- `client/src/routes/ReviewPage.test.tsx`
- `client/src/App.tsx`
- `client/src/components/AppLayout.tsx`
- `client/src/i18n/locales/en.json`
- `client/src/i18n/locales/hr.json`
- `client/src/i18n/receiptStatuses.test.ts`

**Documentation**

- `README.md`
- `.claude/commands/validate.md`
- `.agents/ROADMAP.md`

## Decisions made

- **D1 — Reuse `ReviewPage` for both `review` and `confirmed` receipts.** Task 09 deliberately
  allows corrections in both states, so a read-only confirmed screen would contradict the API and
  duplicate the canonical display.
- **D2 — Sort by `created_at desc`.** It is non-null and covered by
  `receipts_active_user_created_at_idx`; nullable OCR `issue_date` is only a display field.
- **D3 — Use a two-step inline delete.** It is translatable, testable and touch-sized, unlike
  `window.confirm`.
- **D4 — Keep page and status in component state.** URL persistence is useful but outside this PoC
  task's scope.
- **D5 — Leave Task 09's double `SourceDocumentPanel` mount and two-query detail load unchanged.**
  They are unrelated layout/performance cleanups for Task 12 or a small focused follow-up.
- **D6 — Client omits `limit`; the server defaults it to 20 and echoes the applied value.**

## Deviations from the plan

- The plan mentioned two `listCurrent()` call sites in `api/src/routes/receipts.integration.ts`; the
  current code had two there and two more in `api/src/repositories/receipts.integration.ts`. All four
  required migration to `listPage()` after removing the old method.
- Hosted PostgREST returns `416 PGRST103 Requested range not satisfiable` for an out-of-range page,
  rather than an empty 200. `listPage()` now makes one count-only first-page query in that rare case
  and returns `{ items: [], total }`, preserving the list contract.
- A shared `formatAmount()` call without currency suppresses a trailing zero under `Intl`; the
  history-only display helper supplies the canonical amount scale without converting money to a
  JavaScript number. `shared/` remains unchanged as planned.

## Validation results

- `npm install` — passed; no dependency changes or vulnerabilities. npm reported existing pending
  install-script approval notices for `agent-browser` and `esbuild`.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run format:check` — passed.
- `npm test` — passed: 32 files, 305 tests.
- `npx vitest run --project shared` — passed: 4 files, 133 tests.
- `npx vitest run --project api` — passed: 12 files, 84 tests.
- `npx vitest run --project client` — passed: 16 files, 88 tests.
- `npm run build` — passed. Vite reported its existing >500 kB chunk-size advisory.
- Phase 6 security/configuration checks — passed, including the deliberate negative secret-prefix
  check, locale mojibake, translation keys, README parity and no raw client `fetch`.
- `npm run test:integration` — passed against hosted `ssczfjvbeqyrlbasfyzj.supabase.co`: 8 repository,
  3 auth and 12 receipt-route tests. The post-run task-user orphan check returned `[]`.
- Phase 7a local Docker migration validation — skipped: no `supabase/migrations/` file changed.
- Browser journey at 375 × 667 — passed with fresh disposable credentials: uploaded two live receipt
  images, confirmed one, opened history, verified status filters and the confirmed-detail route,
  soft-deleted the other row, proved no horizontal overflow in English and Croatian, then queried the
  row directly (`deleted_at` set). The disposable user and two private sources were removed.

## Post-execution review findings

An independent review pass re-ran the full validation sweep from scratch (not just re-reading the
report above), including the hosted integration suite and a fresh live browser journey through
registration, upload, extraction, confirmation, filtering, paging and two-step delete, verified
directly against the database. All of that held up. Two things did not, both fixed before commit:

1. **Mojibake in the new README bullet for `receiptStatuses.test.ts`.** The em dash separating the
   file path from its description was double-corrupted (UTF-8 misread as Latin-1, re-saved, then
   misread and re-saved a second time) — the same class of encoding bug Task 07 and Task 08 hit
   before. `/validate` Phase 6.11 did not catch it: it scans only the two locale JSON files, and this
   corruption's byte signature falls outside the single-corruption pattern Phase 6.11 matches. Found
   by a raw byte scan across every file this task touched, not by Phase 6.11 itself. Fixed by
   replacing the corrupted sequence with a plain em dash, matching the sibling bullets exactly; no
   other file in the diff carries the same signature.
2. **A genuinely unsound test assertion**, introduced as a side effect of migrating
   `listCurrent()` → `listPage()` in `api/src/repositories/receipts.integration.ts`'s soft-delete
   check. The original `resolves.not.toContainEqual(expect.objectContaining({ id }))` correctly
   checked the whole list for the deleted receipt regardless of position. The replacement,
   `resolves.not.toMatchObject({ items: [expect.objectContaining({ id })] })`, was **not**
   equivalent: `toMatchObject` on an array requires equal length between actual and expected, so the
   negated assertion passes trivially whenever `items.length !== 1` — including when the deleted
   receipt is genuinely still present but sitting at an index other than 0, or alongside another
   receipt. Confirmed empirically with a throwaway three-case test
   (`toMatchObject({ items: [...] })` against an empty array, a two-item array with the target
   buried at index 1, and a single-item array): the two-item case passed `.not.toMatchObject` even
   though the target receipt was present in the array, proving the assertion would silently miss a
   real soft-delete regression in any test scenario with more than one receipt. It happened to pass
   in this file only because `repositoryReceiptId` is the first and only receipt created for a fresh
   test user at that point in the test. Fixed by reverting to the same `.some(...)` membership check
   already used two lines above it in the same test, which is correct regardless of list size or
   order.

## Known gaps / follow-ups

- The browser run validated a 375 px headless viewport, not a physical phone. Task 06's real-phone
  camera validation remains deferred until the hosted deployment exists.
- Keep Task 09's duplicate source-panel signed-URL request and two-query detail polling as a small
  cleanup or Task 12 hardening item.
- Task 11 must register `/api/receipts/export` before `/:id`, or the parameterized route will shadow
  it.
