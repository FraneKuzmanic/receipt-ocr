# Feature: Supabase database schema & private storage

The following plan is complete, but validate the referenced documentation, repository patterns, and task assumptions immediately before implementation. Pay particular attention to the current Supabase CLI behavior, generated database types, and existing user changes in `.env.example` and `README.md`.

## Feature Description

Provision Task 03's Supabase persistence foundation: a migration-managed `public.receipts` table, owner-only Row Level Security (RLS), a private source-document bucket, generated TypeScript database types, and an API repository that maps database rows to the shared canonical receipt model. Add repeatable local reset, seed, database-test, type-generation, and remote deployment procedures.

This task creates the persistence boundary only. Authentication middleware and UI wiring remain Task 04; receipt-upload endpoints and file ingestion remain Task 05.

## User Story

As a receipt application developer,
I want a secure, typed, migration-managed Supabase persistence layer,
So that later API tasks can store and retrieve each user's receipts and source documents without bypassing ownership controls or leaking provider-specific database rows.

## Problem Statement

The application has canonical receipt schemas but no durable database, storage bucket, database authorization, or repository. Subsequent work cannot safely persist receipts until the schema, exact-decimal behavior, ownership policies, private object layout, and local/remote migration workflow are established and tested.

## Solution Statement

Adopt the Supabase CLI as a pinned root development dependency and `@supabase/supabase-js` as a pinned API dependency. Create one forward-only SQL migration for the receipt table, explicit API privileges, row policies, storage-object policies, and query-matched indexes. Configure the local private bucket declaratively, and use a small idempotent administrative script to provision the equivalent remote bucket through the Storage API rather than mutating storage metadata directly.

Generate a typed `Database` interface and inject a user-scoped `SupabaseClient<Database>` into a repository. The repository will store canonical JSON, return only shared canonical domain objects, normalize system timestamps, and perform soft deletes. SQL pgTAP tests will verify database invariants and RLS; Vitest integration tests will verify the repository and private Storage behavior against the local Supabase stack.

## Feature Metadata

**Feature Type**: New Capability

**Estimated Complexity**: High

**Primary Systems Affected**: Supabase Postgres, Supabase Storage, API repository layer, shared receipt validation, local development and validation tooling

**Dependencies**: Docker Desktop, Node.js 24, npm workspaces, Supabase CLI `2.114.0`, `@supabase/supabase-js` `2.112.3`, local Supabase services, linked Supabase project `ssczfjvbeqyrlbasfyzj`

---

## ASSUMPTIONS AND LOCKED DECISIONS

These decisions remove implementation ambiguity. Change them only after human review.

- **Scope boundary**: no auth middleware, browser session integration, routes, upload endpoint, OCR workflow, or UI work. Task 03 may create authenticated test users solely as test fixtures.
- **Identifiers**: use standard Supabase-compatible UUIDs (`uuid` with `gen_random_uuid()` for receipts and `auth.users.id` for owners). Do not add a UUIDv7 extension for this PoC.
- **Object key**: use `receipt-sources/<user_id>/<receipt_id>/source`. Store the original filename and content type on the receipt row; do not place untrusted filenames in object keys.
- **Bucket provisioning**: configure the local bucket in `supabase/config.toml`. Provision/update the remote bucket through the Storage API with the server-only secret key. Do not insert/update `storage.buckets` or `storage.objects` metadata from application SQL.
- **Repository authorization**: inject a user-scoped Supabase client into the repository. Never use `SUPABASE_SECRET_KEY` in normal repository operations because it bypasses RLS. The secret key is restricted to bucket provisioning and isolated test-fixture administration.
- **Canonical source of truth**: `canonical_data` is authoritative. Promoted columns are stored generated columns derived from it, preventing dual-write drift.
- **Exact decimals**: store promoted total as unconstrained PostgreSQL `numeric`, but return the canonical JSON string through the repository. Database tests must compare `total::text` and the JSON value to prove `"100.50"` is retained canonically. Leading-zero input such as `"007"` remains exact in JSON even though its generated numeric projection is `7`.
- **Timestamps**: use `timestamptz` in PostgreSQL. Map system timestamps to `new Date(value).toISOString()` before shared-schema validation because PostgREST may return a valid offset representation that differs from the shared schema's normalized shape.
- **Soft delete**: expose SELECT/INSERT/UPDATE only. A soft delete is an update to `deleted_at`; do not grant DELETE or create a hard-delete policy.
- **Index refinement**: prefer one query-matched partial index on `(user_id, created_at desc) where deleted_at is null`. It supports owner history queries and RLS while avoiding a low-selectivity standalone `deleted_at` index. This deliberately refines the roadmap's suggested separate `deleted_at` index; obtain reviewer approval before execution.
- **Migration repeatability**: migrations are immutable and applied once in production. Satisfy the roadmap's "idempotent to re-run" requirement by proving a clean rebuild/reset can be run repeatedly and reaches the same state; do not wrap every statement in `if not exists`, which can hide drift and broken migration history.
- **No speculative indexes**: do not add JSONB GIN or promoted-column indexes until a concrete query requires them.
- **Existing worktree**: preserve the current user edits in `.env.example` and `README.md`; make only Task 03 additions to overlapping files.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — Read Before Implementing

