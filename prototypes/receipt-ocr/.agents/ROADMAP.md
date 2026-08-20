# Implementation Roadmap — Mobile Receipt Capture & OCR PoC

**Source of truth for scope:** [`PRD.md`](../PRD.md) (v3, 8 Aug 2026)
**Behavioral rules:** [`CLAUDE.md`](../CLAUDE.md)
**Status:** Task 11 complete and validated — Task 12 is next. Real-phone browser validation remains deferred until a hosted deployment is available.

This roadmap divides the PRD into 12 sequential tasks. Each task is one full
**prime → plan → execute → review → commit** cycle, sized to fit comfortably in a single agent
session. Validation, documentation, history and roadmap maintenance are mandatory automatic stages
inside `/execute`. The roadmap is the durable memory between sessions; the per-task history files
are the record of what actually happened.

For substantial tasks, `/execute` should delegate the final full validation sweep to a read-only
validation subagent when available. The implementation agent still owns focused checks while coding,
all fixes, documentation, history, roadmap updates, and the final handoff.

---

## 1. How to run a task

Every task follows the same loop. Do not skip steps, and do not start a task before the
previous one is marked ✅ Done in the progress table below.

| # | Step | Trigger | Output |
| --- | --- | --- | --- |
| 1 | **Prime + read context** | Human runs `/prime` | Verbal summary only |
| 2 | **Plan** | Human runs `/plan-feature <task title from this roadmap>` | `.agents/plans/{kebab-name}.md` |
| 3 | **Review the plan** | Human approves or corrects the plan | Approved plan |
| 4 | **Execute** | Human runs `/execute .agents/plans/{kebab-name}.md` | Code + tests; starts steps 5–7 automatically |
| 5 | **Validate** | Automatic inside `/execute`; prefer a read-only validation subagent for the full sweep; hand-extend `/validate`, never regenerate | Full validation report |
| 6 | **Document** | Automatic after validation passes | Updated README/docs |
| 7 | **Record completion** | Automatic after documentation | History file + roadmap status/links |
| 8 | **Review completed task** | Human reviews the uncommitted diff and validation report | Approval or requested corrections |
| 9 | **Commit** | Human runs `/commit` | One atomic commit per task |

### Session bootstrap (step 1 in detail)

A fresh agent session has zero context. Before touching any task, it must read, in order:

1. `PRD.md` — what we are building and, just as importantly, what is out of scope.
2. `CLAUDE.md` — think before coding, simplicity first, surgical changes, push back when wrong.
3. This roadmap — locked decisions, the current task, and what earlier tasks already built.
4. The most recent 1–2 files in `.agents/history/` — the real state of the code, including
   anything that deviated from its plan.

### File conventions

```text
.agents/
├── ROADMAP.md              # this file — the plan of record
├── plans/                  # one plan per task, produced by /plan-feature
│   └── {kebab-name}.md
└── history/                # one record per completed task
    └── {NN}-{kebab-name}.md
```

### History file template

```markdown
# Task {NN} — {Title}

**Date:** YYYY-MM-DD
**Plan:** `.agents/plans/{kebab-name}.md`
**Commit:** {sha}

## What was built

{Short prose — the shape of the solution, not a file listing.}

## Files created / modified

{Paths, grouped by package.}

## Decisions made

{Any choice the plan left open, plus the reasoning. These become locked decisions.}

## Deviations from the plan

{What changed and why. "None" is a valid answer.}

## Validation results

{Commands run and their outcome. Paste real output for anything that failed.}

## Known gaps / follow-ups

{Anything deliberately deferred, and to which task.}
```

---

## 2. Locked decisions

These were decided before Task 01 and should not be relitigated mid-implementation. Changing
one is allowed, but it must be an explicit decision recorded in a history file.

