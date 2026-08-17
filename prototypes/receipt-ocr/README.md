# Mobile Receipt Capture & OCR PoC

A mobile-first web application for digitizing Croatian retail receipts. A user photographs or uploads
a receipt, the backend extracts structured data with Azure Document Intelligence, and the user
reviews, corrects and confirms the result before exporting it as CSV or JSON.

OCR output is treated as a draft, never as authoritative accounting data — the human confirms the
final record. See [`PRD.md`](PRD.md) for the full product specification and
[`.agents/ROADMAP.md`](.agents/ROADMAP.md) for the implementation plan.

> **Status:** Task 02 of 12. `shared/` now holds the canonical receipt model, decimal-safe money and
> the warning taxonomy, but nothing stores or extracts a receipt yet — the only endpoint is still the
> health check. Persistence arrives in Task 03, upload in Task 05, Azure extraction in Task 07.

## Prerequisites

- **Node.js 24 LTS** (`.nvmrc` pins `24`; anything older fails the `engines` check)
- **npm 10+** (ships with Node 24)

## Setup

```bash
npm install
cp .env.example .env
```

`npm install` also builds `shared` via the `prepare` script, so the workspaces resolve each
other immediately. `.env` is git-ignored; `.env.example` lists every variable name with no values.

> Do not run the copy step if `.env` already exists — it will overwrite credentials you have
> already filled in.

No credentials are needed yet: every variable has a working default, so `npm run dev` works on a
fresh clone even with an empty `.env`. Azure values are needed from Task 07, Supabase from Task 03.

## Running

```bash
npm run dev
```

- Client: <http://localhost:5173>
- API: <http://localhost:3001>

Vite proxies `/api` to the API in development, so the browser only ever talks to one origin locally.

The API fails fast and clearly if its port is taken:

```text
"msg":"port already in use — another server is still running; stop it or set PORT"
```

Vite behaves differently — it silently moves to 5174, 5175, and so on. **If Vite reports a port other
than 5173, a previous dev server is still holding it, and you will be testing stale code.** Stopping
`npm run dev` does not reliably kill its children: the `tsx watch` process in particular survives,
keeps watching `api/`, and blocks renaming or deleting that folder. Kill the stragglers first:

```powershell
foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force } }
```

Note that this only catches processes holding a port. A `tsx watch` that lost its port still lingers;
find those with `Get-Process node`.

## Scripts

All scripts run from the repository root.

