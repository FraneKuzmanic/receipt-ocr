# Feature: Receipt upload API & source-document persistence

**Roadmap task:** 05 (PRD Phase 2) · **Depends on:** 04 (done) · **Blocks:** 06, 07

The following plan should be complete, but it is important that you validate documentation, codebase
patterns and task sanity before you start implementing. Pay special attention to the naming of
existing utils, types and models — import from the right files.

Every library decision below was **probed empirically during planning**, not assumed. Where a probe
produced a surprising result it is recorded verbatim under **GOTCHA**. Do not re-litigate those
decisions without re-running the probe.

## Feature Description

`POST /api/receipts` accepts one receipt image or PDF as `multipart/form-data`, validates it
server-side from its **bytes** rather than its filename, stores the original unchanged in the private
`receipt-sources` bucket, creates a `processing` receipt row, and returns `{ id, status, createdAt }`.

Two supporting endpoints complete the source-document lifecycle: `GET /api/receipts/:id/source`
returns a short-lived signed URL for the owner only, and `DELETE /api/receipts/:id` soft-deletes the
record so it disappears from history and from source access.

Nothing calls Azure. The receipt stays in `processing` until Task 07 wires extraction in — that is
deliberate, and the reason `POST` returns a status the client must be prepared to poll.

## User Story

As a business user
I want to send a photo or PDF of a receipt to the application and have the original kept safely
So that the document is preserved as the source of truth for the structured data extracted from it,
and only I can ever see it

## Problem Statement

Task 04 left the application able to prove *who* a caller is, and Task 03 left it able to store a
receipt row and a private object — but there is no way to get a document into the system. The
`receipts` table, the `receipt-sources` bucket and its four path-scoped Storage policies all exist and
are exercised only by tests. Meanwhile every downstream task is blocked: Task 06 has nothing to submit
to, and Task 07 has no stored source to extract from.

Getting this wrong is expensive in a specific way. A file-type check that trusts the client's declared
`Content-Type` or the file extension is not a check at all — the probe below shows a Windows executable
sailing through `multipart/form-data` announcing itself as `image/jpeg`. And a source document that
leaks to a non-owner is the single highest-impact risk in PRD §14.

## Solution Statement

A three-stage pipeline, each stage refusing to trust the one before it:

1. **`requireAuth` (already mounted on the prefix)** rejects an unauthenticated upload *before* multer
   reads a single byte of the body. An anonymous caller cannot make the server buffer 10 MB.
2. **Multer with hard limits** parses exactly one file part and no text fields, aborting the stream the
   moment it exceeds the configured size.
3. **Byte-level validation** sniffs the real content type with `file-type`, checks it against a
   five-entry allow-list, and for PDFs additionally rejects encrypted documents and documents with too
   many pages.

Only then does the request touch Supabase: upload to `<user_id>/<receipt_id>/source` with the user's
own client (so Storage RLS re-checks ownership), then insert the row. Ownership is therefore enforced
in three independent places — the API's `findById` filter, Postgres RLS, and Storage RLS — and no code
path uses the secret key.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: `api` (routes, config, new `upload/` and `storage/` modules), `shared`
(upload vocabulary + one DTO), `client` (locale files only — no UI, that is Task 06)
**Dependencies**: `multer` 2.2.0, `@types/multer` 2.2.0, `file-type` 22.0.2, `pdf-lib` 1.17.1 — all
added to `api` only, none reaching the browser bundle

---

## CONTEXT REFERENCES

### Relevant Codebase Files — YOU MUST READ THESE BEFORE IMPLEMENTING

- `api/src/routes/receipts.ts` (all 31 lines) — the router you are extending. Read the comment block
  at lines 11–18 explaining **why there is no explicit ownership check**; do not add one to the new
  routes either.
- `api/src/middleware/require-auth.ts` (lines 41–59) — `authenticated()`, the wrapper that hands a
  route its proven `AuthContext` as an **argument**. Every new route uses it. Note it already catches
  both sync throws and rejected promises, so handlers may throw freely.
- `api/src/auth/authenticator.ts` (lines 13–21, 61–71) — `AuthContext` carries `userId` **and** a
  `client` already scoped to the caller's token. That client is what you pass to the repository and to
  Storage. `SUPABASE_SECRET_KEY` must not appear anywhere in this task.
- `api/src/middleware/error-handler.ts` (lines 9–19) — `HttpError(status, code)`. Codes are stable
  machine strings, never prose. Leave this file alone: it already types the body as `ApiErrorResponse`.
- `api/src/repositories/receipts.ts` (lines 21–33 `CreateReceiptInput`, 68–96 `create`, 98–109
  `findById`, 163–165 `softDelete`) — **all three operations you need already exist.** Do not add
  repository methods. Note `create` accepts an optional `id`, which is what lets you compute the
  storage path before inserting.
- `api/src/config.ts` (lines 22–32 `readPort`, 53–59 `readRequired`, 61–71 the `parsed` literal) — the
  shape every new variable follows. All problems are collected and reported at once, never
  fail-on-first.
- `api/src/app.ts` (lines 33–35) — `requireAuth` guards the `/api/receipts` **prefix**. You are adding
  routes to a router that is already protected; do not add per-route auth.
- `api/src/auth/auth.integration.ts` (lines 13–26 fixtures, 34–63 setup/teardown, 143–161
  `createAndSignIn`) — **copy this file's structure** for the new integration test: per-run UUID
  emails with a greppable prefix, unconditional `afterAll` cleanup, cascade delete doing the work.
- `api/src/repositories/receipts.integration.ts` (lines 128–160) — the existing Storage test. It shows
  `upload`, `download`, cross-user denial and the unsigned-URL assertion accepting `[400, 403, 404]`.
  Reuse that status tolerance.
- `api/src/app.test.ts` (lines 7–8, 29–53) — the stub-`Authenticator` pattern for unit-testing routes
  with no network.
- `supabase/migrations/20260817122048_create_receipts.sql` (lines 5–10 source columns, 118–156 the
  four Storage policies) — confirm for yourself that `(storage.foldername(name))[1]` is the user id,
  which is what makes the path scheme load-bearing. **No migration change is needed in this task.**
- `shared/src/api.ts` (lines 21–28 `createReceiptResponseSchema`, and the whole file for DTO style) —
  the POST response DTO already exists. You are adding exactly one more DTO here.
- `shared/src/warnings.ts` (lines 12–23) — the pattern for a **code vocabulary** in `shared`. Your new
  upload-error codes mirror this exactly, including the comment justifying why there are not more.
- `client/src/i18n/warnings.test.ts` (all 33 lines) — the parity test you are mirroring. Read the
  docblock at lines 11–19: it explains why `/validate` Phase 6.5 cannot catch a missing message for a
  code-derived key, which is precisely why your new test must exist.
- `README.md` — sections **API**, **Configuration**, **Logging**, **Database development**. All four
  need edits, and `/validate` Phase 6.6 machine-checks three of them.
- `.claude/commands/validate.md` — Phase 4 table, Phase 8 journeys, Phase 9 row for Task 05. Read
  **Maintaining this file** (lines 451–478) before editing: hand-extend, never regenerate.

