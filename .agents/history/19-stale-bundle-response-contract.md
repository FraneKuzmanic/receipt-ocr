# Iteration 19 — Stale-bundle response contract & error visibility

**Date:** 2026-08-26
**Plan:** _none — user reported a live client-demo failure and asked for a diagnosis, then a direct fix_
**Commit:** _pending human review_

## Why this iteration exists

A client demo failed. The user's client (`marjanovicnevio@gmail.com`) uploaded a PDF successfully at
06:31 UTC, then from 09:09 UTC every image upload ended on the generic processing-error screen. No
message appeared in the browser console and none in the UI beyond "something went wrong", so neither
the user nor the client could tell what had happened. The user reproduced nothing on their own
account, but had seen the same failure once themselves.

## What was actually wrong

**Nothing was wrong with the receipts, the extraction, or the API.** Every one of the client's six
uploads created a row and reached `review` with correct canonical data — there is not a single
`failed` row in the database for that session. `receiptWithTaxMistake.jpg`, which the client retried
three times, extracted seller `REBECA d.o.o.`, total `13.00`, VAT `25.00 / 10.40 / 2.60`, JIR and ZKI
on every attempt, byte-identical in substance to the same file uploaded from the user's own account.

The failure was a **client/API contract skew across a deploy**:

1. Commit `64efb25` added `failureReason` to the `GET /api/receipts/:id` response body. The Render
   static site finished deploying it at **08:08:55 UTC** (confirmed by `last-modified` on the live
   `index.html`).
2. The client's browser was still running the **pre-deploy bundle**, loaded during their 06:31
   session. A single-page app left open never re-fetches its own JavaScript.
3. `receiptDetailResponseSchema` was `.strict()`, inherited from `canonicalReceiptFieldsSchema`. The
   older bundle therefore did not ignore the new key — it rejected the entire body with
   `unrecognized_keys: ["failureReason"]`.
4. `ProcessingPage`'s poll caught that with a bare `catch {` — no error binding, no logging — and
   showed `request_error`. Hence a generic screen and a completely empty console.

Signing out and back in did not help, and could not: that is client-side routing, so the stale bundle
stayed in memory. The polling logs show one request per receipt followed by long, irregular gaps —
those are the client reading the error and pressing **Check again**, not a 2-second timer.

The user's own account worked because they had been developing all morning and had reloaded after the
deploy. The one time it hit them was a stale tab; a failed refresh-token request from their IP at
09:09:36 is the corroborating trace.

## What was built

**Response DTOs are forward compatible; request DTOs are unchanged.** In `shared/src/api.ts` the five
response bodies the browser parses — `apiErrorResponseSchema`, `createReceiptResponseSchema`,
`receiptDetailResponseSchema`, `listReceiptsResponseSchema` (envelope *and* its receipt items) and
`sourceDocumentResponseSchema` — are now `.strip()`.

`.strip()` was chosen over `.loose()` deliberately: both accept an unknown key, but `.strip()`
discards it, so a newer API can neither break an older bundle nor smuggle an undeclared field into
one. That is what let the pre-existing "the create response never carries `userId`" assertion survive
the change as a stronger property rather than being deleted.

**Request strictness is untouched and re-asserted.** `canonicalReceiptFieldsSchema` stays `.strict()`,
so `updateReceiptRequestSchema` still rejects a forged `userId` (PRD §9.1), and
`listReceiptsQuerySchema` still rejects an unknown query parameter. `canonicalReceiptSchema` itself
stays strict, so the repository's row validation and the provider-independence guard are unaffected.

**`sourceRegionsResponseSchema` was deliberately left strict.** The API validates its own output
against it, which is what makes an accidental Azure field name a parse failure rather than a silent
leak (`/validate` 6.17). Its client-side failure is already non-fatal by design — the review form
renders without overlays — so a skew there degrades instead of breaking.

**Errors are visible in the console, and only in the console.** Every swallowing handler now binds
and logs its error: `client.ts` (401s, HTTP failures with their stable code, and a new
`parseResponse` helper that names the endpoint on a shape mismatch), `ProcessingPage`, `ReviewPage`,
`HistoryPage`, `HomePage` and `SourceDocumentPanel`. **No user-facing copy changed** — the screen
keeps its translated, plain-language message; the technical detail goes to the console only. The
processing poll logs only when the error actually reaches the user, so an abort on unmount stays
silent.

## Files created / modified

**Modified** — `shared/src/api.ts`, `shared/src/api.test.ts`, `client/src/api/client.ts`,
`client/src/routes/{ProcessingPage,ReviewPage,HistoryPage,HomePage}.tsx`,
`client/src/review/SourceDocumentPanel.tsx`.

**Created** — this file.

## Decisions made

- **`.strip()` rather than `.loose()`** for response DTOs, so an undeclared field never reaches a
  caller that has no idea what it means. See above.
- **Two existing assertions were changed rather than deleted.** They encoded the old strictness:
  `createReceiptResponseSchema` rejecting `userId`, and `receiptDetailResponseSchema` rejecting an
  extra key. Both now assert the field is *dropped* instead of *fatal*, which preserves the original
  intent under the new contract. Per the iteration-17 amendment, a red check was first established as
  "the check is now wrong" rather than assumed to be a code defect.
- **No stale-version reload prompt was added.** It was offered and the user scoped this iteration to
  tolerant parsing plus logging. It remains the recommended follow-up: tolerant parsing survives an
  *additive* change, not a removed or retyped field.

## Deviations from the plan

No plan existed. The scope was chosen by the user from four options after the diagnosis was presented.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, exit 0 |
| `npm test` | Pass: **48 files, 449 tests** (7 new) |
| `npm run lint` | **Pre-existing failure, not from this diff** — see below |
| `npm run format:check` | **Pre-existing failure, not from this diff** — see below |
| Incident replay (stale bundle vs. newer API body) | Parses; unknown key discarded |
| Security invariants (forged `userId`, canonical strictness) | Both still reject |

Phase 7b (hosted integration) and Phase 8 browser journeys were **not run** and are outstanding for
this change.

### Two validation gates were already red at HEAD

Confirmed by stashing this diff and re-running against `64efb25`:

- `npm run lint` — two `unicorn(prefer-add-event-listener)` errors in
  `client/src/capture/downscale.ts:13-14`, shipped with iteration 18 Commit B.
- `npm run format:check` — **152 files**, essentially the whole repository. The files pass Prettier
  when checked with `--end-of-line auto`, so this is a repo-wide CRLF/LF mismatch rather than real
  style drift. Running `npm run format` would rewrite every file in the repo and bury this change, so
  it was deliberately not done; only the three files this iteration actually touched were formatted,
  with `--end-of-line auto` to avoid line-ending churn.

Both are unrelated to this diff and left for a separate decision.

## Known gaps / follow-ups

- **A stale tab is still unbounded.** Tolerant parsing handles additive fields. A removed or retyped
  field, or a client-side route that no longer exists, still breaks an old bundle. A version handshake
  with a translated "new version available — reload" prompt is the standing recommendation.
- **Nested response objects remain strict.** `.strip()` applies to the level it is written on. A new
  key inside `vatBreakdown[]` or `items[]` would still reject; that is a domain-model change and
  rarer, but it is not covered.
- **`index.html` is served `max-age=0`**, so a plain reload does recover a stale client. That is the
  operational workaround, and it is what was given to the client.
- **Supabase's configured Site URL appears to be `http://localhost:5173`** — every GoTrue log line in
  the incident window carries it as the `referer` fallback. Unverified and harmless today, but it
  would matter if password reset or any email redirect is ever enabled.
