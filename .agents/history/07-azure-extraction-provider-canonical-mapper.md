# Task 07 — Azure extraction provider & canonical mapper

**Date:** 2026-08-19
**Plan:** `.agents/plans/azure-extraction-provider-canonical-mapper.md`
**Commit:** Pending human review

## What was built

Azure Document Intelligence now runs asynchronously after receipt upload. Its provider adapter maps
the `prebuilt-invoice` result into canonical receipt fields, retains the raw result and per-field
metadata, and moves the receipt from `processing` to `review` or `failed`. Failed retryable work can
be restarted from the private stored source; the client exposes Retry on the failed processing page.

The mapper and Croatian text fallbacks are pure and run offline from recorded Azure response fixtures.
They preserve exact decimal strings, deterministically recover OIB/JIR/ZKI/date/time/document-number
gaps, and never expose provider field names outside the adapter.

## Files created / modified

- `api`: Azure provider, mapper, Croatian parser, extraction service, recorded fixtures and their
  unit/integration tests; upload/retry routes, source download, configuration and test configuration.
- `client`: retry API client call, failed-processing retry control and Croatian/English copy.
- Root: pinned Azure SDK dependency, comparison/fixture scripts, `.env.example`, README and validation
  contract.

## Decisions made

- **API version:** `2024-11-30`, the only version available on the configured resource.
- **Model:** `prebuilt-invoice`. The live comparison harness was run against the supplied sources. The
  seven recorded invoice results found seller 7/7, document number 7/7, issue date 6/7, total 7/7 and
  symbol-backed currency 4/7. The prior six-source two-model measurement remains decisive for document
  number: invoice 6/6, receipt 0/6. The supplied PDF also returned review-ready through invoice.
- **Confidence policy:** record every canonical field confidence/provenance; do not discard a readable
  value because it is low confidence. `0.7` remains a future review-highlighting threshold, not a gate.
- **Money policy:** parse only provider text `content` through `parseAmount`; never read
  `valueCurrency.amount` or `valueNumber`.
- **Retryability:** 400/401/404 are non-retryable; 429, 5xx, timeouts and network failures are
  retryable and stored in extraction metadata.

## Live evidence

| Source | Result | Latency | Canonical field names returned |
| --- | --- | ---: | --- |
| Croatian photo (`26515835.jpg`) | review-ready | 8,019 ms | seller, address, OIB, buyer, document number, total, items, JIR, ZKI |
| PDF (`primjer-pdf-racuna.pdf`) | review-ready | 7,363 ms | seller, address, OIB, buyer, document number, payment method, total, date, currency, items |

An unreachable endpoint produced `provider_unavailable` with `retryable: true` in the live provider
smoke check.

## Deviations from the plan

- Added the narrow internal `ReceiptRepository.findExtractionState()` read. The public canonical DTO
  intentionally does not expose extraction metadata, but the retry guard must inspect its stored
  retryability without leaking it through the API.
- Added a controlled mapper edge-case JSON fixture alongside the recorded live fixtures to assert
  decimal cases that the real examples do not happen to contain (`8,08`, `1.234,56`, `2,30`).
- Extended Pino redaction to source bytes, extracted content and raw provider results.

## Validation results

- `npm install` — passed; Azure SDK `1.1.0` added with no vulnerabilities.
- Focused provider tests — 19 passed.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build` — passed;
  25 test files and 254 tests passed.
- `npm run test:integration` against hosted Supabase — passed; 3 files and 20 tests passed.
- Documentation/configuration, bundle-secret, float-mapper and `git diff --check` checks — passed.
- Docker Phase 7a — skipped: this task has no migration or schema change.

## Independent review — findings and fixes

A separate review pass against the plan (not just `/validate`) drove real receipts through the
running app with a browser agent rather than trusting fixtures alone, and found three confirmed bugs
that every automated check had missed. All three are fixed, each with a regression test proving it
would have caught the original bug, and the full suite was re-run clean afterward (258 tests).

1. **Silent loss of the `total` field — the most important field in PRD §6.5.** Uploading the real
   Štorija/REBECA d.o.o. receipt through the running app produced a `review` record with no `total`
   at all, even though the receipt clearly reads "Ukupno: 13.00 kn". Cause: `parseAmount` in
   `shared/src/money.ts` stripped the ISO currency code `HRK` and the euro/dollar/pound symbols but
   not the Croatian kuna abbreviation `kn`, which is exactly how Azure formatted this pre-2023
   receipt's total. Fixed by adding `kn` to `CURRENCY_TOKENS`; `shared/src/money.test.ts` gained two
   cases (`"13.00 kn"`, `"13,00 KN"`), and the live fix was re-verified end to end against the same
   receipt through the running API (`total: "13.00"`, extraction completed in ~9 s).
2. **Mojibake in the Croatian UI.** `client/src/i18n/locales/hr.json`'s new `processing.retry` key
   read `"PokuÅ¡ajte ponovno"` instead of `"Pokušajte ponovno"` — UTF-8 bytes for `š` re-interpreted
   as Latin-1 during the edit that added the key. Confirmed both at the codepoint level and live in a
   rendered screenshot after forcing a receipt to `failed`. No existing check caught it —
   `i18n.test.ts` only verifies key presence, and Prettier does not validate string content. Fixed by
   correcting the encoding, and `/validate` gained a new **Phase 6.11** that scans both locale files
   for the UTF-8-misread-as-Latin-1 byte pattern; verified it both passes on the fixed files and
   throws on the original corrupted string.
3. **`EXTRACTION_TIMEOUT_MS` did not bound the part of the operation that actually takes time.** The
   abort signal built in `azure.ts`'s `extract()` was passed to the initial Azure POST but never to
   `getLongRunningPoller(...).pollUntilDone()` — the long-running poll, which real runs during
   planning measured taking up to ~65 s, is exactly what the documented "Azure extraction timeout"
   exists to bound. Fixed by passing `{ abortSignal: signal }` into `pollUntilDone()`. Verified live
   against the real Azure resource: a 300 ms timeout now aborts at ~316 ms (previously would have run
   to completion regardless of the setting), and `azure.test.ts` gained two offline regression
   tests — one proving the same signal used for the request reaches the poll, one proving a poll that
   outlives the timeout rejects as a retryable failure rather than hanging (confirmed to fail, one
   with a 5 s test timeout reproducing the real hang, against the pre-fix code before being restored).

None of these three bugs were caught by `/validate`, by the plan's own test suite, or by the recorded
fixtures — all three needed a real receipt driven through the actually-running application to surface.
That is the reason this review used a browser agent against the live dev stack and the live Azure
resource rather than relying on the automated sweep alone.

## Known gaps / follow-ups

- The live photo/PDF provider smoke test passed, but the full browser/phone journey in validate Phase
  8.8 still needs a human run against a hosted deployment. Task 12 owns deployment and cross-device QA.
- QR extraction and warning generation remain Task 08; the review form and confidence highlighting
  remain Task 09.
- `shared/src/money.ts`'s `CURRENCY_TOKENS` now handles `kn`, but this class of gap — a real receipt
  using a local abbreviation the parser doesn't recognize — is inherently open-ended. Task 12's
  broader evaluation should keep watching for it.
