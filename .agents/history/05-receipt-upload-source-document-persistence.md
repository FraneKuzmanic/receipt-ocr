# Task 05 — Receipt upload API & source-document persistence

**Date:** 2026-08-18
**Plan:** `.agents/plans/receipt-upload-source-document-persistence.md`
**Commit:** pending human review
**Hosted project:** `ssczfjvbeqyrlbasfyzj`

## What was built

Authenticated callers can now submit one JPEG, PNG, HEIC, HEIF or PDF at `POST /api/receipts`.
Multer accepts exactly one `file` part into bounded memory; byte-level validation then sniffs the real
type, validates PDFs, and normalizes the original filename. The source is stored unchanged in the
private bucket before the `processing` receipt row is created, with a compensating delete if insertion
fails.

`GET /api/receipts/:id/source` gives the owner a five-minute signed URL and source metadata. `DELETE
/api/receipts/:id` soft-deletes the row; both the canonical receipt and source endpoint then return
404. No extraction is initiated here: the receipt remains `processing` until Task 07.

## Files created / modified

- `shared/src/upload.ts`, `shared/src/api.ts`, `shared/src/index.ts` — source content-type and upload
  error vocabularies plus the signed-source DTO.
- `api/src/upload/{multipart,source-file}.{ts,test.ts}` — bounded multipart parsing, byte/PDF
  validation and targeted unit coverage.
- `api/src/storage/receipt-sources.ts`, `api/src/routes/receipts.ts` — user-scoped Storage helpers and
  upload/source/delete routes.
- `api/src/routes/receipts.integration.ts`, `api/src/repositories/receipts.ts` — hosted lifecycle
  coverage and its narrow owner-filtered source-metadata projection.
- `api/package.json`, `package-lock.json`, `api/src/config.ts`, `api/vitest.config.ts`,
  `scripts/provision-storage.mjs`, `.env.example` — dependencies, limits and bucket provisioning.
- `client/src/i18n/locales/{en,hr}.json`, `client/src/i18n/uploadErrors.test.ts` — translated upload
  errors and code-to-locale parity.
- `README.md`, `.claude/commands/validate.md`, this history and the roadmap.

## Decisions made

1. **D1 — Multipart parser: `multer` 2.2.0.** Express has no multipart parser; Multer is the
   established Express wrapper around busboy and its 2.x line includes the fixes for the 1.x DoS
   advisories. It enforces file size, file count and text-field limits declaratively.
2. **D2 — Memory storage, not disk.** A bounded buffer goes directly to Storage, avoiding a temporary
   directory and cleanup path. The 10 MB API limit bounds memory by concurrent authenticated uploads.
3. **D3 — `file-type` 22.0.2 with five allowed types.** The allow-list is JPEG, PNG, HEIC, HEIF and
   PDF. Detection is from bytes, so a Windows executable claiming `image/jpeg` is rejected.
   `image/heic-sequence` and `image/heif-sequence` remain excluded because one upload is one document;
   undetected bytes fail closed.
4. **D4 — `pdf-lib` 1.17.1 for PDF inspection.** `PDFDocument.load(bytes, { ignoreEncryption: true })`
   makes `isEncrypted` reliable without brittle error-message matching; page count is checked after
   loading. A malformed document is `pdf_unreadable`. The package is server-only; its 22 MB installed
   size does not enter the browser bundle, and `@cantoo/pdf-lib` remains the compatible escape hatch.
5. **D5 — Configured defaults: 10 MB and 10 pages.** `MAX_UPLOAD_BYTES=10485760` and
   `MAX_PDF_PAGES=10` are positive-integer configuration with safe code defaults; `.env.example`
   lists names only.
6. **D6 — Signed URLs, 300-second TTL.** A signed URL works directly in an image or iframe without
   proxying bytes through the API. It is a bearer capability: soft deletion prevents issuing a new URL
   but cannot revoke one already issued before expiry.
7. **D7 — Generate id → upload object → insert row, with compensation.** A visible row without a
   source is worse than an invisible object. On insert failure, the API makes a best-effort object
   removal and propagates the insertion error.
8. **D8 — `fields: 0`.** Multipart requests can contain only the file part. A forged `userId` text
   field is rejected structurally rather than ignored, and Task 06 must keep its request body to that
   single part.
9. **D9 — 12 MB bucket backstop, no bucket MIME allow-list.** Provisioning creates/repairs the private
   bucket with `fileSizeLimit: 12582912`, above the API limit. `allowedMimeTypes` is deliberately not
   set because existing Storage RLS coverage needs a `text/plain` fixture; API byte sniffing is the
   relevant acceptance gate.

## Deviations from the plan

The plan stated that no repository method was needed, but its signed-source response requires
`contentType` and `originalFilename` while `findById` deliberately returns the canonical receipt with
no storage metadata. `ReceiptRepository.findSourceById` was added as one minimal, owner/deleted-filtered
projection. It keeps source fields out of the canonical public model and avoids either widening that
model or making two database reads.

## Validation results

```
Phase 0  npm install .................... PASS — 29 packages added, no vulnerabilities
Phase 1  npm run lint ................... PASS — oxlint, zero errors
Phase 2  npm run typecheck .............. PASS — tsc --build, exit 0
Phase 3  npm run format:check ........... PASS — all files formatted
Phase 4  npm test ....................... PASS — 18 files, 213 tests
Phase 5  npm run build .................. PASS — Vite build completed (existing >500 kB chunk warning)
Phase 6  Security/configuration ......... PASS — 6.1–6.6 and 6.8 commands; 6.1 regression rejected a
                                           temporary VITE_AZURE_DOCUMENT_INTELLIGENCE_KEY as expected
Phase 6.7 Logging inspection ............ PASS — no added logging; existing redaction still covers
                                           authorization, cookie, *.file and *.signedUrl
Phase 7a Docker schema suite ............ SKIPPED — no migration changed
Phase 7b Hosted integration ............. PASS — 3 files, 18 tests against real ES256 tokens
Phase 8  Real local stack/browser ....... PASS — API/proxy health; upload 201; disguised executable
                                           415; source 200; delete 204; source 404 after deletion.
                                           Browser HR/EN switch passed and 375 px had 375px scroll/client widths.
```

`npm run db:provision-storage` was run twice: first repaired the bucket to private with the 12 MB
limit; second reported it already matched. Integration cleanup removes Task 05 Storage objects before
deleting disposable `task05-` users; no task users or objects were left from the successful runs.

## Known gaps / follow-ups

- Task 06 owns the capture/upload UI and browser preview behavior for HEIC/HEIF. The server stores
  originals unchanged; no server-side conversion is needed.
- Task 07 owns Azure extraction and the `processing` → terminal status transition.
- A previously issued signed URL remains usable until its 300-second TTL after soft deletion. This is
  documented and is the accepted signed-URL trade-off for the PoC.
