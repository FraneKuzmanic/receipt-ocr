# Task 08 — QR decoding & validation/warnings engine

**Date:** 2026-08-19
**Plan:** `.agents/plans/qr-decoding-validation-warnings-engine.md`
**Commit:** Pending human review

## What was built

Azure Document Intelligence now requests the free barcode feature with every invoice analysis. The
provider parses Croatian fiscal QR payloads, stores a separate `qr_extraction` record when a QR exists,
and preserves `null` when it does not. Extraction computes stable, informational receipt warnings from
canonical fields, QR data and source values that Azure saw but could not normalize. No QR value enters
canonical data and no warning gates an action.

The QR parser and warning engine are pure offline modules. Task 09 can call the same warning function
after an edit without rerunning OCR; Task 08 intentionally does not add that PATCH endpoint.

## Files created / modified

- `api`: fiscal QR parser and tests; warning engine and tests; Azure provider/mapper/type/service
  wiring; recorded Azure fixtures and provider/service tests.
- `scripts`: barcode-enabled fixture recorder; sequential hosted-Supabase integration runner.
- Root documentation: `README.md` and `.claude/commands/validate.md`.
- Project record: `.agents/ROADMAP.md` and this history.

## Decisions made

| Decision | Outcome | Evidence |
| --- | --- | --- |
| D1 — QR decoding | No library; request Azure `features=barcodes` server-side. | It supports the accepted image/PDF/HEIF formats without new decoding/rasterization dependencies. Live side-by-side analysis of `26515835.jpg` returned identical field hashes with and without barcodes and detected one QR. |
| D2 — payload format | Parse fiscal URL `jir`/`zki` parameters case-insensitively, plus a bare UUID JIR. | Real supplied receipts produced two fiscal URLs and one bare JIR UUID. Invalid/marketing payloads preserve raw evidence but yield no invented field. |
| D3 — separator-less `izn` | Preserve raw `izn=199`; set QR total to `null` and do not compare it. | `26515835.jpg` has OCR total `1.99` but QR `izn=199`; treating it as `199.00` would create a false mismatch. |
| D4 — document quality | Do not produce `document_quality`. | Azure document/barcode confidence was non-discriminating across the recorded sources, and accepting a client quality assertion would weaken the upload boundary. |
| D5 — PATCH | Keep PATCH/recomputation wiring in Task 09. | The exported pure engine proves correction clears `qr_total_mismatch` without OCR; no new endpoint was needed here. |
| D6 — QR authority | QR data is cross-check-only. | It is written only to `qr_extraction`; the mapper, canonical data and API DTOs remain provider/QR independent. |

## Deviations from the plan

- The current recorded taxi/mobile fixtures carry a valid Azure `valueDate` alongside malformed display
  text, so the mapper correctly uses that structured value rather than marking the date unreadable.
  The regression test instead supplies malformed source content without a structured value, which
  exercises the intended `unreadableFields` behavior without discarding valid provider data.
- The first fixture stop check falsely showed Croatian mojibake because Windows PowerShell 5.1 read
  UTF-8 JSON through its legacy default encoding. A UTF-8-safe comparison verified all seven refreshed
  fixtures retain identical mapped field values; no mapper expectation was changed.
- The combined hosted integration invocation failed during concurrent-looking setup while each suite
  passed in isolation. `scripts/run-supabase-integration-tests.mjs` now runs its existing Auth,
  repository and routes files sequentially; it preserves all 20 tests and makes the required hosted
  validation deterministic.
- Repaired pre-existing Phase 6.5/6.6 PowerShell quoting so their documented Node checks execute under
  the shell named by the validation guide.

## Validation results

- `npm install` — passed (no peer-resolution error).
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, and `npm run build` —
  passed; the full suite has 27 files / 274 tests.
- `npx vitest run --project api`, `shared`, and `client` — passed: 82, 132 and 60 tests respectively.
- `npm run test:integration` against hosted `ssczfjvbeqyrlbasfyzj.supabase.co` — passed sequentially:
  Auth 8, repository 3 and routes 9 tests.
- Re-recorded seven supplied Azure fixtures with `features=barcodes`; UTF-8-safe comparison confirmed
  no mapped field value changed.
- All Phase 6 security/configuration checks, including new 6.12 (no QR network request) and 6.13 (no
  warning gate), passed. Their deliberately broken in-memory inputs threw as expected.