| Script                 | What it does                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run dev`          | Starts the client and the API concurrently                         |
| `npm run dev:client`   | Starts only the client (Vite)                                      |
| `npm run dev:api`      | Starts only the API (`tsx watch`)                                  |
| `npm run build`        | Compiles all workspaces, then bundles the client                   |
| `npm run typecheck`    | `tsc --build` across the project references — the type gate         |
| `npm run lint`         | oxlint                                                             |
| `npm run format`       | Prettier, writing changes                                          |
| `npm run format:check` | Prettier, check only                                               |
| `npm test`             | Vitest across `shared` (node), `api` (node) and `client` (jsdom)    |
| `npm run validate`     | typecheck → lint → format:check → test                             |

`npm run validate` is the gate to run before committing. To test one workspace only:
`npx vitest run --project shared`, `--project api` or `--project client`. Run those occasionally even
though `npm test` covers them: `npm test` runs every project regardless of its configured `name`, so
only a per-project run catches a stale project name.

## API

| Method | Path          | Response                                     |
| ------ | ------------- | -------------------------------------------- |
| `GET`  | `/api/health` | `200 {"status":"ok","uptimeSeconds":number}`  |

The path and response type are defined once in `shared/src/health.ts` (`HEALTH_PATH`,
`HealthResponse`) and imported by both sides, so a change to either breaks the build rather than
production.

**Error convention — every task follows this.** Failures return a stable machine `code`, never prose:

```json
{ "error": { "code": "not_found" } }
```

The client translates codes into `hr`/`en` copy, which is how PRD §7.13 stays true for error states
too. Server faults (5xx) are logged with the error object; client errors (4xx) are logged at `warn`
without a stack trace, so a URL scanner cannot flood the error log.

That body is not a convention held up by prose: `api/src/middleware/error-handler.ts` types it as
`ApiErrorResponse` from `@receipt/shared`, so a route that invents a different error shape fails to
compile. The endpoints for PRD §10 do not exist yet, but their request and response schemas already
do — see **Domain model** below.

## Workspace layout

Three npm workspaces, flat at the repository root:

```text
client/    React 19 + Vite mobile-first web app   (@receipt/client)
api/       Express 5 API — routes, middleware, config, logging   (@receipt/api)
shared/    Canonical receipt model, money, dates, warnings, API DTOs   (@receipt/shared)
```

`shared/` is the reason this is a workspace repo rather than two unrelated folders: the canonical
receipt model and its Zod schemas are defined once and used by both the API (request validation,
mapping, persistence) and the client (review-form validation). Duplicating that model is how a mapper
and a form silently drift apart.

Cross-workspace imports always use the package name (`@receipt/shared`), never a relative path into
another workspace. That is what keeps the folders renameable without touching a single import.

## Domain model

`shared/` owns one definition of a receipt, provider-independent by design: no Azure vocabulary may
appear anywhere in it, and `shared/src/receipt.test.ts` fails the build if it does (PRD §6.2).

Zod schemas are the source of truth and the TypeScript types are inferred from them, so a schema and
its type cannot drift.

### Money is a string, never a number

Canonical money is a plain decimal string — `"100.50"` — matching `^-?\d+(\.\d+)?$`: no grouping
separators, no currency, no exponent, and **trailing zeros preserved**. `100.50` that comes back as
`100.5` is a bug; a total must export as exactly what was confirmed.

`shared/src/money.ts` sets `Big.strict = true`, which makes `Big` throw if a JS `number` is ever
passed in. That turns "money is never a JS float" from a convention into a runtime guarantee.

- `parseAmount` reads what a receipt actually shows — Croatian `1.234,56`, English `1,234.56`,
  currency symbols and codes, non-breaking spaces, and negatives written `-12,50`, `12,50-` or
  `(12,50)`. It returns `null` for anything it cannot read and **never throws**: an unreadable value
  is a missing value, and missing stays missing rather than being guessed (PRD §7.7).
- `addAmounts` works at the wider of its two arguments' scales, so `100.50 + 0.00` is `100.50`.
- `formatAmount` delegates to `Intl.NumberFormat`, passing the **string**. That preserves arbitrary
  precision; passing a number would corrupt large values.

**Known limitation — the `1.234` ambiguity.** A single separator with exactly three digits after it
is genuinely ambiguous: `"1.234"` and `"1,234"` could each be 1234 or 1.234. Both resolve to
**1234**, because a thousands group is far more common on a receipt than a three-decimal price. This
is a deliberate, lossy judgement call and it will occasionally be wrong — a weight in kilograms is
the realistic case. Task 12's evaluation should watch for it in real receipts.

### Dates and times

A receipt date is a local wall-clock date with no timezone, so it is carried as a string:
`yyyy-mm-dd` for the date, `HH:mm` or `HH:mm:ss` for the time. `shared/src/datetime.ts` normalizes
Croatian forms (`17.08.2026.`, day-first) and validates the calendar by hand, including leap years.

Two rules that matter:

- **Seconds are never padded on.** A receipt showing `14:30` normalizes to `14:30`, not `14:30:00`;
  inventing the second would be inventing data.
- **`Date.parse` and `new Date(string)` are not used, anywhere in that module.** `Date.parse` returns
  `NaN` for `"17.08.2026."`, and reads `"08/17/2026"` as the day *before* in any timezone behind UTC
  — a plausible-looking answer that is silently wrong.

### The two-tier schema split

The receipt schema comes in two tiers, and the split is load-bearing:

- `canonicalReceiptFieldsSchema` — everything the user may edit in the review form.
- `canonicalReceiptSchema` — that, extended with the server-owned envelope: `id`, `userId`, `status`,
  `warnings`, timestamps.

Every DTO in `shared/src/api.ts` is *derived* rather than redeclared. The PATCH body is
`canonicalReceiptFieldsSchema.partial()`, and because Zod's `.strict()` survives `.partial()`,
`.extend()`, `.pick()` and `.omit()`, that body is structurally incapable of accepting a `userId`.
"Never trust a client-supplied `userId`" (PRD §9.1) is therefore a property of the type system rather
than a rule a route has to remember. **Do not flatten the two tiers into one schema.**

### Warnings

`shared/src/warnings.ts` holds the warning **taxonomy** — a stable machine code plus the dotted field
path it concerns. The rules that decide when a warning applies land in Task 08.

Warning **messages** live in the client locale files, not in `shared`, matching the error convention
above: the server emits a code, the client owns the human copy. Every code needs an `hr` and an `en`
message, enforced by `client/src/i18n/warnings.test.ts` — `/validate` Phase 6.5 cannot catch this
one, because the review form will render these with a template literal rather than a literal key.

Warnings are informational and must never block confirmation (PRD §7.8).

### What `@receipt/shared` exports

Everything below is re-exported from the package root, so `import { … } from "@receipt/shared"` is
always the right form — never a deep path into `shared/src`. Each schema also exports its inferred
type under the obvious name (`canonicalReceiptSchema` → `CanonicalReceipt`).

| Module | Exports |
| --- | --- |
| `shared/src/money.ts` | `AMOUNT_PATTERN`, `isAmount`, `parseAmount`, `addAmounts`, `compareAmounts`, `amountsEqual`, `formatAmount` |
| `shared/src/datetime.ts` | `ISO_DATE_PATTERN`, `ISO_TIME_PATTERN`, `parseIssueDate`, `parseIssueTime` |
| `shared/src/warnings.ts` | `WARNING_CODES`, `warningCodeSchema`, `receiptWarningSchema` |
| `shared/src/receipt.ts` | `RECEIPT_STATUSES`, `receiptStatusSchema`, `vatBreakdownSchema`, `receiptItemSchema`, `canonicalReceiptFieldsSchema`, `canonicalReceiptSchema` |
| `shared/src/api.ts` | `apiErrorResponseSchema`, `createReceiptResponseSchema`, `listReceiptsQuerySchema`, `listReceiptsResponseSchema`, `updateReceiptRequestSchema`, `confirmReceiptResponseSchema`, `EXPORT_FORMATS`, `exportFormatSchema` |
| `shared/src/health.ts` | `HEALTH_PATH`, `HealthResponse` |

Two DTOs are deliberately **absent** and should not be invented ahead of their task: the
source-document access shape for `GET /api/receipts/:id/source` (Task 05) and the export body's
`schemaVersion` (Task 11). `GET /api/receipts/:id` returns `canonicalReceiptSchema` as it stands.

### Adding tests to `shared`

`shared/tsconfig.json` excludes `src/**/*.test.ts` from the build so test files never land in
`shared/dist/` and ship inside the package surface. They are still typechecked, by the sibling
`shared/tsconfig.test.json`, which is listed in the root `tsconfig.json` references — **a project
config missing from that list is never typechecked at all**, so broken test files would pass silently.
`api/` uses the identical pattern. One difference worth knowing: the `shared` build config sets
`"types": []` to keep the package browser-safe, while its test config sets `"types": ["node"]`,
because tests run in Node.

## Toolchain notes

**The linter is oxlint, not ESLint. Do not reinstate ESLint without reading this.**

The PRD mandates TypeScript 7, which is the native Go port of the compiler. TypeScript 7 no longer
exports the JavaScript compiler API from its main entry point:

```console
$ node -e "const ts=require('typescript'); console.log(Object.keys(ts).length, typeof ts.createProgram)"
2 undefined
```

`typescript-eslint` is built entirely on that API and declares a peer range of `>=4.8.4 <6.1.0`.
There is no v9 release. Installing it under TypeScript 7 produces a package that cannot function.
oxlint parses TypeScript and JSX directly and has no `typescript` peer dependency.

The trade-off is that oxlint offers no type-aware rules (`no-floating-promises` and friends).
`tsc --build` under `strict` with `noUncheckedIndexedAccess` is the authoritative type gate and
covers most of that ground. If `typescript-eslint` ships TypeScript 7 support later, revisiting this
is cheap.

**The decimal library is `big.js`, not `decimal.js`.** This is the same class of trap. `decimal.js`
merges a class, a namespace and a function under one name in its type declarations and re-exports it
as `export default`; TypeScript 7 resolves that default to the non-constructable member:

```ts
import Decimal from "decimal.js"; // error TS2351: This expression is not constructable.
```

`big.js` typechecks either way and is **58 KB installed** (measured), where the `decimal.js` probe
during planning measured ~5.9 MB — and this dependency is bundled into the browser build. `Big.strict`
gives the float guarantee described under **Domain model**. This PoC only ever adds, compares and
formats money, so arbitrary-precision transcendental functions buy nothing.

One related gap: TypeScript's bundled lib still types `Intl.NumberFormat#format` as taking only a
`number`, including under `ESNext.Intl`, even though the runtime has accepted strings since ES2023
and Node 24 honours it. `shared/src/money.ts` declares that capability in one narrow local interface
rather than widening the project's `lib`.