- `.agents/ROADMAP.md:247` - Authoritative Task 03 goal, scope, exclusions, and definition of done.
- `.agents/ROADMAP.md:285` - Task 04 auth ownership work that must not leak into this task.
- `.agents/ROADMAP.md:319` - Task 05 upload work that must not be implemented early.
- `.claude/commands/plan-feature.md:1` - Planning and validation expectations that produced this plan.
- `package.json:14` - Root workspace scripts; add database lifecycle commands here and keep `validate` deterministic.
- `package.json:27` - Root development dependencies; pin the Supabase CLI exactly and commit the lockfile update.
- `api/package.json:7` - API scripts and dependency conventions.
- `api/src/config.ts:13` - Current aggregate environment-validation pattern. Extend only with runtime values actually consumed by Task 03.
- `api/src/logger.ts:7` - Existing secret/file/signed-URL redaction. Do not log database URLs, keys, object contents, or signed URLs.
- `api/src/middleware/error-handler.ts:6` - Stable machine-code error policy. Repository/provider prose must not escape into future HTTP responses.
- `api/vitest.config.ts:1` - Existing unit-test configuration; keep local-service integration tests out of the normal unit suite.
- `api/tsconfig.json:1` and `api/tsconfig.test.json:1` - API compilation boundaries and test compiler behavior.
- `shared/src/receipt.ts:30` - Canonical decimal-string total field that must remain the API/domain source of truth.
- `shared/src/receipt.ts:83` - Canonical receipt schema; tighten `id` and `userId` to UUID validation and preserve camelCase domain naming.
- `shared/src/receipt.ts:91` - ISO timestamp expectations that require DB timestamp normalization in the mapper.
- `shared/src/api.ts:1` - API DTOs derive from shared schemas; the repository must return domain types, not Supabase row types.
- `.env.example:17` - Existing Supabase environment naming and warning that the secret key bypasses RLS.
- `README.md:301` - Existing configuration documentation; extend surgically with Task 03 setup and commands.
- `.gitignore:1` - Add only Supabase CLI-generated transient paths confirmed after `supabase init`.

### New Files to Create

- `supabase/config.toml` - Supabase local-stack configuration, including private `receipt-sources` bucket.
- `supabase/migrations/<cli_timestamp>_create_receipts.sql` - Forward migration for table, constraints, generated columns, privileges, RLS, policies, and indexes. Generate the timestamp with the CLI; do not invent it manually.
- `supabase/seed.sql` - Documented, repeatable seed entry point. Keep it empty/comment-only unless a stable non-user seed is genuinely required.
- `supabase/tests/database/receipts.test.sql` - pgTAP database contract, privilege, RLS, projection, and exact-decimal tests.
- `api/src/database.types.ts` - Generated Supabase types; do not hand-edit.
- `api/src/repositories/receipts.ts` - Typed repository and explicit row-to-domain mapper.
- `api/src/repositories/receipts.test.ts` - Fast mapper/query-contract unit tests using a narrow test double where useful.
- `api/src/repositories/receipts.integration.ts` - Local-stack repository, RLS, and private Storage integration tests; deliberately not named `*.test.ts`.
- `api/vitest.integration.config.ts` - Integration-only Vitest configuration with serial execution and explicit environment requirements.
- `scripts/provision-storage.mjs` - Idempotent administrative Storage API provisioning for the remote private bucket.
- `scripts/run-supabase-integration-tests.mjs` - Reads local CLI status JSON, injects local test credentials without printing them, and launches the integration suite.

### Files to Modify

- `package.json` and `package-lock.json` - Pin the CLI and add database lifecycle/validation scripts.
- `api/package.json` - Pin `@supabase/supabase-js` and add integration-test script if workspace-local invocation is useful.
- `shared/src/receipt.ts` and its existing tests - Validate persisted receipt/user identifiers as UUIDs.
- `.env.example` - Keep every Task 03 value blank (including `STORAGE_BUCKET=`) and document `receipt-sources` as the required local value in its comment/README; retain the existing publishable/secret key naming and names-only security check.
- `README.md` - Document Docker prerequisite, local reset/test/type workflow, bucket path, remote linking/push/provisioning, and IPv4 session-pooler note.
- `.gitignore` - Ignore only confirmed local Supabase temporary artifacts.
- `.claude/commands/validate.md` - Add a database/integration phase by hand while preserving all current validation phases and commands.