### New Files to Create

| Path | Purpose |
| --- | --- |
| `shared/src/upload.ts` | `SOURCE_CONTENT_TYPES` allow-list and `UPLOAD_ERROR_CODES` vocabulary — shared because Task 06's file picker needs the first and the client needs a message for every one of the second |
| `api/src/upload/multipart.ts` | Multer instance + the middleware that translates `MulterError` into `HttpError` |
| `api/src/upload/source-file.ts` | Pure byte-level validation: sniff, allow-list, PDF inspection, filename repair |
| `api/src/upload/source-file.test.ts` | Unit tests for the validator — the bulk of this task's coverage |
| `api/src/upload/multipart.test.ts` | Unit tests for limit → error-code mapping, no Supabase involved |
| `api/src/storage/receipt-sources.ts` | Three thin functions over Supabase Storage: upload, sign, remove |
| `api/src/routes/receipts.integration.ts` | End-to-end upload/source/delete against the hosted project |
| `client/src/i18n/uploadErrors.test.ts` | `hr`/`en` parity for every `UPLOAD_ERROR_CODES` entry |

### Files to Modify

`api/src/routes/receipts.ts` · `api/src/config.ts` · `api/package.json` · `shared/src/index.ts` ·
`shared/src/api.ts` · `client/src/i18n/locales/en.json` · `client/src/i18n/locales/hr.json` ·
`scripts/provision-storage.mjs` · `.env.example` · `README.md` · `.claude/commands/validate.md`

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [Supabase — Serving assets from Storage → Signing URLs](https://supabase.com/docs/guides/storage/serving/downloads#signing-urls)
  - Why: the note that matters most — *"Storage signed URLs are signed with a dedicated internal key
    that is separate from your project's Auth JWT signing key… Signed URLs remain valid until their
    expiry time regardless of any Auth key changes."* This is the reason the TTL must be short, and
    the reason a soft-deleted receipt's already-issued URL keeps working until it expires.
- [Supabase — Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
  - Why: the Free-plan global ceiling is **50 MB**, and per-bucket `fileSizeLimit` must sit below it.
    Also the filename character restrictions — irrelevant to us only because our object names are two
    UUIDs and the literal `source`, which is exactly why untrusted filenames must never become paths.
- [Supabase — createSignedUrl reference](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl)
  - Why: exact signature `createSignedUrl(path, expiresIn, options?)` returning `{ data, error }` with
    `data.signedUrl`.
- [Azure Document Intelligence — input requirements](https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/document-intelligence/includes/input-requirements.md)
  - Why: settles the HEIC question ahead of Task 07. Supported input is *"PDF | Image: JPEG/JPG, PNG,
    BMP, TIFF, **HEIF** | Office: …"*, paid tier 500 MB / 2,000 pages. **HEIF is supported**, so storing
    the original HEIC unchanged is expected to be enough and no server-side conversion belongs here.
- [multer README — limits](https://github.com/expressjs/multer#limits) · [busboy config](https://github.com/mscdex/busboy#exports)
  - Why: `limits.fileSize`, `limits.files`, `limits.fields`, and the `defParamCharset` option that
    multer forwards to busboy.
- [pdf-lib PDFDocument.load](https://pdf-lib.js.org/docs/api/classes/pdfdocument#load)
  - Why: `ignoreEncryption`, and the `isEncrypted` property that makes error-string matching unnecessary.

### Patterns to Follow

**Route handlers take identity as an argument, never off the request.**

```ts
receiptsRouter.get(
  "/:id",
  authenticated(async (req, res, auth) => {
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) throw new HttpError(400, "invalid_request");

    const repository = new ReceiptRepository(auth.client, auth.userId);
    const receipt = await repository.findById(id.data);
    if (receipt === null) throw new HttpError(404, "not_found");

    res.json(receipt);
  }),
);
```

Every new route mirrors this exactly: parse → `HttpError(400, "invalid_request")` on a bad id →
repository built from `auth.client` and `auth.userId` → `null` becomes `404 not_found`.

**Errors are machine codes, translated by the client.** `throw new HttpError(415, "unsupported_media_type")`.
Never a sentence, never a provider or library name — a user must never read the words "multer",
"Supabase" or "Azure" (PRD §7.6, §7.13).

**A code vocabulary lives in `shared` with a comment defending its size** (`shared/src/warnings.ts:3-11`):

```ts
/**
 * These seven are derived from the check list in ROADMAP Task 08, not invented. Adding an
 * eighth speculatively would be scaffolding for a rule nobody has written yet, and every
 * code costs two translations.
 */
export const WARNING_CODES = [ /* … */ ] as const;
```

**Cross-workspace imports use the package name.** `import { … } from "@receipt/shared"`, never a
relative path into `shared/src`. Within `api`, relative imports need the `.js` extension even in `.ts`
source (`nodenext`).

**Money and dates never appear in this task.** Nothing here parses an amount. If you find yourself
importing `parseAmount`, you have wandered into Task 07.

---

## DECISIONS THIS TASK OWNS

The roadmap leaves these open. Each is resolved here with the evidence that resolved it, and each must
be copied into the Task 05 history file.

### D1 — Multipart parser: `multer` 2.2.0

Express 5 ships no multipart parsing. `multer` is the Express-idiomatic wrapper over `busboy`,
configures every limit we need declaratively, and its 2.x line is past the 1.x DoS advisories
(CVE-2025-47935 / 47944 / 7338, all fixed by 2.0.2). Using `busboy` directly would mean hand-writing
stream glue and our own limit enforcement — more code, doing the same thing, less well tested.

**Verified under this project's exact compiler options** (`nodenext`, `strict`,
`verbatimModuleSyntax: true`, `noUncheckedIndexedAccess`, `types: ["node"]`): `tsc --noEmit` exits 0
for `import multer from "multer"`, `multer.memoryStorage()`, `multer.MulterError` and
`Express.Multer.File`. This mattered: `decimal.js` failed exactly this test during Task 02 planning.

> **GOTCHA — `Express.Multer.File` is a global augmentation.** `api/tsconfig.json` sets
> `"types": ["node"]`, which disables automatic `@types/*` inclusion. The augmentation is only in
> scope in files that **import `multer`**. Probe-confirmed working; if a file needs the type without
> importing multer, import the type explicitly rather than widening `types`.

### D2 — Memory storage, not disk

Files go to `multer.memoryStorage()` and straight on to Supabase. Disk storage would add a temp
directory, a cleanup path, and a new class of leak, to serve a buffer we forward within milliseconds.
The memory ceiling is bounded and documented: `MAX_UPLOAD_BYTES` × concurrent uploads. At 10 MB that
is acceptable for a PoC and is a number Task 12 can revisit with real latency data.

### D3 — Content sniffing: `file-type` 22.0.2, allow-listing five MIME types

**The probe that decided this** (real output):

```text
jpeg                         -> image/jpeg (jpg)
png                          -> image/png (png)
ISO-BMFF ftyp=heic           -> image/heic (heic)
ISO-BMFF ftyp=heix           -> image/heic (heic)
ISO-BMFF ftyp=mif1           -> image/heif (heic)
ISO-BMFF ftyp=hevc           -> image/heic-sequence (heic)
ISO-BMFF ftyp=msf1           -> image/heif-sequence (heic)
pdf (3 pages)                -> application/pdf (pdf)
MZ executable (as .jpg)      -> application/x-msdownload (exe)
plain text                   -> UNDETECTED
```

Two findings drove the decision. First, **the HEIC family produces four different MIME strings**, and
an iPhone still photo commonly carries the `mif1` brand, which reports as `image/heif` — a hand-rolled
magic-byte table would have to encode the whole ISO-BMFF brand table correctly or silently reject real
phone photos. That is the single most likely way this feature fails in the field, and it is exactly
what the library gets right. Second, the DoD's renamed-executable case is detected cleanly.

The allow-list is therefore:

```ts
export const SOURCE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;
```

**`image/heic-sequence` and `image/heif-sequence` are deliberately excluded.** A sequence is multiple
images in one container, and "one receipt per upload" is a PRD rule (§4.6 excludes multi-image
documents). The still-image brands (`heic`, `heix`, `mif1`) are what a phone camera produces for a
single photo. Task 06's real-device testing should confirm this on actual hardware — if a real iPhone
ever produces a sequence for a single shot, revisit here, not in the client.

An undetectable file (`file-type` returns `undefined`) is rejected as `unsupported_media_type`. Failing
closed is correct: we would rather refuse an exotic-but-valid JPEG than store bytes we cannot classify.

`file-type` is 156 KB installed with four small dependencies, all server-side. It is not in the browser
bundle, so the sizing argument that rejected `decimal.js` in Task 02 does not apply.

### D4 — PDF inspection: `pdf-lib` 1.17.1, read via `isEncrypted` rather than a thrown error

PRD §7.3 requires rejecting password-protected PDFs and configuring a page limit. Both facts live in
PDF structures that a byte-scan cannot read reliably: since PDF 1.5, generators put the page tree
inside compressed **object streams**, so `/Type /Page` counting finds nothing on most modern files, and
a naive `/Encrypt` grep can false-positive — rejecting a *good* receipt, the worse failure direction.

> **GOTCHA — pdf-lib's `EncryptedPDFError` cannot be caught by type.** Probe output on an encrypted
> document: the thrown value has `constructor.name === "Error"`, `name === "Error"`, and
> `err instanceof EncryptedPDFError === false`. pdf-lib is ES5-transpiled, so its error subclasses do
> not survive `instanceof`. Matching the message string would be brittle.
>
> **Do this instead** — one call, both facts, no error handling for the encrypted case at all:
>
> ```ts
> const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
> if (document.isEncrypted) throw new HttpError(422, "pdf_encrypted");
> if (document.getPageCount() > config.MAX_PDF_PAGES) throw new HttpError(422, "pdf_too_many_pages");
> ```
>
> Probe-confirmed: `ignoreEncryption: true` → `isEncrypted === true` and `getPageCount()` still works.
> A genuinely unparseable PDF throws a plain `Error`; catch that and map it to `pdf_unreadable`.

**Honest accounting of the cost.** `pdf-lib` is **22 MB installed** — 13.8 MB of that is `dist/` UMD
bundles and source maps that are never loaded; the CJS entry actually required at runtime is ~3 MB.
It was last published as 1.17.1 and is effectively quiet. Both facts are acceptable here and it is
worth being explicit about why, since Task 02 rejected `decimal.js` partly on size:

- **Server-only.** `decimal.js` was rejected because it *"is bundled into the browser build"*
  (README, Toolchain notes). `pdf-lib` never reaches the browser, so that argument does not transfer.
- **Two read-only calls** on input already capped at `MAX_UPLOAD_BYTES`, from an **authenticated**
  caller, with `throwOnInvalidObject` left at its default `false`. The residual risk is a
  malformed-PDF CPU spike from a signed-in user, which is acceptable for a PoC and is written down.
- **Escape hatch:** `@cantoo/pdf-lib` 2.9.0 is a maintained API-compatible fork. Switch only if an
  advisory lands; do not switch speculatively.

Alternatives were checked and are worse: every lightweight page-counter on npm wraps `pdf.js`
(`unpdf`, `pdf-parse`, `pdf-page-counter`), which is heavier still.

### D5 — Configured limits: 10 MB, 10 pages

| Setting | Value | Why this number |
| --- | --- | --- |
| `MAX_UPLOAD_BYTES` | `10485760` (10 MB) | Comfortably above a phone photo (3–8 MB typical, HEIC smaller), well under Supabase's 50 MB Free-plan global ceiling, and a memory ceiling we can defend |
| `MAX_PDF_PAGES` | `10` | A receipt is one or two pages; ten is a sanity bound against a document dump, not a business rule. Task 07 should re-tune it once Azure's real per-page cost is known |

Both are environment variables because the roadmap says *"Configured, documented limits"*. Both carry
code defaults, so a fresh clone runs without setting them.

> **`.env.example` must list these as bare names with no value.** `/validate` Phase 6.1b allows a value
> only for `PORT`, `NODE_ENV`, `LOG_LEVEL` and `WEB_ORIGIN`. Put the default in a `#` comment and in
> the README table — do **not** add these names to the check's `SAFE` set, which would be working
> around a check rather than satisfying it.

### D6 — Source access is a short-lived signed URL, not a proxied stream

PRD §9.3 permits either. The signed URL wins for a mobile-first PoC: the review screen (Task 09) can
put the result straight into `<img src>` or `<iframe src>`, whereas an authorized stream cannot carry
an `Authorization` header from those elements and would force the client into fetch-to-blob plumbing —
and would push every byte through the API twice.

**TTL: 300 seconds**, as a module constant, not configuration. Nobody asked for it to be tunable, and
one fewer environment variable is one fewer row in three documents. 300 rather than 60 because a phone
that rotates, backgrounds, or re-requests the image mid-review would otherwise show a broken document,
and the security difference is negligible for a URL handed only to the authenticated owner over HTTPS.

> **Known limitation to write into the README and the history file.** A signed URL is a bearer
> capability: once issued it works for its full lifetime, and Supabase signs it with a key entirely
> separate from Auth, so signing out, rotating keys, or **soft-deleting the receipt** does not revoke
> it. `GET /:id/source` starts returning 404 immediately on soft-delete, but a URL handed out in the
> preceding 5 minutes keeps working until it expires. That is the whole reason the TTL is short. Do
> not "fix" this by deleting the object on soft delete — PRD §7.10 requires the original to be
> preserved, and hard-delete/retention is listed as future work in PRD §13.

### D7 — Write order: generate id → upload object → insert row, with a compensating delete

The object path needs the receipt id, so the id is generated in the API with `randomUUID()` and passed
to `repository.create({ id, … })`, which already accepts one.

Upload **before** insert. If the insert then fails, best-effort remove the object and let the error
propagate. The failure modes are asymmetric: an orphaned Storage object is invisible and costs a
fraction of a cent, whereas an orphaned row is **user-visible** — it would appear in Task 10's history
as a receipt stuck in `processing` forever with no document behind it.

### D8 — `fields: 0` makes "never trust a client-supplied userId" a parser-level guarantee

Probe output for a request carrying an extra `userId` text part alongside the file:

```text
extra text field (fields:0)   400 {"code":"LIMIT_FIELD_COUNT"}
```

This is the multipart analogue of what `.strict()` does for the JSON DTOs (`shared/src/api.ts:57-67`):
a forged `userId` is not ignored, it is structurally impossible to send. Note the consequence for
Task 06 — **the client must send only the file part**, or its uploads will be rejected. Say so in the
README.

### D9 — Bucket-level `fileSizeLimit`, but deliberately **no** `allowedMimeTypes`

Extend `scripts/provision-storage.mjs` to set `fileSizeLimit` to **12 MB** — above `MAX_UPLOAD_BYTES`
so the API always produces the clean translatable error and the bucket is only a backstop against a
bypass.

**Do not set `allowedMimeTypes`.** It would break `api/src/repositories/receipts.integration.ts:132`,
which uploads a `text/plain` fixture to prove path scoping. Weakening an existing passing test to add
a redundant second gate is not a trade worth making — the API's sniffing allow-list is the real check.
Record this reasoning; it will look like an oversight otherwise.

---

## IMPLEMENTATION PLAN

### Phase 1 — Vocabulary and configuration

The shared allow-list, the error taxonomy, its translations, and the two new settings. Nothing in this
phase can fail at runtime, so it is the safe foundation to land first.

### Phase 2 — Byte-level validation

`upload/multipart.ts` and `upload/source-file.ts`, with their unit tests. This is where the security
properties live and where most of the test coverage belongs, because it is pure and needs no network.

### Phase 3 — Storage helpers and routes

`storage/receipt-sources.ts`, then the three routes wired into the existing `receiptsRouter`.

### Phase 4 — Integration, documentation, validation

The hosted integration suite, README and `validate.md` updates, then the full `/validate` sweep.

---

## STEP-BY-STEP TASKS

Execute in order. Each task is atomic and ends with a command that must pass before the next begins.

### 1. ADD dependencies to `api/package.json`

- **IMPLEMENT**: add to `dependencies`: `"multer": "2.2.0"`, `"file-type": "22.0.2"`,
  `"pdf-lib": "1.17.1"`. Add to `devDependencies`: `"@types/multer": "2.2.0"`. Keep both blocks
  alphabetically sorted, matching the existing file.
- **PATTERN**: `api/package.json:12-30` — exact pinned versions, no `^` or `~`, mirroring every
  existing entry.
- **GOTCHA**: install from the **repository root**, never inside `api/`, or npm workspaces will create
  a nested `api/node_modules` and the lockfile will disagree with reality.
- **VALIDATE**: `npm install; npx tsc --build --force`

### 2. CREATE `shared/src/upload.ts`

- **IMPLEMENT**: `SOURCE_CONTENT_TYPES` (the five from D3) with `sourceContentTypeSchema` and the
  inferred `SourceContentType`; `UPLOAD_ERROR_CODES` with `uploadErrorCodeSchema` and
  `UploadErrorCode`. Codes, exactly six:
  `file_required`, `file_too_large`, `unsupported_media_type`, `pdf_encrypted`, `pdf_too_many_pages`,
  `pdf_unreadable`.
- **PATTERN**: `shared/src/warnings.ts:1-23`. Include the same style of docblock justifying the size of
  each list, and state explicitly why the two `-sequence` HEIF types are absent (D3).
- **IMPORTS**: `import { z } from "zod";` only.
- **GOTCHA**: no Azure vocabulary anywhere — `shared/src/receipt.test.ts` scans all of `shared/src` and
  fails the build on it. "PDF", "HEIC" and "JPEG" are format names, not provider names, and are fine.
- **VALIDATE**: `npx vitest run --project shared`

### 3. UPDATE `shared/src/api.ts` and `shared/src/index.ts`

- **IMPLEMENT**: add `sourceDocumentResponseSchema` to `api.ts`, documented as PRD §10.8:

  ```ts
  /** PRD §10.8 — `GET /api/receipts/:id/source` */
  export const sourceDocumentResponseSchema = z
    .object({
      url: z.url(),
      contentType: sourceContentTypeSchema,
      originalFilename: z.string(),
      expiresAt: z.iso.datetime(),
    })
    .strict();
  ```

  Then re-export everything new from `index.ts`.
- **PATTERN**: `shared/src/api.ts:21-28` for the DTO comment style; `shared/src/index.ts:37-53` for the
  export block, values first then `type` exports, alphabetical.
- **GOTCHA**: `README.md:359-361` currently states this DTO is *"deliberately absent and should not be
  invented ahead of their task"*. Task 05 **is** that task — update that paragraph so only the Task 11
  `schemaVersion` remains listed as absent.
- **GOTCHA**: `contentType` is the **sniffed** type, not the client's claim. `expiresAt` exists so the
  client can refresh before expiry instead of hardcoding the TTL.
- **VALIDATE**: `npx vitest run --project shared; npx tsc --build`

### 4. ADD translations and their parity test

- **IMPLEMENT**: add an `"upload"` namespace to both `client/src/i18n/locales/en.json` and `hr.json`,
  keyed by the six codes verbatim (snake_case), with plain-language messages. No provider or library
  name may appear. Suggested `en`, to be matched in `hr`:
  - `file_required` — "Attach one receipt image or PDF."
  - `file_too_large` — "This file is too large. The maximum size is 10 MB."
  - `unsupported_media_type` — "This file type is not supported. Use a JPEG, PNG, HEIC photo or a PDF."
  - `pdf_encrypted` — "This PDF is password-protected and cannot be read. Save an unprotected copy and try again."
  - `pdf_too_many_pages` — "This PDF has too many pages. Upload a document of up to 10 pages."
  - `pdf_unreadable` — "This PDF could not be read. It may be damaged. Try exporting it again."
- **IMPLEMENT**: create `client/src/i18n/uploadErrors.test.ts` mirroring
  `client/src/i18n/warnings.test.ts` — both directions: every code has a non-empty message in each
  locale, and no message exists without a code.
- **PATTERN**: `client/src/i18n/warnings.test.ts:1-33`, copied nearly verbatim with `WARNING_CODES` →
  `UPLOAD_ERROR_CODES` and `locale.warnings` → `locale.upload`.
- **GOTCHA**: this test is load-bearing for the same reason the warnings one is — Task 06 will render
  these from a template literal built out of the code, which `/validate` Phase 6.5's literal-`t("…")`
  scan cannot follow. Say so in the docblock.
- **GOTCHA**: `client/src/i18n/i18n.test.ts` enforces identical key sets across `hr` and `en`. Add both
  files in the same edit or it fails.
- **VALIDATE**: `npx vitest run --project client`

### 5. UPDATE `api/src/config.ts`

- **IMPLEMENT**: add three values to the `Config` interface and the `parsed` literal:
  - `MAX_UPLOAD_BYTES: number` and `MAX_PDF_PAGES: number`, via a new `readCount(name, raw, fallback)`
    helper that pushes to `problems` on a non-integer or non-positive value. Defaults `10485760` and `10`.
  - `STORAGE_BUCKET: string`, via the existing `readRequired`. It is read from `process.env` by the
    scripts today but has never been part of `Config`; `api/src/storage/receipt-sources.ts` (step 11)
    needs it, and `config.ts` is the single place this project reads the environment.
- **PATTERN**: `api/src/config.ts:24-32` (`readPort`) for `readCount`; `api/src/config.ts:53-59`
  (`readRequired`) for the bucket — same shape, same `problems.push` phrasing.
- **GOTCHA**: making `STORAGE_BUCKET` required means the API now refuses to boot without it, matching
  how `SUPABASE_URL` already behaves. Add it to `api/vitest.config.ts`'s placeholder `env` block
  alongside the existing two, or every API unit test fails at import.
- **GOTCHA**: do **not** refactor `readPort` to share code with the new helper (CLAUDE.md §3, surgical
  changes). Two small similar functions are correct here.
- **GOTCHA**: `api/vitest.config.ts:9-13` injects placeholder env for unit tests. The new variables
  have defaults, so nothing needs adding there — confirm by running the API unit tests.
- **VALIDATE**: `npx vitest run --project api`

### 6. UPDATE `.env.example`

- **IMPLEMENT**: add a `# --- Uploads (Task 05) ---` block with `MAX_UPLOAD_BYTES=` and
  `MAX_PDF_PAGES=`, **names only**, defaults stated in a preceding comment.
- **PATTERN**: the existing `# Required value: receipt-sources` comment above `STORAGE_BUCKET`.
- **GOTCHA**: a value on either line fails `/validate` Phase 6.1b.
- **VALIDATE**:
  `node -e "const fs=require('fs'); const SAFE=new Set(['PORT','NODE_ENV','LOG_LEVEL','WEB_ORIGIN']); const bad=[]; for(const line of fs.readFileSync('.env.example','utf8').split(/\r?\n/)){ const m=/^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if(!m) continue; if(!SAFE.has(m[1]) && m[2].trim()!=='') bad.push(m[1]); } if(bad.length) throw new Error('populated: '+bad.join(', ')); console.log('ok');"`

### 7. CREATE `api/src/upload/multipart.ts`

- **IMPLEMENT**: a module-level multer instance and one exported `RequestHandler`:

  ```ts
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1, fields: 0 },
    // Busboy defaults multipart parameters to latin1, which mangles every Croatian filename.
    defParamCharset: "utf8",
  }).single("file");
  ```

  plus `receiptSourceUpload`, which calls `upload(req, res, cb)` and in the callback translates:
  `LIMIT_FILE_SIZE` → `HttpError(413, "file_too_large")`; `LIMIT_UNEXPECTED_FILE`, `LIMIT_FILE_COUNT`
  and `LIMIT_FIELD_COUNT` → `HttpError(400, "file_required")`; anything else → pass through unchanged
  so it becomes a 500.
- **GOTCHA — probe-confirmed, and the reason `defParamCharset` is not optional.** Without it,
  `račun-ožujak.jpg` arrives as `raÄun-oÅ¾ujak.jpg`. With it, the name is exact. This is a
  Croatian-market application; do not drop that line.
- **GOTCHA — the three "limit" errors deliberately collapse to one code.** From the user's side all of
  them mean "the receipt file did not arrive in the form we need", and inventing three codes for cases
  only a hand-written request can produce would be speculative (CLAUDE.md §2).
- **GOTCHA**: a multer error must not reach `errorHandler` untranslated — it is not an `HttpError`, so
  it would surface as `500 internal_error` and the user would see nothing actionable.
- **VALIDATE**: `npx tsc --build`

### 8. CREATE `api/src/upload/source-file.ts`

- **IMPLEMENT**: `validateSourceFile(file: Express.Multer.File): Promise<SourceFile>` returning
  `{ bytes, contentType, originalFilename, byteSize }`, in this order:
  1. `file === undefined` → `HttpError(400, "file_required")`.
  2. `fileTypeFromBuffer(file.buffer)`; `undefined` or not in `SOURCE_CONTENT_TYPES` →
     `HttpError(415, "unsupported_media_type")`.
  3. If `application/pdf`, run the pdf-lib inspection from D4.
  4. Normalize the filename: trim, cap at 255 characters, fall back to `"receipt"` when blank.
- **IMPORTS**: `fileTypeFromBuffer` from `"file-type"`; `PDFDocument` from `"pdf-lib"`;
  `SOURCE_CONTENT_TYPES` / `SourceContentType` from `"@receipt/shared"`; `HttpError` from
  `"../middleware/error-handler.js"`; `config` from `"../config.js"`.
- **GOTCHA**: `file.mimetype` is the **client's claim** and is worthless — probe-confirmed, a file whose
  bytes begin `MZ` arrives with `mimetype: "image/jpeg"` and `originalname: "totally.jpg"`. Never read
  `mimetype` or the extension for a decision. The value you store is the sniffed one.
- **GOTCHA**: the 255-character cap is not cosmetic — a 400-character filename passes multer untouched
  (probe-confirmed) and would land in `source_original_filename`.
- **GOTCHA**: multer already strips directory components (`../../etc/passwd` → `passwd`,
  probe-confirmed), and the filename never becomes an object path regardless. Do not add path
  sanitization; it would be dead code guarding an impossible case (CLAUDE.md §2).
- **VALIDATE**: `npx tsc --build`

### 9. CREATE `api/src/upload/source-file.test.ts`

- **IMPLEMENT**: unit tests over crafted buffers — no Express, no Supabase, no network:
  - each of the five allowed types is accepted and reports the **sniffed** content type
  - `MZ` bytes with `originalname: "receipt.jpg"` and `mimetype: "image/jpeg"` → 415
    `unsupported_media_type` (**this is the roadmap DoD case**)
  - plain text → 415
  - `image/heic-sequence` bytes (ftyp brand `hevc`) → 415, proving D3's exclusion is intentional
  - an encrypted PDF → 422 `pdf_encrypted`
  - a PDF over `MAX_PDF_PAGES` → 422 `pdf_too_many_pages`
  - a truncated PDF → 422 `pdf_unreadable`
  - `undefined` file → 400 `file_required`
  - a 400-character filename is capped; a blank one falls back
  - a UTF-8 Croatian filename survives intact
- **PATTERN**: `shared/src/money.test.ts` for table-driven cases; assert on `HttpError.status` **and**
  `.code`.
- **GOTCHA — building the fixtures.** Generate PDFs with pdf-lib itself in the test
  (`PDFDocument.create()`, `addPage()` ×N, `save()`), which keeps them honest and tiny. For the
  encrypted case, save with `{ useObjectStreams: false }`, then patch the trailer to reference a live
  object: replace `/trailer\s*\n?<</` with `"trailer\n<< /Encrypt 1 0 R "`. Probe-confirmed to make
  `isEncrypted` true. Pointing `/Encrypt` at a **non-existent** object does *not* work — pdf-lib
  resolves the reference, so a dangling one leaves `isEncrypted` false and the test would pass
  vacuously.
- **GOTCHA**: build the HEIC fixtures as a 32-byte ISO-BMFF box — big-endian size at offset 0, `ftyp`
  at 4, the brand at 8. See the probe listing in D3 for brand→MIME mappings.
- **VALIDATE**: `npx vitest run --project api`

### 10. CREATE `api/src/upload/multipart.test.ts`

- **IMPLEMENT**: mount `receiptSourceUpload` on a bare Express app with the project's `errorHandler`,
  and drive it with supertest `.attach()` / `.field()`. Assert the JSON error bodies:
  oversized → `413 {"error":{"code":"file_too_large"}}`; wrong field name → `400 file_required`; two
  files → `400 file_required`; an extra text field → `400 file_required`; a valid small file passes
  through to the next handler.
- **PATTERN**: `api/src/app.test.ts:1-27` for the supertest style.
- **GOTCHA**: multer does **not** error when no file is sent — probe-confirmed, a body with no file
  part yields `200` with `req.file === undefined`, as does a non-multipart body. That case is the
  route's to catch (task 8, step 1), so do not expect an error here.
- **VALIDATE**: `npx vitest run --project api`

### 11. CREATE `api/src/storage/receipt-sources.ts`

- **IMPLEMENT**: three plain functions taking the user-scoped `SupabaseClient<Database>`, plus the
  path builder and the TTL constant:
  - `sourceObjectPath(userId, receiptId)` → `` `${userId}/${receiptId}/source` ``
  - `uploadSource(client, path, bytes, contentType)` — `upsert: false`, explicit `contentType`
  - `createSourceSignedUrl(client, path)` — `createSignedUrl(path, SOURCE_URL_TTL_SECONDS)`
  - `removeSource(client, path)` — best-effort, used only by the compensating delete
  - `export const SOURCE_URL_TTL_SECONDS = 300;`
- **PATTERN**: `api/src/repositories/receipts.integration.ts:128-160` shows the exact Storage call
  shapes already proven against this project.
- **GOTCHA**: read the bucket name from `config.STORAGE_BUCKET` (added in step 5), never from
  `process.env` in this module. `api/src/config.ts` is the one place this project touches the
  environment, and it is what reports every misconfiguration at startup instead of at first upload.
- **GOTCHA**: plain functions, not a class. `ReceiptRepository` is a class because it holds
  `client + userId` across many methods; these three take what they need per call and holding state
  would be ceremony (CLAUDE.md §2).
- **GOTCHA**: use the **user's** client, never one built from `SUPABASE_SECRET_KEY`. Storage RLS then
  re-checks the first path segment against `auth.uid()`, which is a genuine second enforcement layer
  and the reason the path scheme is what it is.
- **VALIDATE**: `npx tsc --build`

### 12. UPDATE `api/src/routes/receipts.ts` — `POST /`

- **IMPLEMENT**:

  ```ts
  receiptsRouter.post(
    "/",
    receiptSourceUpload,
    authenticated(async (req, res, auth) => {
      const file = await validateSourceFile(req.file);
      const receiptId = randomUUID();
      const path = sourceObjectPath(auth.userId, receiptId);

      await uploadSource(auth.client, path, file.bytes, file.contentType);

      try {
        const receipt = await new ReceiptRepository(auth.client, auth.userId).create({
          id: receiptId,
          sourceObjectPath: path,
          sourceOriginalFilename: file.originalFilename,
          sourceContentType: file.contentType,
        });
        res.status(201).json({ id: receipt.id, status: receipt.status, createdAt: receipt.createdAt });
      } catch (error) {
        await removeSource(auth.client, path);   // D7: never leave a user-visible orphan row
        throw error;
      }
    }),
  );
  ```

- **GOTCHA**: middleware order is `receiptSourceUpload` **then** `authenticated(...)`, and both sit
  behind the prefix-level `requireAuth` in `api/src/app.ts:35`. That ordering is what makes an
  unauthenticated 10 MB upload cost nothing — the body is never read.
- **GOTCHA**: the response is `201`, not `200` (PRD §10.1 shows the body but not the status). The
  client's `request()` helper checks `response.ok`, which covers 201.
- **GOTCHA**: status defaults to `processing` in the repository — do not pass it, and do not set
  `canonicalData`. Nothing is extracted in this task, and an empty `{}` is what the column defaults to.
- **VALIDATE**: `npx tsc --build; npx vitest run --project api`

### 13. UPDATE `api/src/routes/receipts.ts` — `GET /:id/source` and `DELETE /:id`

- **IMPLEMENT**: both mirror the existing `GET /:id` exactly — parse the id, build the repository from
  `auth`, `findById`, `null` → `404 not_found`.
  - `GET /:id/source`: then `createSourceSignedUrl(auth.client, sourceObjectPath(auth.userId, id))`,
    responding with the `sourceDocumentResponseSchema` shape. `expiresAt` is
    `new Date(Date.now() + SOURCE_URL_TTL_SECONDS * 1000).toISOString()`.
  - `DELETE /:id`: `repository.softDelete(id)`; `null` → 404; otherwise `res.status(204).end()`.
- **GOTCHA**: `findById` already filters `user_id` **and** `deleted_at`, so both routes get the
  cross-user 404 and the soft-deleted 404 for free. Do not add an ownership check — read the comment at
  `api/src/routes/receipts.ts:11-18`.
- **GOTCHA**: recompute the object path with `sourceObjectPath(auth.userId, id)` rather than reading it
  off the receipt. `CanonicalReceipt` deliberately carries **no source fields** — check
  `shared/src/receipt.ts` — so the stored path is not on the object `findById` returns, and the
  recomputed value is identical to what was written because both derive from the same two ids. Do not
  widen the canonical model to expose it; that model is the user-facing receipt, not a storage record.
- **GOTCHA**: if `createSignedUrl` returns an error, let it become a 500. A row that exists with no
  object behind it is an internal inconsistency, not a client error, and 404 would hide a real bug.
- **GOTCHA**: `DELETE` returns `204 No Content` with an empty body (PRD §10.7) — do not send JSON.
- **VALIDATE**: `npx tsc --build; npx vitest run --project api`

### 14. UPDATE `scripts/provision-storage.mjs`

- **IMPLEMENT**: pass `fileSizeLimit: 12582912` (12 MB) on `createBucket`, and repair it via
  `updateBucket` when an existing bucket's limit differs, alongside the existing `public` repair.
- **PATTERN**: the existing create/repair/report branches at lines 27-37; keep the same
  console-message style and idempotency.
- **GOTCHA**: **do not** add `allowedMimeTypes` — see D9. It would break
  `api/src/repositories/receipts.integration.ts:132`.
- **VALIDATE**: `npm run db:provision-storage` (run twice; the second run must report no change)

### 15. CREATE `api/src/routes/receipts.integration.ts`

- **IMPLEMENT**: against the hosted project, with two disposable users prefixed `task05-`:
  - upload a JPEG → `201`, body matches `createReceiptResponseSchema`, status `processing`
  - upload a PDF → `201`
  - the stored object exists at `<userId>/<id>/source` and downloads to the exact bytes uploaded
  - `.exe` bytes named `receipt.jpg` → `415 unsupported_media_type`, and **no row and no object are
    created**
  - a file over `MAX_UPLOAD_BYTES` → `413 file_too_large`, cleanly, with no timeout
  - `GET /:id/source` as the owner → `200` with a URL that actually fetches the bytes
  - `GET /:id/source` as user B → `404`
  - `DELETE /:id` → `204`; afterwards `GET /:id` and `GET /:id/source` both → `404`
  - **expiry**: sign a 1-second URL directly with the owner's storage client, wait ~1.5 s, fetch, and
    expect one of `[400, 403, 404]`; separately assert the route's `expiresAt` is ≈300 s ahead
- **PATTERN**: `api/src/auth/auth.integration.ts` — copy the fixture, `beforeAll`/`afterAll` and
  `createAndSignIn` structure verbatim, changing only the prefix and the cases.
- **GOTCHA**: cleanup must remove **objects as well as users**. `receipts.user_id` is
  `on delete cascade` so rows go with the user, but **Storage objects do not** — delete them explicitly
  in `afterAll`, as `receipts.integration.ts:64` already does.
- **GOTCHA**: use supertest's `.attach("file", buffer, { filename, contentType })`. The `contentType`
  you pass is the client's *claim*, which is exactly what the sniffing test needs to contradict.
- **GOTCHA**: the oversized-file case allocates `MAX_UPLOAD_BYTES + 1` bytes — use
  `Buffer.alloc(...)`, and keep the assertion on the status code, not on timing.
- **GOTCHA**: for the "no row created" assertion, list the user's receipts through the repository
  rather than guessing an id.
- **VALIDATE**: `npm run test:integration`

### 16. UPDATE `README.md`

- **IMPLEMENT**:
  - **API** table: three new rows (`POST /api/receipts` → 201, `GET /api/receipts/:id/source`,
    `DELETE /api/receipts/:id` → 204), plus the upload error codes and their statuses.
  - A new **Receipt uploads** section: the allow-list and why sniffing is byte-level; the limits and
    their defaults; the write order and the compensating delete (D7); the signed-URL TTL **and its
    revocation limitation** (D6); the `fields: 0` consequence for Task 06 (D8).
  - **Configuration** table: `MAX_UPLOAD_BYTES`, `MAX_PDF_PAGES`, and `STORAGE_BUCKET` if its row does
    not already reflect being required at startup.
  - **Toolchain notes**: a short paragraph on `pdf-lib` — the 22 MB/3 MB split, the `instanceof`
    gotcha, why the `decimal.js` size argument does not transfer to a server-only dependency, and the
    `@cantoo/pdf-lib` escape hatch.
  - **Domain model**: update the "deliberately absent DTOs" paragraph (see step 3).
- **GOTCHA**: `/validate` Phase 6.6 machine-checks that every `npm run` script mentioned exists, every
  script is documented, every backticked path resolves, every relative link resolves, and the
  Configuration table matches `.env.example` **exactly, both directions**.
- **VALIDATE**: the Phase 6.6 one-liner from `.claude/commands/validate.md:219`

### 17. UPDATE `.claude/commands/validate.md`

- **IMPLEMENT**:
  - Phase 4 table: one row per new test file, saying what it protects.
  - Phase 8: a new journey **8.6 — upload, fetch the source, soft-delete**, covering the DoD cases.
  - Phase 9: delete the Task 05 row.
  - Phase 7b: extend the orphan-check note, which currently names only `task03-`/`task04-`.
- **PATTERN**: read **Maintaining this file** (lines 451-478) first. Hand-extend only. **Never** re-run
  `/ultimate_validate_command` — it overwrites and would delete ~140 lines of hard-won checks.
- **GOTCHA**: Phase 7a stays **skippable** this task and the skip must be *reported* with its reason —
  no migration changes here. If you find yourself editing `supabase/migrations/`, stop: nothing in this
  plan requires it.
- **VALIDATE**: read it back and confirm Phase 9 no longer lists Task 05.

### 18. RUN the full validation sweep

- **IMPLEMENT**: every phase of `/validate` in order, reporting honestly, including any skip and why.
- **VALIDATE**: see **VALIDATION COMMANDS** below.

---

## TESTING STRATEGY

The split follows what this codebase already does, and it is deliberate: **pure logic is unit-tested,
routes are proven by integration tests.** Task 04 unit-tested `authenticator`, `require-auth` and the
prefix guard, and proved `GET /:id` only in `auth.integration.ts`, because a fake Supabase client good
enough to lie convincingly is more code than the route it tests.

### Unit tests (no network, `npm test`)

- `api/src/upload/source-file.test.ts` — the bulk of this task. Sniffing, the allow-list, all three PDF
  rejections, filename handling. Every DoD security property except cross-user access is provable here.
- `api/src/upload/multipart.test.ts` — limit → error-code mapping through a bare Express app.
- `client/src/i18n/uploadErrors.test.ts` — `hr`/`en` parity for all six codes, both directions.

**Rejection paths are unit-testable end-to-end and should be.** A request rejected for type or size
never reaches Supabase, so `createApp({ authenticator: stub })` with a stub returning
`{ userId, client }` exercises the real route through supertest with no network at all. Add these to
`api/src/app.test.ts` or a new `api/src/routes/receipts.test.ts` — the `.exe`-renamed-`.jpg` case is
worth having at both levels.

### Integration tests (`npm run test:integration`, hosted)

`api/src/routes/receipts.integration.ts` — the success paths, cross-user 404, soft-delete behaviour and
signed-URL expiry. Hosted rather than Docker for the reason recorded in ROADMAP §2 amendments: the local
stack signs symmetric JWTs and `getClaims` takes a different verification branch, so a Docker-only run
would pass while never exercising production's path.

### Edge cases that must be covered

| Case | Expected |
| --- | --- |
| `.exe` renamed `.jpg`, declared `image/jpeg` | `415 unsupported_media_type`, no row, no object |
| Plain text / undetectable bytes | `415` — fail closed |
| `image/heif-sequence` (ftyp `msf1`) | `415` — a sequence is not one document |
| Real iPhone brand `mif1` → `image/heif` | **accepted** — the field-failure this allow-list exists to prevent |
| `MAX_UPLOAD_BYTES + 1` | `413 file_too_large`, promptly, no crash or hang |
| No file part, and a non-multipart body | `400 file_required` (multer returns neither an error nor a file) |
| Two file parts; an extra text field | `400 file_required` |
| Password-protected PDF | `422 pdf_encrypted` |
| PDF over the page limit; truncated PDF | `422 pdf_too_many_pages` / `422 pdf_unreadable` |
| `račun-ožujak.jpg` | stored byte-exact, not mojibake |
| 400-character and blank filenames | capped at 255 / falls back to `receipt` |
| Non-owner `GET /:id/source`; soft-deleted `GET /:id/source` | `404` both |
| Signed URL after expiry | one of `[400, 403, 404]` |

---

## VALIDATION COMMANDS

Run every phase of `.claude/commands/validate.md` in order from the repository root. PowerShell 5.1
has no `&&` — chain with `;` or run separately.

### Level 1 — Syntax and style

```
npm run lint
npm run format:check
```

### Level 2 — Types and unit tests

```
npm run typecheck
npm test
npx vitest run --project shared
npx vitest run --project api
npx vitest run --project client
```

### Level 3 — Build and security

```
npm run build
```

then Phase 6.1, 6.1b, 6.2, 6.3, 6.4, 6.5, 6.6 and 6.8 verbatim from `validate.md`, plus **6.7 by
inspection**: confirm no new line logs a file buffer, a filename, or a signed URL. The logger already
redacts `*.file` and `*.signedUrl` (`api/src/logger.ts:8`) — extend that list rather than working
around it, and never log `file.bytes`.

### Level 4 — Integration

```
npm run test:integration
```

Phase 7a (Docker schema suite) is **skippable this task** — no migration changes. Report the skip with
that reason; a phase that was not run is not a passing phase.

### Level 5 — Manual journey

Clean the ports first, confirm Vite reports **5173**, then `npm run dev`. Sign in through the browser
to obtain a real token, then:

```powershell
foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "cleaned port $p" } else { "port $p free" } }
```

```powershell
$h = @{ Authorization = "Bearer $token" }
curl.exe -s -o NUL -w "%{http_code}`n" -X POST http://localhost:3001/api/receipts -H "Authorization: Bearer $token" -F "file=@receipt.jpg"
curl.exe -s -o NUL -w "%{http_code}`n" -X POST http://localhost:3001/api/receipts -H "Authorization: Bearer $token" -F "file=@notes.exe;filename=receipt.jpg;type=image/jpeg"
Invoke-WebRequest -Uri "http://localhost:3001/api/receipts/$id/source" -Headers $h -UseBasicParsing | Select-Object -ExpandProperty Content
```

Expect `201`, then `415`, then a JSON body whose `url` opens the image in a browser and stops working
about five minutes later. Finally `DELETE` the receipt and confirm both `GET /:id` and `GET /:id/source`
return `404`.

---

## ACCEPTANCE CRITERIA

Straight from ROADMAP Task 05's definition of done:

- [ ] Uploading each supported type creates a row and stores the object
- [ ] A `.exe` renamed to `.jpg` is rejected by content sniffing
- [ ] An oversized file is rejected with a clear message, not a crash or a timeout
- [ ] `GET /api/receipts/:id/source` as a non-owner returns 404
- [ ] The signed URL expires; an expired URL no longer serves the file
- [ ] A soft-deleted receipt's source is no longer retrievable

Plus the standing rules:

- [ ] Every user-facing failure has an `hr` and an `en` message, enforced by a test
- [ ] No provider, library or infrastructure word appears in any user-facing string
- [ ] No route reads a user id from the body, the query or a header
- [ ] `SUPABASE_SECRET_KEY` appears nowhere on a request path
- [ ] Nothing invents receipt data — `canonical_data` stays `{}` until Task 07
- [ ] `npm run validate` and `npm run test:integration` both pass
- [ ] README and `validate.md` updated; Phase 9's Task 05 row deleted

---

## COMPLETION CHECKLIST

- [ ] All 18 tasks completed in order, each validation passing before moving on
- [ ] Full `/validate` sweep run and reported honestly, with Phase 7a's skip named and justified
- [ ] No orphan `task05-` users or Storage objects left in the hosted project
- [ ] `.agents/history/05-receipt-upload-source-document-persistence.md` written, carrying **D1–D9
      verbatim** — the probe results in D3 and D4 are the parts a future session cannot re-derive cheaply
- [ ] ROADMAP §3 progress row for Task 05 updated with plan and history links

---

## NOTES

### Concerns raised before implementation, per CLAUDE.md §1 and ROADMAP §5

1. **HEIC is less of a problem than the roadmap implies — and Task 06's open question is narrower than
   it reads.** Task 06's DoD says HEIC handling must be "decided and documented: browser-supported,
   server-converted, or rejected". Azure Document Intelligence lists **HEIF** as a supported input
   format, so the *server* side needs no conversion and this task simply stores the original. What
   remains genuinely open for Task 06 is only whether the **browser** can render a HEIC preview before
   upload (Safari can; Chrome on Android generally cannot). Worth flagging so Task 06 does not build a
   server-side converter it does not need.

2. **The signed-URL revocation gap is real and should be accepted deliberately, not discovered later.**
   Supabase signs storage URLs with a key independent of Auth, so nothing the application does —
   sign-out, key rotation, soft delete — invalidates an already-issued URL. The DoD line "a
   soft-deleted receipt's source is no longer retrievable" is satisfied *at the endpoint*, which is
   the only place it can be satisfied without abandoning signed URLs entirely. The 300-second TTL is
   the mitigation. This belongs in the README's known limitations and in Task 12's security pass.

3. **`pdf-lib` is a 22 MB, effectively unmaintained dependency** carried for two read-only facts. The
   plan recommends it with reasons (D4), but it is the weakest link here and the reviewer should
   actively agree. The credible alternative is to **drop the PDF page and encryption checks from Task
   05 entirely** and let Task 07 surface them from Azure's own errors — the roadmap mentions the limits
   in scope text but, notably, includes **neither in Task 05's definition of done**. If the reviewer
   prefers fewer dependencies over an earlier error message, cutting D4 removes one dependency, two
   error codes, four translations and three tests, and costs only that a bad PDF fails later and less
   clearly.

4. **`fields: 0` is strict, and Task 06 must know.** Any client that sends a stray form field alongside
   the file gets a 400. That is the point — it makes a forged `userId` unsendable rather than merely
   ignored — but it is a sharp edge for the next task and must be documented, not just implemented.

5. **No migration is needed and none should be written.** `receipts` already has every source column,
   and the bucket and its four path-scoped policies already exist. If implementation reaches for
   `supabase/migrations/`, something has gone wrong. The one infrastructure change is a bucket
   `fileSizeLimit` via the existing provisioning script, which is not a migration.

### Deliberately out of scope

Calling Azure (Task 07) · `POST /:id/retry` (Task 07) · the paged `GET /api/receipts` list (Task 10) ·
any capture or upload UI (Task 06) · OCR-friendly derivatives or downscaling (Task 06 client-side,
Task 07 server-side) · idempotency keys and concurrency tokens (PRD §10 leaves these to implementation
and nothing needs them yet) · hard delete and retention (PRD §13, future).

### Confidence

**8.5 / 10** for one-pass success. The three library decisions are probe-verified against this
project's exact compiler options rather than assumed, and the four gotchas most likely to cost an hour
each — the `Express.Multer.File` global, `defParamCharset` mangling Croatian filenames, pdf-lib's
uncatchable `EncryptedPDFError`, and multer returning neither error nor file when no file is sent — are
all documented with their probe output. The residual risk is concentrated in the hosted integration
test, which touches the real project and where fixture cleanup (**Storage objects do not cascade**) is
the easiest thing to get wrong.