Three smaller conventions worth knowing:

- **`react-router`, never `react-router-dom`.** v8 consolidated into the single package;
  `react-router-dom` is frozen at 7.18.2.
- **Module resolution differs by workspace.** `api` and `shared` use `nodenext`, so
  relative imports need a `.js` extension even in `.ts` source. `client` uses `bundler`
  resolution, where extensionless imports are correct.
- **Prettier does not touch `*.md`.** Markdown tables in the PRD and roadmap are hand-aligned;
  letting Prettier reflow them creates noise in every diff.

## Internationalization

The UI ships in Croatian (`hr`) and English (`en`). The initial language comes from the browser and
is overridable with the header switcher, which persists the choice to `localStorage`.

Resources live in `client/src/i18n/locales/en.json` and `client/src/i18n/locales/hr.json`. Keys are
namespaced by feature (`common.*`, `home.*`, `errors.*`, `warnings.*`) so later tasks can add
`capture.*`, `review.*` and `history.*` without collision.

**No user-facing string may be hardcoded in any component** (PRD §7.13). Translation keys are typed
against `client/src/i18n/locales/en.json` via a `CustomTypeOptions` augmentation, so an unknown key
is a compile error.

Two tests guard the locale files, and both are load-bearing:

- `client/src/i18n/i18n.test.ts` — `hr` and `en` have identical key sets and no empty values. If it
  fails, translate the missing key rather than deleting it from the other file.
