# Task 11 — CSV & JSON export

**Date:** 2026-08-20
**Plan:** `.agents/plans/csv-json-export.md`
**Commit:** `000fc76`

## What was built

Confirmed receipts can now leave the PoC. `GET /api/receipts/export?format=csv|json` returns the
authenticated user's confirmed, non-deleted receipts, and the history page offers both downloads in
Croatian and English.

The serialization is a pure module (`api/src/export/receipts.ts`): `toCsv` produces a UTF-8 CSV with a
byte-order mark, CRLF rows, RFC 4180 escaping and OWASP formula neutralization; `toJsonExport`
produces a versioned envelope derived from the canonical schema. Neither touches I/O, so both are
tested offline.

The export scope is fixed at confirmed + non-deleted regardless of the history status filter, which
the UI states in copy rather than leaving the user to infer.

## Files created / modified

**Shared**

- `shared/src/api.ts`, `shared/src/api.test.ts`, `shared/src/index.ts`

**API**

- `api/src/export/receipts.ts` (new), `api/src/export/receipts.test.ts` (new)
- `api/src/repositories/receipts.ts`, `api/src/repositories/receipts.test.ts`
- `api/src/routes/receipts.ts`, `api/src/routes/receipts.integration.ts`

**Client**

- `client/src/history/download.ts` (new), `client/src/history/download.test.ts` (new)
- `client/src/api/client.ts`, `client/src/api/client.test.ts`
- `client/src/routes/HistoryPage.tsx`, `client/src/routes/HistoryPage.test.tsx`
- `client/src/i18n/locales/en.json`, `client/src/i18n/locales/hr.json`

**Documentation**

- `README.md`, `.claude/commands/validate.md`, `.agents/ROADMAP.md`, this history

## Decisions made

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | `/export` registered **above** `/:id` | Express matches in registration order and `idSchema` is `z.uuid()`, so a later registration answers `400 invalid_request` — a plausible-looking failure rather than a crash. Predicted by Task 10's history; now also enforced by `/validate` 6.15. |
| D2 | The export query pages internally (`EXPORT_PAGE_SIZE = 500`) | `supabase/config.toml` sets `max_rows = 1000`, which truncates a larger result **silently**. Ten lines removes the cap from the correctness argument. Terminating on a short page means the loop never issues an out-of-range `.range()`, so it cannot hit the `PGRST103` case `listPage()` must handle. |
| D3 | CSV `vatBreakdown` is one column of compact JSON | PRD §7.12 allows "flattened or serialized consistently". Indexed columns need an arbitrary rate cap; parallel pipe-joined columns pair by position and break when one rate lacks a base. JSON is lossless, uncapped and identical to the JSON export. |
| D4 | Formula neutralization applies to **text columns only** | A canonical negative total is `-12.50`; prefixing it with `'` would turn a number into text and break spreadsheet arithmetic. Money, date and timestamp columns are schema-validated (`AMOUNT_PATTERN`, `z.iso.*`) and cannot carry a formula. `currency` **is** neutralized — `z.string().length(3)` admits `=AB`. |
| D5 | UTF-8 BOM and CRLF | The definition of done is "opens correctly in a spreadsheet with Croatian characters intact"; Excel on Windows reads BOM-less UTF-8 in the system ANSI codepage and mangles `š č ć ž đ`. CRLF is RFC 4180 §2.1. |
| D6 | `schemaVersion` is the integer `1`, typed `z.literal(1)` | PRD §7.12 asks for "a simple schema/export version". A literal makes an accidental change a compile error. |
| D7 | JSON omits `userId` and `deletedAt`, derived with `.omit()` | `userId` is the caller's own id; `deletedAt` is `null` by definition of the scope. Deriving preserves the invariant that DTOs are never redeclared. |
| D8 | The client downloads via `request()` → `Blob` → object URL | A plain `<a href>` or `window.open` sends no `Authorization` header and would 401. Also required by `/validate` 6.9, which forbids a raw `fetch(` outside the API module. |

## Deviations from the plan

- **Neutralization covers more than the plan specified.** The implementation also treats a leading
  line feed and the full-width variants `＝ ＋ － ＠` as formula starts. Harmless and slightly more
  defensive than the OWASP set; kept.
- **`Content-Disposition` uses a fixed `receipts.csv`**, not the plan's dated filename, and is set
  only on the CSV branch. The client builds its own dated filename through `exportFilename()`, so the
  downloaded file is named correctly either way; the header only matters to someone calling the
  endpoint directly.
- **Five planned integration cases were condensed into two `it` blocks.** Coverage is complete —
  scope, ordering, BOM, neutralization, exact money, format rejection and 401 are all asserted.
- **`exporting` state is a `Set<ExportFormat>` rather than a single nullable format**, so a slow CSV
  download does not disable the JSON button. Better than the plan's version.

## Validation results

Full sweep, run against the working tree after the implementation handoff.