- Live API/Azure/Supabase check on a disposable user passed and cleaned up the user plus all sources:
  `racuntaksi1.jpg` stored JIR/date/time/`132.72`; `26515835.jpg` preserved `izn=199` with null QR
  total and no total mismatch; `images.jpg` reached review with null QR. Logs contained IDs, timings,
  status and warning counts only, not QR/raw receipt content.
- Phase 7a Docker migration validation — skipped legitimately: `supabase/migrations/` did not change.

## Known gaps / follow-ups

- The new Phase 8.9 flow was exercised through the real API, Azure and hosted Supabase, but the full
  browser/phone journey remains a deployment-era check. Task 12 owns hosted real-phone validation.
- Task 09 owns exposing QR evidence beside editable fields, the PATCH endpoint and warning
  recomputation after saved edits.

## Post-execution review findings

An independent review pass (not just re-running `/validate`) checked this task's diff line by line
against the plan and re-verified its central claims from scratch — including re-diffing all seven
fixtures' field values against `git show HEAD:...` directly, rather than trusting the "no value diffs"
claim above, and re-running the full test suite, hosted integration suite and a fresh live upload
through a freshly started `dev:api` against a disposable Supabase user. All of that held up. Two things
did not, both fixed before commit:

1. **Mojibake in the new `azure.test.ts` test fixture.** `content: "RaÄun broj:\n:barcode:\n..."` — the
   same UTF-8-misread-as-Latin-1 corruption Task 07 found and fixed (`č` → `Ä` + an invisible control
   byte), reintroduced by whatever tool wrote this new test's string literal. `/validate` Phase 6.11
   only scans `client/src/i18n/locales/*.json`, so it cannot catch this class of bug in `.ts` source —
   worth knowing if Phase 6.11 is ever generalized. Fixed by a byte-precise replacement, re-verified
   with the same scan pattern Phase 6.11 uses.
2. **Fixing the mojibake uncovered a real, general, pre-existing bug in Task 07's
   `croatian.ts` `DOCUMENT_NUMBER` regex**, previously masked by the corruption above (the corrupted
   `RaÄun` simply failed to match `ra[čc]un` at all, so the whole regex matched nothing and
   `documentNumber` stayed `undefined` — accidentally making the test's assertion pass for the wrong
   reason). Once `Račun` was spelled correctly, the same regex matched incorrectly: the alternation
   `(?:br\.?|broj)?` tries `br\.?` first, which matches just `"br"` out of `"broj"` (the trailing dot
   is optional), so the capture group starts mid-word and returns `"oj"` instead of the real document
   number or `null`. Confirmed with a **realistic, single-line receipt string with no barcode
   involved at all** — `"Račun broj: 381/1/3"` also yields `"oj"` — so this is not an artifact of the
   barcode-marker-stripping test, it is a standing defect in the Croatian text-fallback path for any
   receipt spelling out the full word **"broj"** instead of the abbreviation **"br."**. It is currently
   dormant for `26515835.jpg` specifically because Azure's own `InvoiceId` field already supplies
   `"10752/310012/2"` for that receipt, so the fallback never runs — but the fallback exists precisely
   for receipts where Azure's structured field is absent, and this receipt's own OCR `content` (see the
   Task 08 evidence table under D1) shows exactly the `"Račun broj:\n<number>\n"` shape that triggers
   it. **Not fixed in this commit** — `croatian.ts` is Task 07's file and outside this task's scope;
   bundling an unrelated regex fix into this commit would break the roadmap's one-atomic-commit-per-task
   discipline. **Fixed separately, immediately after, in its own commit**: swapping the alternation
   order to `(?:broj|br\.?)?` so `"broj"` is tried before the dot-optional `"br\.?"` abbreviation.
   Verified against `"Račun br. 381/1/3"` (existing case, still correct), `"Račun broj: 381/1/3"` and
   `"Račun broj:\n381/1/3"` (both now correct), `"r1 123"`, `"r-1 123"`, `"br. 123"` (all still
   correct), and the malformed-input case (still `null`) — plus the real `26515835.jpg` fixture
   content itself, which now correctly yields `"10752/310012/2"` instead of `"oj"`. A regression test
   was added to `croatian.test.ts`.
   Because this bug only affected a **newly written Task 08 test's fixture content**, not any
   pre-existing assertion, the fix was to change that fixture's content to a form the regex already
   handles correctly (`"Račun br. 381/1/3"`, matching `croatian.test.ts`'s known-good case) rather than
   asserting the buggy `"oj"` output as if it were intended behavior.