| Decision            | Choice                                                                                                              | Rationale                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform services   | **Supabase** — Postgres, email/password auth, private storage                                                       | PRD §8 recommendation; removes custom auth, session and signed-URL code from the PoC                                                                                                                                                                                                          |
| Extraction provider | **Azure Document Intelligence v4** behind `DocumentExtractionProvider`                                              | PRD §6.3, §7.6 — fixed platform, isolated adapter                                                                                                                                                                                                                                             |
| Azure credentials   | **Available now** — tasks may call the live service                                                                 | No mock provider needed beyond recorded test fixtures                                                                                                                                                                                                                                         |
| Repo shape          | TypeScript npm-workspaces monorepo at `prototypes/receipt-ocr/` with **three flat workspaces**: `client/` (`@receipt/client`), `api/` (`@receipt/api`), `shared/` (`@receipt/shared`). **Amended 2026-08-17, two changes.** (1) PRD §6.7 nests these under `apps/` and `packages/`; the wrappers are dropped and `web` is renamed `client`, because the extra nesting bought nothing and the names were unfamiliar. `src/` was considered and rejected — it conventionally means one package's own sources, and would have produced `src/api/src/`. (2) PRD §6.7 also lists both `packages/domain` and `packages/shared`; that is one package too many for a PoC, since the canonical model and the API DTOs always travel together and would import each other constantly. Task 02 puts the canonical receipt model into `shared/` and no `domain` package is ever created. Because cross-workspace imports use the package name, neither change touched a single source import. | PRD §6.7; shared types between frontend and backend                                                                                                                                                                                                                                           |
| Stack baselines     | React 19.2.x, Vite 8.2.x, TypeScript 7.0.x, Node 24 LTS, Express 5.x, Zod 4.x, i18next 26.x, Vitest 4.x, Playwright | PRD §8, Appendix D; versions verified against npm 2026-08-16 during Task 01 planning                                                                                                                                                                                                          |
| Linter              | **oxlint**, not ESLint + typescript-eslint                                                                          | TypeScript 7 is the native Go port and no longer exports the JS compiler API from its main entry, so `typescript-eslint` (peer `typescript <6.1.0`, no v9 release) cannot work. `tsc --build` under `strict` is the authoritative type gate. Do not reinstate ESLint without revisiting this. |
| Router package      | `react-router` v8, **never** `react-router-dom`                                                                     | v8 consolidated into `react-router`; `react-router-dom` is frozen at 7.18.2                                                                                                                                                                                                                   |
| Money               | Decimal-safe **string** representation across the wire and in `numeric` columns; never JS floats                    | PRD §6.4 schema rules                                                                                                                                                                                                                                                                         |
| Canonical model     | Application-owned; Azure field names never reach the DB, the API surface or the UI                                  | PRD §6.2                                                                                                                                                                                                                                                                                      |
| Warnings            | Informational only — never block confirmation                                                                       | PRD §7.8                                                                                                                                                                                                                                                                                      |

### Deliberately deferred decisions

Each is owned by a specific task and must be resolved there, not earlier:

- ~~**Decimal library vs. hand-rolled string helpers** → Task 02.~~ **Resolved:** `big.js` for
  arithmetic, hand-written locale parsing, `Intl.NumberFormat` for display, with `Big.strict = true`
  making "money is never a JS float" a runtime guarantee. `decimal.js` was rejected — it is not
  constructable under TypeScript 7 with a default import. See
  [history](history/02-canonical-domain-model-shared-contracts.md).
- ~~**Azure model choice, confidence policy and Croatia-specific field parsing** → Task 07.~~
  **Resolved:** Azure Document Intelligence `2024-11-30` with `prebuilt-invoice`; record all
  confidence rather than discarding low-confidence values; use deterministic Croatian text fallbacks
  for fiscal identifiers and model gaps. See [history](history/07-azure-extraction-provider-canonical-mapper.md).
- ~~**QR decode library and Croatian fiscal QR payload format** → Task 08.~~
  **Resolved:** Azure Document Intelligence's free `barcodes` feature runs server-side in the existing
  `prebuilt-invoice` call; the parser accepts fiscal JIR/ZKI URLs plus an observed bare JIR UUID and
  never fetches the URL. See [history](history/08-qr-decoding-validation-warnings-engine.md).
- **Hosting provider for the deployed PoC** → Task 12.
- **Password reset** → **deferred with no owning task.** PRD §7.1 and Task 04 both qualify it with
  "if readily available from the provider", and it is not: it needs custom SMTP, an email template,
  a redirect allow-list entry, `detectSessionInUrl: true` and a set-new-password screen. Add a task
  if the PoC decides it wants one. See [history](history/04-authentication-ownership-enforcement.md).

### Amendments from completed tasks

- **Integration tests default to the hosted project, not Docker** (Task 04). The local stack falls
  back to symmetric JWT signing, where `getClaims` takes a different verification branch, so a
  Docker-based auth test would pass without ever exercising the production path. `npm run
  test:integration` targets hosted and is required on every task; `npm run test:integration:local`
  targets Docker and is required whenever `supabase/migrations/` changes. `/validate` Phase 7 is
  split along the same line.
- **`supabase config push` publishes every setting in `config.toml`, not just the ones you edited**
  (Task 04). It prints a diff and applies it with no prompt and no dry-run flag, so an untouched CLI
  default silently becomes the hosted project's real configuration. Read the diff after the fact and
  be ready to correct it.

