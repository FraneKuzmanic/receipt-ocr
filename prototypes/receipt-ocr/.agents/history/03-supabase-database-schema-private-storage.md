# Task 03 — Supabase database schema & private storage

**Date:** 2026-08-17
**Plan:** `.agents/plans/supabase-database-schema-private-storage.md`
**Hosted project:** `ssczfjvbeqyrlbasfyzj`

## What was built

Task 03 establishes the persistence boundary for later authentication, upload and OCR work. A pinned
Supabase CLI owns a repeatable local migration workflow, while the API receives a typed repository
that accepts a user-scoped client and returns only validated canonical domain objects.

`public.receipts` stores UUID ownership, source-file metadata, status, canonical and extraction JSON,
warnings and lifecycle timestamps. `canonical_data` is authoritative. Seller name, issue date,
document number, exact `numeric` total and currency are stored generated projections, so application
code cannot create dual-write drift.

The authenticated role has only SELECT, INSERT and UPDATE. Owner RLS covers reads, inserts and updates;
the update policy has both `using` and `with check`, so ownership cannot be reassigned. Normal repository
reads exclude soft-deleted rows, and there is no table DELETE grant or policy.

The private `receipt-sources` bucket uses `<user_id>/<receipt_id>/source`. Four `storage.objects`
policies scope SELECT, INSERT, UPDATE and DELETE to the authenticated user's first path segment. The
remote bucket is provisioned through the Storage API rather than by writing Storage metadata in SQL.

## Files created / modified

- `supabase/config.toml`, `supabase/seed.sql`, the receipt migration and pgTAP suite.
- `api/src/database.types.ts` and `api/src/repositories/receipts.ts` with unit and integration tests.
- `api/vitest.integration.config.ts`, `scripts/run-supabase-integration-tests.mjs` and
  `scripts/provision-storage.mjs`.
- Root/API package manifests and lockfile for pinned Supabase dependencies and database scripts.
- Shared receipt UUID validation and affected test fixtures.
- `.env.example`, `README.md`, `.prettierignore` and `.claude/commands/validate.md`.

## Decisions made

1. **Canonical JSON remains the money source of truth.** PostgreSQL `numeric` is an exact generated
   query projection, but the repository returns the canonical decimal string so `"100.50"` retains
   its scale.
2. **One query-matched partial index replaces separate speculative indexes.**
   `(user_id, created_at desc) where deleted_at is null` matches owner history reads and avoids a
   low-selectivity standalone `deleted_at` index.
3. **RLS is backed by explicit privileges.** SQL-created tables are not assumed to be exposed to the
   Data API; the migration grants authenticated SELECT/INSERT/UPDATE and nothing to `anon`.
4. **The secret key is administrative only.** Repository operations require a user-scoped client.
   The secret key appears only in bucket provisioning and isolated test-fixture setup/cleanup.
5. **Remote deployment uses the committed migration.** MCP was used for read-only inspection and
   verification; it was not used to bypass migration history with ad-hoc schema mutation.

## Deviations and reviewed runtime behavior

- The generated Supabase type describes PostgreSQL `numeric` as `number` and lists stored generated
  columns in Insert/Update shapes. Repository input types omit those columns, canonical money never
  reads the numeric projection, and pgTAP proves PostgreSQL rejects generated-column writes.
- Local Storage v1.69 returns HTTP 400 for an unsigned request through a private bucket's public URL;
  hosted versions may return 403/404. The integration assertion accepts these denial statuses and
  still requires the authenticated owner path to succeed while a second user is denied.
- `db:provision-storage` uses Node's built-in optional `.env` loading so the documented hosted command
  works while still allowing local validation to inject disposable credentials through the process
  environment.

## Validation results

```
Application validation .... PASS — typecheck, lint, format, 149 unit tests
Production build .......... PASS — Vite bundle and all TypeScript workspaces
Database reset ............ PASS — two consecutive clean rebuilds
Database lint ............. PASS — no schema errors
pgTAP ..................... PASS — 33 contract, constraint, privilege and RLS assertions
Local integration ......... PASS — 3 repository, two-user RLS and private Storage tests
Generated types ........... PASS — identical SHA-256 across consecutive generations
Remote migration .......... PASS — 20260817122048_create_receipts applied once
Remote bucket ............. PASS — receipt-sources exists, public=false; provisioner is idempotent
Remote security advisor ... PASS — no findings
Remote performance advisor  REVIEWED — fresh empty-table unused-index informational finding only
Final remote dry run ...... PASS — project is up to date; no migrations, seeds or roles pending
```

Hosted metadata verification confirmed an empty RLS-enabled `public.receipts` table, exactly three
authenticated privileges, three owner receipt policies, four path-scoped Storage policies, the
partial history index and the private bucket. No disposable hosted users or receipt data were created;
the equivalent two-user behavior was exercised against the real local Supabase stack and all fixtures
were cleaned.

On 2026-08-18, the final pre-commit validation reran dependency installation, lint, typecheck,
formatting, all 149 unit tests, the production build, security checks and workspace tests successfully.
At the user's request, the Docker-backed local Supabase and live-browser reruns were skipped because
their full suites had already passed on 2026-08-17. Read-only hosted verification instead reconfirmed
the migration, RLS and grants, all receipt and Storage policies, the private bucket and the partial
history index. The hosted security advisor remained clear; the performance advisor reported only the
expected informational unused-index notice for the empty table.

## Follow-ups

- Task 04 wires authenticated user clients into API middleware; Task 03 deliberately adds no auth
  routes or session handling.
- Task 05 uses the private object path from the upload endpoint; Task 03 deliberately uploads no
  production source documents.
- Re-evaluate the history index only after real traffic exists. An unused-index advisor result is
  expected immediately after deployment to an empty table and is not evidence that the query-matched
  index should be removed.
