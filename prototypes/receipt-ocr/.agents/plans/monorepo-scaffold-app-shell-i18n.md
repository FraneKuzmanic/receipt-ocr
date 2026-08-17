# Feature: Monorepo Scaffold, App Shell & i18n (Task 01)

The following plan should be complete, but it's important that you validate documentation and codebase
patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **This plan's version matrix was empirically verified against the live npm registry on 2026-08-16**,
> including real install probes and compile runs. Do not "upgrade" or "correct" the pinned versions
> from memory — several of them are counter-intuitive (see [Critical Finding](#critical-finding-typescript-7-breaks-typescript-eslint)).

---

## Feature Description

Build the foundation the other eleven roadmap tasks sit on: a TypeScript monorepo containing a
mobile-first React web application and an Express API, wired together with shared types, a working
toolchain (typecheck, lint, format, test), and Croatian/English internationalization from the very
first screen.

Nothing in this task is receipt-specific. Its entire value is that every later task — the domain
model, Supabase, auth, upload, Azure extraction, review, export — starts from a repository that
builds, typechecks, lints, tests and runs both applications with one command.

The i18n foundation is deliberately part of this task rather than a later one. PRD §7.13 requires all
user-facing copy to be externalized, and retrofitting translation onto screens built with hardcoded
strings is far more expensive than starting correctly.

## User Story

As a developer building the receipt OCR PoC
I want a monorepo where the web app and API share types and both run with a single command
So that every subsequent feature task starts from a working, verifiable baseline instead of
re-litigating tooling.

## Problem Statement

The repository currently contains only `PRD.md`, `CLAUDE.md`, `.claude/` and `.agents/`. There is no
application code, no package manager setup, no build tooling and no test runner. No feature work can
begin, and there is no way to validate anything.

Compounding this, the PRD's technology baselines (Appendix D, verified 8 Aug 2026) specify
**TypeScript 7.x**, which is the native Go port of the compiler. TypeScript 7 removed the JavaScript
compiler API from the package's main export, which silently breaks a large part of the conventional
TypeScript tooling ecosystem — most importantly `typescript-eslint`. A scaffold built on the standard
"ESLint + typescript-eslint" assumption will fail to install or, worse, install and then fail at
runtime. This must be resolved in the scaffold, not discovered in Task 07.

## Solution Statement

Create an npm-workspaces monorepo with three workspaces (`apps/web`, `apps/api`, `packages/shared`)
using TypeScript project references so the web app and API share compile-time types with real
cross-package typechecking.

For the toolchain, replace ESLint + typescript-eslint with **oxlint**, which lints TypeScript and JSX
natively without depending on the TypeScript compiler API, and therefore works with TypeScript 7.
Type-level correctness is enforced separately by `tsc --build`, which is the authoritative typechecker
regardless of linter choice. This keeps full type safety while avoiding a dependency that is
fundamentally incompatible with the PRD's mandated compiler.

Prove the wiring end-to-end with one genuinely-used shared contract — the `/api/health` response type,
defined once in `packages/shared`, served by the API and consumed by the web app — rather than
placeholder exports that exist only to make the build graph non-empty.

## Feature Metadata

**Feature Type**: New Capability (greenfield scaffold)
**Estimated Complexity**: Medium — low conceptual difficulty, high configuration-surface risk
**Primary Systems Affected**: entire repository (new)
**Dependencies**: Node.js 24 LTS, npm 10+. No external services, no credentials, no network access at
runtime. Supabase and Azure are **not** touched in this task.

---

## CRITICAL FINDING: TypeScript 7 breaks typescript-eslint

**Read this before writing any configuration.** This was verified empirically, not inferred.

TypeScript 7.0.2 is the native Go port. Its `package.json` exports are:

```json
{
  "exports": {
    ".": "./lib/version.cjs",
    "./unstable/sync": "./dist/api/sync/api.js",
    "./unstable/async": "./dist/api/async/api.js",
    "./unstable/ast": "./dist/ast/index.js"
  },
  "bin": { "tsc": "./bin/tsc" }
}
```

The root export resolves to `version.cjs` only. Verified at runtime:

```console
$ node -e "const ts=require('typescript'); console.log(Object.keys(ts).length, typeof ts.createProgram)"
2 undefined
```

The compiler API (`createProgram`, `TypeChecker`, the whole surface `typescript-eslint` is built on) is
**absent from the main export** and available only behind explicitly `unstable/*` subpaths. The actual
compiler ships as per-platform native binaries (`@typescript/typescript-win32-x64` etc.) that `tsc`
spawns.

Consequently:

| Package                     | Latest | TypeScript peer range | Works with TS 7? |
| --------------------------- | ------ | --------------------- | ---------------- |
| `typescript-eslint`         | 8.67.0 | `>=4.8.4 <6.1.0`      | ❌ **No**        |
| `@typescript-eslint/parser` | 8.67.0 | `>=4.8.4 <6.1.0`      | ❌ **No**        |

There is **no `typescript-eslint` v9**; `npm view typescript-eslint versions` contains no 9.x or 10.x
release, and `dist-tags` are only `latest: 8.67.0` and `canary: 8.67.1-alpha.4`. The peer range is
accurate and intentional, not conservative lag. Forcing the install with `--legacy-peer-deps` produces
a package that cannot function, because the API it imports does not exist.

**Decision: use `oxlint` (1.78.0).** It is a Rust-based linter that parses TypeScript and JSX directly,
has no `typescript` peer dependency, and needs no configuration to be useful. Verified working:

```console
$ npx oxlint src/
src/bad.ts:2:9: warning eslint(no-unused-vars): Variable 'unused' is declared but never used.
```

**Trade-off, stated honestly:** oxlint does not perform type-aware linting, so rules like
`no-floating-promises` and `no-unsafe-argument` are unavailable. This is an acceptable PoC trade-off
because (a) `tsc --build` under `strict: true` remains the authoritative type gate and catches the
large majority of what type-aware rules would, and (b) the alternative is downgrading to TypeScript 5.x,
which contradicts PRD Appendix D. **Do not silently substitute ESLint back in.** If you believe this
decision is wrong, raise it with the user before implementing (CLAUDE.md §5) rather than quietly
changing it.

---

## VERIFIED VERSION MATRIX

Every version below was resolved from the live npm registry on 2026-08-16 and, where marked ✅,
installed and executed successfully in a probe.

### Runtime

| Tool    | Required                    | Local machine   | Note                |
| ------- | --------------------------- | --------------- | ------------------- |
| Node.js | **24 LTS** (PRD Appendix D) | ✅ **v24.19.0** | Verified 2026-08-16 |
| npm     | 10+                         | ✅ 11.17.0      | ships with Node 24  |

> ✅ **Node environment is resolved — no action needed.** An earlier draft of this plan flagged a
> conflict because the machine ran Node v22.20.0, which failed `jsdom@30.0.1`'s engine requirement
> (`^22.22.2 || ^24.15.0 || >=26.0.0`). **The user has since upgraded to Node v24.19.0**, and a probe
> confirmed `jsdom@30.0.1` + `vite@8.2.1` + `vitest@4.1.10` install with zero `EBADENGINE` warnings.
>
> Pin `jsdom@^30`. Do **not** downgrade to `jsdom@^27` — that workaround was only for Node 22 and is no
> longer needed.

### Root / shared tooling

| Package        | Version  | Verified                                       |
| -------------- | -------- | ---------------------------------------------- |
| `typescript`   | `7.0.2`  | ✅ compiled a 3-project reference graph        |
| `oxlint`       | `1.78.0` | ✅ linted a `.ts` file                         |
| `prettier`     | `3.9.6`  | bundles its own parser, no TS API dependency   |
| `vitest`       | `4.1.10` | ✅ peer `vite: ^6 \|\| ^7 \|\| ^8`             |
| `npm-run-all2` | `9.0.3`  | cross-platform parallel scripts (Windows-safe) |

### apps/web

| Package                             | Version   | Verified                                                         |
| ----------------------------------- | --------- | ---------------------------------------------------------------- |
| `react` / `react-dom`               | `19.2.8`  | ✅                                                               |
| `@types/react`                      | `19.2.18` | ✅ JSX typechecks under TS 7                                     |
| `@types/react-dom`                  | `19.2.4`  | ✅                                                               |
| `vite`                              | `8.2.1`   | ✅ (PRD says 8.1.x; 8.2.1 is current — see Notes)                |
| `@vitejs/plugin-react`              | `6.0.5`   | ✅ both babel peers are **optional**                             |
| `react-router`                      | `8.3.0`   | ⚠️ **not `react-router-dom`** — see gotcha                       |
| `i18next`                           | `26.3.6`  | ✅                                                               |
| `react-i18next`                     | `17.0.11` | ✅ peer `typescript: ^5 \|\| ^6 \|\| ^7` — explicitly TS 7 ready |
| `i18next-browser-languagedetector`  | `8.2.1`   |                                                                  |
| `tailwindcss` + `@tailwindcss/vite` | `4.3.3`   | v4 uses the Vite plugin, **no `postcss.config.js`**              |

> ⚠️ **Router gotcha.** `react-router-dom` is frozen at `7.18.2`; v8 consolidated everything into the
> `react-router` package. Install **`react-router`**, and import `BrowserRouter`, `Routes`, `Route`,
> `Link`, `useNavigate` from `"react-router"`. Importing from `react-router-dom` will pull a stale major.

### apps/api

| Package                                        | Version   | Verified                                    |
| ---------------------------------------------- | --------- | ------------------------------------------- |
| `express`                                      | `5.2.1`   | ✅ served JSON via `tsx` under TS 7         |
| `helmet`                                       | `8.3.0`   |                                             |
| `cors`                                         | `2.8.6`   |                                             |
| `dotenv`                                       | `17.4.2`  |                                             |
| `pino` + `pino-http`                           | `10.3.1`  | structured logging (PRD §9.4)               |
| `tsx`                                          | `4.23.12` | ✅ ran `.ts` directly, no build step in dev |
| `@types/express`, `@types/node`, `@types/cors` | latest    |                                             |

---

## CONTEXT REFERENCES

### Relevant Codebase Files — YOU MUST READ THESE BEFORE IMPLEMENTING

The repository has **no source code yet**. These four files are the entire context:

- `PRD.md` §6.7 (lines 433-464) — Why: prescribes the exact `apps/` + `packages/` repository structure.
- `PRD.md` §8 (lines 755-818) — Why: the technology stack table this plan's version matrix implements.
- `PRD.md` §7.13 (lines 739-751) — Why: the Croatian/English i18n requirements implemented here.
- `PRD.md` §9.2 (lines 832-853) — Why: the exact env var names that must appear in `.env.example`.
- `PRD.md` Appendix D (lines 1399-1420) — Why: version baselines and official reference links.
- `.agents/ROADMAP.md` §2 "Locked decisions" — Why: Supabase, monorepo shape and money handling are
  already decided; do not re-open them.
- `.agents/ROADMAP.md` Task 01 — Why: the definition of done this plan must satisfy.
- `CLAUDE.md` (all 74 lines) — Why: simplicity first, surgical changes, and §5 Integrity (push back
  when the plan is wrong rather than silently working around it).

### New Files to Create

Repository root is `prototypes/receipt-ocr/`.

**Root**

- `package.json` — workspaces, scripts, shared devDependencies
- `tsconfig.base.json` — compiler options inherited by every workspace
- `tsconfig.json` — solution file; `files: []` plus references to all three workspaces
- `.oxlintrc.json` — lint configuration
- `.prettierrc.json`, `.prettierignore`
- `.editorconfig`
- `.gitignore`
- `.env.example`
- `README.md`
- `.nvmrc`

**packages/shared**

- `package.json`, `tsconfig.json`
- `src/index.ts` — re-exports
- `src/health.ts` — `HealthResponse` contract used by both apps

**apps/api**

- `package.json`, `tsconfig.json`
- `src/index.ts` — entry point, binds the port
- `src/app.ts` — Express app factory (exported separately so tests can import without listening)
- `src/config.ts` — env parsing and validation
- `src/logger.ts` — pino instance with redaction
- `src/routes/health.ts` — `GET /api/health`
- `src/middleware/error-handler.ts` — centralized error handling
- `src/app.test.ts` — health endpoint test

**apps/web**

- `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`
- `src/main.tsx`, `src/App.tsx`, `src/index.css`
- `src/i18n/index.ts`, `src/i18n/locales/en.json`, `src/i18n/locales/hr.json`
- `src/components/AppLayout.tsx`, `src/components/LanguageSwitcher.tsx`
- `src/components/Spinner.tsx`, `src/components/ErrorMessage.tsx`
- `src/routes/HomePage.tsx`, `src/routes/NotFoundPage.tsx`
- `src/api/client.ts` — typed fetch wrapper
- `src/i18n/i18n.test.ts`, `src/components/LanguageSwitcher.test.tsx`
- `vitest.config.ts`, `src/test/setup.ts`

### Relevant Documentation — YOU SHOULD READ THESE BEFORE IMPLEMENTING

- [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  - Why: explains the native port, the removal of the JS compiler API from the main export, and which
    ecosystem tools are affected. Directly underpins the oxlint decision.
- [Vite 8 guide — Getting Started](https://vite.dev/guide/)
  - Why: Vite 8 config shape and the Rolldown-based bundler.
- [Vite — Env Variables and Modes](https://vite.dev/guide/env-and-mode.html#env-files)
  - Why: only `VITE_`-prefixed vars reach the client; central to keeping secrets server-side (PRD §9.2).
- [Vite — Server Options: `server.proxy`](https://vite.dev/config/server-options.html#server-proxy)
  - Why: proxying `/api` to the Express server in dev to avoid CORS entirely.
- [React Router v8 docs](https://reactrouter.com/)
  - Why: confirms the `react-router` package consolidation.
- [react-i18next — Getting Started](https://react.i18next.com/getting-started)
  - Why: `useTranslation`, provider setup, and the `Suspense` interaction.
- [i18next — TypeScript](https://www.i18next.com/overview/typescript)
  - Why: augmenting `CustomTypeOptions` so translation keys are type-checked — the mechanism that makes
    "no hardcoded strings" enforceable by the compiler.
- [i18next-browser-languagedetector](https://github.com/i18next/i18next-browser-languageDetector#readme)
  - Why: detection order and `localStorage` caching for the language preference.
- [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5.html)
  - Why: Express 5 changed error handling for async handlers and altered the path-matching syntax.
- [Tailwind CSS v4 — Vite installation](https://tailwindcss.com/docs/installation/using-vite)
  - Why: v4 uses `@tailwindcss/vite` and a single `@import "tailwindcss"`; there is no
    `tailwind.config.js` or `postcss.config.js` by default.
- [Vitest — Workspaces / projects](https://vitest.dev/guide/workspace)
  - Why: running one test command across workspaces with different environments (node vs jsdom).
- [oxlint documentation](https://oxc.rs/docs/guide/usage/linter.html)
  - Why: `.oxlintrc.json` schema, categories and rule configuration.

### Patterns to Follow

There is no existing code to mirror, so **this task establishes the patterns** every later task will
follow. Get them right; they will be copied a dozen times.

**Naming conventions**

- Directories and non-component files: `kebab-case` (`error-handler.ts`, `language-switcher.test.tsx`).
- React components: `PascalCase` file and export (`AppLayout.tsx` exports `AppLayout`).
- Workspace package names: `@receipt/web`, `@receipt/api`, `@receipt/shared`.
- Types and interfaces: `PascalCase`, no `I` prefix.
- Constants: `SCREAMING_SNAKE_CASE` only for genuine module-level constants.

**Module system — this is the highest-friction area, follow it exactly**

- Every `package.json` sets `"type": "module"`. The whole repo is ESM.
- `apps/api` and `packages/shared` use `"module": "nodenext"` + `"moduleResolution": "nodenext"`.
  Under nodenext, **relative imports must carry a `.js` extension even in `.ts` source**:

  ```ts
  // apps/api/src/app.ts  — CORRECT
  import { healthRouter } from "./routes/health.js";
  import { errorHandler } from "./middleware/error-handler.js";

  // WRONG — will not typecheck under nodenext
  import { healthRouter } from "./routes/health";
  ```

  Verified: `tsc --noEmit` exits 0 with `.js` extensions and `tsx` runs the same source unchanged.

- `apps/web` uses `"module": "preserve"` + `"moduleResolution": "bundler"`, where extensionless
  relative imports are correct because Vite resolves them:

  ```tsx
  // apps/web/src/App.tsx — CORRECT (bundler resolution)
  import { AppLayout } from "./components/AppLayout";
  ```

- Cross-workspace imports always use the package name, never a relative path into another workspace:

  ```ts
  import type { HealthResponse } from "@receipt/shared"; // ✅
  import type { HealthResponse } from "../../packages/shared/src"; // ❌
  ```

**Type-only imports** — `verbatimModuleSyntax: true` is enabled, so type imports must be explicit:

```ts
import { type HealthResponse, HEALTH_PATH } from "@receipt/shared";
import type { Request, Response, NextFunction } from "express";
```

**Error handling (API)** — one centralized handler; route handlers never format error responses
themselves. Express 5 forwards rejected async handlers to the error middleware automatically.

```ts
// src/middleware/error-handler.ts
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err instanceof HttpError ? err.status : 500;
  logger.error({ err, status }, "request failed");
  res.status(status).json({ error: { code: status === 500 ? "internal_error" : "request_error" } });
}
```

Note it returns a **stable machine `code`**, not a raw message. Later tasks translate these codes in
the UI, which is how PRD §7.13 ("copy externalized") stays true for error states too.

**Logging (PRD §9.4 — never log receipt contents or signed URLs)** — establish redaction now:

```ts
// src/logger.ts
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.file", "*.signedUrl"],
    remove: true,
  },
});
```

**i18n — the rule every later task depends on: no hardcoded user-facing strings, ever.**

```tsx
const { t } = useTranslation();
return <h1>{t("home.title")}</h1>; // ✅
return <h1>Scan receipt</h1>; // ❌ fails review
```

Keys are namespaced by feature (`home.title`, `common.retry`, `errors.network`) so later tasks add
`capture.*`, `review.*`, `history.*` without collision.

**Testing** — colocate tests next to source as `*.test.ts` / `*.test.tsx`. API tests import the app
factory from `./app.js` and drive it with `supertest`, never binding a real port.

**Anti-patterns to avoid**

- ❌ Installing `eslint` / `typescript-eslint` (broken under TS 7 — see Critical Finding).
- ❌ `react-router-dom` (stale at v7).
- ❌ `postcss.config.js` or `tailwind.config.js` (Tailwind v4 needs neither).
- ❌ `any` — `strict` is on and there is no legacy code to appease.
- ❌ Secrets or Azure/Supabase config in `apps/web` — only `VITE_`-prefixed public values reach it.
- ❌ Business logic of any kind. This task ships a shell, not a feature.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Establish the workspace graph and the shared compiler configuration before any application code, so
that typechecking is meaningful from the first file.

**Tasks:** root `package.json` with workspaces; `tsconfig.base.json`; solution `tsconfig.json`;
`packages/shared` with the health contract; `.gitignore`, `.editorconfig`, `.nvmrc`.

### Phase 2: Core Implementation

Build the two applications against the shared contract.

**Tasks:** Express API with config, logger, health route and error handler; React app with Vite,
Tailwind v4, router, layout, and the typed API client.

### Phase 3: Integration

Wire the pieces into a single developer experience.

**Tasks:** i18n with `hr`/`en` and typed keys; language switcher with `localStorage` persistence; Vite
dev proxy from `/api` to Express; root scripts running both apps concurrently; `.env.example`; README.

### Phase 4: Testing & Validation

**Tasks:** Vitest projects for node and jsdom environments; API health test; i18n parity and language
switcher tests; full validation sweep; generate `/validate` via `/ultimate_validate_command`.

---

## STEP-BY-STEP TASKS

Execute in order, top to bottom. Each task is atomic and independently validatable.

> **Windows note:** the user's shell is PowerShell. `&&` is **not** a valid chain operator in Windows
> PowerShell 5.1 — use `;` or separate calls. All validation commands below are single commands to
> sidestep this entirely.

---

### CREATE `package.json` (root)

- **IMPLEMENT**: private root package with `"workspaces": ["apps/*", "packages/*"]`, `"type": "module"`,
  `"engines": { "node": ">=24.0.0" }`, and shared devDependencies: `typescript@7.0.2`, `oxlint@1.78.0`,
  `prettier@3.9.6`, `vitest@4.1.10`, `npm-run-all2@9.0.3`.
  Scripts:
  - `"dev": "run-p dev:*"`
  - `"dev:api": "npm run dev --workspace @receipt/api"`
  - `"dev:web": "npm run dev --workspace @receipt/web"`
  - `"build": "tsc --build && npm run build --workspace @receipt/web"`
  - `"typecheck": "tsc --build"`
  - `"lint": "oxlint ."`
  - `"format": "prettier --write ."`
  - `"format:check": "prettier --check ."`
  - `"test": "vitest run"`
  - `"validate": "npm run typecheck && npm run lint && npm run format:check && npm run test"`
- **GOTCHA**: use `npm-run-all2`'s `run-p`, not `&` shell backgrounding — the latter does not work in
  PowerShell. Do **not** add `eslint`.
- **VALIDATE**: `node -e "const p=require('./package.json'); if(!p.workspaces) throw new Error('no workspaces'); console.log('ok')"`

### CREATE `.nvmrc`, `.editorconfig`, `.gitignore`, `.prettierrc.json`, `.prettierignore`

- **IMPLEMENT**: `.nvmrc` containing `24`. `.gitignore` covering `node_modules/`, `dist/`, `.env`,
  `.env.local`, `*.tsbuildinfo`, `coverage/`, `.DS_Store`, `playwright-report/`.
  `.prettierrc.json`: `{ "semi": true, "singleQuote": false, "printWidth": 100, "trailingComma": "all" }`.
  `.prettierignore`: `dist`, `coverage`, `node_modules`, `*.tsbuildinfo`.
- **GOTCHA**: `.env` **must** be ignored (PRD §9.2 — never commit secrets). `.env.example` must NOT be
  ignored.
- **VALIDATE**: `node -e "const s=require('fs').readFileSync('.gitignore','utf8'); if(!/^\.env$/m.test(s)) throw new Error('.env not ignored'); console.log('ok')"`

### CREATE `tsconfig.base.json`

- **IMPLEMENT**: shared options only — no `include`/`files`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2023",
      "strict": true,
      "noUncheckedIndexedAccess": true,
      "noImplicitOverride": true,
      "exactOptionalPropertyTypes": false,
      "verbatimModuleSyntax": true,
      "skipLibCheck": true,
      "esModuleInterop": true,
      "forceConsistentCasingInFileNames": true,
      "declaration": true,
      "composite": true,
      "sourceMap": true
    }
  }
  ```
- **GOTCHA**: `composite: true` here is what makes project references work; `packages/shared` must stay
  composite because it is referenced by both apps. Leave `exactOptionalPropertyTypes` off — the PRD's
  canonical schema (Task 02) uses `field?: string | null`, which that flag makes needlessly painful.
- **VALIDATE**: `npx tsc --showConfig --project tsconfig.base.json` (must print JSON and exit 0; do not
  redirect to `NUL` — that is a cmd.exe device name and PowerShell would create a file named `NUL`)

### CREATE `packages/shared/package.json` + `tsconfig.json`

- **IMPLEMENT**: name `@receipt/shared`, `"type": "module"`, `"main": "./dist/index.js"`,
  `"types": "./dist/index.d.ts"`, and an `exports` map pointing `.` at those. tsconfig extends the base
  with `"rootDir": "src"`, `"outDir": "dist"`, `"module": "nodenext"`, `"moduleResolution": "nodenext"`,
  `"include": ["src/**/*"]`.
- **PATTERN**: verified working in a probe — `tsc --build` emitted `dist/index.js` + `dist/index.d.ts`
  and a consuming workspace resolved the types correctly.
- **GOTCHA**: the `exports` map must list `"types"` **before** `"default"`; TypeScript resolves
  conditions in order and will miss the declarations otherwise.
- **VALIDATE**: `node -e "const p=require('./packages/shared/package.json'); if(p.name!=='@receipt/shared') throw new Error('bad name'); console.log('ok')"`

### CREATE `packages/shared/src/health.ts` and `src/index.ts`

- **IMPLEMENT**:
  ```ts
  // src/health.ts
  export const HEALTH_PATH = "/api/health" as const;

  export interface HealthResponse {
    status: "ok";
    uptimeSeconds: number;
  }
  ```
  `src/index.ts` re-exports: `export { HEALTH_PATH, type HealthResponse } from "./health.js";`
- **GOTCHA**: `.js` extension in the re-export is required under nodenext.
- **IMPORTS**: none.
- **VALIDATE**: `npx tsc --build packages/shared`

### CREATE root `tsconfig.json` (solution file)

- **IMPLEMENT**:
  ```json
  {
    "files": [],
    "references": [
      { "path": "./packages/shared" },
      { "path": "./apps/api" },
      { "path": "./apps/web" }
    ]
  }
  ```
- **GOTCHA**: `"files": []` is mandatory — without it `tsc` tries to compile the whole tree directly and
  the reference graph is ignored.
- **VALIDATE**: (run after the app tsconfigs exist) `npx tsc --build --dry`

### CREATE `apps/api/package.json` and `tsconfig.json`

- **IMPLEMENT**: name `@receipt/api`, `"type": "module"`, scripts
  `"dev": "tsx watch src/index.ts"`, `"start": "node dist/index.js"`.
  dependencies: `express@5.2.1`, `helmet@8.3.0`, `cors@2.8.6`, `dotenv@17.4.2`, `pino@10.3.1`,
  `pino-http`, `@receipt/shared@*`.
  devDependencies: `tsx@4.23.12`, `@types/express`, `@types/node`, `@types/cors`, `supertest`,
  `@types/supertest`.
  tsconfig extends base: `"rootDir": "src"`, `"outDir": "dist"`, `"module": "nodenext"`,
  `"moduleResolution": "nodenext"`, `"types": ["node"]`, `"include": ["src/**/*"]`,
  `"references": [{ "path": "../../packages/shared" }]`.
- **GOTCHA**: `@receipt/shared@*` resolves through the npm workspace symlink — do not use a file: path.
- **VALIDATE**: `npm install` (from root; expect no `ERESOLVE` errors)

### CREATE `apps/api/src/config.ts`

- **IMPLEMENT**: load `dotenv`, read and validate `PORT` (default `3001`), `NODE_ENV`
  (default `development`), `LOG_LEVEL` (default `info`), `WEB_ORIGIN` (default `http://localhost:5173`).
  Export a frozen `config` object. Throw a clear error listing every missing/invalid variable at once.
- **GOTCHA**: do **not** add Supabase or Azure variables here — Tasks 03 and 07 own those. Adding them
  now is speculative (CLAUDE.md §2) and would make the app fail to boot without credentials it doesn't
  need yet.
- **VALIDATE**: `npx tsc --build apps/api`

### CREATE `apps/api/src/logger.ts`

- **IMPLEMENT**: pino logger at `config.LOG_LEVEL` with the redaction paths shown in _Patterns to
  Follow_. In development enable `pino-pretty` only if it is installed; otherwise plain JSON.
- **GOTCHA**: PRD §9.4 forbids logging full receipt contents or signed URLs. Establishing redaction now
  means later tasks inherit it rather than each remembering.
- **VALIDATE**: `npx tsc --build apps/api`

### CREATE `apps/api/src/routes/health.ts`

- **IMPLEMENT**: an Express `Router` with `GET /` returning `HealthResponse`:
  ```ts
  import { Router } from "express";
  import { type HealthResponse } from "@receipt/shared";

  export const healthRouter = Router();

  healthRouter.get("/", (_req, res) => {
    const body: HealthResponse = { status: "ok", uptimeSeconds: Math.floor(process.uptime()) };
    res.json(body);
  });
  ```
- **PATTERN**: the explicit `HealthResponse` annotation is the point — it makes the shared contract
  compiler-enforced on the server side.
- **VALIDATE**: `npx tsc --build apps/api`

### CREATE `apps/api/src/middleware/error-handler.ts` and `src/app.ts`

- **IMPLEMENT**: `error-handler.ts` per _Patterns to Follow_. `app.ts` exports
  `export function createApp(): Express` which applies `helmet()`, `cors({ origin: config.WEB_ORIGIN })`,
  `express.json()`, `pinoHttp({ logger })`, mounts `healthRouter` at `/api/health`, then a 404 handler,
  then `errorHandler` **last**.
- **GOTCHA**: the error handler must be registered after all routes, and must keep all four parameters
  (`err, req, res, next`) or Express will not recognize it as error middleware — even though `next` is
  unused. Prefix unused params with `_` for oxlint.
- **VALIDATE**: `npx tsc --build apps/api`

### CREATE `apps/api/src/index.ts`

- **IMPLEMENT**: import `createApp`, listen on `config.PORT`, log the bound port. Keep the listen call
  out of `app.ts` so tests can import the app without opening a socket.
- **VALIDATE**: `npx tsc --build apps/api`

### CREATE `apps/api/src/app.test.ts`

- **IMPLEMENT**: supertest against `createApp()` asserting `GET /api/health` → 200, `status === "ok"`,
  and `typeof uptimeSeconds === "number"`. Add a test asserting an unknown route returns 404 with a JSON
  error body.
- **PATTERN**: `import request from "supertest"; import { createApp } from "./app.js";`
- **VALIDATE**: `npx vitest run apps/api`

### CREATE `apps/web/package.json`, `tsconfig.json`, `tsconfig.node.json`

- **IMPLEMENT**: name `@receipt/web`, `"private": true`, scripts `"dev": "vite"`, `"build": "vite build"`,
  `"preview": "vite preview"`.
  dependencies: `react@19.2.8`, `react-dom@19.2.8`, `react-router@8.3.0`, `i18next@26.3.6`,
  `react-i18next@17.0.11`, `i18next-browser-languagedetector@8.2.1`, `@receipt/shared@*`.
  devDependencies: `vite@8.2.1`, `@vitejs/plugin-react@6.0.5`, `@types/react@19.2.18`,
  `@types/react-dom@19.2.4`, `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`,
  `@testing-library/react@16.3.2`, `@testing-library/jest-dom@7.0.1`,
  `@testing-library/user-event@14.6.4`, `jsdom@^30`.
  `tsconfig.json`: `"module": "preserve"`, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"`,
  `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"noEmit": true`, `"composite": false`,
  `"include": ["src"]`, `"references": [{ "path": "../../packages/shared" }]`.
  `tsconfig.node.json` covers `vite.config.ts` with nodenext settings.
- **GOTCHA**: `composite: false` + `noEmit: true` is correct for a leaf project that nothing references;
  ✅ verified that React 19 JSX typechecks clean under TS 7 with exactly these options.
- **VALIDATE**: `npx tsc --build apps/web`

### CREATE `apps/web/vite.config.ts` and `index.html`

- **IMPLEMENT**: Vite config with `react()` and `tailwindcss()` plugins, and a dev proxy:
  ```ts
  server: { proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } } }
  ```
  `index.html` with `<html lang="hr">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`,
  and `<div id="root">`.
- **GOTCHA**: the proxy means the web app calls same-origin `/api/...` in dev, so CORS never fires
  locally — but keep `cors()` on the API for the deployed split-origin case.
  The mobile-first viewport meta is required by PRD §11.5; without it the phone layout is wrong.
- **VALIDATE**: `npx vite build --root apps/web` (after the source files exist)

### CREATE `apps/web/src/i18n/locales/en.json` and `hr.json`

- **IMPLEMENT**: identical key trees, both fully populated. Minimum keys:
  ```json
  {
    "common": { "appName": "...", "retry": "...", "loading": "...", "language": "..." },
    "home": {
      "title": "...",
      "subtitle": "...",
      "apiStatus": "...",
      "apiOnline": "...",
      "apiOffline": "..."
    },
    "nav": { "home": "..." },
    "errors": { "network": "...", "notFound": "...", "unknown": "..." }
  }
  ```
- **GOTCHA**: Croatian is a first-class language here, not a stub — PRD §7.13 and the primary market is
  Croatia. Write real Croatian copy (e.g. `"home.title": "Digitalizacija računa"`), not `TODO`.
- **VALIDATE**: `node -e "const a=require('./apps/web/src/i18n/locales/en.json'),b=require('./apps/web/src/i18n/locales/hr.json');const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?f(v,p+k+'.'):[p+k]);const ka=f(a).sort(),kb=f(b).sort();if(JSON.stringify(ka)!==JSON.stringify(kb))throw new Error('locale key mismatch');console.log('ok',ka.length,'keys')"`

### CREATE `apps/web/src/i18n/index.ts`

- **IMPLEMENT**: initialize i18next with the language detector and both resource bundles,
  `fallbackLng: "en"`, `supportedLngs: ["hr", "en"]`, detection order
  `["localStorage", "navigator"]` with `caches: ["localStorage"]`, `interpolation.escapeValue: false`.
  Add a `declare module "i18next"` block augmenting `CustomTypeOptions` with
  `resources: { translation: typeof en }` so translation keys are type-checked.
- **GOTCHA**: import the locale JSON with `resolveJsonModule` enabled. The type augmentation is what
  turns "don't hardcode strings" into a compiler-enforced rule for the next eleven tasks — do not skip it.
  Set `react: { useSuspense: false }` to avoid needing a Suspense boundary for synchronous bundled
  resources.
- **VALIDATE**: `npx tsc --build apps/web`

### CREATE `apps/web/src/components/LanguageSwitcher.tsx`

- **IMPLEMENT**: a control switching between `hr` and `en` via `i18n.changeLanguage`, reflecting the
  active language, with an accessible label from `t("common.language")`. Persistence comes free from the
  detector's `localStorage` cache.
- **GOTCHA**: minimum 44×44px touch target (PRD §11.5). Also update `document.documentElement.lang` on
  change for accessibility.
- **VALIDATE**: `npx tsc --build apps/web`

### CREATE `apps/web/src/components/AppLayout.tsx`, `Spinner.tsx`, `ErrorMessage.tsx`

- **IMPLEMENT**: `AppLayout` — mobile-first shell with a header (app name + `LanguageSwitcher`) and a
  `<main>` rendering `<Outlet />`, constrained to a comfortable max width on larger screens.
  `Spinner` — accessible loading indicator with `role="status"`. `ErrorMessage` — message plus optional
  retry button, all copy via `t()`.
- **GOTCHA**: these three are the loading/error primitives every later task reuses; keep them
  presentational and prop-driven with no data fetching inside.
- **VALIDATE**: `npx tsc --build apps/web`

### CREATE `apps/web/src/api/client.ts`

- **IMPLEMENT**: a small typed fetch wrapper — `getHealth(): Promise<HealthResponse>` importing
  `HEALTH_PATH` and `HealthResponse` from `@receipt/shared`, throwing a typed error on non-2xx.
- **PATTERN**: this closes the shared-contract loop — one type definition, enforced at both ends.
- **GOTCHA**: use the relative `HEALTH_PATH` so the Vite dev proxy handles it; do not hardcode
  `http://localhost:3001`.
- **VALIDATE**: `npx tsc --build apps/web`

### CREATE `apps/web/src/routes/HomePage.tsx` and `NotFoundPage.tsx`

- **IMPLEMENT**: `HomePage` renders the translated title/subtitle and calls `getHealth()` on mount,
  showing `Spinner` while pending, the online state on success, and `ErrorMessage` with a working retry
  on failure. `NotFoundPage` renders `t("errors.notFound")`.
- **GOTCHA**: this is the only place the scaffold does any data fetching, and it exists to prove the
  full stack — shared type → API → proxy → client → UI — actually connects. Keep it to `useState` +
  `useEffect`; no data-fetching library (CLAUDE.md §2).
- **VALIDATE**: `npx tsc --build apps/web`

### CREATE `apps/web/src/main.tsx`, `App.tsx`, `index.css`

- **IMPLEMENT**: `index.css` containing `@import "tailwindcss";` plus a small base layer.
  `App.tsx` defines routes with `react-router`: `/` → `HomePage` inside `AppLayout`, `*` → `NotFoundPage`.
  `main.tsx` imports `./i18n`, `./index.css`, and mounts `<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>`.
- **GOTCHA**: `import "./i18n"` must come **before** the app renders or the first paint is untranslated.
  Import from `"react-router"`, never `"react-router-dom"`. Tailwind v4 needs only the single `@import`.
- **VALIDATE**: `npx vite build --root apps/web`

### CREATE `apps/web/vitest.config.ts` and `src/test/setup.ts`

- **IMPLEMENT**: vitest config with `environment: "jsdom"`, `globals: true`, `setupFiles`.
  Setup imports `@testing-library/jest-dom/vitest` and registers `afterEach(cleanup)`.
- **GOTCHA**: the API workspace needs `environment: "node"`; use Vitest `projects` at the root so one
  `npm test` covers both with the right environment each.
- **VALIDATE**: `npx vitest run apps/web`

### CREATE `apps/web/src/i18n/i18n.test.ts` and `src/components/LanguageSwitcher.test.tsx`

- **IMPLEMENT**: `i18n.test.ts` asserts `hr` and `en` have identical key sets (recursive walk) and that
  no value is an empty string. `LanguageSwitcher.test.tsx` renders the switcher, asserts visible copy
  changes after switching, and asserts the choice is written to `localStorage`.
- **PATTERN**: the locale-parity test is a durable guard — every later task adding keys gets an
  automatic failure if it translates only one language.
- **VALIDATE**: `npx vitest run apps/web`

### CREATE `.env.example`

- **IMPLEMENT**: every variable name from PRD §9.2 with **empty values**, grouped and commented:
  ```env
  # --- API ---
  PORT=3001
  NODE_ENV=development
  LOG_LEVEL=info
  WEB_ORIGIN=http://localhost:5173

  # --- Azure Document Intelligence (Task 07) ---
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
  AZURE_DOCUMENT_INTELLIGENCE_KEY=

  # --- Supabase / database (Task 03) ---
  DATABASE_URL=
  SUPABASE_URL=
  SUPABASE_SERVICE_ROLE_KEY=
  SUPABASE_ANON_KEY=
  STORAGE_BUCKET=

  # --- Web (only VITE_* reach the browser bundle) ---
  VITE_API_BASE_URL=/api
  ```
- **GOTCHA**: PRD §9.2 requires variable names with **no real values**. Note in a comment that
  `SUPABASE_SERVICE_ROLE_KEY` and the Azure key are server-only and must never gain a `VITE_` prefix.
- **VALIDATE**: `node -e "const s=require('fs').readFileSync('.env.example','utf8'); for(const k of ['AZURE_DOCUMENT_INTELLIGENCE_KEY','SUPABASE_SERVICE_ROLE_KEY','STORAGE_BUCKET']) if(!s.includes(k)) throw new Error('missing '+k); if(/VITE_[A-Z_]*(KEY|SECRET)/.test(s)) throw new Error('secret exposed to client'); console.log('ok')"`

### CREATE `.oxlintrc.json`

- **IMPLEMENT**: enable `correctness` and `suspicious` categories as errors, `pedantic` off. Ignore
  `dist`, `coverage`, `node_modules`. Allow leading-underscore unused args.
- **GOTCHA**: keep it lean. An over-tuned lint config on a greenfield repo generates noise that later
  tasks will be tempted to suppress.
- **VALIDATE**: `npx oxlint .`

### CREATE `README.md`

- **IMPLEMENT**: what the project is (one paragraph, linking `PRD.md`), prerequisites (Node 24 LTS, npm
  10+), setup (`npm install`, `cp .env.example .env`), running (`npm run dev` → web on 5173, API on
  3001), the full script table, the workspace layout, and a short **Toolchain notes** section recording
  the TypeScript 7 / oxlint decision so the next developer doesn't "fix" it by reinstalling ESLint.
- **GOTCHA**: PRD §12 Phase 4 requires a clean-clone setup to work from the README alone. Write it as if
  for someone who has never seen the repo.
- **VALIDATE**: `node -e "const s=require('fs').readFileSync('README.md','utf8'); for(const k of ['npm install','npm run dev','oxlint']) if(!s.includes(k)) throw new Error('README missing '+k); console.log('ok')"`

### RUN full validation sweep

- **IMPLEMENT**: from the repo root, in order: `npm install`, `npm run typecheck`, `npm run lint`,
  `npm run format:check`, `npm run test`, `npm run build`. Fix any failure before proceeding.
- **VALIDATE**: `npm run validate`

### RUN `/ultimate_validate_command`

- **IMPLEMENT**: with the scaffold in place and green, invoke `/ultimate_validate_command` to generate
  `.claude/commands/validate.md`. It must cover lint, typecheck, format, unit tests, build, and a
  manual/E2E section (the E2E section will be thin now and grow with later tasks).
- **GOTCHA**: this is deliberately last — the command analyses the real codebase, so it needs the
  codebase to exist.
- **VALIDATE**: `/validate`

---

## TESTING STRATEGY

Testing is intentionally light here. A scaffold's correctness is proven mostly by _building and
running_, not by unit tests, and writing tests for framework boilerplate is the kind of speculative
work CLAUDE.md §2 rules out. The tests that do exist target the things that will silently rot.

### Unit Tests

- **Locale parity** (`i18n.test.ts`) — `hr` and `en` have identical key sets and no empty values.
  This is the highest-value test in the task: it protects PRD §7.13 across all eleven remaining tasks.
- **Language switcher** (`LanguageSwitcher.test.tsx`) — switching changes rendered copy and persists to
  `localStorage`.

### Integration Tests

- **API health** (`app.test.ts`) — supertest against `createApp()`; asserts the `HealthResponse` shape,
  proving the shared contract is honored at runtime and not just at compile time.
- **404 handling** — unknown route returns a JSON error body, not an HTML stack trace.

### Edge Cases

- Unknown API route → JSON 404 (not Express's default HTML).
- `localStorage` unavailable (private browsing) → language detection falls back to `navigator` without
  throwing.
- API unreachable → `HomePage` renders `ErrorMessage` with a working retry, never a blank screen or an
  unhandled rejection.
- A locale key present in `en` but missing from `hr` → locale parity test fails.
- Unsupported browser language (e.g. `de`) → falls back to `en`, not a crash or an empty UI.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.
Run from the repository root (`prototypes/receipt-ocr/`).

### Level 1: Syntax & Style

```
npm run lint
npm run format:check
```

### Level 2: Type Checking

```
npm run typecheck
```

Authoritative type gate. Must exit 0. (Verified: `tsc --build` exits **2** on a cross-package type
error, so failures are correctly detected in CI. Do **not** pipe this command through `tail`/`head` in
a script — the pipe masks the exit code.)

### Level 3: Unit & Integration Tests

```
npm run test
```

### Level 4: Build

```
npm run build
```

### Level 5: Manual Validation

1. `npm run dev` — confirm both servers start and neither logs an error.
2. Open `http://localhost:5173` — the shell renders with real translated copy, not raw keys like
   `home.title`.
3. The home page shows the API as online (proves shared type → API → proxy → client works).
4. Toggle the language — all visible copy switches between Croatian and English.
5. Reload — the chosen language persists.
6. Open DevTools → device toolbar → iPhone SE (375px): layout is usable, nothing overflows
   horizontally, the language control is comfortably tappable.
7. Visit `http://localhost:5173/nonexistent` — the translated not-found page renders.
8. Stop the API, reload the home page — `ErrorMessage` appears with a retry; restart the API and the
   retry succeeds.
9. `curl http://localhost:3001/api/health` → `{"status":"ok","uptimeSeconds":N}`.
10. Confirm `.env` is git-ignored and `.env.example` contains no real values.

---

## ACCEPTANCE CRITERIA

Mirrors the Definition of Done in `.agents/ROADMAP.md` Task 01.

- [ ] `npm install` succeeds on a clean checkout with no `ERESOLVE` errors
- [ ] `npm run dev` serves the web app and the API concurrently
- [ ] `GET /api/health` returns 200 with a `HealthResponse`-shaped body
- [ ] `npm run typecheck` (`tsc --build`) passes with zero errors across all three workspaces
- [ ] `npm run lint` (oxlint) passes with zero errors
- [ ] `npm run format:check` passes
- [ ] `npm run test` passes
- [ ] `npm run build` produces a web bundle and compiled API output
- [ ] Language toggle changes visible copy and survives a page reload
- [ ] `hr` and `en` locale files have identical key sets, enforced by a test
- [ ] No hardcoded user-facing string exists in any component
- [ ] `.env.example` contains every PRD §9.2 variable name with no values; `.env` is git-ignored
- [ ] No secret-bearing variable carries a `VITE_` prefix
- [ ] `packages/shared` is consumed by both apps via `@receipt/shared`, never a relative path
- [ ] Layout is usable at 375px width
- [ ] `.claude/commands/validate.md` exists and runs green
- [ ] README enables setup from a clean clone

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes
- [ ] No type or lint errors
- [ ] Manual validation steps 1–10 confirmed
- [ ] Acceptance criteria all met
- [ ] `.agents/history/01-monorepo-scaffold-app-shell-i18n.md` written
- [ ] `.agents/ROADMAP.md` Task 01 status flipped to ✅ Done, with plan/history links
- [ ] Committed via `/commit`

---

## NOTES

### Design decisions and trade-offs

**oxlint instead of ESLint + typescript-eslint.** Forced by TypeScript 7 removing the JS compiler API
from its main export (see Critical Finding). The cost is losing type-aware lint rules; the mitigation is
that `tsc --build` under `strict: true` with `noUncheckedIndexedAccess` remains the authoritative gate.
Record this in the history file — it is the kind of decision a future session will otherwise try to
"fix". If typescript-eslint ships TS 7 support later, revisiting is cheap.

**`packages/domain` is deliberately NOT created in this task.** The roadmap listed all four workspaces
under Task 01, but Task 02 owns the canonical domain model and creating an empty package now would be
speculative scaffolding (CLAUDE.md §2). Instead this task creates `packages/shared` with one genuinely
used contract (`HealthResponse`), which proves the workspace wiring just as well while shipping zero
dead code. Task 02 creates `packages/domain` following the identical, now-proven pattern.
**Action:** note this deviation when updating the roadmap.

**Health endpoint as the integration proof.** Rather than placeholder exports, the scaffold ends with
one thin vertical slice through every layer. If it renders "API online", then workspaces, project
references, the shared contract, the dev proxy, the router, i18n and the component primitives are all
demonstrably working — which is exactly what a scaffold task should prove.

**Vite 8.2.1 vs the PRD's 8.1.x.** PRD Appendix D was written on 8 Aug 2026 and specifies 8.1.x; 8.2.1
is the current release and Appendix D explicitly says to "use current secure patch releases compatible
with these baselines". Same major, no migration. Using 8.2.1.

**No Playwright yet.** PRD §8 lists it, but there are no user journeys to test. Task 12 owns E2E.

**No state-management or data-fetching library.** One `useEffect` is enough for a health check.
Introduce one only when a task actually needs it.

### Risks

| Risk                                                                      | Likelihood   | Mitigation                                                                  |
| ------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| ~~Node 22.20.0 vs jsdom 30's engine requirement~~                         | **Resolved** | User upgraded to Node v24.19.0; clean install verified                      |
| Agent reflexively installs ESLint + typescript-eslint                     | High         | Critical Finding section; README toolchain note; explicit anti-pattern list |
| `.js` extension confusion between nodenext (api/shared) and bundler (web) | Medium       | Both patterns shown explicitly with ✅/❌ examples; verified by probe       |
| `react-router-dom` installed instead of `react-router`                    | Medium       | Called out in the version matrix and the anti-pattern list                  |
| Croatian translations left as English placeholders                        | Medium       | Locale parity test plus an explicit instruction to write real copy          |
| Tailwind v4 config files created out of habit                             | Low          | Listed as an anti-pattern                                                   |

### What this task explicitly does NOT do

No authentication, no database, no Supabase client, no Azure SDK, no receipt types, no upload, no
camera, no business logic of any kind. Adding any of it here makes Tasks 02–07 harder to review, not
easier.

### Confidence Score

**9 / 10** for one-pass success. The version matrix, TypeScript 7 behavior, project references,
cross-package typechecking, React 19 JSX compilation, Express 5 + tsx execution, oxlint, and the Node 24
runtime were all verified by real installs and compile runs rather than assumed. The remaining risk is
breadth rather than uncertainty — roughly 40 files of configuration where a single wrong tsconfig field
costs a debug cycle. No open questions remain for the user.
