# Task 04 — Authentication & ownership enforcement

**Date:** 2026-08-18
**Plan:** `.agents/plans/authentication-ownership-enforcement.md`
**Hosted project:** `ssczfjvbeqyrlbasfyzj`

## What was built

Task 03 left a repository and a set of RLS policies that both required a user-scoped Supabase
client, and nothing in the application could produce one. Task 04 closes that gap end to end.

The API verifies the Supabase access token with `getClaims`, which — because the hosted project
signs **ES256** — happens in-process against a cached JWKS with no network round trip per request.
`userId` comes from the token's `sub` claim and from nowhere else. A token is accepted only when its
`role` is `authenticated` and its `sub` is a UUID, so neither an `anon` nor a `service_role` token
can pass for a session.

Identity reaches a route as a **function argument**, not as a property on the request. `requireAuth`
guards the `/api/receipts` **prefix** rather than individual routes, so a path with no route defined
yet answers 401, and every route Task 05 adds is protected by default rather than by remembering.
One route ships here — `GET /api/receipts/:id` — which is the minimum needed to prove that another
user's receipt returns **404, not 403**.

On the client, `AuthProvider` restores and tracks the session, `ProtectedRoute` gates the routes, and
a 401 from any API call signs out so the redirect happens in one place. Every string is translated in
`hr` and `en`; Supabase's English error prose is never rendered — error codes are mapped to keys.

## Files created / modified

**API**

- Created `src/auth/authenticator.ts`, `src/auth/authenticator.test.ts`, `src/auth/auth.integration.ts`.
- Created `src/middleware/require-auth.ts`, `src/middleware/require-auth.test.ts`.
- Created `src/routes/receipts.ts`.
- Modified `src/app.ts` (dependency bag, prefix guard), `src/app.test.ts`, `src/config.ts`
  (required Supabase values), `vitest.config.ts`, `package.json` (explicit `zod`).

**Client**

- Created `src/lib/supabase.ts`, `src/auth/AuthContext.ts`, `src/auth/AuthProvider.tsx`,
  `src/auth/useAuth.ts`, `src/auth/ProtectedRoute.tsx`, `src/auth/authErrors.ts`,
  `src/components/AuthForm.tsx`, `src/routes/LoginPage.tsx`, `src/routes/RegisterPage.tsx`.
- Created tests: `src/auth/authErrors.test.ts`, `src/auth/AuthProvider.test.tsx`,
  `src/auth/ProtectedRoute.test.tsx`, `src/api/client.test.ts`.
- Modified `src/App.tsx`, `src/main.tsx`, `src/components/AppLayout.tsx`, `src/api/client.ts`,
  `src/vite-env.d.ts`, `src/i18n/locales/{en,hr}.json`, `index.html`, `vite.config.ts`,
  `vitest.config.ts`, `package.json`.

**Infrastructure and process**

- `supabase/config.toml` — auth URLs corrected; MFA and email-rate settings pinned (see Deviations).
- `scripts/run-supabase-integration-tests.mjs` — two named targets instead of one Docker assumption.
- `package.json` — `test:integration` (hosted) and `test:integration:local` (Docker).
- `.env.example`, `README.md`, `.claude/commands/validate.md`.

## Decisions made

1. **`getClaims` over `getUser`, and no `jose`.** ES256 means local verification via WebCrypto
   against a cached JWKS. `getUser` would cost a network round trip on every authenticated request;
   `getSession` does not verify at all. No new dependency.
2. **`SUPABASE_JWKS_URL` deleted.** `supabase-js` derives the JWKS endpoint from `SUPABASE_URL`, so
   the variable only ever existed for a hand-rolled verifier that is no longer the approach.
3. **`AuthContext` is a handler parameter, not `req.auth`.** An optional property on `Request` would
   invite `req.auth!` in a future route and lose the guarantee. `authenticated()` used without
   `requireAuth` fails as a 500, never as a 401, so a wiring bug cannot masquerade as a credential
   problem.
