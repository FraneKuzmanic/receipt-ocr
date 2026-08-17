# Task 01 — Monorepo scaffold, app shell & i18n

**Date:** 2026-08-16 → 2026-08-17
**Plan:** `.agents/plans/monorepo-scaffold-app-shell-i18n.md`
**Commit:** `b965482` — 56 files, 9639 insertions

## What was built

A runnable, lintable, testable TypeScript monorepo with nothing receipt-specific in it. Three npm
workspaces — a React 19 + Vite client, an Express 5 API, and a `shared` package holding types both
consume — wired together with TypeScript project references so cross-package type errors are caught
by the compiler rather than at runtime.

The scaffold ends in one thin vertical slice rather than placeholder exports: `HEALTH_PATH` and
`HealthResponse` are defined once in `shared/`, the API mounts the route at that constant and returns
that type, and the client fetches the same constant and renders the result. If the home page shows
the service as available, then workspaces, project references, the shared contract, the Vite dev
proxy, the router, i18n and the component primitives are all demonstrably working.

Croatian and English translations are in place from the first screen, with translation keys typed
against `en.json` so an unknown key is a compile error, and a test asserting the two locales have
identical key sets. Retrofitting i18n later would have been far more expensive.

## Files created / modified

**Root:** `package.json`, `package-lock.json`, `tsconfig.base.json`, `tsconfig.json` (solution),
`vitest.config.ts` (projects), `.oxlintrc.json`, `.prettierrc.json`, `.prettierignore`,
`.editorconfig`, `.nvmrc`, `.gitignore`, `.env.example`, `README.md`

**`shared/`** (`@receipt/shared`): `package.json`, `tsconfig.json`, `src/health.ts`, `src/index.ts`

**`api/`** (`@receipt/api`): `package.json`, `tsconfig.json`, `tsconfig.test.json`,
`vitest.config.ts`, `src/index.ts`, `src/app.ts`, `src/config.ts`, `src/logger.ts`,
`src/routes/health.ts`, `src/middleware/error-handler.ts`, `src/app.test.ts`

**`client/`** (`@receipt/client`): `package.json`, `tsconfig.json`, `tsconfig.node.json`,
`vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`,
`src/vite-env.d.ts`, `src/api/client.ts`, `src/i18n/index.ts`, `src/i18n/locales/{en,hr}.json`,
`src/components/{AppLayout,LanguageSwitcher,Spinner,ErrorMessage}.tsx`,
`src/routes/{HomePage,NotFoundPage}.tsx`, `src/test/setup.ts`, `src/i18n/i18n.test.ts`,
`src/components/LanguageSwitcher.test.tsx`

**Also created:** `.claude/commands/validate.md` (the `/validate` command), this history file, and
`.env` (git-ignored, holds the real Azure credentials).

**Modified:** `.agents/ROADMAP.md` — two locked-decision amendments, see below.

> Note: `.claude/` is listed in `.gitignore`, so `validate.md` is **not** tracked. Flagged to the
> user twice; left as-is because it was a pre-existing choice. Revisit if `/validate` should be
> shared between machines.

## Decisions made

1. **oxlint instead of ESLint + typescript-eslint.** Forced by TypeScript 7 being the native Go port,
   which no longer exports the JS compiler API from its main entry (`Object.keys(require("typescript"))`
   has 2 entries and no `createProgram`). `typescript-eslint` peers on `<6.1.0` and has no v9, so it
   cannot function. `tsc --build` under `strict` + `noUncheckedIndexedAccess` is the authoritative
   type gate. **Do not reinstate ESLint without revisiting this** — it is documented in `README.md`
   so a future session does not "fix" it.
2. **One shared package, not two.** PRD §6.7 lists both `packages/domain` and `packages/shared`.
   That is one too many for a PoC: the canonical model and the API DTOs always travel together and
   would import each other constantly. Task 02 puts the canonical receipt model into `shared/` and no
   `domain` package is ever created. Recorded as an amendment in ROADMAP §2.
3. **Flat workspace layout, `client` not `web`.** The user found `apps/` + `packages/` unfamiliar.
   The wrappers were dropped so the three workspaces sit flat at the repo root. `src/` was proposed
   and **rejected**: it conventionally means one package's own sources and would have produced
   `src/api/src/`. Because cross-workspace imports use the package name, the entire restructure
   touched **zero** source imports — a property worth preserving.
4. **Root `prepare` script** runs `tsc --build shared`. The client imports `HEALTH_PATH` as a runtime
   value, so `shared/dist` must exist before `npm run dev` or `npm test` on a clean clone.
5. **Explicit Vitest imports, not `globals: true`.** Avoids adding `vitest/globals` to `types` and
   keeps `strict` honest.
6. **Errors return a stable machine `code`**, never prose (`{"error":{"code":"not_found"}}`). The
   client translates codes, which keeps PRD §7.13 true for error states. 4xx logs at `warn` without a
   stack; only 5xx logs the error object.
7. **Prettier ignores `*.md`.** See deviations — this was a reaction to real damage.

## Deviations from the plan

- **`packages/domain` never created** (planned and agreed) — Task 02 owns the canonical model, and an
  empty package would be speculative scaffolding.