- `client/src/i18n/warnings.test.ts` — every code in `WARNING_CODES` has a non-empty message in both
  languages, and no orphan message exists. This one exists because `/validate` Phase 6.5 only sees
  translation calls whose key is a string literal; warnings will be rendered from a template literal
  built out of the code, which that scan cannot follow.

## Configuration

Every variable lives in a single `.env` at the repository root, read by `api/src/config.ts`, which
validates it at startup and reports **all** invalid variables at once rather than failing on the
first.

| Variable                               | Default                 | Notes                    |
| -------------------------------------- | ----------------------- | ------------------------ |
| `PORT`                                 | `3001`                  | API port                 |
| `NODE_ENV`                             | `development`           | `development` \| `test` \| `production` |
| `LOG_LEVEL`                            | `info`                  | pino level, or `silent`  |
| `WEB_ORIGIN`                           | `http://localhost:5173` | CORS allow-list origin   |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | —                       | Task 07, server-only     |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY`      | —                       | Task 07, **server-only** |
| `DATABASE_URL`                         | —                       | Task 03                  |
| `SUPABASE_URL`                         | —                       | Task 03                  |
| `SUPABASE_SERVICE_ROLE_KEY`            | —                       | Task 03, **server-only** |
| `SUPABASE_ANON_KEY`                    | —                       | Task 03                  |
| `STORAGE_BUCKET`                       | —                       | Task 03                  |

Two rules that are enforced, not merely documented:

1. **Only `VITE_`-prefixed variables reach the browser bundle.** Azure keys and the Supabase service
   role key must never gain that prefix. There are currently no `VITE_` variables at all.
2. **`.env.example` holds names only, never real values.** It is deliberately *not* git-ignored —
   it is the committed template — so a value pasted into it goes straight into git history, where
   deleting it later does not remove it. Only the harmless local defaults (`PORT`, `NODE_ENV`,
   `LOG_LEVEL`, `WEB_ORIGIN`) may carry a value. Real credentials belong in `.env`.

Both rules are checked by `/validate` Phase 6. If a credential ever does reach a commit, rotate it —
removing it in a later commit is not sufficient.

## Logging

`api/src/logger.ts` configures pino with redaction for `authorization` and `cookie` headers and any
`*.file` or `*.signedUrl` field (PRD §9.4). Receipt images, extracted receipt contents and signed
URLs must never be logged. That redaction list is inherited by every later task — extend it rather
than working around it.