4. **`requireAuth` guards the prefix.** Proven by a test asserting that `GET /api/receipts` — a path
   with no route — returns 401 rather than 404.
5. **Exactly one receipt route ships here.** `POST`, `DELETE` and `/source` stay in Task 05. **Task 04
   did not take the paged list endpoint**; per Task 05's scope note, it remains Task 10's.
6. **Cross-user access returns 404.** It falls out of `findById` already filtering `user_id` and
   `deleted_at`; no second ownership check was written, so there is no third copy of the rule to keep
   in sync. A soft-deleted receipt returns 404 to its own owner too.
7. **Email confirmation disabled on hosted.** Required — Supabase's built-in SMTP would never deliver
   to a test address, making the definition of done unreachable. Tradeoff: email addresses are
   unverified. Recorded as a known limitation for Task 12.
8. **Password reset deferred.** It needs custom SMTP, a template, a redirect allow-list entry,
   `detectSessionInUrl: true` and a set-new-password screen. That is a task, not a freebie.
9. **`/validate` Phase 6.1 tightened, not bypassed.** The publishable key is public by design, so it
   is allow-listed **by name** with the reasoning written down; every other secret-shaped `VITE_`
   name is still rejected, and this was proven by temporarily adding one and watching it throw.
10. **Integration tests default to the hosted project.** Not for convenience but for fidelity: the
    local stack leaves `signing_keys_path` commented out and falls back to the legacy symmetric
    secret, where `getClaims` takes a different verification branch entirely. A Docker-based auth
    test would have passed while never exercising the path production uses. Cleanup is structural —
    `receipts.user_id` is `on delete cascade`, so deleting the disposable user removes its rows.

## Deviations from the plan

1. **`supabase config push` changed more than the plan scoped, and gave no chance to refuse.** The
   plan said to read the printed diff and abort if it touched anything unintended. The CLI printed
   the diff and applied it in the same breath — there is no prompt and no dry-run flag. Beyond the
   intended `site_url`, `additional_redirect_urls` and `enable_confirmations`, it also pushed three
   untouched CLI defaults onto the project: MFA TOTP `enroll_enabled`/`verify_enabled` `true → false`,
   email `max_frequency` `1m0s → 1s`, and `otp_length` `8 → 6`. Two of those weaken the project
   (MFA capability switched off, an anti-abuse email limit relaxed). All three were restored by
   pinning the hosted values in `config.toml` and pushing again, with comments explaining why the
   CLI default is wrong here. **Anyone running `config push` in a later task should assume every
   untouched default in `config.toml` is about to become the project's real configuration.**
2. **`client/vite.config.ts` needed `envDir`** — not in the plan. Vite's project root is `client/`,
   so it never reads the repository's single root `.env`; every `VITE_` variable would have silently
   been `undefined` and the app would have thrown at boot. Verified with `loadEnv` before and after.
3. **`client/vitest.config.ts` also needed placeholder env values.** The plan only anticipated this
   for `api`, but the client Supabase singleton throws at import time when its variables are absent.
4. **The two auth screens share an `AuthForm` component.** They differ only in copy, autocomplete and
   destination, so two near-identical pages would have been duplication. The in-flight state is a
   disabled button labelled `auth.submitting` rather than the `Spinner` the plan suggested — a
   spinner beside a disabled button says the same thing twice. `ProtectedRoute` still uses `Spinner`.
5. **`AuthContext` lives in its own module**, separate from `AuthProvider.tsx`, so tests can inject a
   fake context without constructing the provider.
6. **`zod` was added to `api`'s dependencies explicitly.** It was already imported by
   `src/repositories/receipts.ts` and resolving only through hoisting — a pre-existing latent break.
7. **`api/src/auth/auth.integration.ts` asserts one case more than planned:** a non-UUID id returns
   400 `invalid_request` rather than a 500 from an unguarded parse.