| Phase | Result |
| --- | --- |
| 0 — clean install | Not re-run; no dependency change in this task |
| 1 — `npm run lint` | Pass, zero errors |
| 2 — `npm run typecheck` | Pass, exit 0 |
| 3 — `npm run format:check` | **Failed initially**, then fixed — see below |
| 4 — `npm test` | Pass: 34 files, 330 tests |
| 4 — per project | `shared` 4/137, `api` 13/99, `client` 17/94 |
| 5 — `npm run build` | Pass; only the pre-existing >500 kB chunk advisory |
| 6 — security/config | All pass, including new 6.15 |
| 7a — Docker migrations | **Skipped, legitimately**: no file under `supabase/migrations/` changed |
| 7b — hosted integration | Pass: 8 repository, 3 auth, 14 route tests against `ssczfjvbeqyrlbasfyzj.supabase.co`; orphan check returned `[]` |
| 8.12 — export journey | Pass — API contract and browser UI, see below |

### Defect found and fixed during validation

**`npm run format:check` failed on `client/src/api/client.test.ts`.** The implementation handoff left
the file unformatted, so the repository was in a state `/validate` Phase 3 rejects. Fixed with
`npx prettier --write` on that file alone (22 lines reflowed, no logic touched); the full check then
reported `All matched files use Prettier code style!`.

### Live journey 8.12

Ports 3001 and 5173 were checked first: **3001 was held by a stale server** — the exact failure Phase
8.1 warns about — and was cleaned before anything else ran. Vite then reported 5173 under
`--strictPort`, so nothing was tested against stale code.

A disposable `task11-` user was seeded with three receipts chosen to exercise every rule the
definition of done names: one confirmed receipt carrying an adversarial seller name
(`=cmd|'/c calc'!A1 Trgovina "Šćžđ", Split` — a formula prefix, Croatian diacritics, an embedded
quote and an embedded comma), `documentNumber` `@381/1/3`, `paymentMethod` `-Gotovina`, a
trailing-zero `total` of `100.50`, two VAT rates and one line item; plus a `review` receipt and a
soft-deleted confirmed receipt that must not appear.

Verified against the real HTTP response, not a test double:

- `200`, `Content-Type: text/csv; charset=utf-8`. **This is also the route-ordering proof** — a
  shadowed route would have answered `400`.
- First three bytes are `EF BB BF`, the UTF-8 BOM.
- One CRLF, zero bare LFs, exactly one data row.
- `'=cmd|'/c calc'!A1 …`, `'@381/1/3` and `'-Gotovina` are all single-quote prefixed.
- The seller name is RFC 4180 quoted with its embedded quote doubled; `Šćžđ` survives intact.
- `100.50` and `80.40` appear verbatim — no float artifact, no lost trailing zero.
- `vatBreakdown` is one column of compact JSON carrying both rates.
- Neither the `review` nor the soft-deleted receipt appears.
- JSON: `schemaVersion: 1`, `userId` and `deletedAt` absent, VAT nested, line items present (they are
  deliberately absent from CSV v1), and a scan for Azure vocabulary
  (`azure`, `prebuilt`, `valueCurrency`, `valueNumber`, `boundingRegions`, `modelId`, `polygon`,
  `docType`) returned **no hits**.
- Error paths: a missing `format` and `format=xml` both return `400 invalid_request`; no token
  returns `401 unauthorized`.

Then in the browser at a 375 × 667 viewport, signed in as that user:

- The history page renders the Export panel with its heading, the "Confirmed receipts only." hint and
  both download buttons. The soft-deleted receipt is absent from the list; the `review` one is
  present but, per the export scope, absent from both downloads.
- Clicking **Download CSV** and **Download JSON** each issued a real authenticated request —
  `GET /api/receipts/export?format=csv` and `?format=json`, both `200` — with **zero page errors**,
  which is what proves the `URL.createObjectURL` download path executes rather than throwing.
- Croatian: `Izvoz`, `Samo potvrđeni računi.`, `Preuzmi CSV`, `Preuzmi JSON` — diacritics correct, no
  mojibake, and the adversarial seller name renders as literal text in the list rather than being
  interpreted.
- Layout: `document.documentElement.scrollWidth` is 375 against a 375 px viewport in both languages,
  so there is no horizontal overflow, and both export buttons measure exactly 44 px tall (PRD §11.5).
- The API log for the whole run contains no seller name, total, receipt content or signed URL across
  all ten export requests (PRD §9.4).

The disposable user and its rows were deleted afterwards; the orphan check returned `[]`.

## Known gaps / follow-ups

- **The spreadsheet leg of journey 8.12 was verified by byte inspection, not by opening Excel.** The
  BOM (`EF BB BF`), CRLF rows, RFC 4180 escaping and the diacritics were all confirmed in the actual
  response bytes, which is what determines how a spreadsheet reads the file — but no human opened the
  CSV in Excel or LibreOffice. Worth doing once by hand before the PoC is presented.
- **`agent-browser set viewport` hangs indefinitely when no browser session is open.** It produced no
  output for four minutes and had to be killed. Running `agent-browser open <url>` first, then
  `set viewport`, works immediately. Worth remembering for every later browser journey.
- Task 09's duplicate source-panel signed-URL request and two-query detail polling remain open,
  unchanged by this task, for Task 12.
- Task 06's real-phone camera journey remains deferred until the prototype is hosted.
- Azure's measured latency tail (65 s against two 60 s timeouts, Task 09) is untouched and still owned
  by Task 12.