---

## 3. Progress

Legend: ⬜ Not started · 🟡 In progress · ✅ Done · ✅* Done with a documented deferred validation item · ⏭️ Skipped (record why)

| #   | Task                                             | PRD phase | Status | Plan                                              | History |
| --- | ------------------------------------------------ | --------- | ------ | ------------------------------------------------- | ------- |
| 01  | Monorepo scaffold, app shell & i18n              | 1         | ✅     | [plan](plans/monorepo-scaffold-app-shell-i18n.md) | [history](history/01-monorepo-scaffold-app-shell-i18n.md) |
| 02  | Canonical domain model & shared contracts        | 1         | ✅     | [plan](plans/canonical-domain-model-shared-contracts.md) | [history](history/02-canonical-domain-model-shared-contracts.md) |
| 03  | Supabase database schema & private storage       | 1         | ✅     | [plan](plans/supabase-database-schema-private-storage.md) | [history](history/03-supabase-database-schema-private-storage.md) |
| 04  | Authentication & ownership enforcement           | 1         | ✅     | [plan](plans/authentication-ownership-enforcement.md) | [history](history/04-authentication-ownership-enforcement.md) |
| 05  | Receipt upload API & source-document persistence | 2         | ✅     | [plan](plans/receipt-upload-source-document-persistence.md) | [history](history/05-receipt-upload-source-document-persistence.md) |
| 06  | Mobile capture & upload UI                       | 2         | ✅*    | [plan](plans/mobile-capture-upload-ui.md)         | [history](history/06-mobile-capture-upload-ui.md) |
| 07  | Azure extraction provider & canonical mapper     | 2         | ✅*    | [plan](plans/azure-extraction-provider-canonical-mapper.md) | [history](history/07-azure-extraction-provider-canonical-mapper.md) |
| 08  | QR decoding & validation/warnings engine         | 2         | ✅     | [plan](plans/qr-decoding-validation-warnings-engine.md) | [history](history/08-qr-decoding-validation-warnings-engine.md) |
| 09  | Review form, editing & confirmation              | 3         | ✅     | [plan](plans/review-form-editing-confirmation.md) | [history](history/09-review-form-editing-confirmation.md) |
| 10  | History, detail view & soft delete               | 3         | ✅     | [plan](plans/history-detail-view-soft-delete.md) | [history](history/10-history-detail-view-soft-delete.md) |
| 11  | CSV & JSON export                                | 3         | ✅     | [plan](plans/csv-json-export.md)                 | [history](history/11-csv-json-export.md) |
| 12  | PoC evaluation, hardening & documentation        | 4         | ⬜     | —                                                 | —       |

**Dependency graph** — the chain is mostly linear, with two places where work can be split:

```text
01 → 02 → 03 → 04 → 05 ─┬─ 06 ──┐
                        └─ 07 → 08 → 09 → 10 → 11 → 12
```

Tasks 06 (capture UI) and 07 (extraction) both depend only on 05 and can be done in either
order. Everything else is sequential.

\* Task 06 passed automated and desktop-browser validation. Its mandatory real-phone camera journey
is deliberately deferred until the prototype is hosted; see its history for the exact scope.

---

## 4. Tasks

---

### Task 01 — Monorepo scaffold, app shell & i18n

**Goal:** A runnable, lintable, testable empty application. `npm run dev` starts both the web
app and the API; the web app renders a mobile-first shell in Croatian and English.

**Depends on:** nothing.

**Scope**

- Monorepo with npm workspaces: `client`, `api`, `shared`.
  **Amended during planning:** no `packages/domain` is created — creating it empty here would be
  speculative scaffolding (CLAUDE.md §2). `shared` ships one genuinely used contract (the
  `/api/health` response type), consumed by both apps, which proves the workspace wiring.
  **Amended 2026-08-17:** the `apps/` and `packages/` wrappers were dropped and `web` renamed to
  `client`, so the three workspaces sit flat at the repository root. Task 02 extends this same
  `shared` package with the canonical model rather than adding a second one. See the amended Repo
  shape row in §2.
- `client`: Vite 8 + React 19 + TypeScript, React Router, mobile-first layout, touch-sized
  targets, loading/error primitives.
- `api`: Express 5 + TypeScript, `/api/health`, centralized error handler, request logging
  that never logs file contents or full receipt data (PRD §9.4).
- Shared tooling: TypeScript project references, ESLint, Prettier, Vitest, `.editorconfig`.
- i18next + react-i18next with `hr` and `en` resource files, browser-language default, manual
  language switcher persisted to `localStorage`. All UI copy externalized from day one — no
  hardcoded strings anywhere, in any task.
