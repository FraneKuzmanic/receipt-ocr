# Mobile Receipt Capture & OCR PoC

A mobile-first web application for digitizing Croatian retail receipts. A user photographs or uploads
a receipt, the backend extracts structured data with Azure Document Intelligence, and the user
reviews, corrects and confirms the result before exporting it as CSV or JSON.

OCR output is treated as a draft, never as authoritative accounting data — the human confirms the
final record. See [`PRD.md`](PRD.md) for the full product specification and
[`.agents/ROADMAP.md`](.agents/ROADMAP.md) for the implementation plan.

> **Status:** Task 01 of 12 — the scaffold. There is no receipt functionality yet. The only endpoint
> is a health check, which exists to prove that a type defined once in `shared/` is honoured by both
> the API and the client.

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

Task 01 needs no credentials: every variable has a working default, so `npm run dev` works on a
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
| `npm test`             | Vitest across the `api` (node) and `client` (jsdom) workspaces      |
| `npm run validate`     | typecheck → lint → format:check → test                             |

`npm run validate` is the gate to run before committing. To test one workspace only:
`npx vitest run --project api` or `--project client`.

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

## Workspace layout

Three npm workspaces, flat at the repository root:

```text
client/    React 19 + Vite mobile-first web app   (@receipt/client)
api/       Express 5 API — routes, middleware, config, logging   (@receipt/api)
shared/    Types shared by client and api   (@receipt/shared)
```

`shared/` is the reason this is a workspace repo rather than two unrelated folders: the canonical
receipt model and its Zod schemas are defined once and used by both the API (request validation,
mapping, persistence) and the client (review-form validation). Duplicating that model is how a mapper
and a form silently drift apart. The canonical model lands there in Task 02.

Cross-workspace imports always use the package name (`@receipt/shared`), never a relative path into
another workspace. That is what keeps the folders renameable without touching a single import.

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
namespaced by feature (`home.*`, `common.*`, `errors.*`) so later tasks can add `capture.*`,
`review.*` and `history.*` without collision.

**No user-facing string may be hardcoded in any component** (PRD §7.13). Translation keys are typed
against `client/src/i18n/locales/en.json` via a `CustomTypeOptions` augmentation, so an unknown key
is a compile error, and
`client/src/i18n/i18n.test.ts` asserts `hr` and `en` have identical key sets with no empty values.
That test is the guard that stops a language being left behind — if it fails, translate the missing
key rather than deleting it from the other file.

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