- **`apps/`/`packages/` → flat `client`/`api`/`shared`, and `@receipt/web` → `@receipt/client`.**
  Not in the plan; requested mid-task. See decision 3.
- **Added `api/vitest.config.ts`** — the root `projects` array needs a config per project.
- **Added `api/tsconfig.test.json`** and excluded `*.test.ts` from `api/tsconfig.json`, because test
  files were being compiled into `api/dist/`. The extra config keeps them typechecked while keeping
  the build output clean. Same pattern as `client/tsconfig.node.json`, which is referenced from the
  solution file so it is not dead config.
- **Dropped `nav.home` and `errors.unknown`** from both locale files, and `VITE_API_BASE_URL` from
  `.env.example`. The plan listed them but nothing used them (CLAUDE.md §2).
- **Skipped conditional `pino-pretty`** — unrequested configurability.
- **`pino-http` uses its named export**, not default: under `nodenext` the default import resolves to
  the module namespace and is not callable.
- **`client/src/vite-env.d.ts` added** — without the `vite/client` reference, `import "./index.css"`
  does not typecheck.
- **`prettier --write .` rewrote `PRD.md`, `CLAUDE.md`, `ROADMAP.md` and the plan file.** Content
  survived intact (only markdown tables were re-padded; `PRD.md` and `CLAUDE.md` kept identical line
  counts), so they were not retyped — that risked real corruption for a cosmetic gain. Root cause
  fixed: `.prettierignore` now excludes `*.md`. **Do not remove that exclusion.**
- **`agent-browser` added as a root dev dependency** to run the plan's manual browser checks. Its
  npm `postinstall` is blocked by npm's `allow-scripts` gate, which is why `npx agent-browser` hangs
  forever with no output. Fix without changing global npm trust:
  `node node_modules/agent-browser/scripts/postinstall.js`.
- **`server.listen` error handler added to `api/src/index.ts`.** Not planned. A port clash produced a
  raw unhandled stack trace; it now logs `port already in use …` and exits 1.

## Validation results

`/validate` run end-to-end. All phases pass.

```
Phase 0  clean install ... 294 packages, 0 vulnerabilities, no ERESOLVE
Phase 1  lint (oxlint) ... PASS
Phase 2  typecheck ....... PASS (exit 0)
Phase 3  format:check .... PASS
Phase 4  tests ........... 3 files, 7 tests passed
Phase 5  build ........... index.html 0.39 kB · CSS 9.02 kB · JS 286.45 kB
Phase 6  security/docs ... 6.1, 6.1b, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7 all ok
Phase 7  journeys ........ 7.1–7.4 all pass
```

Phase 7.4 verified in real Chrome at 375×812: translated copy with no raw keys, service shown as
available, HR/EN toggle switches all copy, choice persists across reload (`lang="hr"`,
`i18nextLng: hr`), tap targets 44–45 px, no horizontal overflow, translated not-found page, and
offline → retry → recovery with zero page errors.

Also verified: `GET /api/health` returns exactly `{status:"ok", uptimeSeconds:number}` with no extra
keys, on a freshly started process; the `EADDRINUSE` path exits 1 with a clear message;
`--project api` and `--project client` both run.

### Two bugs the test suite could not catch

1. **Stale Vitest project name.** After the rename, `client/vitest.config.ts` still said
   `name: "web"`, so `npx vitest run --project client` failed. `npm test` runs every project
   regardless of name, so it stayed green. Found only by testing a command the README documents.
2. **Orphaned dev servers producing false passes.** Stopping `npm run dev` kills the `run-p` parent
   but not its children; `tsx watch` in particular survives, keeps watching `api/` (which blocks
   renaming that folder) and does not hold a port, so port-based cleanup misses it. At one point
   **12 orphans** were alive and a stale Vite on 5173 answered a proxy check while the current Vite
   had silently moved to 5176 — meaning that check was passing against old code. A documentation
   check was likewise answered by a 27-minute-old API before being redone on a fresh process.
   **Lesson for every later task: before any live check, confirm the ports are free and that Vite
   reports 5173.** `/validate` Phase 7.1 now includes the cleanup command; `README.md` documents it.

## Known gaps / follow-ups

- **Not verified:** nothing outstanding for Task 01. All plan validation steps were executed.
- ~~**`.claude/` is git-ignored**, so `.claude/commands/validate.md` is untracked. Decide whether
  `/validate` should be version-controlled.~~ **Resolved after Task 01 closed:** `.claude/` was
  removed from `.gitignore` and committed in `4f00f38`, so `/validate` now travels with a clone.
- **No Playwright yet** — PRD §8 lists it but there are no user journeys to test. Task 12 owns E2E.
- **No state-management or data-fetching library** — one `useEffect` covers the health check. Add one
  only when a task needs it.
- **oxlint has no type-aware rules** (`no-floating-promises` and similar are unavailable). Revisit if
  `typescript-eslint` ships TypeScript 7 support.
- **Azure credentials are live in `.env`** (git-ignored). They were briefly pasted into
  `.env.example`, which **is** committed by design; caught before any commit, so no rotation was
  needed. `/validate` Phase 6.1b now fails the build if any non-default value appears there.
- **Task 02 next:** canonical domain model in `shared/`, and the deferred decision on a decimal
  library vs. hand-rolled string helpers for money.