- `.env.example` listing every variable name from PRD §9.2 with no values; `.gitignore` for
  `.env`, `node_modules`, `dist`.
- `README.md` with setup and run instructions.
- After the scaffold exists, run `/ultimate_validate_command` **once** to generate
  `.claude/commands/validate.md`. From Task 02 onward, run `/validate` and hand-extend that file —
  do **not** re-run the generator, which would discard checks earned from real incidents.

**Not in this task:** auth, database, any receipt logic, styling systems beyond a light
Tailwind or plain-CSS setup.

**Definition of done**

- [ ] `npm install` at the repo root succeeds on a clean checkout.
- [ ] `npm run dev` serves the web app and the API concurrently.
- [ ] `GET /api/health` returns 200.
- [ ] Lint, typecheck and `vitest run` all pass with zero errors.
- [ ] Switching the language toggle changes visible copy; the choice survives a page reload.
- [ ] `.claude/commands/validate.md` exists and runs green.

**PRD references:** §6.7, §7.13, §8, §9.2, §12 Phase 1.

---

### Task 02 — Canonical domain model & shared contracts

**Goal:** One provider-independent definition of a receipt, shared by web and API, with
decimal-safe money and a warning taxonomy.

**Depends on:** 01.

**Scope**

- `shared`: `CanonicalReceipt`, `VatBreakdown`, `ReceiptItem`, `ReceiptStatus`,
  `ReceiptWarning` exactly as specified in PRD §6.4 — no extra speculative fields.
  **Amended 2026-08-17:** these land in the existing `shared` created by Task 01, not in a
  separate `packages/domain`. See the amended Repo shape row in §2.
- Zod schemas as the single source of truth, with TypeScript types inferred from them. Used for
  API request validation on the backend and form validation on the frontend.
- Money handling: **decide and document** whether to use a decimal library or string helpers.
  Requirements: parse Croatian and English number formats, compare exactly, format for display,
  round-trip through Postgres `numeric` without loss.
- Date/time normalization helpers (receipt-local date and time as separate strings).
- Warning code enum with a stable machine code per check, plus `hr`/`en` message resources.
  Warnings carry a field path so the UI can attach them to inputs (PRD §7.8).
- API DTO types for every endpoint in PRD §10, in the same `shared`.
- Unit tests for money parse/format/compare, date normalization and schema validation,
  including malformed and missing input.

**Not in this task:** any persistence, any mapping from Azure, any warning _rules_ — only the
warning type and codes. Rules land in Task 08.

**Definition of done**

- [ ] `shared` builds and the canonical model is importable from both `client` and `api`.
- [ ] Money helpers have tests covering `1.234,56`, `1,234.56`, `100`, `""`, `null`, and a
      value that would lose precision as a JS float.
- [ ] Zod schema rejects an unknown status and accepts a receipt with every optional field null.
- [ ] No Azure-specific name appears anywhere in `shared`.

**PRD references:** §6.2, §6.4, §6.5, §7.7, Appendix A.

---

### Task 03 — Supabase database schema & private storage

**Goal:** A provisioned Supabase project with the receipts table, a private storage bucket, and
a typed repository layer the API can use.

**Depends on:** 02.

**Scope**

- Supabase project provisioned; connection details in `.env`, names documented in `.env.example`.
- SQL migration for `receipts` following PRD Appendix B: `id`, `user_id`, source file columns,
  `status`, the `jsonb` columns (`canonical_data`, `original_extraction`, `extraction_metadata`,
  `qr_extraction`, `raw_provider_result`, `warnings`), timestamps including `confirmed_at` and
  `deleted_at`.
- Promoted query columns for history and export: seller name, issue date, document number,
  total (`numeric`), currency. Indexes on `(user_id, created_at desc)` and `deleted_at`.
- Row Level Security enabled with owner-only policies, so ownership is enforced at the database
  even if an API check is ever missed.
- Private storage bucket for source documents, with a path scheme that includes `user_id`.
- `api/src/repositories/receipts.ts` — typed CRUD returning canonical domain objects, never
  raw rows. Soft delete is a `deleted_at` write; normal reads filter it out.
- Migration runner and a documented reset/seed path for local development.

**Not in this task:** auth wiring (Task 04), file uploads (Task 05).

**Definition of done**

- [x] Migration applies cleanly to an empty database and is idempotent to re-run.
- [x] Repository tests (against a real Supabase test project or a local Postgres) cover insert,
      read, update, soft delete, and that a soft-deleted row is excluded from list queries.
