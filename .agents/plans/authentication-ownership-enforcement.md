# Feature: Authentication & ownership enforcement (Roadmap Task 04)

The following plan should be complete, but it is important that you validate documentation, codebase
patterns and task sanity before you start implementing.

Pay special attention to the naming of existing utils, types and models. Import from the right files.
Cross-workspace imports always use `@receipt/shared`, never a relative path. `api` and `shared` use
`nodenext` resolution, so **relative imports need a `.js` extension even in `.ts` source**; `client`
uses `bundler` resolution, where extensionless imports are correct.

## Feature Description

Task 03 built a receipts table whose Row Level Security policies are all written against
`auth.uid()`, and a `ReceiptRepository` that takes a **user-scoped** Supabase client. Nothing today
can produce such a client, because there is no authentication anywhere in the application. This task
closes that gap end to end:

- The **client** gains Supabase email/password registration, login, logout, a persisted session, a
  protected-route wrapper, and translated auth copy in `hr` and `en`.
- The **API** gains a middleware that verifies the Supabase access token, derives `userId` from the
  token's `sub` claim (never from the request body), and builds the per-request user-scoped Supabase
  client that `ReceiptRepository` has been waiting for since Task 03.
- The entire `/api/receipts` path prefix becomes protected by construction, so no route added in a
  later task can accidentally ship public.
- One receipt route — `GET /api/receipts/:id` — is implemented, which is the minimum needed to prove
  that another user's receipt returns **404, not 403** (existence must not leak).

## User Story

As a business user
I want to register, log in once and stay logged in
So that my receipts are private to me and I never have to prove who I am on every screen

## Problem Statement

`ReceiptRepository` (`api/src/repositories/receipts.ts:63`) requires `(client, userId)` and every RLS
policy in `supabase/migrations/20260817122048_create_receipts.sql:95-112` matches
`(select auth.uid()) = user_id`. Today the only way to satisfy either is the secret key, which
bypasses RLS entirely and which Task 03 explicitly reserved for administrative provisioning. Until a
request can carry a verified user identity, no receipt endpoint can be written safely, so Tasks 05
onward are blocked.

Separately, PRD §9.1 requires that the backend derive identity from the session/token and **never**
trust a client-supplied `userId`. That has to be enforced structurally, not by a rule each future
route author remembers.

## Solution Statement