8. **Phase 6.5 caught a literal translation call inside one of my own code comments** and failed. The
   comment was reworded rather than the check weakened.
9. **Prettier reformatted two pre-existing untracked files** — `.mcp.json` and
   `.claude/settings.local.json` — which were already failing `format:check` before this task began.

## Validation results

```
Phase 0  Clean install ........ PASS — no ERESOLVE; supabase-js deduped to one copy
Phase 1  Lint ................. PASS — oxlint, zero errors
Phase 2  Typecheck ............ PASS — tsc --build, exit 0
Phase 3  Format ............... PASS — all files match Prettier
Phase 4  Unit tests ........... PASS — 15 files, 190 tests (was 149)
Phase 5  Build ................ PASS — bundle 780.81 kB, gzip 227.07 kB
Phase 6.1  VITE_ secrets ...... PASS — and proven to still throw on a real secret
Phase 6.1b .env.example ....... PASS — names only
Phase 6.2  Bundle secrets ..... PASS — no service_role, Azure key or JWT in dist
Phase 6.3  .gitignore ......... PASS
Phase 6.4  No committed .env .. PASS — .env untracked
Phase 6.5  Translation keys ... PASS — after rewording one comment
Phase 6.6  Docs match code .... PASS — scripts, paths, links, env table
Phase 6.7  Log redaction ...... PASS — unchanged; no new line logs a token or claims
Phase 6.8  Money never float .. PASS
Phase 7a Schema (Docker) ...... SKIPPED — no migration changed; only config.toml
Phase 7b Hosted integration ... PASS — 2 files, 11 tests, real ES256 tokens
Phase 8  Journeys ............. PASS — HTTP and browser, see below
Advisors security/performance . PASS — no findings of either kind
```

Phase 8 was run against real servers with Vite confirmed on **5173** (both 3001 and 5173 were held by
stale processes at the start and had to be cleaned — exactly the failure the port check exists for).

- `/api/receipts` (no route defined) without a token → `401 {"error":{"code":"unauthorized"}}`, not
  404, which is the prefix guard proving itself.
- `/api/receipts/:id` without a token, and with `Bearer not-a-jwt` → 401 in both cases.
- Registered a real account → landed signed in; reloaded → still signed in with no login flash.
- Language toggle switches every label, and a failed sign-in rendered
  "Neispravna e-adresa ili lozinka." — never Supabase's English prose.
- Signed out → redirected to `/login`; `/` and an unknown URL both redirect again while signed out,
  so the catch-all route is not an authentication bypass.
- `document.documentElement.lang` and the tab title follow the active language, closing the
  §7.13 violation Task 02 deferred.
- At 375 px: no horizontal overflow, and every interactive control measured exactly 44 px tall.

The cross-user 404 is proven in `auth.integration.ts` rather than by hand, because it needs two real
accounts and genuine ES256 tokens. **No test user was left behind** — the hosted project reports zero
users after every run, including the browser account, which was deleted explicitly.

**Client bundle grew from ~360 kB to 780.81 kB (gzip 227.07 kB)** on adding `@supabase/supabase-js`.
This is expected, not a regression, and it is the figure Task 12 should measure code-splitting
against.

## Known gaps / follow-ups

- **Password reset is not implemented** (decision 8). It needs its own task if the PoC ever wants it.
- **Email addresses are unverified** because confirmation is disabled (decision 7). Task 12 should
  state this plainly rather than let it look like an oversight.
- **Phase 7a was skipped** — no migration changed. It becomes mandatory again the moment
  `supabase/migrations/` does.
- **A Supabase client is allocated per authenticated request.** Correct, and what the server-side
  docs do, but if Task 12's latency measurements show it mattering, the fix is a small keyed cache,
  not abandoning RLS.
- **`config push` overwrites hosted settings from every default in `config.toml`** (deviation 1).
  Worth a moment's diff-reading in any later task that touches it.
- Task 05 owns upload, `/source` and `DELETE`; Task 10 still owns the paged list endpoint.