- [x] A `numeric` total round-trips as an exact decimal string.
- [x] RLS verified: a query authenticated as user B cannot read user A's row.
- [x] The storage bucket is not publicly readable — an unsigned URL to an object returns 403/404.

**PRD references:** §6.4, §7.10, §9.1, §9.3, Appendix B.

---

### Task 04 — Authentication & ownership enforcement

**Goal:** A user can register, log in, stay logged in, and log out. The API derives identity
from the token and never from the request body.

**Depends on:** 03.

**Scope**

- Supabase email/password registration, login, logout; password reset if it comes free with the
  provider (PRD §7.1).
- Web: register/login screens, session persistence across reloads, protected route wrapper,
  redirect to login on 401, logout action. All copy in `hr` and `en`.
- API: auth middleware that verifies the Supabase JWT and attaches `userId` to the request.
  Every `/api/receipts*` route is protected.
- An ownership guard used by every receipt route: a receipt belonging to another user returns
  404 (not 403 — do not leak existence).
- Tests: unauthenticated request rejected; a client-supplied `userId` in the body is ignored;
  cross-user access returns 404.

**Not in this task:** roles, companies, tenants, MFA, SSO — all explicitly out of scope (PRD §4.6, §9.5).

**Definition of done**

- [x] Register → log in → reload the page → still authenticated → log out → protected route
      redirects to login.
- [x] `GET /api/receipts` without a token returns 401.
- [x] Automated test proves user B gets 404 for user A's receipt id.
- [x] Automated test proves a forged `userId` in a request body has no effect.

**PRD references:** §7.1, §9.1, §11.2, §12 Phase 1 validation.

---

### Task 05 — Receipt upload API & source-document persistence

**Goal:** `POST /api/receipts` accepts one image or PDF, validates it server-side, stores the
original privately, creates a `processing` receipt, and returns its id. The source is
retrievable only by its owner.

**Depends on:** 04.

**Scope**

- `POST /api/receipts` (multipart) — JPEG, PNG, HEIC/HEIF, PDF. Content-type detected from file
  **bytes**, not the filename or the client-declared type (PRD §7.3).
- Configured, documented limits: max file size, max PDF pages. Password-protected PDFs that
  cannot be processed are rejected with a clear, translatable message.
- Store the original in the private bucket unchanged; persist filename, content type and size.
  If an OCR-friendly derivative is generated later, the original still wins (PRD §7.3).
- Create the receipt row in `processing` and return `{ id, status, createdAt }`.
- `GET /api/receipts/:id/source` — ownership and soft-delete checked, then a short-lived signed
  URL or an authorized stream. Never a public URL.
- `DELETE /api/receipts/:id` (soft delete) implemented against the repository.
  **`GET /api/receipts/:id` already shipped in Task 04**, where it was needed to prove the
  cross-user 404. **Decided:** the paged `GET /api/receipts` list endpoint stays in **Task 10**;
  Task 04 deliberately did not take it.
- Error taxonomy for upload failures with translatable, user-facing messages that mention no
  provider or infrastructure terminology.

**Not in this task:** calling Azure. The receipt stays in `processing` until Task 07 wires
extraction in.

**Definition of done**

- [ ] Uploading each supported type creates a row and stores the object.
- [ ] A `.exe` renamed to `.jpg` is rejected by content sniffing.
- [ ] An oversized file is rejected with a clear message, not a crash or a timeout.
- [ ] `GET /api/receipts/:id/source` as a non-owner returns 404.
- [ ] The signed URL expires; an expired URL no longer serves the file.
- [ ] A soft-deleted receipt's source is no longer retrievable.

**PRD references:** §7.3, §7.10, §9.3, §10.1, §10.3, §10.7, §10.8.

---

### Task 06 — Mobile capture & upload UI

**Goal:** On a phone, a user can photograph a receipt or pick a file, preview it, retake, and
submit — landing on a processing state that polls to review.

**Depends on:** 05. Can run in parallel with 07.

**Scope**

- **Scan receipt** as the primary action, preferring the rear camera where the browser allows.
- File-picker fallback when camera access is denied or unavailable — the flow must never
  dead-end (PRD §11.2).
- Preview with **Use photo** / **Retake**. Capture guidance: whole receipt in frame, readable,
  minimal glare.
- Client-side pre-checks before upload: file type, size, and a cheap resolution/blur heuristic.
  Keep this simple — the PRD explicitly rejects building a computer-vision quality classifier
  (§7.4). Borderline quality proceeds and produces a warning instead.