Verify the Supabase JWT locally with `supabase.auth.getClaims(token)` — the project's hosted signing
key is **ES256** (verified against the live JWKS endpoint, see Verified Findings #1), so verification
happens in-process via WebCrypto against a cached JWKS with no per-request network call. Derive
`userId` from `claims.sub`, then mint a per-request Supabase client carrying
`Authorization: Bearer <token>` so PostgREST and Storage evaluate every query under that user's RLS
context.

Hand the route an `AuthContext` as an **explicit function parameter** rather than a monkey-patched
`req.auth`, so a handler is structurally incapable of reading a user id it has not proven. This
mirrors the two-tier schema split from Task 02, where "never trust a client-supplied `userId`" was
made a property of the type system instead of a rule to remember.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High (touches all three workspaces, hosted project config, and the
validation harness)
**Primary Systems Affected**: `api` (middleware, config, routes), `client` (auth context, routing,
i18n), `supabase/config.toml` (hosted auth settings), `.claude/commands/validate.md`
**Dependencies**: `@supabase/supabase-js@2.112.3` — already an `api` dependency; **added to `client`
at the same pinned version** so npm dedupes it. No other new dependency. Notably **no `jose`**.

---

## VERIFIED FINDINGS — read these before you plan your own approach

These were established by probing the live project and the installed packages during planning. They
overturn two assumptions baked into the current `.env.example`, so do not skip them.

### 1. The hosted project signs JWTs with ES256 (asymmetric)

```console
$ curl -s https://ssczfjvbeqyrlbasfyzj.supabase.co/auth/v1/.well-known/jwks.json
{"keys":[{"alg":"ES256","crv":"P-256","ext":true,"key_ops":["verify"],
"kid":"58309ea2-9a41-4005-8020-8b758ab4e395","kty":"EC","use":"sig", ...}]}
```

Consequence: `getClaims()` verifies **locally with WebCrypto against a cached JWKS**, so there is no
network round trip per authenticated request. Node 24 provides WebCrypto natively, so no polyfill is
needed. The Supabase docs are explicit that `getClaims` is the method to use for authorization
decisions:

> Use `getClaims` to protect pages and user data. It reads the access token from storage and verifies
> it. Locally via the WebCrypto API and a cached JWKS endpoint when the project uses asymmetric
> signing keys (the default for new projects) […] `getSession` […] is loaded directly from local
> storage and isn't re-validated against the Auth server, so the embedded user object shouldn't be
> trusted on its own.

### 2. `SUPABASE_JWKS_URL` is dead weight and must be removed

`supabase-js` derives the JWKS endpoint from `SUPABASE_URL` itself and caches it on the client
instance. `.env.example:22` carries `SUPABASE_JWKS_URL` (currently populated in the developer's
`.env`) purely because Task 03 anticipated a hand-rolled `jose` verifier. Using `getClaims` makes it
unreferenced configuration, and unreferenced configuration rots.

**Remove it from `.env.example` and from the README Configuration table in the same commit** —
`/validate` Phase 6.6 compares the two sets and fails if they diverge.

### 3. Registration is currently broken on the hosted project

```console
$ curl -s https://ssczfjvbeqyrlbasfyzj.supabase.co/auth/v1/settings
{... "mailer_autoconfirm": false, "disable_signup": false, ...}
```

Hosted requires email confirmation; local `supabase/config.toml:229` sets
`enable_confirmations = false`. Supabase's built-in SMTP for new projects is heavily rate-limited and
restricted, so a test signup against hosted would receive no email and could never sign in — the
Task 04 definition of done ("Register → log in → reload → still authenticated") is **unreachable on
hosted** until this is changed.

`supabase config push` exists in the pinned CLI (2.114.0) and pushes `config.toml` to the linked
project, which is the version-controlled way to fix this rather than clicking in the dashboard.

### 4. `supabase/config.toml` points at the wrong dev URL

`config.toml:162` has `site_url = "http://127.0.0.1:3000"` and `:166`
`additional_redirect_urls = ["https://127.0.0.1:3000"]`. Both are untouched CLI defaults; this app
serves on `http://localhost:5173`. These become the redirect allow-list the moment any email flow
exists, so fix them before pushing config.

### 5. `VITE_SUPABASE_PUBLISHABLE_KEY` **breaks `/validate` Phase 6.1 as written**

```console
$ node -e "console.log(/VITE_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/.test('VITE_SUPABASE_PUBLISHABLE_KEY='))"
true
```

Phase 6.1 (`.claude/commands/validate.md:137`) throws on any `VITE_`-prefixed name ending in
`KEY`/`SECRET`/`TOKEN`/`PASSWORD`. The Supabase publishable key is *designed* to be public — it is
the successor to the anon key, it is what RLS assumes the browser holds, and it carries no privilege
on its own.

**Fix the check, do not rename the variable.** `validate.md:5-8` forbids working around a failing
check, and renaming a correctly-named variable to dodge a grep is exactly that. Phase 6.1 must gain
an explicit allow-list entry for `VITE_SUPABASE_PUBLISHABLE_KEY` with a comment saying why, while
still rejecting everything else.

### 6. The publishable key is the new `sb_publishable_…` format

The developer's `.env` holds a 46-character `SUPABASE_PUBLISHABLE_KEY` (not a ~200-char JWT), i.e.
the modern format. `supabase-js@2.112.3` supports it. Do not assume the value is a JWT anywhere.

### 7. `api/vitest.config.ts` can inject environment variables

`api/vitest.config.ts:7` already sets `env: { LOG_LEVEL: "silent" }`. This is where the Supabase
variables that unit tests need are supplied, so `npm test` keeps working with no `.env` present.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: YOU MUST READ THESE BEFORE IMPLEMENTING

**API**

- `api/src/repositories/receipts.ts` (lines 59-121, 168-187) — Why: the consumer of everything this
  task builds. Note `constructor(client, userId)` and that `findById` already filters
  `.eq("user_id", …)` **and** `.is("deleted_at", null)`, so a cross-user or deleted receipt comes back
  as `null`. Your route turns `null` into 404; do not add a second ownership check.
- `api/src/middleware/error-handler.ts` (all 40 lines) — Why: `HttpError(status, code)` is the only
  way to fail a request. The body is typed `ApiErrorResponse`, 4xx logs at `warn` without a stack,
  5xx logs the error. Every new failure follows this; never invent a different body.
- `api/src/app.ts` (all 32 lines) — Why: middleware order, the catch-all 404, and the rule that
  `errorHandler` stays last. You will add the receipts router between `healthRouter` and the
  catch-all.
- `api/src/config.ts` (all 57 lines) — Why: the exact validation idiom to extend — accumulate into
  `problems[]`, report **all** failures at once, freeze the result. Note `process.env["X"]` bracket
  access (required by the TS config).
- `api/src/logger.ts` (all 12 lines) — Why: `req.headers.authorization` is already redacted. Do not
  log tokens, and do not weaken this list.
- `api/src/app.test.ts` (all 22 lines) — Why: the supertest idiom (`request(createApp()).get(…)`) and
  the assertion style for error bodies.
- `api/src/repositories/receipts.integration.ts` (lines 1-67, 107-126, 163-177) — Why: **the pattern
  to mirror for your auth integration test.** Shows `admin.auth.admin.createUser({ id, email,
  password, email_confirm: true })`, `signInWithPassword`, per-user clients, and `afterAll` cleanup
  that deletes both users. Copy this structure.
- `api/vitest.config.ts` (all 9 lines) — Why: where unit-test env vars go.
- `api/vitest.integration.config.ts` (all 17 lines) — Why: integration tests are `src/**/*.integration.ts`,
  run serially with a 30 s timeout.

**Shared**

- `shared/src/api.ts` (lines 13-19, 36-44, 57-67) — Why: `apiErrorResponseSchema` is the error
  contract; `listReceiptsQuerySchema` is `.strict()` so an unknown query key such as `userId` is
  already a rejection; `updateReceiptRequestSchema` is derived from tier 1 and cannot carry `userId`.
- `shared/src/receipt.ts` (lines 75-97) — Why: `canonicalReceiptSchema` is what `GET /api/receipts/:id`
  returns, and both `id` and `userId` are `z.uuid()`.

**Client**

- `client/src/App.tsx` (all 15 lines) — Why: the route table you will restructure into public and
  protected branches.
- `client/src/main.tsx` (all 21 lines) — Why: provider nesting order. `./i18n` must stay imported
  before the first render; `AuthProvider` goes inside `BrowserRouter`.
- `client/src/components/AppLayout.tsx` (all 21 lines) — Why: the shell you add a sign-out control to,
  and the Tailwind idiom (`mx-auto max-w-3xl px-4`).
- `client/src/routes/HomePage.tsx` (lines 14-31) — Why: the effect/cancel pattern for async work, and
  the loading/online/offline state machine you will mirror for form submission state.
- `client/src/components/ErrorMessage.tsx`, `client/src/components/Spinner.tsx` — Why: reuse these,
  do not write new ones. `ErrorMessage` takes an already-translated `message` string.
- `client/src/components/LanguageSwitcher.tsx` (lines 24-33) — Why: the `min-h-11 min-w-11` touch
  target and button styling to copy for auth form buttons (PRD §11.5 requires 44 px).
- `client/src/api/client.ts` (all 19 lines) — Why: `ApiError` carries `status`. You will add the
  bearer token and the 401 reaction here.
- `client/src/i18n/index.ts` (lines 10-18) — Why: the `CustomTypeOptions` augmentation that makes
  every key compiler-checked against `en.json`. A key missing from `en.json` is a build error.
- `client/src/i18n/locales/en.json` + `hr.json` — Why: both must gain identical key sets, enforced by
  `client/src/i18n/i18n.test.ts`.
- `client/src/vite-env.d.ts` (1 line) — Why: currently only `/// <reference types="vite/client" />`.
  `client/tsconfig.json` sets `"types": []`, so custom `import.meta.env` members must be declared here
  or they will not typecheck.
- `client/src/components/LanguageSwitcher.test.tsx` — Why: the RTL + `userEvent` idiom for component
  tests under jsdom.

**Database / infra**

- `supabase/migrations/20260817122048_create_receipts.sql` (lines 90-116) — Why: the grants and RLS
  policies your token must satisfy. `authenticated` has SELECT/INSERT/UPDATE and **no DELETE**;
  `anon` has nothing. Confirms the token must carry `role: "authenticated"`.
- `supabase/config.toml` (lines 158-188, 222-237) — Why: the auth block you will correct and push.

**Process**

- `.claude/commands/validate.md` — Why: Phase 6.1 must be amended (Finding #5); Phase 4 gains rows;
  Phase 8 gains the Task 04 journey and Phase 9 loses its row 04. Read `validate.md:352-378`
  ("Maintaining this file") first — **never regenerate it**.
- `.agents/history/03-supabase-database-schema-private-storage.md` — Why: decision #4 ("The secret key
  is administrative only. Repository operations require a user-scoped client") is the constraint this
  task exists to satisfy.
- `.agents/ROADMAP.md` §4 Task 04 and §5 — Why: scope and the ten standing rules.

### New Files to Create

**API**

- `api/src/auth/authenticator.ts` — the `AuthContext` / `Authenticator` interfaces and the Supabase
  implementation built on `getClaims`.
- `api/src/auth/authenticator.test.ts` — unit tests for claim validation, driven by a stub
  `getClaims`.
- `api/src/middleware/require-auth.ts` — the Express middleware plus the `authenticated()` route
  wrapper.
- `api/src/middleware/require-auth.test.ts` — unit tests for header parsing and 401 behaviour.
- `api/src/routes/receipts.ts` — the receipts router; in this task it holds exactly one route.
- `api/src/auth/auth.integration.ts` — two-user test against the hosted project (no Docker; see
  Decision 10) proving 401, cross-user 404 and
  the forged-`userId` rejection against real JWTs.

**Client**

- `client/src/lib/supabase.ts` — the singleton browser Supabase client.
- `client/src/auth/AuthProvider.tsx` — session context and the `signIn` / `signUp` / `signOut`
  actions.
- `client/src/auth/useAuth.ts` — the context hook.
- `client/src/auth/ProtectedRoute.tsx` — loading / redirect / render gate.
- `client/src/auth/authErrors.ts` — maps Supabase `ErrorCode` values to translation keys.
- `client/src/auth/authErrors.test.ts` — proves every mapped code has a translation and unknown codes
  fall back.
- `client/src/routes/LoginPage.tsx`, `client/src/routes/RegisterPage.tsx`.
- `client/src/auth/AuthProvider.test.tsx` — sign-in success, sign-in failure copy, sign-out.
- `client/src/auth/ProtectedRoute.test.tsx` — spinner while loading, redirect when signed out.
- `client/src/api/client.test.ts` — proves the bearer header is attached and a 401 triggers sign-out.

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [`supabase.auth.getClaims()`](https://supabase.com/docs/reference/javascript/auth-getclaims)
  - Section: signature and return shape.
  - Why: the exact API this task's security rests on. Returns
    `{ data: { claims, header, signature }, error: null } | { data: null, error: AuthError }`.
- [User sessions / access token JWT claims](https://supabase.com/docs/guides/auth/sessions#access-token-jwt-claims)
  - Section: required claims.
  - Why: confirms `sub`, `role`, `exp`, `aal`, `session_id` are always present. `sub` is the user's
    UUID; `role` is `authenticated` for a signed-in user.
- [JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)
  - Section: asymmetric keys and local verification.
  - Why: explains why ES256 means no per-request network call.
- [Server-side auth patterns](https://supabase.com/docs/guides/auth/server-side)
  - Section: "Summary of the methods" — `getClaims` vs `getUser` vs `getSession`.
  - Why: justifies `getClaims` over `getUser` (which costs a network round trip per request) and over
    `getSession` (which does not verify).
- [`signUp`](https://supabase.com/docs/reference/javascript/auth-signup) /
  [`signInWithPassword`](https://supabase.com/docs/reference/javascript/auth-signinwithpassword) /
  [`onAuthStateChange`](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
  - Why: the three client calls. **`onAuthStateChange` has a documented deadlock**: never `await`
    another Supabase call inside the callback. Set state and return.
- [Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)
  - Why: the stable `error.code` strings to map to translations. The full union is in
    `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts:6`.
- [`supabase config push`](https://supabase.com/docs/reference/cli/supabase-config-push)
  - Why: applies `config.toml` auth settings to the linked hosted project (Findings #3 and #4).

### Patterns to Follow

**Error handling — API.** Only `HttpError` with a stable machine code, never prose:

```ts
// api/src/app.ts:24-26
app.use((_req, _res, next) => {
  next(new HttpError(404, "not_found"));
});
```

New codes this task introduces: `unauthorized` (401). `not_found` (404) already exists and is reused
for a receipt the caller does not own — **404, never 403**, so existence does not leak.

**Configuration — API.** Accumulate, report everything at once, freeze:

```ts
// api/src/config.ts:20, 46-57
const problems: string[] = [];
// …readers push onto problems…
if (problems.length > 0) {
  throw new Error(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
}
export const config: Config = Object.freeze(parsed);
```

**Schemas are derived, never redeclared.** From `shared/src/api.ts:65`, and the reason the PATCH body
cannot carry a `userId`. Apply the same instinct: `AuthContext` is produced in exactly one place.

**Repository errors are already categorised.** `ReceiptRepositoryError` carries
`"invalid_data" | "query_failed"` (`api/src/repositories/receipts.ts:47`). Let it propagate to
`errorHandler`, which turns any non-`HttpError` into a logged 500 `internal_error`. Do not translate
repository errors into 4xx.

**Client async work — cancel on unmount.** From `client/src/routes/HomePage.tsx:16-31`: a `cancelled`
flag set in the cleanup function, guarding every `setState`. Reuse this in `AuthProvider`.

**Client copy is always translated.** No literal user-facing string, anywhere
(`client/src/i18n/index.ts:10-18` makes keys compiler-checked). Supabase's own English error prose
must never be rendered — map `error.code` to a key.

**Touch targets.** `min-h-11` (44 px) on every interactive control, per
`client/src/components/LanguageSwitcher.tsx:31` and PRD §11.5.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Configuration and the hosted project must be correct before any code can be exercised, and the
validation harness must be corrected before it can be trusted to gate the work.

**Tasks:**

- Correct `supabase/config.toml` auth URLs; push config to the linked project so hosted and local
  agree that email confirmation is off.
- Extend `api/src/config.ts` with the required Supabase variables; drop `SUPABASE_JWKS_URL` from
  `.env.example`.
- Amend `/validate` Phase 6.1 so the publishable key is allowed while real secrets stay banned.
- Add `@supabase/supabase-js` to `client`, pinned to the same version `api` uses.

### Phase 2: Core Implementation

**Tasks:**

- `Authenticator` interface + Supabase implementation over `getClaims`, validating `sub`, `role` and
  expiry, and minting the user-scoped client.
- `requireAuth` middleware and the `authenticated()` wrapper that passes `AuthContext` as an argument.
- `GET /api/receipts/:id` returning `canonicalReceiptSchema`, or 404 when the repository returns null.
- Client: Supabase singleton, `AuthProvider`, `useAuth`, `ProtectedRoute`, error-code mapping.
- Client: login and registration screens, sign-out control, `auth.*` translations in `hr` and `en`.

### Phase 3: Integration

**Tasks:**

- Mount `requireAuth` on the `/api/receipts` **prefix** in `app.ts`, before the router, so the whole
  namespace is protected by construction.
- Attach the bearer token in `client/src/api/client.ts`; on 401 sign out so `ProtectedRoute` redirects.
- Restructure `App.tsx` into public (`/login`, `/register`) and protected branches.
- Carry over the deferred `<html lang>` / `<title>` fix from Task 02's history.

### Phase 4: Testing & Validation

**Tasks:**

- Unit tests for the authenticator, the middleware, the error mapping, `ProtectedRoute`,
  `AuthProvider` and the API client wrapper.
- An integration test against the hosted project — no Docker — proving 401, cross-user 404 and
  forged-`userId` rejection with real ES256 JWTs.
- Extend `.claude/commands/validate.md`: Phase 4 rows, the amended Phase 6.1, the new Phase 8 journey,
  and delete row 04 from Phase 9.
- Run the full `/validate` sweep.

---

## STEP-BY-STEP TASKS

Execute in order, top to bottom. Each task is atomic and independently verifiable.

### 1. UPDATE `supabase/config.toml`

- **IMPLEMENT**: Set `site_url = "http://localhost:5173"` and
  `additional_redirect_urls = ["http://localhost:5173"]`. Leave `enable_confirmations = false` as it
  already is. Change nothing else in the file.
- **PATTERN**: `supabase/config.toml:162,166`.
- **GOTCHA**: The existing `additional_redirect_urls` value uses `https://`, which is wrong for local
  development. These become the redirect allow-list once any email flow exists.
- **VALIDATE**: `node -e "const s=require('fs').readFileSync('supabase/config.toml','utf8'); if(!/site_url = \"http:\/\/localhost:5173\"/.test(s)) throw new Error('site_url not updated'); console.log('ok');"`

### 2. PUSH config to the linked hosted project

- **IMPLEMENT**: `npx --no-install supabase config push`. **Read the diff the CLI prints and confirm
  it changes only the auth URL and confirmation settings before accepting.** Check
  `npx --no-install supabase config push --help` for a dry-run flag first and prefer it.
- **GOTCHA**: This writes to the live project. It is the only step in this task that is not
  reversible from the repository alone. If the diff touches anything you did not intend, abort and
  raise it rather than accepting.
- **VALIDATE**: `curl -s https://ssczfjvbeqyrlbasfyzj.supabase.co/auth/v1/settings` — expect
  `"mailer_autoconfirm":true`.

### 3. UPDATE `.env.example`

- **IMPLEMENT**: Delete the `SUPABASE_JWKS_URL=` line (Finding #2). Add, under a new
  `# --- Client (browser) ---` heading with a comment explaining that the publishable key is designed
  to be public and carries no privilege without a user token:

  ```
  VITE_SUPABASE_URL=
  VITE_SUPABASE_PUBLISHABLE_KEY=
  ```

- **GOTCHA**: Names only, never values — Phase 6.1b enforces this, and `.env.example` is committed, so
  a pasted value enters git history permanently.
- **VALIDATE**: run the Phase 6.1b command from `validate.md:150`.

### 4. UPDATE `.claude/commands/validate.md` — Phase 6.1

- **IMPLEMENT**: Replace the 6.1 command so it keeps rejecting secret-bearing `VITE_` names but
  allow-lists `VITE_SUPABASE_PUBLISHABLE_KEY`, and add prose explaining that the publishable key is
  the successor to the anon key, is what RLS assumes the browser holds, and grants nothing without a
  user token.

  ```
  node -e "const fs=require('fs'); const ALLOWED=new Set(['VITE_SUPABASE_PUBLISHABLE_KEY']); const bad=[]; for(const line of fs.readFileSync('.env.example','utf8').split(/\r?\n/)){ const m=/^([A-Z0-9_]+)=/.exec(line.trim()); if(!m) continue; const name=m[1]; if(!name.startsWith('VITE_')) continue; if(ALLOWED.has(name)) continue; if(/(KEY|SECRET|TOKEN|PASSWORD)$/.test(name)) bad.push(name); } if(bad.length) throw new Error('secret-bearing variable carries a VITE_ prefix: '+bad.join(', ')); console.log('ok');"
  ```

- **GOTCHA**: Do not delete the check and do not rename the variable to dodge it — `validate.md:5-8`
  forbids working around a failure. Adding to `ALLOWED` in future requires the same justification.
- **VALIDATE**: run the new command; it must print `ok`. Then temporarily add
  `VITE_AZURE_DOCUMENT_INTELLIGENCE_KEY=` to `.env.example`, re-run, confirm it **throws**, and remove
  the line again.

### 5. UPDATE `api/src/config.ts`

- **IMPLEMENT**: Add `SUPABASE_URL: string` and `SUPABASE_PUBLISHABLE_KEY: string` to `Config` as
  **required** values, via a `readRequired(name, raw)` helper that pushes to `problems` when absent or
  blank. Do **not** add `SUPABASE_SECRET_KEY` (administrative scripts only, per Task 03 decision #4),
  and do not add `SUPABASE_JWKS_URL`.
- **PATTERN**: `api/src/config.ts:22-44` for the helper shape; `:46-51` for the assembly.
- **IMPORTS**: none new.
- **GOTCHA**: `process.env["X"]` bracket notation is required by this project's TS settings. Making
  these required deliberately breaks the README promise that `npm run dev` works with an empty `.env`
  — Task 12 will not thank you for a silent runtime failure instead. Update the README in task 25.
- **VALIDATE**: `npm run typecheck`

### 6. UPDATE `api/vitest.config.ts`

- **IMPLEMENT**: Extend `env` with placeholder Supabase values so unit tests never need a real `.env`:
  `SUPABASE_URL: "http://127.0.0.1:54321"`, `SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"`.
- **PATTERN**: `api/vitest.config.ts:7`.
- **GOTCHA**: These are placeholders. No unit test may make a network call to them — that is what the
  injected `Authenticator` stub is for.
- **VALIDATE**: `npx vitest run --project api`

### 7. CREATE `api/src/auth/authenticator.ts`

- **IMPLEMENT**:

  ```ts
  export interface AuthContext {
    readonly userId: string;
    readonly client: SupabaseClient<Database>;
  }

  export interface Authenticator {
    /** Returns null for any token that is absent, malformed, expired or not a signed-in user. */
    authenticate(accessToken: string): Promise<AuthContext | null>;
  }

  export function createSupabaseAuthenticator(): Authenticator;
  ```

  The implementation holds **one long-lived, session-less verifier client** (so the JWKS cache is
  reused across requests) created with `config.SUPABASE_URL` and `config.SUPABASE_PUBLISHABLE_KEY` and
  `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }`.

  `authenticate` must:
  1. `const { data, error } = await verifier.auth.getClaims(accessToken)` — return `null` on `error`
     or `data === null`.
  2. Return `null` unless `data.claims.role === "authenticated"` (rejects an `anon` token).
  3. Return `null` unless `z.uuid().safeParse(data.claims.sub).success`.
  4. Build the per-request user client:
     `createClient<Database>(url, publishableKey, { global: { headers: { Authorization: \`Bearer ${accessToken}\` } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`.
  5. Return `{ userId: data.claims.sub, client }`.

- **PATTERN**: client options mirror
  `api/src/repositories/receipts.integration.ts:163-171`.
- **IMPORTS**: `createClient, type SupabaseClient` from `@supabase/supabase-js`; `z` from `zod`
  (already a transitive dep via `@receipt/shared` — **add `zod` to `api`'s dependencies explicitly if
  it is not already listed**, do not rely on hoisting); `type Database` from `../database.types.js`;
  `config` from `../config.js`.
- **GOTCHA**: `getClaims` already validates signature and `exp`; do not re-check expiry by hand. Never
  log the token or the claims — `logger.ts` redacts the header, but a hand-written log line would
  bypass that. Return `null` for every failure mode: the middleware, not this module, decides the
  status code.
- **VALIDATE**: `npm run typecheck`

### 8. CREATE `api/src/auth/authenticator.test.ts`

- **IMPLEMENT**: Unit-test the claim-validation logic by stubbing `getClaims`. Cases: valid claims →
  `AuthContext` with the expected `userId`; `error` set → `null`; `role: "anon"` → `null`;
  non-UUID `sub` → `null`.
- **PATTERN**: `api/src/repositories/receipts.test.ts` for the mocking idiom already used in this
  workspace.
- **GOTCHA**: To keep this a true unit test, factor the claim-checking into an exported pure function
  (e.g. `userIdFromClaims(claims): string | null`) and test that directly, rather than mocking the
  whole Supabase client. Simpler and no network risk.
- **VALIDATE**: `npx vitest run --project api`

### 9. CREATE `api/src/middleware/require-auth.ts`

- **IMPLEMENT**: Two exports.

  ```ts
  export function requireAuth(authenticator: Authenticator): RequestHandler;
  export function authenticated(
    handler: (req: Request, res: Response, auth: AuthContext) => Promise<void> | void,
  ): RequestHandler;
  ```

  `requireAuth` parses `Authorization`, requiring exactly the `Bearer <token>` form (case-insensitive
  scheme, non-empty token). Anything missing or malformed, or an `authenticate` that resolves `null`,
  fails with `next(new HttpError(401, "unauthorized"))`. On success it stores the context on
  `res.locals` and calls `next()`.

  `authenticated` reads that context, passes it to the handler as a **third argument**, and forwards
  any rejection to `next` so async errors reach `errorHandler`. If the context is absent — which can
  only happen if a route is wired without `requireAuth` — it must fail loudly as a 500-class error,
  not silently as a 401.

- **PATTERN**: `HttpError` from `./error-handler.js`; `api/src/app.ts:24-26` for the `next(err)` idiom.
- **IMPORTS**: `type NextFunction, type Request, type RequestHandler, type Response` from `express`;
  `HttpError` from `./error-handler.js`; `type AuthContext, type Authenticator` from
  `../auth/authenticator.js`.
- **GOTCHA**: Express 5 forwards a rejected promise from a handler automatically, but **not** from a
  middleware you wrote as `async`; wrap the `authenticate` call in try/catch and `next(err)` so a
  Supabase outage becomes a logged 500 rather than an unhandled rejection. The `authenticated()`
  wrapper is what makes `AuthContext` a parameter instead of an optional property on `Request` — do
  not replace it with `declare global { namespace Express { interface Request { auth?: … } } }`,
  because an optional property lets a future route read `req.auth!` and lose the guarantee.
- **VALIDATE**: `npm run typecheck`

### 10. CREATE `api/src/middleware/require-auth.test.ts`

- **IMPLEMENT**: Drive a tiny Express app with a stub `Authenticator`. Cases: no header → 401
  `{"error":{"code":"unauthorized"}}`; `Authorization: Basic xyz` → 401; `Bearer` with empty token →
  401; authenticator returns `null` → 401; authenticator throws → 500 `internal_error`; success →
  handler receives the stub's `userId`.
- **PATTERN**: `api/src/app.test.ts:1-13` for the supertest idiom.
- **VALIDATE**: `npx vitest run --project api`

### 11. CREATE `api/src/routes/receipts.ts`

- **IMPLEMENT**: A `Router` with exactly one route:

  ```ts
  receiptsRouter.get("/:id", authenticated(async (req, res, auth) => { … }));
  ```

  Validate `req.params.id` with `z.uuid()`; a malformed id is `HttpError(400, "invalid_request")`.
  Construct `new ReceiptRepository(auth.client, auth.userId)`, call `findById`, and throw
  `HttpError(404, "not_found")` when it returns `null`. Otherwise `res.json(receipt)`.

- **PATTERN**: `api/src/routes/health.ts` for router shape; `receipts.ts:98-109` for `findById`.
- **GOTCHA**: **Do not add a second ownership check.** `findById` already filters on `user_id` and
  `deleted_at`, and RLS enforces it again at the database. A soft-deleted receipt correctly returns
  404 too. Returning 403 instead of 404 would leak that the id exists — the roadmap is explicit about
  this. Do **not** implement POST, DELETE, `/source` or the paged list here; they belong to Tasks 05
  and 10.
- **VALIDATE**: `npm run typecheck`

### 12. UPDATE `api/src/app.ts`

- **IMPLEMENT**: Give `createApp` an optional dependency bag —
  `createApp(options: { authenticator?: Authenticator } = {})` — defaulting to
  `createSupabaseAuthenticator()`. Mount:

  ```ts
  app.use("/api/receipts", requireAuth(authenticator), receiptsRouter);
  ```

  between the health router and the catch-all 404.

- **PATTERN**: `api/src/app.ts:22-29`.
- **GOTCHA**: Mounting `requireAuth` on the **prefix** rather than per-route is the point: it means
  `GET /api/receipts` (no route defined yet) still returns 401 without a token, and every route Task
  05 adds is protected by default rather than by remembering. Build the default authenticator
  **lazily inside the function**, not at module scope, so importing `app.ts` in a test does not
  construct a Supabase client. `errorHandler` must remain the last `app.use`.
- **VALIDATE**: `npx vitest run --project api`

### 13. UPDATE `api/src/app.test.ts`

- **IMPLEMENT**: Add cases using an injected stub authenticator: `GET /api/receipts/<uuid>` with no
  header → 401 `{"error":{"code":"unauthorized"}}`; `GET /api/receipts` (the undefined list route)
  with no header → **401, not 404**, proving prefix-level protection; `GET /api/receipts?userId=…`
  with no header → 401.
- **GOTCHA**: Keep the existing health and unknown-route tests untouched.
- **VALIDATE**: `npx vitest run --project api`

### 14. UPDATE `scripts/run-supabase-integration-tests.mjs` — make hosted the default target

- **IMPLEMENT**: Today this script hard-requires the Docker stack: it shells out to `supabase status`
  and exits if that fails (`scripts/run-supabase-integration-tests.mjs:7-15`). Change it to resolve
  its target explicitly rather than assuming Docker:
  - Default (`npm run test:integration`): read `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
    `SUPABASE_SECRET_KEY` and `STORAGE_BUCKET` from `.env` via
    `node --env-file-if-exists=.env`, exactly as `db:provision-storage` already does
    (`package.json:32`). No Docker.
  - Opt-in (`npm run test:integration:local`): keep the current `supabase status` path for schema
    work.
  - **Print the resolved target host loudly before running** so nobody discovers after the fact that
    a run touched the hosted project.
- **PATTERN**: `package.json:32` for the `--env-file-if-exists` idiom Task 03 established.
- **GOTCHA**: Do not make this an automatic silent fallback from local to hosted. A developer who
  believes they are hitting a disposable local database while actually writing to the real project is
  the exact failure this split exists to prevent. Two named scripts, one printed target.
- **VALIDATE**: `npm run test:integration` prints the hosted host and runs without Docker.

### 15. CREATE `api/src/auth/auth.integration.ts`

- **IMPLEMENT**: Mirror `receipts.integration.ts` exactly — create users A and B with
  `admin.auth.admin.createUser({ id, email, password, email_confirm: true })`, sign both in, and use
  their **real access tokens** against `createApp()` with the **real** `createSupabaseAuthenticator()`.
  Seed one receipt owned by A through `ReceiptRepository`. Assert:
  1. No `Authorization` header → 401.
  2. `Bearer not-a-jwt` → 401.
  3. A's token, A's receipt → 200 and `userId === userAId`.
  4. **B's token, A's receipt → 404** (the cross-user proof).
  5. A's token, a random UUID → 404.
  6. A's token plus a body or query carrying `userId: <B's id>` has no effect — the response is still
     scoped to A.
  7. A soft-deleted receipt returns 404 to its own owner.
- **PATTERN**: `api/src/repositories/receipts.integration.ts:12-67` for setup/teardown; delete both
  users in `afterAll`.
- **GOTCHA**: This file must end in `.integration.ts` to be picked up by
  `api/vitest.integration.config.ts` and excluded from `npm test`. `config.ts` is read at **module
  load**, but the runner script sets the environment in the child process before Vitest starts, so a
  normal top-level import of `app.ts` is fine — verify this holds.

  **This test runs against the hosted project, not Docker** (see Decision 10). That makes cleanup
  load-bearing rather than cosmetic:
  - Give both users a distinctive, greppable email prefix — `task04-a-<uuid>@example.test` — so any
    orphan left by a crashed run can be found and removed.
  - `afterAll` must `admin.auth.admin.deleteUser` both users **unconditionally**, including when
    assertions failed. Because `receipts.user_id` is declared
    `references auth.users (id) on delete cascade`
    (`supabase/migrations/20260817122048_create_receipts.sql:3`), deleting the user removes the seeded
    receipt with it — cleanup is structural, not something the test has to remember row by row.
  - Never reuse a fixed UUID or email between runs; generate them per run with `randomUUID()` as
    `receipts.integration.ts:12-19` already does.
  - Admin-created users with `email_confirm: true` send **no** email, so this does not consume the
    project's email quota.
- **VALIDATE**: `npm run test:integration` (no Docker)

### 16. UPDATE `client/package.json`

- **IMPLEMENT**: Add `"@supabase/supabase-js": "2.112.3"` to `dependencies` — the exact version `api`
  pins (`api/package.json`), so npm dedupes to a single copy.
- **GOTCHA**: Expect the client bundle to grow noticeably (Task 02 grew it 286 → 360 kB adding Zod and
  big.js). Record the new figure in the history file as expected, not as a regression.
- **VALIDATE**: `npm install` then `npm run build`

### 17. UPDATE `client/src/vite-env.d.ts`

- **IMPLEMENT**: Declare the two custom variables so `import.meta.env` typechecks:

  ```ts
  /// <reference types="vite/client" />

  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
  ```

- **GOTCHA**: `client/tsconfig.json` sets `"types": []`, so this file is the only place these can be
  declared.
- **VALIDATE**: `npm run typecheck`

### 18. CREATE `client/src/lib/supabase.ts`

- **IMPLEMENT**: A module-scope singleton:

  ```ts
  export const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
  );
  ```

  Throw a clear developer-facing error at module load if either variable is missing.

- **GOTCHA**: One instance only — a second instance means two localStorage listeners and duplicated
  refresh timers. `detectSessionInUrl: false` is correct because this task ships no email link flow;
  revisit it if password reset is ever added. This error message is for developers, not users, so it
  is the one place an untranslated string is acceptable — the app cannot boot without it.
- **VALIDATE**: `npm run typecheck`

### 19. CREATE `client/src/auth/authErrors.ts` and its test

- **IMPLEMENT**: `authErrorKey(code: string | undefined): TranslationKey` mapping Supabase codes to
  `auth.errors.*` keys, with `auth.errors.generic` as the fallback. Map at minimum:
  `invalid_credentials`, `email_exists`, `user_already_exists`, `weak_password`,
  `email_address_invalid`, `validation_failed`, `over_request_rate_limit`,
  `over_email_send_rate_limit`, `signup_disabled`, `email_not_confirmed`.
- **PATTERN**: the code union lives at
  `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts:6`.
- **GOTCHA**: **Never render `error.message`** — it is untranslated English prose from Supabase and
  would violate PRD §7.13. Always go through this map. The test must assert every mapped key exists in
  both `en.json` and `hr.json`, mirroring `client/src/i18n/warnings.test.ts`, because Phase 6.5 only
  scans literal `t("…")` calls and cannot follow a computed key.
- **VALIDATE**: `npx vitest run --project client`

### 20. CREATE `client/src/auth/AuthProvider.tsx` + `useAuth.ts` + `ProtectedRoute.tsx`

- **IMPLEMENT**:
  - `AuthProvider` holds `{ session, loading }`; on mount calls `supabase.auth.getSession()` and
    subscribes with `supabase.auth.onAuthStateChange`, unsubscribing on cleanup. Exposes
    `signIn(email, password)`, `signUp(email, password)`, `signOut()`, each returning
    `{ errorKey } | null` rather than throwing, so forms can render translated copy.
  - `useAuth()` throws if used outside the provider.
  - `ProtectedRoute` renders `<Spinner />` while `loading`, `<Navigate to="/login" replace />` when
    there is no session, and `<Outlet />` otherwise.
- **PATTERN**: `client/src/routes/HomePage.tsx:16-31` for the cancel-on-unmount idiom;
  `client/src/components/Spinner.tsx` for the loading indicator.
- **GOTCHA**: **Never `await` another Supabase call inside the `onAuthStateChange` callback** — it
  deadlocks the auth client. Set state and return. `loading` must start `true` and only clear after
  the first `getSession()` resolves, or an authenticated user sees the login screen flash on every
  reload. React 19 StrictMode double-invokes effects, so the unsubscribe must be correct.
- **VALIDATE**: `npm run typecheck`

### 21. CREATE `client/src/routes/LoginPage.tsx` and `RegisterPage.tsx`

- **IMPLEMENT**: Controlled email/password forms. Native `<form onSubmit>` with
  `type="email"`/`type="password"`, `autoComplete="email"` and `current-password`/`new-password`,
  `required`, and `inputMode` suited to mobile. Disable the submit button while in flight and render a
  `<Spinner />`. On failure render `<ErrorMessage message={t(errorKey)} />`. On success
  `navigate("/", { replace: true })`. Each page links to the other.
- **PATTERN**: `client/src/components/LanguageSwitcher.tsx:31` for `min-h-11` touch targets;
  `client/src/components/ErrorMessage.tsx` for the error surface (pass an already-translated string).
- **GOTCHA**: React Hook Form is in the PRD stack table but is **not installed** and is not needed for
  two fields — Task 09 introduces it for the review form. Do not add it here (CLAUDE.md §2). Every
  label, placeholder, button and error must come from `t(…)`.
- **VALIDATE**: `npx vitest run --project client`

### 22. UPDATE `client/src/App.tsx`, `main.tsx`, `AppLayout.tsx`

- **IMPLEMENT**:
  - `main.tsx`: wrap `<App />` in `<AuthProvider>` **inside** `<BrowserRouter>` (the provider needs
    router context for redirects).
  - `App.tsx`: `/login` and `/register` as public routes inside `AppLayout`; the index route and the
    catch-all behind `<ProtectedRoute>`.
  - `AppLayout.tsx`: render a translated sign-out button in the header when a session exists.
  - **Carried-over fix** (deferred by Task 02's history, which assigned it to "whichever task next
    owns the app shell"): add an effect that sets `document.documentElement.lang = i18n.resolvedLanguage`
    and `document.title = t("common.appName")`, and remove the hardcoded Croatian `<title>` from
    `client/index.html`. Today a fresh load in English still advertises `lang="hr"` and a Croatian tab
    title, which is a PRD §7.13 violation.
- **GOTCHA**: The catch-all `*` route must stay **inside** the protected branch so an unknown URL does
  not become an authentication bypass. Keep the not-found page reachable and translated. If the
  reviewer prefers to keep this task strictly surgical, the `lang`/`title` fix is the one item here
  that can be dropped without affecting the definition of done — flag it in the history file either
  way.
- **VALIDATE**: `npm run build`

### 23. UPDATE `client/src/api/client.ts` + `client.test.ts`

- **IMPLEMENT**: A private `request(path, init)` that reads
  `const { data } = await supabase.auth.getSession()` and sets
  `Authorization: Bearer ${data.session.access_token}` when a session exists. On a 401 response, call
  `await supabase.auth.signOut()` before throwing `ApiError(401)`, so `onAuthStateChange` fires,
  `AuthProvider` clears the session and `ProtectedRoute` performs the redirect. Keep `getHealth()`
  working unauthenticated.
- **PATTERN**: `client/src/api/client.ts:13-19`.
- **GOTCHA**: `getSession()` transparently refreshes an expiring token — do not hand-roll refresh
  logic. Calling `signOut()` on an already-signed-out client is a no-op, so there is no redirect loop.
  Do not sign out on 403 or 404. The test asserts the header is attached and that a 401 triggers
  exactly one `signOut`.
- **VALIDATE**: `npx vitest run --project client`

### 24. UPDATE `client/src/i18n/locales/en.json` and `hr.json`

- **IMPLEMENT**: Add an `auth.*` namespace with identical key sets in both files: `signIn`, `signUp`,
  `signOut`, `email`, `password`, `submitting`, `noAccount`, `haveAccount`, plus `auth.errors.*` for
  every code mapped in task 18 and `auth.errors.generic`.
- **GOTCHA**: `client/src/i18n/i18n.test.ts` fails if the key sets differ or any value is empty.
  Translate properly into Croatian — do not paste the English string to make the test pass.
- **VALIDATE**: `npx vitest run --project client`

### 25. UPDATE `README.md`

- **IMPLEMENT**: Update the status banner to Task 04; add `GET /api/receipts/:id` and the 401
  convention to the API table; document the `Authorization: Bearer` contract; add `VITE_SUPABASE_URL`
  and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Configuration table and **remove `SUPABASE_JWKS_URL`**;
  correct the "no credentials needed" claim now that `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are
  required at startup; add a short **Authentication** section covering `getClaims`, why the secret key
  is still never used at request time, and why cross-user access is 404 rather than 403; note that
  email confirmation is disabled and password reset is deferred.
- **GOTCHA**: `/validate` Phase 6.6 cross-checks scripts, backticked file paths, local links and the
  Configuration table against `.env.example`. A stale row fails the build.
- **VALIDATE**: run the Phase 6.6 command from `validate.md:196`.

### 26. UPDATE `.claude/commands/validate.md` — Phases 4, 7, 8, 9

- **IMPLEMENT**:
  - Phase 4 table: one row per new test file describing what it protects.
  - **Split Phase 7 in two**, so the Docker-dependent half only runs when it has something to
    validate:
    - **7a — Schema and migrations (Docker).** Everything Phase 7 lists today: `db:start`, two
      consecutive `db:reset` runs, `db:lint`, `db:test` (pgTAP), `db:types`,
      `npm run test:integration:local`, `supabase migration list --local`. State plainly that this
      phase is **required whenever `supabase/migrations/` changes and skippable when it does not** —
      and that skipping it must be reported, per the Reporting rule. Task 04 changes no SQL, so it is
      skipped here with that reason recorded.
    - **7b — Live integration (no Docker).** `npm run test:integration` against the hosted project,
      covering `receipts.integration.ts` and the new `auth.integration.ts`. Required on **every**
      task. Note that it creates and deletes two disposable users per run and that a failed run may
      leave orphans findable by the `task04-` email prefix.
  - Phase 8: add journey **8.5 — register → log in → reload → log out**, including
    `GET /api/receipts/<uuid>` without a token returning 401 and the cross-user 404.
  - Phase 9: delete the row for Task 04.
- **GOTCHA**: Hand-extend only. Never re-run `/ultimate_validate_command` — `validate.md:352-378`
  explains it would silently delete ~140 lines earned from real incidents. Splitting 7 must **not**
  drop any command that exists there today; every one of them moves into 7a intact.
- **VALIDATE**: `npm run format:check`

### 27. RUN the full validation sweep

- **IMPLEMENT**: Every phase of `/validate` in order: Phases 0–6, **7b** (hosted integration, no
  Docker), and the Phase 8 browser checks. Phase 7a is skipped for this task because it adds no
  migration — record that skip and its reason in the history file rather than letting the phase look
  green.
- **GOTCHA**: Before Phase 8, run the port-cleanup command from `validate.md:276` and confirm Vite
  reports **5173**. A stale Vite on 5173 answers while the new one moves to 5174+, so checks pass
  against old code.
- **VALIDATE**: `npm run validate`, then the Phase 6, 7b and 8 commands.

---

## TESTING STRATEGY

### Unit Tests (`npm test` — no Docker, no network)

| File | Protects |
|---|---|
| `api/src/auth/authenticator.test.ts` | Claims are only accepted when `role === "authenticated"` and `sub` is a UUID; every rejection path returns `null` rather than throwing |
| `api/src/middleware/require-auth.test.ts` | Missing, malformed and non-Bearer headers all fail 401 `unauthorized`; an authenticator that throws becomes a 500, not a silent 401; a success passes the right `userId` |
| `api/src/app.test.ts` (extended) | The whole `/api/receipts` prefix answers 401 without a token — including paths with no route defined |
| `client/src/auth/authErrors.test.ts` | Every mapped Supabase code has an `hr` and `en` message; unknown codes fall back to `auth.errors.generic` |
| `client/src/auth/AuthProvider.test.tsx` | Sign-in success exposes a session; failure yields a translated key, never Supabase prose; sign-out clears the session |
| `client/src/auth/ProtectedRoute.test.tsx` | Spinner while loading, redirect to `/login` when signed out, children when signed in |
| `client/src/api/client.test.ts` | The bearer token is attached when a session exists; a 401 triggers exactly one `signOut` |

### Integration Tests (`npm run test:integration` — hosted project, real ES256 JWTs, no Docker)

`api/src/auth/auth.integration.ts` runs the real `createSupabaseAuthenticator` against the **hosted**
Supabase project with two disposable users, proving the seven assertions listed in task 15. This is
the only place the cross-user 404 can be proven honestly, because it needs genuine ES256 tokens and
live RLS — and per Decision 10, only the hosted project actually issues ES256, so this is also the
only place the production verification path is exercised at all.

### Edge Cases

- `Authorization` present but not `Bearer` (`Basic`, or `Bearer` with an empty token).
- A well-formed JWT signed by a different project (must fail — the JWKS will not match).
- An expired token (`getClaims` validates `exp`).
- A token whose `sub` is not a UUID, and one whose `role` is `anon`.
- A receipt id that is not a UUID → 400 `invalid_request`, not a 500 from `z.uuid().parse`.
- A soft-deleted receipt requested by its own owner → 404.
- Supabase unreachable during verification → 500 `internal_error`, logged with the error, never 401
  (an outage must not look like a rejected credential).
- Language switch on the login screen: all copy including error messages re-renders translated.

---

## VALIDATION COMMANDS

Run from `prototypes/receipt-ocr/`. PowerShell 5.1 is the shell — `&&` is a parser error at the
prompt; chain with `;` or run separately. `npm run <script>` chains internally and is fine.

### Level 1: Syntax & Style

```
npm run lint
npm run typecheck
npm run format:check
```

`npm run typecheck` is authoritative — oxlint has no type-aware rules. Do not pipe it through
`Select-Object`/`head`; the pipe masks exit code 2.

### Level 2: Unit Tests

```
npm test
npx vitest run --project api
npx vitest run --project client
npx vitest run --project shared
```

### Level 3: Integration Tests — no Docker

```
npm run test:integration
```

Runs `receipts.integration.ts` and `auth.integration.ts` against the **hosted** project. Confirm the
script prints the hosted host before it runs, and that both disposable users are gone afterwards:

```
node --env-file-if-exists=.env -e "const {createClient}=require('@supabase/supabase-js'); const a=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY); a.auth.admin.listUsers().then(r=>console.log(r.data.users.filter(u=>u.email?.startsWith('task04-')).map(u=>u.email)))"
```

Expected: an empty array. Anything listed is an orphan from a crashed run — delete it.

**The Docker path is deliberately not run for this task.** Task 04 changes no SQL, so migration
repeatability, pgTAP and `db:types` have nothing new to prove. If you do change a migration, Phase 7a
becomes mandatory:

```
npm run db:start
npm run db:reset
npm run db:test
npm run test:integration:local
```

### Level 4: Manual Validation

```
foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "cleaned port $p" } else { "port $p free" } }
npm run dev
```

Confirm Vite reports **5173**, then:

```
try { Invoke-WebRequest -Uri "http://localhost:3001/api/receipts" -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected `401`, body `{"error":{"code":"unauthorized"}}`.

In the browser at <http://localhost:5173>:

1. Visiting `/` while signed out redirects to `/login`, with no flash of the home page.
2. Register a new account → land on the home page authenticated.
3. Reload → still authenticated, no login flash.
4. Toggle HR/EN on the login screen → all copy switches, including a failed-login error.
5. Sign out → redirected to `/login`; navigating back to `/` redirects again.
6. Sign in with a wrong password → translated error, never English Supabase prose.
7. At 375 px width the forms are usable one-handed with 44 px targets and no horizontal overflow.
8. `document.documentElement.lang` matches the active language on a fresh load, and the tab title is
   translated.

### Level 5: Additional Validation

```
curl -s https://ssczfjvbeqyrlbasfyzj.supabase.co/auth/v1/settings
```

Expect `"mailer_autoconfirm":true` after task 2. Then use the Supabase MCP `get_advisors` tool for
both `security` and `performance` and confirm no new findings.

---

## ACCEPTANCE CRITERIA

Roadmap Task 04 definition of done, plus what this plan adds:

- [ ] Register → log in → reload the page → still authenticated → log out → protected route redirects
      to login.
- [ ] `GET /api/receipts` without a token returns **401**.
- [ ] An automated test proves user B gets **404** for user A's receipt id.
- [ ] An automated test proves a forged `userId` in a request body or query has no effect.
- [ ] The API derives identity only from the verified token; `SUPABASE_SECRET_KEY` is never read on a
      request path.
- [ ] Every string a user can see is translated in both `hr` and `en`; no Supabase error prose is
      rendered.
- [ ] `SUPABASE_JWKS_URL` is gone from `.env.example` and the README.
- [ ] `/validate` Phase 6.1 allows `VITE_SUPABASE_PUBLISHABLE_KEY` and still rejects a
      `VITE_`-prefixed real secret (proven by temporarily adding one).
- [ ] Hosted `mailer_autoconfirm` is `true` and `config.toml` is the record of why.
- [ ] All of `/validate` passes, including Phase 7b (hosted integration) and the Phase 8 browser
      checks. Phase 7a (Docker/schema) is skipped because this task changes no SQL — and that skip is
      **reported**, not quietly treated as green.
- [ ] No `task04-` test user is left behind in the hosted project after the run.
- [ ] No route outside `/api/health` is reachable without a token.

---

## COMPLETION CHECKLIST

- [ ] All 27 tasks completed in order
- [ ] Each task's validation command passed immediately after it
- [ ] Full `/validate` sweep green, with any skipped phase named and justified
- [ ] `.claude/commands/validate.md` hand-extended (Phases 4, 6.1, 7, 8) and row 04 deleted from
      Phase 9
- [ ] `README.md` updated and Phase 6.6 passes
- [ ] `.agents/history/04-authentication-ownership-enforcement.md` written using the ROADMAP §1
      template, recording the decisions below
- [ ] `.agents/ROADMAP.md` progress table row 04 flipped to ✅ with plan and history links
- [ ] Client bundle size delta recorded as expected, not a regression

---

## NOTES

### Decisions this plan makes, for the history file

1. **`getClaims` over `getUser`, and no `jose`.** The hosted project signs ES256, so verification is
   local via WebCrypto with a cached JWKS — no network round trip per request. `getUser` would cost
   one. `supabase-js` is already a dependency, so this adds nothing to install.
2. **`SUPABASE_JWKS_URL` deleted.** It only existed for a hand-rolled verifier that is no longer the
   approach. Unreferenced configuration rots.
3. **`AuthContext` is a handler parameter, not `req.auth`.** A route cannot read a user id without
   having been authenticated, which is the same instinct as Task 02's two-tier schema split. The
   alternative — augmenting `Express.Request` with `auth?: AuthContext` — was rejected because an
   optional property invites `req.auth!` and loses the guarantee.
4. **`requireAuth` is mounted on the `/api/receipts` prefix, not per route.** Every route Task 05 adds
   is protected by default. It is also what makes `GET /api/receipts` return 401 before the list route
   exists.
5. **Exactly one receipt route ships here: `GET /api/receipts/:id`.** It is the minimum needed to prove
   the cross-user 404. `POST`, `DELETE` and `/source` stay in Task 05; the paged list stays in Task 10.
   Task 05's scope note already anticipates the list endpoint moving, so record that Task 04 did
   **not** take it.
6. **Cross-user access returns 404, never 403.** Existence must not leak. This falls out of
   `findById` returning `null` — no extra guard is written, so there is no second code path to keep in
   sync.
7. **Email confirmation is disabled on the hosted project.** Required, because Supabase's built-in
   SMTP would never deliver to a test address and the definition of done would be unreachable.
   Tradeoff: email addresses are unverified. Acceptable for a PoC that has no email flow at all;
   record it as a known limitation for Task 12.
8. **Password reset is deferred.** PRD §7.1 and the roadmap both qualify it with "if readily
   available from the provider". It is not: it needs custom SMTP, an email template, a redirect
   allow-list entry, `detectSessionInUrl: true`, and a set-new-password screen. That is a task, not a
   freebie. Record the deferral explicitly rather than letting it look forgotten.
9. **`/validate` Phase 6.1 was tightened, not bypassed.** The publishable key is public by design; the
   check now allow-lists it by name and still rejects every other `VITE_`-prefixed secret.
10. **Integration tests run against the hosted project, not Docker.** Two reasons, and the second is
    the important one.

    First, cost: Task 04 changes no SQL, so migration repeatability, pgTAP and `db:types` determinism
    have nothing new to validate. Starting a container to re-prove Task 03 is not verification, it is
    ceremony.

    Second, **fidelity — the local stack would have exercised the wrong code path.** The hosted
    project signs **ES256** (Finding #1), so `getClaims` verifies in-process via WebCrypto against a
    cached JWKS. `supabase/config.toml:172` leaves `signing_keys_path` commented out, so the local
    stack falls back to the legacy symmetric JWT secret — and against a symmetric key `getClaims`
    takes a **different branch entirely**, sending a network request to the auth server to validate.
    A Docker-based auth test would therefore have passed while never running the verification path
    production uses. Hosted is both faster and more truthful here.

    This is strongly indicated rather than directly observed — Docker was not running during
    planning. Confirm it in one command if the local stack is ever up, and correct this note if it
    turns out otherwise:

    ```
    curl -s http://127.0.0.1:54321/auth/v1/.well-known/jwks.json
    ```

    An empty `keys` array, or a 404, confirms symmetric signing locally.

    The trade is that tests now touch the real project, which is why cleanup in task 15 is
    structural (cascade delete on user removal) rather than left to the test to remember. Supabase
    branching would isolate this properly, but the project has no branches and branching is a paid
    feature — not worth it for a PoC. Revisit if orphaned test users ever become a nuisance.

### Risks

- **`supabase config push` writes to the live project** (task 2). It is the only irreversible step.
  Review the printed diff; abort if it touches anything beyond the auth URL and confirmation
  settings.
- **Making `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` required breaks a documented promise** that
  `npm run dev` works with an empty `.env`. This is deliberate — fail fast at boot beats a confusing
  401 at runtime — but the README must be corrected in the same commit, or Phase 6.6 will disagree
  with reality.
- **Integration tests now write to the real project** (Decision 10). The blast radius is two
  disposable users per run whose receipts cascade away on delete, but a crashed run can leave
  orphans. The Level 3 section has the command to list them. If auth rate limits ever bite — a
  handful of signups and sign-ins per run is well inside them today — that is the signal to
  reconsider branching.
- **Per-request `createClient`** allocates a client per authenticated request. Correct and what the
  Supabase server-side docs do, but if Task 12's latency measurements show it mattering, the fix is a
  small keyed cache, not abandoning RLS.
- **The `lang`/`title` carry-over (task 22)** is the one item not strictly required by the definition
  of done. It is included because Task 02's history assigned it to the next task that owns the app
  shell and because it is a live PRD §7.13 violation, but it is the clean thing to drop if the
  reviewer wants a tighter diff.

### Out of scope — do not build

Roles, companies, tenants, accountants, approval workflows, MFA, SSO (PRD §4.6, §9.5). Also not here:
password reset (see decision 8), the paged list endpoint (Task 10), upload and `/source` (Task 05),
and React Hook Form (Task 09).

**Confidence score: 8.5/10** for one-pass success. The API half is well-constrained by existing
patterns and the repository contract. The two points of residual risk are `supabase config push`
behaving as expected against the hosted project, and the client-side session bootstrap, where the
`loading` flag and the `onAuthStateChange` deadlock rule have to be right or the symptoms are
confusing (a login-screen flash, or a hung auth client).