### Relevant Documentation — Read Before Implementing

- [Supabase local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows) - Migration, linking, pull/push, and deployment model.
- [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started) - Docker-backed local stack and status/start/stop behavior.
- [Supabase local development overview](https://supabase.com/docs/guides/local-development/overview) - Migration and seed workflow.
- [Supabase CLI config reference](https://supabase.com/docs/guides/local-development/cli/config) - `[storage.buckets.<name>]` private-bucket configuration.
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) - `auth.uid()`, owner policies, and update-policy requirements.
- [Supabase testing overview](https://supabase.com/docs/guides/local-development/testing/overview) - pgTAP database tests plus application-level tests.
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) - Required `storage.objects` policies for uploads/downloads.
- [Storage ownership](https://supabase.com/docs/guides/storage/security/ownership) - `owner_id` semantics and service-key bypass warning.
- [Private bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals) - Authenticated download/signed URL behavior.
- [Creating Storage buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets) - Server-client bucket administration.
- [Storage schema design](https://supabase.com/docs/guides/storage/schema/design) - Treat storage metadata as read-only; perform object operations through the API.
- [Generated TypeScript types](https://supabase.com/docs/reference/javascript/typescript-support) - `Database` generation and typed client usage.
- [Supabase JavaScript auth configuration](https://supabase.com/docs/reference/javascript/auth) - Disable session persistence/refresh/URL detection in server-side test clients.
- [Supabase JavaScript error handling](https://supabase.com/docs/guides/api/handling-errors-in-supabase-js) - Check `{ data, error }` at every boundary.
- [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres) and [IPv4/IPv6 compatibility](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP) - Use Supavisor session mode from this IPv4-only development environment.
- [Breaking change: new SQL-created tables are not automatically API-exposed](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) - Add explicit grants in the migration; RLS alone is insufficient.
- [PostgreSQL generated columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html) - Stored generated promoted fields.
- [PostgreSQL exact numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html) - Exact decimal storage and output considerations.

### Patterns to Follow

**Naming conventions**

- SQL identifiers and storage metadata: lowercase `snake_case`.
- TypeScript domain values: existing `camelCase` shared schemas.
- TypeScript imports within API/shared source: preserve the repository's `.js` relative-import suffix convention.
- Environment variables: preserve `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `STORAGE_BUCKET`, and `DATABASE_URL` names already documented.

**Boundary mapping**

- Keep the Supabase-generated `Database` row type at the infrastructure boundary.
- Map every snake_case row explicitly to `CanonicalReceipt`; parse `canonical_data` and `warnings` with shared schemas.
- Do not cast an unvalidated row with `as CanonicalReceipt`, expose raw JSON/provider output, or use the generated numeric column to build the canonical total.

**RLS and privileges**

- Enable RLS and grant only `select`, `insert`, and `update` to `authenticated`.
- Use `(select auth.uid()) = user_id`, not a bare `auth.uid()` call, and specify `to authenticated` on each policy.
- INSERT: `with check`; SELECT: `using`; UPDATE: both `using` and `with check` so a user cannot reassign ownership.
- Add no `anon` privileges and no DELETE privilege/policy.
- Storage policies must pin `bucket_id = 'receipt-sources'` and compare the first object-key folder with `(select auth.uid())::text`.

**Dependency and error handling**

- Pin exact versions, consistent with the repository's package manifests.
- Every Supabase operation checks and handles `error`; repository errors may carry a stable internal category and cause, but must not publish raw provider prose.
- Never log keys, database URLs, source contents, raw provider JSON, or signed URLs.

---

## IMPLEMENTATION PLAN

### Phase 1: Supabase Tooling and Local Foundation

Pin dependencies, initialize the Supabase directory through the CLI, declare the local private bucket, and add non-interactive lifecycle commands. Establish the exact environment contract without committing credentials.

### Phase 2: Database Schema, Privileges, and Policies

Create a single forward migration containing the receipt schema, validation constraints, generated query columns, least-privilege grants, owner-only receipt policies, private storage-object policies, and the partial history index.

### Phase 3: Generated Types and Repository Boundary

Generate the database types and add a user-client-injected repository with explicit mapping, UUID validation, timestamp normalization, CRUD methods, and soft-delete filtering.

### Phase 4: Database, Repository, RLS, and Storage Tests

Add pgTAP contract tests and local-stack Vitest integration tests, including cross-user denial, decimal preservation, repeatable reset, and unsigned private-object access.

### Phase 5: Remote Provisioning and Documentation

Document and validate the local workflow, repair the developer-only connection string to use Supavisor session mode if needed, link the project, preview/apply migrations, provision the private remote bucket, and run post-deployment advisors and smoke checks.

---

## STEP-BY-STEP TASKS

Execute every task in order. Each step is intentionally narrow and has an immediate validation.

### 1. UPDATE `package.json`, `api/package.json`, and `package-lock.json`

- **IMPLEMENT**: Install root dev dependency `supabase@2.114.0` and API dependency `@supabase/supabase-js@2.112.3` with exact versions. Add root scripts for `db:start`, `db:stop`, `db:reset`, `db:lint`, `db:test`, `db:types`, `db:provision-storage`, and `test:integration` using `npx --no-install supabase` or npm workspace commands.
- **PATTERN**: Preserve exact dependency pinning and existing workspace script composition in `package.json:14` and `api/package.json:7`.
- **GOTCHA**: Do not use a global CLI or a floating `latest` tag. Do not make normal `npm test` start Docker or require Supabase.
- **VALIDATE**: Run `npm install`, then `npm ls supabase @supabase/supabase-js`.

### 2. CREATE `supabase/config.toml`, `supabase/seed.sql`, and confirmed ignore entries

- **IMPLEMENT**: Run `npx --no-install supabase init`; review generated files before editing. Configure project identity and `[storage.buckets."receipt-sources"]` with `public = false`. Keep `seed.sql` comment-only unless the CLI requires content. Add only generated transient paths to `.gitignore`.
- **PATTERN**: Follow the CLI config reference, not a hand-built directory approximation.
- **GOTCHA**: Do not set a size or MIME allowlist before Task 05 defines supported uploads. Do not overwrite an existing file blindly if a future execution finds prior initialization.
- **VALIDATE**: Run `npx --no-install supabase start`, then `npx --no-install supabase status`.

### 3. CREATE `supabase/migrations/<cli_timestamp>_create_receipts.sql`

- **IMPLEMENT**: Generate the file with `npx --no-install supabase migration new create_receipts`. Create `public.receipts` with:
  - `id uuid primary key default gen_random_uuid()`;
  - `user_id uuid not null references auth.users(id) on delete cascade`;
  - non-empty text columns `source_object_path`, `source_original_filename`, and `source_content_type`;
  - checked status text with the four shared states (`processing`, `review`, `confirmed`, `failed`) and default `processing`;
  - non-null `canonical_data jsonb default '{}'::jsonb` constrained to an object;
  - nullable `original_extraction`, `extraction_metadata`, `qr_extraction`, and `raw_provider_result` JSONB;
  - non-null `warnings jsonb default '[]'::jsonb` constrained to an array;
  - stored generated `seller_name` text, `issue_date` ISO `yyyy-mm-dd` text, `document_number` text, `total numeric`, and `currency` text projections derived with guarded/null-safe expressions from `canonical_data`;
  - `created_at` and `updated_at` non-null `timestamptz` defaults plus nullable `confirmed_at` and `deleted_at`.
- **PATTERN**: Use lowercase identifiers, exact `numeric`, and database constraints from the Supabase Postgres best-practice skill. Let the repository set `updated_at`; do not add a public trigger function solely for this table.
- **GOTCHA**: A malformed total/date in JSON must fail predictably rather than silently corrupt promoted data. Match the exact shared JSON keys. Generated columns must not be included in inserts/updates.
- **VALIDATE**: `npm run db:reset`

### 4. ADD receipt privileges, RLS policies, and indexes to the same migration

- **IMPLEMENT**: Revoke/default-deny access as necessary, explicitly grant SELECT/INSERT/UPDATE to `authenticated`, enable RLS, and add owner SELECT/INSERT/UPDATE policies with `(select auth.uid()) = user_id`. Add the partial `(user_id, created_at desc) where deleted_at is null` index.
- **PATTERN**: UPDATE must have both `using` and `with check`; policies explicitly target `authenticated`.
- **GOTCHA**: The 2026 API-exposure change means grants are mandatory. RLS does not replace table privileges. Do not grant DELETE, expose to `anon`, or use a secret client to validate these policies.
- **VALIDATE**: Run `npm run db:reset`, then `npm run db:lint`.

### 5. ADD private Storage object policies to the migration

- **IMPLEMENT**: Add SELECT, INSERT, UPDATE, and DELETE policies on `storage.objects` for the fixed bucket. Require `bucket_id = 'receipt-sources'` and `(storage.foldername(name))[1] = (select auth.uid())::text`; for ownership-sensitive updates/deletes, also use `owner_id = (select auth.uid())::text` where compatible with the current Storage schema. Include both `using` and `with check` for UPDATE/upsert behavior.
- **PATTERN**: The path's first segment is the authenticated user UUID; Task 05 will use a user JWT so Storage records receive an owner.
- **GOTCHA**: Do not alter Storage tables or ownership; add policies only. Do not use `service_role` to exercise normal file access because it bypasses RLS.
- **VALIDATE**: Run `npm run db:reset`, then `npm run db:lint`.

### 6. CREATE `supabase/tests/database/receipts.test.sql`

- **IMPLEMENT**: Add a transaction-scoped pgTAP suite that creates two auth users/claims and verifies table shape, constraints, generated fields, explicit privileges, owner CRUD, cross-owner denial, ownership-reassignment denial, and absence of hard delete. Assert canonical JSON total equals `"100.50"` and generated `total::text` equals `100.50`. Verify normal projection behavior for nullable promoted fields and leading-zero canonical strings.
- **PATTERN**: Set JWT claims/role in the database session and test as `authenticated`, not as `postgres`, for RLS assertions.
- **GOTCHA**: Plan the pgTAP assertion count exactly, roll back fixtures, and never rely on test order or persistent seeded users.
- **VALIDATE**: `npx --no-install supabase test db --local supabase/tests/database/receipts.test.sql`

### 7. GENERATE `api/src/database.types.ts`

- **IMPLEMENT**: Run the CLI against the reset local database and commit the public-schema TypeScript output. Add `db:types` as the sole regeneration command.
- **PATTERN**: Import the generated `Database` type into infrastructure code only.
- **GOTCHA**: Do not hand-edit generated output. Confirm generated promoted columns are non-insertable/non-updatable. Regeneration must be deterministic after a clean reset.
- **VALIDATE**: Run `npm run db:types`, then `npm run typecheck`.

### 8. UPDATE `shared/src/receipt.ts` and existing receipt-schema tests

- **IMPLEMENT**: Change persisted canonical receipt `id` and `userId` from generic strings to UUID validation. Update fixtures to stable valid UUIDs and add invalid-UUID rejection coverage.
- **PATTERN**: Keep the current Zod-first schema/type derivation and existing test location/naming.
- **GOTCHA**: Do not change field optionality, decimal-string behavior, or timestamp semantics beyond the UUID contract required by persistence.
- **VALIDATE**: Run `npm test -- shared/src/receipt.test.ts`, then `npm run typecheck`.

### 9. CREATE `api/src/repositories/receipts.ts`

- **IMPLEMENT**: Export a repository class or factory that accepts `SupabaseClient<Database>` and provides typed create, find-by-id, list-current, update, and soft-delete operations. Define narrow create/update inputs for persisted non-generated fields. Explicitly map rows to `CanonicalReceipt`, parse canonical JSON/warnings, normalize DB timestamps, set `updated_at` on mutations, and return `null` for an absent/deleted receipt where appropriate.
- **PATTERN**: Use `.js` relative imports, shared canonical types, `.eq('user_id', userId)` as defense in depth, `.is('deleted_at', null)` on normal reads, and descending `created_at` ordering for list queries.
- **GOTCHA**: The client JWT, not a caller-supplied user ID, is the authority. Never return a generated row directly, read canonical total from the numeric projection, accept generated-column writes, use the secret key, or leak raw Supabase errors.
- **VALIDATE**: Run `npm run typecheck`, then `npm run lint`.

### 10. CREATE `api/src/repositories/receipts.test.ts`

- **IMPLEMENT**: Unit-test the explicit row mapper, timestamp normalization, canonical/warnings validation failure, not-found behavior, soft-delete timestamp mutation, list filtering, and list ordering using the smallest practical typed test double.
- **PATTERN**: Match existing Vitest tests under `api/src/**/*.test.ts` and use deterministic UUID/timestamp fixtures.
- **GOTCHA**: Do not duplicate RLS/database assertions in mocks or build a general fake Supabase client. Leave database truth to pgTAP and integration tests.
- **VALIDATE**: `npm test -- api/src/repositories/receipts.test.ts`

### 11. CREATE `api/vitest.integration.config.ts`, `api/src/repositories/receipts.integration.ts`, and `scripts/run-supabase-integration-tests.mjs`

- **IMPLEMENT**: Configure serial, local-only integration execution. The runner obtains local service values from `supabase status -o json`, passes them as child-process environment variables without logging them, and launches the integration config. Tests use an administrative fixture client only to create/delete users and cleanup; each repository/storage action uses a separately signed-in user client with server auth options disabling persistence, token refresh, and URL detection.
- **IMPLEMENT**: Cover insert/read/update, exact canonical `"100.50"`, soft delete and exclusion from list/find, user B unable to read/update user A's row, path ownership, authenticated owner upload/download/delete, cross-user Storage denial, and unsigned object URL returning 403/404.
- **PATTERN**: Keep `*.integration.ts` outside `api/vitest.config.ts`'s normal `*.test.ts` suite so `npm test` remains fast and Docker-independent.
- **GOTCHA**: Do not print local/remote keys, reuse one client across users, call public URL success a private-bucket test, or leave fixture users/objects behind. Use unique UUID paths and `finally` cleanup.
- **VALIDATE**: `npm run test:integration`

### 12. CREATE `scripts/provision-storage.mjs`

- **IMPLEMENT**: Require `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `STORAGE_BUCKET`; use a non-persisting server Supabase client. Read the bucket, create it private if absent, or update it to `public: false` if present with the wrong visibility. Exit non-zero with a safe summary for all other failures.
- **PATTERN**: Use the Storage API for bucket metadata and restrict the secret key to this administrative entry point.
- **GOTCHA**: Never echo environment values or embed the project URL/key. Do not upload an object in this script. Do not loosen MIME/size restrictions speculatively.
- **VALIDATE**: Parse `npx --no-install supabase status -o json` in PowerShell, set `SUPABASE_URL` from `API_URL`, `SUPABASE_SECRET_KEY` from the local `SERVICE_ROLE_KEY`, and `STORAGE_BUCKET` to `receipt-sources` for that process; then run `npm run db:provision-storage`. Never print the parsed object.

### 13. UPDATE `.env.example`, `README.md`, `.gitignore`, and `.claude/commands/validate.md`

- **IMPLEMENT**: Document the fixed bucket name, key roles, Docker daemon prerequisite, local start/reset/test/type commands, repeatable reset/seed behavior, object path, RLS client rule, remote link/dry-run/push/provision sequence, and cleanup. Keep `STORAGE_BUCKET=` blank in `.env.example` and name `receipt-sources` in an adjacent comment/README so the existing names-only secret check still passes. Add a database phase to the validation command without replacing existing phases.
- **PATTERN**: Preserve the existing configuration table at `README.md:301` and current blank-secret policy in `.env.example:17`.
- **GOTCHA**: The current workstation's direct `db.<project-ref>.supabase.co` connection timed out because it is IPv6-only. Document using the project's Supavisor **session** pooler URI for CLI/direct-Postgres work on IPv4-only networks. Never commit `.env` or a credential-bearing URL.
- **VALIDATE**: Run `npm run format:check`, then `rg -n "receipt-sources|db:reset|db:test|Supavisor|SUPABASE_SECRET_KEY" README.md .env.example .claude/commands/validate.md`.

### 14. VALIDATE a repeatable clean local database lifecycle

- **IMPLEMENT**: Start local Supabase, reset twice, run database lint/tests, regenerate types, and confirm the second run is clean. Review schema diff/migration status so repeatability does not depend on untracked dashboard state.
- **PATTERN**: Local migration files are the source of truth; generated types follow the final migration.
- **GOTCHA**: Docker is installed on the planning workstation but its daemon was not running. Start Docker Desktop before this step. Do not weaken tests to work around an unavailable daemon.
- **VALIDATE**: Run these separately in order so PowerShell preserves each exit code: `npm run db:start`; `npm run db:reset`; `npm run db:reset`; `npm run db:lint`; `npm run db:test`; `npm run db:types`; `npx --no-install supabase migration list --local`.

### 15. RUN the complete repository validation

- **IMPLEMENT**: Execute existing validation plus integration, build, security/logging scan, and generated-file cleanliness. Inspect the diff to ensure only Task 03 changes were made and existing user edits were preserved.
- **PATTERN**: Keep existing `validate` behavior intact; database validation is explicit because it requires Docker.
- **GOTCHA**: Formatting commands may rewrite files. Inspect the diff immediately and revert only unintended formatting introduced by this task—never discard pre-existing changes.
- **VALIDATE**: Run separately: `npm run validate`; `npm run build`; `npm run test:integration`; `git diff --check`; `git status --short`.

### 16. PREFLIGHT and DEPLOY to the linked Supabase project

- **IMPLEMENT**: Reload Codex so the authenticated Supabase MCP server becomes visible. Use MCP read-only tools first to list current tables/migrations and run security/performance advisors. Separately authenticate the pinned CLI if needed, link project `ssczfjvbeqyrlbasfyzj`, compare local/remote migration history, preview with `db push --linked --dry-run`, obtain human approval for the remote write, then run `db push --linked` and `npm run db:provision-storage` with remote environment values.
- **PATTERN**: MCP OAuth and CLI authentication are separate. Perform read-only discovery before writes and keep migrations as the auditable schema-change mechanism.
- **GOTCHA**: The Supabase MCP tools were authenticated but not exposed in the planning session, so no live-project inspection has yet occurred. Stop on unexpected remote tables, migration divergence, advisor findings, or a dry-run that includes out-of-scope changes. Use the Supavisor session pooler for IPv4 CLI access if `DATABASE_URL` is involved.
- **VALIDATE**: Run `npx --no-install supabase migration list --linked`, then `npx --no-install supabase db push --linked --dry-run`.

### 17. VERIFY the deployed security contract

- **IMPLEMENT**: Re-run Supabase security/performance advisors, inspect the deployed table/policies/bucket through read-only MCP or dashboard metadata, and run a disposable remote smoke check only if an approved non-production test user/project is available. Confirm an unsigned object URL is 403/404 and cross-user access fails; clean all disposable rows, users, and objects.
- **PATTERN**: Test with user-scoped publishable-key clients; use the secret client only for setup/cleanup.
- **GOTCHA**: Do not create disposable data in a production project without explicit approval. A successful secret-key query proves nothing about RLS.
- **VALIDATE**: Run `npx --no-install supabase db advisors --linked --type security`, then `npx --no-install supabase db advisors --linked --type performance`.

---

## TESTING STRATEGY

### Unit Tests

- Shared schema rejects non-UUID persisted IDs and continues to accept valid canonical receipt data.
- Repository mapper converts snake_case rows to canonical camelCase objects.
- System timestamps normalize to the shared ISO format.
- Invalid canonical JSON or warnings fail at the repository boundary.
- Repository query construction includes owner defense-in-depth, `deleted_at is null`, descending creation order, and mutation timestamps without recreating Supabase behavior in a large fake.

### Database Contract Tests (pgTAP)

- Receipt columns, data types, nullability, defaults, checks, foreign key, generated status, and index definition match the contract.
- Canonical `"100.50"` is unchanged in JSON; its numeric projection is exact when cast to text.
- RLS grants/policies allow owner SELECT/INSERT/UPDATE and reject cross-owner operations and ownership reassignment.
- No authenticated DELETE privilege or policy exists.
- Storage policies are scoped to the private bucket and first path segment.
- Tests run in a transaction and leave no fixtures.

### Local Supabase Integration Tests

- A real authenticated repository client performs insert/read/update/soft delete.
- Soft-deleted rows disappear from find/list.
- A second authenticated user cannot read or update the first user's row.
- Owner Storage operations work at `<user_id>/<receipt_id>/source`; a second user cannot access them.
- An unsigned object URL for the private bucket returns 403 or 404.
- All administrative fixtures are isolated and cleaned in `finally` blocks.

### Edge Cases

- Null optional JSON and promoted fields.
- Canonical decimal scale and a leading-zero canonical string.
- Invalid status, JSON container type, UUID, and foreign-key owner.
- Attempted owner reassignment.
- Reads after soft delete.
- Existing bucket accidentally configured public; provisioning restores `public: false`.
- Storage path with a different user's first segment.
- Supabase error/not-found distinction without provider-message leakage.
- Valid Postgres timestamps with offsets normalized for `z.iso.datetime()`.

---

## VALIDATION COMMANDS

Run from the repository root with Docker Desktop running.

### Level 1: Syntax, Types, and Style

```powershell
npm run typecheck
npm run lint
npm run format:check
git diff --check
```

### Level 2: Existing and Unit Tests

```powershell
npm test
npm run build
```

### Level 3: Database and Integration Tests

```powershell
npm run db:start
npm run db:reset
npm run db:reset
npm run db:lint
npm run db:test
npm run db:types
npm run test:integration
npx --no-install supabase migration list --local
```

Regenerate database types once more and verify `git diff` shows no generated-type change from the prior generation.

### Level 4: Local Manual Validation

```powershell
npx --no-install supabase status
npm run db:provision-storage
```

Inspect the local Studio only as a convenience; tests and migrations remain authoritative. Confirm the bucket is private and the table has RLS enabled, explicit authenticated grants, expected policies, and the partial history index.

### Level 5: Remote Preflight and Post-Deploy Validation

```powershell
npx --no-install supabase link --project-ref ssczfjvbeqyrlbasfyzj
npx --no-install supabase migration list --linked
npx --no-install supabase db push --linked --dry-run
npx --no-install supabase db advisors --linked --type security
npx --no-install supabase db advisors --linked --type performance
```

Only after reviewing the dry-run and receiving approval:

```powershell
npx --no-install supabase db push --linked
npm run db:provision-storage
```

Also use the reloaded Supabase MCP connection for read-only table, migration, and advisor verification. Never substitute MCP mutation for committed migration files.

---

## ACCEPTANCE CRITERIA

- [ ] A fresh local Supabase database applies every committed migration successfully.
- [ ] Two consecutive resets succeed and reach the same schema and generated types.
- [ ] `public.receipts` contains every Task 03 source, status, JSONB, promoted, and timestamp field with documented constraints.
- [ ] Promoted fields are derived from `canonical_data` without application dual writes.
- [ ] Canonical total `"100.50"` round-trips unchanged, and the generated PostgreSQL numeric value is exact.
- [ ] The authenticated role has explicit SELECT/INSERT/UPDATE privileges and no DELETE privilege.
- [ ] Owner RLS permits user A's operations and prevents user B from reading, updating, or reassigning user A's row.
- [ ] Normal repository find/list operations exclude soft-deleted rows.
- [ ] The repository accepts a user-scoped typed client and returns validated `CanonicalReceipt` objects, never raw database rows.
- [ ] The local and remote `receipt-sources` buckets are private and use `<user_id>/<receipt_id>/source` keys.
- [ ] Owner Storage access succeeds, cross-user access fails, and an unsigned object URL returns 403/404.
- [ ] Secret/service credentials appear only in administrative provisioning/test-fixture code and are never logged or used by the repository.
- [ ] Local reset, seed, lint, database test, type-generation, integration-test, and remote deployment workflows are documented and executable.
- [ ] Existing `npm run validate`, build, database tests, and integration tests pass with zero errors.
- [ ] Supabase security/performance advisors have no unreviewed findings attributable to Task 03.
- [ ] Task 04 authentication wiring and Task 05 upload API/UI behavior remain unimplemented.

---

## COMPLETION CHECKLIST

- [ ] Review and approve the partial-index refinement and generated-column design.
- [ ] Start Docker Desktop and confirm the local Supabase stack is healthy.
- [ ] Complete Tasks 1–15 in order with each immediate validation passing.
- [ ] Review the complete diff and preserve all pre-existing user worktree changes.
- [ ] Reload Codex and confirm the authenticated Supabase MCP tools are visible.
- [ ] Complete a read-only live-project preflight and resolve any migration divergence.
- [ ] Review and approve the remote `db push --dry-run` output.
- [ ] Complete Tasks 16–17 and clean disposable test data.
- [ ] Run every validation level successfully.
- [ ] Verify every acceptance criterion and update `.agents/ROADMAP.md` only when the implementation is genuinely complete.

---

## NOTES AND RISKS

- **Current environment blocker**: Docker CLI is installed, but the daemon was not running during planning. Local schema and test commands cannot be proven until it is started.
- **Current connectivity blocker**: the configured direct database hostname timed out from this IPv4-only network. Replace the developer-only `DATABASE_URL` with the project's Supavisor session-pooler connection string when direct database access is required; do not commit it.
- **Current observability gap**: the Supabase MCP server was authenticated previously but is not exposed to this active Codex session. Reload Codex before implementation's remote preflight. No claim is made that the live project is empty.
- **Remote writes**: linking is not deployment. Always inspect migration history and `db push --dry-run`; require explicit review before applying remote migrations or changing the bucket.
- **Storage policy behavior**: confirm the current `owner_id` type/semantics in the generated local Storage schema before finalizing owner checks. The user-folder rule remains mandatory even if the owner predicate needs a syntax adjustment.
- **Generated expressions**: guarded casts must match the shared canonical schema. If PostgreSQL rejects an expression as non-immutable, prefer a simpler immutable expression or a migration-owned immutable helper with locked `search_path`; do not fall back to application-managed duplicate columns silently.
- **Roadmap discrepancy**: the roadmap names a standalone `deleted_at` index, while the recommended partial composite index better matches actual active-history reads. A reviewer must approve this documented refinement.
- **Out-of-scope observation**: do not fold unrelated application-shell or existing-code cleanup into Task 03.

## CONFIDENCE SCORE

**8.5/10 for one-pass implementation after the three environment preconditions are resolved**: Docker daemon running, MCP visible after reload, and remote database access using a compatible pooler. The local architecture, schema, security model, package versions, CLI commands, and official guidance have been researched; the remaining uncertainty is live-project state and runtime validation rather than plan completeness.