- Optional client-side downscale of very large camera photos when text readability is preserved;
  the original still uploads (PRD §7.3).
- Processing state with visible feedback and polling to `GET /api/receipts/:id`, transitioning to
  the review route on `review` and to an actionable retry/re-upload state on `failed`.
- HEIC handling decided and documented: browser-supported, server-converted, or rejected with a
  clear message.

**Not in this task:** the review form itself (Task 09).

**Definition of done**

- [ ] Verified on a real phone browser, not only a desktop responsive emulator. **Deferred until the
      prototype is hosted; this is the documented Task 06 validation caveat.**
- [ ] Denying camera permission still leaves a working upload path.
- [ ] Retake discards the previous image and does not upload it.
- [ ] The processing screen never freezes: it reaches review, failure, or a timeout state with
      a retry action.
- [ ] The full flow is operable one-handed (PRD §11.5).

**PRD references:** §7.2, §7.3, §7.4, §11.4, §11.5.

---

### Task 07 — Azure extraction provider & canonical mapper

**Goal:** An uploaded document is processed by Azure Document Intelligence and mapped into
canonical fields, with the raw result retained for debugging. **This is the OCR implementation
task the PRD defers all provider-specific decisions to** — the largest and highest-risk task in
the roadmap.

**Depends on:** 05. Can run in parallel with 06.

**Scope**

- `DocumentExtractionProvider` interface in `api/src/providers/document-extraction/`,
  exactly as sketched in PRD §6.3. One implementation: Azure.
- **Decide and document here:** Azure model choice (prebuilt-receipt vs. prebuilt-invoice vs.
  layout, or a conditional combination), API version, confidence policy, and how far to trust a
  low-confidence field. Evidence beats intuition — try candidate models against real Croatian
  receipts before committing.
- Croatia-specific deterministic parsing where Azure's generic models fall short: OIB, JIR, ZKI,
  document number, Croatian date and decimal formats, EUR. Extract only — no OIB verification,
  no company matching (PRD §4.6).
- Canonical mapper: Azure output → `CanonicalReceipt`. Missing stays null. **Nothing is ever
  invented** (PRD §7.7).
- Persist separately: `original_extraction` (machine values before any user edit),
  `extraction_metadata` (per-field confidence and provenance), `raw_provider_result`.
- Workflow: `processing` → `review` on success, → `failed` on error, with retryable and
  non-retryable errors distinguished. `POST /api/receipts/:id/retry` re-runs against the stored
  source (PRD §10.6).
- Azure credentials stay server-side; Azure terminology never reaches the user (PRD §7.6).
- Tests use **recorded real Azure responses as fixtures** so the mapper is testable without
  network calls or cost. Keep at least one live smoke test, run manually.

**Not in this task:** QR (Task 08), warnings (Task 08), any LLM — explicitly excluded (§4.7).

**Definition of done**

- [ ] A real Croatian receipt photo reaches `review` with seller, document number, issue date,
      total and currency populated where they are legible in the source.
- [ ] A PDF receipt reaches `review`.
- [ ] Mapper unit tests run offline from fixtures and cover a receipt missing VAT, missing
      buyer, and missing fiscal identifiers.
- [ ] No Azure field name appears in the API response, the database canonical column, or the UI.
- [ ] A simulated Azure 429/500 produces `failed` with a working retry that succeeds.
- [ ] Processing latency is recorded for each run — the baseline Task 12 reports on.
- [ ] The model/confidence decision and its evidence are written into the history file.

**PRD references:** §4.7, §6.2, §6.3, §7.6, §7.7, §10.6, §12 Phase 2, §14 risks 1–2.

---

### Task 08 — QR decoding & validation/warnings engine

**Goal:** Croatian fiscal QR codes are decoded when present and cross-checked against the OCR
result; deterministic checks produce field-attached warnings ready for Task 09 to recalculate after edits.

**Depends on:** 07.

**Scope**

- QR decode attempt on every uploaded document. **Decide here:** library and where decoding runs.
  Absence or failure must never block OCR (PRD §7.5).
- QR payload stored separately in `qr_extraction`, never merged silently into canonical values
  and never allowed to overwrite a user-confirmed value.
- QR content treated as untrusted: no URL is fetched, no Tax Administration verification, nothing
  from the payload is rendered unescaped (PRD §9.3).
- Warning rules engine — pure functions over canonical fields plus optional QR data, run during initial
  extraction and ready for Task 09 to reuse on every edit without re-running OCR:
  - missing critical field (seller, document number, issue date, total, currency)
  - unparseable date
  - unparseable monetary value
  - VAT arithmetic inconsistency when there is enough information
  - QR total vs. current total mismatch
  - QR date/time vs. current date/time mismatch
- `document_quality` remains deliberately unproduced: available server-side confidence is not a
  reliable quality signal.
- Every warning: stable code, affected field path, `hr`/`en` message. Never blocking.
- Warnings persisted on the receipt at extraction; `PATCH` recomputation belongs to Task 09.

**Not in this task:** duplicate detection, buyer-OIB matching, company verification, LLM
validation — all explicitly out of scope (§7.8).

**Definition of done**

- [ ] A receipt with a readable fiscal QR decodes and stores the payload.
- [ ] A receipt with no QR, and one with a damaged QR, both still reach `review` normally.
- [ ] Deliberately mismatching a QR total against the OCR total raises exactly one warning.
- [ ] Correcting the total clears that warning without re-running OCR.
- [ ] The rules engine is unit-tested as pure functions, one test per rule, including the
      "not enough information to judge" path for VAT.
- [ ] No warning can prevent confirmation anywhere in the code.

**PRD references:** §7.5, §7.8, §9.3, §11.2.

---

### Task 09 — Review form, editing & confirmation

**Goal:** The human-confirmation step — the heart of the product. Extracted values are
pre-populated, editable beside the source document, warnings sit next to their fields, and an
explicit confirm marks the record `confirmed`.

**Depends on:** 08.

**Scope**

- Review screen with the source document visible alongside the form, or one tap away on a
  narrow phone screen — the two must be easy to compare (PRD §11.5).
- React Hook Form + the Zod schemas from Task 02. Every displayed extracted field is editable,
  including header, VAT and fiscal fields, in one review experience.
- Fields missing or low-confidence are visually distinct, using the `extraction_metadata` from
  Task 07 (PRD §7.9).
- Optional line items shown compactly and never required for confirmation — routine review must
  not become a reconciliation task (PRD §11.5).
- `PATCH /api/receipts/:id` persists edits and returns recalculated warnings. Debounced autosave
  or explicit save — pick one, keep it simple, record the choice.
- `POST /api/receipts/:id/confirm` sets `confirmed` and `confirmed_at`. **Allowed with warnings
  outstanding.** Never auto-confirm.
- `original_extraction` stays untouched by edits, so machine output and confirmed values remain
  distinguishable forever (PRD §6.4).

**Definition of done**

- [ ] A receipt in `review` shows pre-populated fields matching the extraction.
- [ ] Editing a wrong document number and saving persists the corrected value.
- [ ] A warning is visible next to its field, in both languages.
- [ ] Confirming with an unresolved warning succeeds.
- [ ] After confirmation, `original_extraction` still holds the pre-edit machine values.
- [ ] Nothing transitions to `confirmed` without an explicit user action.
- [ ] Component tests cover pre-population, edit → warning recalculation, and confirm.

**PRD references:** §6.4, §7.9, §11.1, §11.2, §11.5, §12 Phase 3.

---

### Task 10 — History, detail view & soft delete

**Goal:** A user finds a past receipt, opens it with its original document, and can remove it
from their history.

**Depends on:** 09.

**Scope**

- `GET /api/receipts` — the authenticated user's non-deleted receipts, newest first, paged,
  optional `status` filter (PRD §10.2).
- Mobile-friendly history list showing issue date, seller, document number, total, currency and
  status. A list, not a cramped desktop table.
- Detail view reusing the existing editable review screen for `review` and `confirmed` records,
  always with access to the original source. Task 09's confirmed-state editing decision takes
  precedence over this task's original read-only wording; see
  [history](history/10-history-detail-view-soft-delete.md).
- Soft delete with confirmation; deleted receipts vanish from history and from exports.
- Empty state, loading state, and an error state that offers a retry.

**Not in this task:** search, advanced filtering, bulk actions — not MVP blockers (PRD §7.11).

**Definition of done**

- [ ] History shows only the current user's receipts, newest first.
- [ ] Status filter works for all four states.
- [ ] Opening a receipt shows its structured data and its original document.
- [ ] Soft-deleting removes it from history; the row still exists with `deleted_at` set.
- [ ] Paging works with more than one page of receipts.
- [ ] Verified readable and tappable on a phone-width viewport.

**PRD references:** §7.11, §10.2, §10.3, §10.7, §11.2.

---

### Task 11 — CSV & JSON export

**Goal:** Confirmed data leaves the PoC in a portable, stable format, proving the record is
useful to a downstream system that does not exist yet.

**Depends on:** 10.

**Scope**

- `GET /api/receipts/export?format=csv` and `?format=json` — default scope is the authenticated
  user's **confirmed, non-deleted** receipts (PRD §7.12).
- CSV: one row per receipt, stable documented column names, UTF-8 with correct escaping, VAT
  breakdown flattened or serialized consistently. Line items not required in v1.
- **CSV formula-injection protection** on every untrusted text field — seller names and OCR text
  are untrusted input (PRD §7.12, §9.3).
- JSON: canonical field names only, nested VAT breakdown preserved, optional items included when
  present, money exact and consistent, and an explicit `schemaVersion`.
- Download UI in history, in both languages.
- Column names and the JSON schema version documented in the README — this is the contract future
  integrations will read.

**Definition of done**

- [ ] CSV opens correctly in a spreadsheet with Croatian characters intact.
- [ ] A seller name beginning with `=`, `+`, `-` or `@` is neutralized in the CSV output.
- [ ] JSON contains no Azure-specific property name.
- [ ] Exports exclude non-confirmed receipts, soft-deleted receipts, and other users' receipts.
- [ ] A total of `100.50` exports as exactly `100.50` — no float artifacts.
- [ ] Column names and schema version are documented.

**PRD references:** §7.12, §10.9, §11.2.

---

### Task 12 — PoC evaluation, hardening & documentation

**Goal:** Turn a working application into a credible PoC result: measured extraction quality,
measured latency, explicit known limitations, and a decision-ready write-up.

**Depends on:** 11.

**Scope**

- Assemble a representative test set: genuine phone photos (not only clean PDFs), Croatian and
  English receipts, and hard cases — glare, moderate blur, imperfect framing, faded thermal
  print, missing QR (PRD §12 Phase 4).
- Measure and record, per PRD §11.3:
  - exact normalized match rate for the five critical fields before any user correction
  - percentage of receipts needing no critical-field correction
  - critical-field edits per receipt
  - which fields are corrected most often
  - median and worst-case processing latency against the 2–5 s UX target
- Security pass: ownership tests across every endpoint, private storage verified, no secret in
  the frontend bundle, no full receipt content or signed URL in logs (PRD §9.4).
- A small Playwright suite for the critical journeys: register → login → capture → review →
  confirm → history → export; and camera-denied → upload fallback.
- Mobile browser QA on at least one real iOS and one real Android device.
- Error-state polish: every failure path has a plain-language, translated, actionable message.
- Documentation: README setup from a clean clone, architecture notes, API reference, export
  schema, and an honest **known OCR weaknesses and follow-ups** document feeding PRD §13.
- Deploy the PoC: managed hosting, HTTPS, secrets via environment variables.

**Definition of done**

- [ ] The full flow works end-to-end on a real phone against the deployed environment.
- [ ] Quality and latency measurements are written up with the sample size stated.
- [ ] Known limitations are explicit — no overclaiming that OCR or review guarantees correctness
      (PRD §11.3).
- [ ] Playwright critical-path suite passes.
- [ ] `/validate` passes across the whole repo.
- [ ] A fresh clone can be set up from the README alone.
- [ ] The write-up is sufficient to decide whether to continue toward a production iteration.

**PRD references:** §9.4, §11.3, §11.4, §12 Phase 4, §13, §14.

---

## 5. Standing rules for every task

These come from `CLAUDE.md` and the PRD, and apply to all twelve tasks:

1. **Plan before code.** State assumptions; if two readings are possible, surface both rather
   than silently choosing one.
2. **Simplicity first.** Minimum code that solves the problem. No speculative abstraction, no
   configurability nobody asked for. If 200 lines could be 50, rewrite it.
3. **Surgical changes.** Every changed line traces to the task. Do not improve adjacent code;
   mention unrelated dead code instead of deleting it.
4. **Push back.** If a task in this roadmap is wrong, or the PRD is unclear, say so before
   building — and hold the line if the pushback was right.
5. **Never invent receipt data.** Missing stays null, everywhere, always (PRD §7.7).
6. **Warnings never block.** Any code path that prevents confirmation is a bug (PRD §7.8).
7. **Azure stays behind the adapter.** Provider field names must not reach the database, the API
   surface or the UI (PRD §6.2).
8. **Everything the user reads is translated.** No hardcoded strings, in any task (PRD §7.13).
9. **Money is never a JS float.** Decimal-safe representation end to end (PRD §6.4).
10. **Out of scope stays out.** No companies, tenants, accountants, approvals, duplicate
    detection, LLMs, or accounting integrations — however tempting (PRD §4.6–4.8).
