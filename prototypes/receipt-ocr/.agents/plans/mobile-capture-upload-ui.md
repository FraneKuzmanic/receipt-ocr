# Feature: Mobile capture and upload UI

The following plan is complete, but implementation must still re-read the referenced files and
validate that their line numbers and contracts have not changed before editing.

Pay special attention to the existing multipart contract: the browser must send exactly one part
named `file`. Do not add metadata fields to `FormData`, do not set `Content-Type` manually, and do not
alter the selected `File` before upload.

## Feature Description

Replace the scaffold home/status screen with the first usable receipt workflow. An authenticated
mobile user can open the rear-camera-oriented picker or choose an existing image/PDF, inspect the
selection, receive simple non-blocking quality guidance, retake/reselect, upload the original file,
and see a processing screen that resolves to review, failure, connection error, or timeout.

This is a client feature over the Task 05 API. It does not call Azure, add an extraction endpoint,
implement the review form, or change persistence. Until Task 07 is present, a normal upload remains
`processing`; the timeout path is therefore a valid live outcome, while real `review` and `failed`
polling transitions are validated by changing disposable receipt rows through the hosted test
project's admin client.

## User Story

As a business user
I want to photograph a receipt or select an existing document on my phone
So that I can check the source and submit it for digitization without a dead end when camera capture
is unavailable.

## Problem Statement

Task 05 accepts and stores receipt sources, but the authenticated client still shows only an API
health card. There is no camera entry point, file fallback, preview/retake step, upload call, or
visible processing lifecycle. A user cannot exercise the product's primary capture-to-processing
workflow from the web app.

## Solution Statement

Use native file inputs rather than a custom `getUserMedia` camera surface:

- The primary `Scan receipt` input uses image-only `accept` values and `capture="environment"` to
  request the rear camera where supported.
- A separate, always-visible `Choose file` input accepts supported images and PDF. It remains usable
  if camera permission is denied, capture is cancelled, or the browser ignores `capture`.
- Selection is explicit and never uploads automatically. A preview screen offers `Use photo` and
  `Retake`; PDFs use a document preview card rather than attempting to render a PDF.
- JPEG/PNG/HEIC/HEIF images are decoded through the browser. A 256-pixel canvas sample supplies
  dimensions and an advisory Laplacian-variance blur score. Warnings never block `Use photo`.
- If HEIC/HEIF cannot be decoded by the current browser, selection is rejected with a translated
  instruction to choose a JPEG/PNG/PDF. No browser conversion package is added.
- Upload sends the original `File` unchanged in a one-entry `FormData`. On `201`, navigate to a
  protected processing route.
- The processing page performs one request at a time, polls every 2 seconds, times out after 60
  seconds, cancels work on unmount, routes `review` (and defensively `confirmed`) to the review
  destination, and renders actionable states for `failed`, request error, and timeout.
- A minimal review-ready destination proves routing without implementing Task 09's form.

## Feature Metadata

**Feature Type**: New capability

**Estimated Complexity**: Medium

**Primary Systems Affected**: React client routes, authenticated API client, browser file/image APIs,
i18n resources, client tests, README, validation journeys, roadmap/history records

**Dependencies**: Existing Task 05 receipt API and shared contracts; add `lucide-react` for familiar
camera/upload/retake/document icons. No image-processing, camera, HEIC-conversion, state-management,
or polling library is needed.

---

## Assumptions and Resolved Decisions

1. **Native capture, not `getUserMedia`.** `capture="environment"` is a preferred-facing-mode hint,
   not a guaranteed camera contract. The separate file picker is visible at all times in the idle
   state, so denial/cancellation cannot dead-end the flow.
2. **The app home route is the capture experience.** Replace the temporary API health card in
   `HomePage`; do not add a landing page in front of the product's primary action. Keep `getHealth`
   because Phase 8 still validates the shared health contract directly.
3. **`accept` is advisory.** Client MIME/extension checks improve feedback, but Task 05 byte sniffing
   remains authoritative. A server rejection must be translated and shown while retaining the
   selected file for retry or retake.
4. **Quality checks are advisory.** Warn when the image's short edge is below 800 pixels or when a
   256-pixel grayscale sample has Laplacian variance below 80. Do not claim to detect framing, glare,
   receipt count, or OCR readability. The user may upload despite either warning.
5. **No upload downscale.** The roadmap calls downscaling optional and the PRD requires preserving
   the original. Only the canvas analysis sample is downscaled; `createReceipt` receives the exact
   `File` returned by the input.
6. **HEIC/HEIF is browser-native or clearly rejected.** Safari 17+ can render HEIC. Other browsers
   may not. If browser decode fails, do not silently upload an image the user could not preview and
   do not add a conversion dependency. Show a localized format-specific message. The API remains
   capable of accepting HEIC/HEIF from clients that can preview it.
7. **Polling is sequential.** Use recursive `setTimeout`, not `setInterval`, so slow requests cannot
   overlap. Poll immediately, then every 2,000 ms. Stop after 60,000 ms of wall-clock time.
8. **No Task 07 retry endpoint.** `failed` offers `Upload another receipt`; timeout/request error
   offers `Check again` plus `Upload another receipt`. Do not implement or call `POST /:id/retry`.
9. **Review is a destination, not a form.** Add `/receipts/:id/review` with a minimal ready state so
   the Task 06 transition is real. Task 09 replaces that page with the editable form.
10. **No backend or database edits.** Existing create/get routes and schemas are sufficient. If
    implementation reaches for `api/src/routes`, `supabase/migrations`, Storage policy, or Azure
    code, stop and reassess.

---

## CONTEXT REFERENCES

### Relevant Codebase Files - Read Before Implementing

- `.agents/ROADMAP.md:382` - Task 06 scope and definition of done. Read through line 419, including
  the explicit Task 09 exclusion.
- `PRD.md:493` - mobile capture requirements; rear-camera preference, fallback, guidance, retake.
- `PRD.md:529` - accepted source formats and HEIC/HEIF qualification.
- `PRD.md:539` - optional OCR derivative versus mandatory original-source preservation.
- `PRD.md:548` - quality pre-check intent and the prohibition on a complex quality classifier.
- `PRD.md:903` - create receipt API; the client must support the normal `processing` response.
- `PRD.md:943` - receipt polling contract and status-dependent response shape.
- `PRD.md:1092` - visible feedback, approximate latency goal, and actionable failure requirement.
- `client/src/App.tsx:9` - protected route tree. Add receipt routes before the protected catch-all at
  line 20; continue importing only from `react-router`.
- `client/src/routes/HomePage.tsx:9` - temporary home health screen to replace with capture/preview
  state. Preserve the mobile-first, translated component style; remove only health-specific state
  and imports.
- `client/src/api/client.ts:4` - `ApiError` and the single authenticated request path. Extend this
  helper rather than issuing raw `fetch` from route components.
- `client/src/api/client.ts:20` - bearer-token attachment, `401` sign-out behavior, and non-OK error
  handling that must remain centralized.
- `client/src/api/client.test.ts:46` - fetch/session mocking conventions and existing auth regression
  tests that must continue to pass.
- `client/src/components/AppLayout.tsx:7` - authenticated shell and constrained mobile content area.
  Do not refactor the shell as part of this task.
- `client/src/components/Spinner.tsx` - existing accessible loading indicator for image analysis,
  upload, and processing.
- `client/src/components/ErrorMessage.tsx` - existing translated error/retry presentation pattern.
- `client/src/index.css:1` - Tailwind v4 entry point and minimal global styles. Prefer component
  utilities; add global CSS only for a behavior utilities cannot express.
- `client/src/i18n/locales/en.json` and `client/src/i18n/locales/hr.json` - add identical `capture`,
  `processing`, and `reviewReady` key trees. Never surface provider/library names.
- `client/src/i18n/i18n.test.ts:17` - locale parity and non-empty value checks already protect all
  literal keys.
- `client/src/i18n/uploadErrors.test.ts:13` - every server upload code already has HR/EN copy and is
  checked against `UPLOAD_ERROR_CODES`.
- `shared/src/upload.ts:7` - accepted source content types and stable upload error vocabulary. Import
  from `@receipt/shared`; do not redeclare server error codes.
- `shared/src/api.ts:12` - stable API failure shape; use `apiErrorResponseSchema` to preserve the
  machine code on `ApiError`.
- `shared/src/api.ts:22` - create response type/schema.
- `shared/src/receipt.ts:4` - status vocabulary and canonical receipt returned by `GET /:id`.
- `api/src/upload/multipart.ts:6` - hard server limits: one file, zero text fields. This is why client
  `FormData` must contain only `file`.
- `api/src/upload/source-file.ts:15` - byte-level server validation. Client checks are not a security
  boundary and must not duplicate binary sniffing.
- `api/src/routes/receipts.ts:29` - existing owner-filtered polling endpoint.
- `api/src/routes/receipts.ts:43` - existing upload endpoint and `201` response.
- `api/src/config.ts:85` - 10 MiB default. The client pre-check mirrors this default for early
  feedback, while the server remains authoritative if deployment configuration changes.
- `README.md:210` - Task 05 upload contract, supported types, limits, and original-source semantics.
- `.claude/commands/validate.md:328` - live-server journey rules and port hygiene.
- `.claude/commands/validate.md:455` - Task 06 journey row to move into Phase 8 when shipped.
- `.agents/history/05-receipt-upload-source-document-persistence.md:8` - actual Task 05 behavior and
  locked decisions D1-D9, especially exact source retention and `fields: 0`.

### Existing Patterns to Mirror

**Authenticated request path** (`client/src/api/client.ts:20`):

```ts
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  const response = await fetch(path, { ...init, headers });
  // 401 signs out; other non-OK responses become ApiError.
  return response;
}
```

All new API functions go through this helper. Extend it to parse the existing shared error body; do
not reproduce auth or sign-out logic in capture/processing components.

**Cancelable effect** (`client/src/routes/HomePage.tsx:16` and `AuthProvider.tsx:11`):

```ts
useEffect(() => {
  let cancelled = false;
  // async work checks cancelled before changing state
  return () => {
    cancelled = true;
  };
}, [dependency]);
```

Polling additionally clears its timeout and aborts the active request. This is required because the
app renders under React Strict Mode.

**Route ownership** (`client/src/App.tsx:18`): all capture, processing, and review-ready routes stay
inside `ProtectedRoute`. The catch-all remains last and inside the same branch.

**Translations**: components call `t()` with literal keys. API upload codes are the one dynamic case;
validate them with `uploadErrorCodeSchema` before constructing `upload.${code}`.

**Testing**: client tests use Vitest, jsdom, Testing Library, `MemoryRouter`, module mocks, and
`vi.stubGlobal`/`vi.restoreAllMocks`. Follow `ProtectedRoute.test.tsx` for route assertions and
`client.test.ts` for fetch assertions.

### New Files to Create

- `client/src/capture/receiptFile.ts` - supported-file classification, 10 MiB pre-check, browser image
  decode, dimensions, 256-pixel canvas sample, and pure Laplacian variance calculation.
- `client/src/capture/receiptFile.test.ts` - pure classification/size/quality tests without depending
  on jsdom canvas support.
- `client/src/routes/HomePage.test.tsx` - capture, fallback, preview, warning, retake, upload, and error
  behavior.
- `client/src/routes/ProcessingPage.tsx` - sequential status polling and terminal UI states.
- `client/src/routes/ProcessingPage.test.tsx` - fake-timer route tests for review, failed, error,
  timeout, retry, and cleanup.
- `client/src/routes/ReviewReadyPage.tsx` - intentionally minimal Task 06 destination for a receipt in
  review state; no editable fields.
- `.agents/history/06-mobile-capture-upload-ui.md` - implementation decisions, deviations, real
  validation results, phone/browser used, and known Task 07/09 follow-ups.

Do not create a custom camera component, upload context/provider, state machine library wrapper,
polling hook used only once, image worker, HEIC converter, service worker, or API/backend file.

### Relevant Documentation - Read Before Implementing

- [W3C HTML Media Capture: capture attribute](https://www.w3.org/TR/html-media-capture/#the-capture-attribute)
  - `environment` expresses preferred facing mode and the user agent only *should* invoke the
    matching capture control.
  - Why: justifies a native capture hint plus an independent fallback, not permission assumptions.
- [WHATWG HTML: accept attribute](https://html.spec.whatwg.org/multipage/input.html#attr-input-accept)
  - `accept` is a file-picker hint expressed as MIME/extension tokens.
  - Why: the client improves selection UX while Task 05 remains the security boundary.
- [W3C File API: blob URLs](https://www.w3.org/TR/FileAPI/#blob-url)
  - Blob URL mappings retain the underlying Blob until revoked.
  - Why: every selection replacement, retake, successful upload/navigation, and unmount must revoke
    its preview URL.
- [React: synchronizing with effects, fetching data](https://react.dev/learn/synchronizing-with-effects#fetching-data)
  - Effects must abort or ignore stale fetch results and clean timers/subscriptions.
  - Why: prevents Strict Mode's development remount and route changes from causing stale polling.
- [WebKit: HEIC in Safari 17](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/#heic)
  - Safari 17 added native HEIC importing/display/editing support.
  - Why: browser-native preview is viable on current Apple devices but cannot be assumed elsewhere.
- [Azure Document Intelligence receipt input requirements](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt#input-requirements)
  - Prebuilt models accept PDF, JPEG, PNG, and HEIF; best results use one clear photo; image bounds
    are 50x50 to 10,000x10,000 and readable text needs adequate pixel height.
  - Why: supports keeping HEIF on the server path and treating quality checks as guidance.
- [OpenCV: Laplace operator](https://docs.opencv.org/4.x/d5/db5/tutorial_laplace_operator.html)
  - The second spatial derivative responds to image edges.
  - Why: basis for the small dependency-free focus proxy. It is not evidence that a universal blur
    threshold exists, which is why the warning cannot block upload.
- [lucide-react package](https://www.npmjs.com/package/lucide-react)
  - Tree-shakeable React icon components.
  - Why: use familiar camera, upload, document, check, and retake symbols instead of hand-authored
    SVGs. Install through npm so the lockfile records the exact current version.

---

## IMPLEMENTATION PLAN

### Phase 1: Client Contract and File Analysis Foundation

Extend the centralized API client so route components can upload a source, poll a receipt, cancel a
poll request, and translate stable server error codes. Add one focused receipt-file module for
client-only pre-checks and image analysis. No server contract changes are required.

### Phase 2: Capture, Preview, and Upload Experience

Turn the protected home route into the actual capture experience. Keep camera and fallback actions
visible, use large one-handed targets, preview before any network request, preserve warnings as
advisory, and upload only after explicit confirmation.

### Phase 3: Processing Lifecycle and Routing

Add protected processing and review-ready routes. Poll sequentially with cleanup and a finite
timeout. Every terminal or exceptional state has a clear next action, and no route depends on Task
07 or Task 09 code.

### Phase 4: Tests, Documentation, and Full Validation

Cover pure analysis logic, user interactions, API body/error behavior, all polling outcomes, i18n
parity, responsive desktop checks, and a real phone. Update the plan of record and `/validate`
journeys by hand, then run the complete existing validation sweep.

---

## STEP-BY-STEP TASKS

Execute in order. Each step is independently checkable; do not batch unrelated refactors into it.

### 1. ADD `lucide-react` to the client workspace

- **IMPLEMENT**: from the repository root run
  `npm install lucide-react --workspace @receipt/client`. Let npm update `client/package.json` and
  `package-lock.json`; do not hand-pick an unverified version.
- **USE**: import only the icons rendered by Task 06 so Vite can tree-shake the package.
- **GOTCHA**: do not add a second component or styling library.
- **VALIDATE**: `npm ls lucide-react --workspace @receipt/client`

### 2. UPDATE `client/src/api/client.ts` and `client/src/api/client.test.ts`

- **IMPLEMENT**: add optional `code?: string` to `ApiError`. For non-OK responses, attempt to parse a
  cloned/read JSON body with `apiErrorResponseSchema`; preserve its `error.code`, falling back to an
  uncoded `ApiError` for malformed/non-JSON responses. Keep the existing 401 sign-out exactly once.
- **IMPLEMENT**: allow `request` to receive an `AbortSignal` through normal `RequestInit`.
- **ADD**: `createReceipt(file: File): Promise<CreateReceiptResponse>`. Build `new FormData()`, call
  `formData.append("file", file)`, and send `POST /api/receipts` with that body.
- **ADD**: `getReceipt(id: string, signal?: AbortSignal): Promise<CanonicalReceipt>` using
  `GET /api/receipts/${encodeURIComponent(id)}`.
- **PATTERN**: keep response conversion consistent with `getHealth`; types come from
  `@receipt/shared`. Do not introduce a second fetch wrapper.
- **GOTCHA**: never set `Content-Type` for `FormData`; the browser adds the multipart boundary.
- **TEST**: create request contains exactly one `file` entry, carries the original `File` object,
  includes auth, has no manually-set multipart header, accepts `201`, forwards abort signal, parses a
  stable upload error code, tolerates a malformed error body, and preserves all existing 401 tests.
- **VALIDATE**: `npx vitest run --project client client/src/api/client.test.ts`

### 3. CREATE `client/src/capture/receiptFile.ts` and its unit test

- **IMPLEMENT**: export constants:
  - `MAX_CLIENT_UPLOAD_BYTES = 10 * 1024 * 1024`
  - `QUALITY_SAMPLE_MAX_EDGE = 256`
  - `MIN_RECOMMENDED_SHORT_EDGE = 800`
  - `BLUR_VARIANCE_WARNING_THRESHOLD = 80`
  - explicit camera/image and file-picker `accept` strings covering JPEG/JPG, PNG, HEIC/HEIF, and
    PDF; include extensions because some browsers return an empty `File.type`.
- **IMPLEMENT**: a synchronous classifier that:
  - rejects empty selection, unsupported declared MIME/extension, and files above the client limit;
  - permits extension fallback only when `File.type` is empty;
  - distinguishes `image` from `pdf`;
  - never claims byte-level validity.
- **IMPLEMENT**: browser image analysis using an object URL plus `HTMLImageElement.decode()`. Capture
  natural dimensions, draw an aspect-preserving sample whose longest edge is at most 256 pixels,
  read image data, and revoke the analysis URL in `finally`.
- **IMPLEMENT**: convert RGB to grayscale and compute the variance of a 4-neighbor discrete
  Laplacian over interior pixels. Return `low_resolution` and/or `possible_blur`; never throw merely
  because the score is low.
- **IMPLEMENT**: surface decode/canvas failure as `preview_unavailable`; the component translates it
  and prevents upload because preview/quality confirmation was not possible.
- **GOTCHA**: this helper creates an analysis sample only. It must return/retain the original `File`,
  never a canvas Blob. Do not add EXIF rewriting or compression.
- **TEST**: MIME acceptance, empty-MIME extension fallback, mismatched non-empty MIME rejection,
  10 MiB boundary, PDF bypass of image analysis, grayscale/Laplacian output for flat versus
  high-edge synthetic `ImageData`, low-resolution warning, blur warning, and warning non-blocking
  result. Keep browser decode itself for component mocks/manual browser validation because jsdom has
  no real image decoder/canvas.
- **VALIDATE**: `npx vitest run --project client client/src/capture/receiptFile.test.ts`

### 4. REPLACE `client/src/routes/HomePage.tsx` with capture/preview/upload UI

- **IMPLEMENT**: idle view with concise translated capture guidance: full receipt visible, readable,
  minimal glare. The first and visually dominant action is `Scan receipt` with a camera icon and an
  image-only hidden file input carrying `capture="environment"`.
- **IMPLEMENT**: keep `Choose file` with an upload icon and the broader image/PDF input immediately
  available. Do not conditionally hide it based on permission APIs or feature detection.
- **IMPLEMENT**: selection runs basic validation and, for images, async analysis. Show the existing
  spinner while checking. A cancelled picker leaves current state unchanged.
- **IMPLEMENT**: ready view shows an `img` using a component-owned object URL for images; PDF uses a
  stable document panel with icon, filename, and size. Include translated quality warnings and file
  metadata without exposing a local path.
- **IMPLEMENT**: `Retake`/`Choose another` clears both input values, the selected `File`, warnings,
  errors, and preview URL. `Use photo`/`Use file` is the only path that invokes `createReceipt`.
- **IMPLEMENT**: during upload disable controls and show visible feedback. On success call
  `navigate(`/receipts/${receipt.id}/processing`)`. On `ApiError`, map known upload codes through
  `uploadErrorCodeSchema` to existing `upload.*` copy; otherwise show a generic translated error.
  Retain the selection so the user can retry or retake.
- **PATTERN**: use a small discriminated local state or a few direct state values; do not add context,
  reducer infrastructure, or a global store for this one-page workflow.
- **ACCESSIBILITY**: use semantic buttons/labels, visible focus, `aria-live` for check/upload/errors,
  descriptive image alt text, 44px minimum targets, and no hover-only information.
- **LAYOUT**: full-width actions on narrow screens, preview constrained by `max-height`/`object-contain`
  with stable dimensions, no nested cards, no text overflow, and no viewport-scaled typography.
- **CLEANUP**: revoke the preview URL whenever selection changes and on unmount. Retake must make
  selecting the same file fire `change` again.
- **VALIDATE**: `npm run typecheck; npx vitest run --project client`

### 5. CREATE `client/src/routes/HomePage.test.tsx`

- **MOCK**: `analyzeReceiptImage` and `createReceipt`; render `HomePage` under `MemoryRouter` and i18n
  using the repository's existing setup.
- **TEST**:
  - camera input is image-only and has `capture="environment"`;
  - fallback accepts image/PDF and remains rendered independently of camera action;
  - selecting does not upload;
  - image preview and PDF document preview render;
  - low-resolution/blur warnings still leave `Use` enabled;
  - oversized/unsupported/decode-failed selections cannot upload and show translated action;
  - retake revokes/clears the prior selection and `createReceipt` remains uncalled;
  - upload sends the same `File` object and navigates only after success;
  - server upload codes and generic/network errors are translated;
  - upload button cannot double-submit while pending.
- **GOTCHA**: stub and restore `URL.createObjectURL`/`URL.revokeObjectURL`; assert revocation without
  relying on jsdom to display image pixels.
- **VALIDATE**: `npx vitest run --project client client/src/routes/HomePage.test.tsx`

### 6. CREATE `client/src/routes/ProcessingPage.tsx`

- **IMPLEMENT**: read `id` from `useParams`, poll immediately through `getReceipt`, and use a recursive
  2-second `setTimeout`. Keep `POLL_INTERVAL_MS` and `POLL_TIMEOUT_MS` exported or otherwise directly
  testable.
- **IMPLEMENT**: one effect owns a start time, abort controller, active timer, and cancelled flag.
  Cleanup aborts, clears, and prevents stale state/navigation.
- **TRANSITIONS**:
  - `processing`: schedule next poll unless 60 seconds elapsed;
  - `review`: `navigate(`/receipts/${id}/review`, { replace: true })`;
  - `confirmed`: use the same terminal destination defensively so a stale processing URL never loops;
  - `failed`: stop and render `Upload another receipt` linking to `/`;
  - timeout: stop and render `Check again` (fresh 60-second window) plus upload-another;
  - request error/404: stop and render a translated message with check-again/upload-another. A 401 is
    already handled centrally by sign-out and `ProtectedRoute`.
- **UI**: visible spinner and short status text, stable centered layout, `aria-live="polite"`, and
  large one-handed actions. Do not show an invented percentage or provider name.
- **GOTCHA**: no `setInterval`, no overlapping GETs, no retry POST, and no endless background poll.
- **VALIDATE**: `npm run typecheck`

### 7. CREATE `ProcessingPage.test.tsx` and `ReviewReadyPage.tsx`

- **IMPLEMENT**: `ReviewReadyPage` shows only a translated ready heading/status and an upload-another
  action. It must not render editable receipt fields or imply OCR accuracy.
- **TEST PROCESSING** with fake timers and mocked `getReceipt`:
  - immediate first request;
  - processing schedules exactly one next request after 2 seconds;
  - no overlap while a request is pending;
  - review navigates with replacement and stops polling;
  - confirmed does not loop;
  - failed shows re-upload and stops;
  - 60-second timeout shows both actions;
  - `Check again` starts a new finite polling window;
  - request rejection is actionable;
  - unmount aborts/ignores completion and clears the timer;
  - Strict Mode behavior does not produce stale state changes.
- **GOTCHA**: flush promises between fake-timer advances; restore real timers in `afterEach`.
- **VALIDATE**: `npx vitest run --project client client/src/routes/ProcessingPage.test.tsx`

### 8. UPDATE `client/src/App.tsx` and both locale JSON files

- **ROUTES**: under `ProtectedRoute`, add
  `/receipts/:id/processing` -> `ProcessingPage` and
  `/receipts/:id/review` -> `ReviewReadyPage`, before the catch-all.
- **I18N**: add matching HR/EN trees for capture actions/guidance/checking/file metadata/local
  validation/quality warnings/uploading, processing states/actions, and review-ready state.
- **COPY**: use plain user language. Do not mention Azure, Supabase, Laplacian, MIME, HEIC decoder,
  browser capability APIs, or Task numbers. The HEIC failure should simply ask for JPEG, PNG, or PDF.
- **PATTERN**: keep existing `upload.*` server messages; do not duplicate those codes under capture.
- **VALIDATE**: `npx vitest run --project client client/src/i18n/i18n.test.ts client/src/i18n/uploadErrors.test.ts`

### 9. UPDATE `README.md`

- **IMPLEMENT**: change status from Task 05 to Task 06 and describe the now-usable client flow.
- **DOCUMENT**:
  - native rear-camera hint and permanent picker fallback;
  - client checks are advisory and server sniffing is authoritative;
  - exact 800px/80-score warning thresholds and that warnings do not block upload;
  - original `File` uploads unchanged; canvas is analysis/preview only;
  - HEIC/HEIF preview is native-browser-dependent and unsupported decode asks for JPEG/PNG/PDF;
  - 2-second polling, 60-second timeout, and available actions;
  - Task 07 absence means ordinary Task 06 uploads remain processing until timeout.
- **GOTCHA**: do not claim camera enforcement, blur detection accuracy, HEIC support in every browser,
  or live extraction before Task 07.
- **VALIDATE**: run the README consistency one-liner in `.claude/commands/validate.md` Phase 6.6,
  then run `rg -n "native|capture|HEIC|original|2-second|60-second" README.md` and inspect every
  match against the shipped behavior.

### 10. UPDATE `.claude/commands/validate.md` by hand

- **IMPLEMENT**: read `Maintaining this file` first. Never regenerate it.
- **UPDATE**: Phase 4 test inventory for the new client tests.
- **UPDATE**: Phase 8 preamble from Task 05/three journeys to Task 06/four journeys. Revise the old
  manual home-page check so it expects the capture UI instead of the removed API status card; the
  health contract remains covered by 8.2's direct requests.
- **ADD**: a Task 06 journey covering camera cancel/denial fallback, image and PDF selection, preview,
  warning, retake, exact-file upload, review transition, failed state, request error, and timeout.
- **REAL SERVER STATES**: if Task 07 is not yet implemented, use a disposable receipt and the hosted
  admin client to set its row to `review`, then another to `failed`; the browser must observe the real
  `GET /api/receipts/:id` response. Leave a third untouched to verify timeout. Do not add product-only
  test controls.
- **REAL PHONE**: specify same-LAN startup with API plus
  `npm run dev --workspace @receipt/client -- --host 0.0.0.0 --strictPort`, use Vite's printed Network
  URL, and record device/OS/browser. Verify one-handed operation and actual rear-camera preference.
- **REMOVE**: Task 06 row from Phase 9. Keep every later row intact.
- **VALIDATE**: `rg -n "Task 06|capture|real phone|Phase 9" .claude/commands/validate.md`

### 11. UPDATE `.agents/ROADMAP.md` and CREATE Task 06 history after validation

- **ROADMAP**: only after all checks pass, mark Task 06 complete, link this plan and the new history,
  update top status/progress summary, and leave Task 07 as next. Do not edit Task 07 scope.
- **HISTORY**: follow the existing template and record actual files, exact dependency version,
  thresholds, HEIC decision, polling constants, validation output, phone/browser, deviations, and
  the Task 07/09 boundaries. Do not copy planned results as if they ran.
- **NOTE**: correct Task 05 history's `Commit: pending human review` only if the implementation task
  is explicitly cleaning documentation drift and can verify commit `1ff1a97`; otherwise mention the
  drift without mixing it into Task 06's code diff.
- **VALIDATE**: `rg -n "Task 06|Mobile capture|Task 07" .agents/ROADMAP.md .agents/history/06-mobile-capture-upload-ui.md`

### 12. RUN the complete validation sweep

- **IMPLEMENT**: run `.claude/commands/validate.md` from Phase 0 through Phase 8 in order. Report every
  result honestly.
- **DATABASE**: Phase 7a is skippable because this plan changes no migration; report `SKIPPED - no
  migration changed`. Hosted Phase 7b remains mandatory even though the API is unchanged.
- **MANUAL**: finish both desktop responsive checks and the real-phone journey. A desktop emulator
  alone does not satisfy Task 06.
- **VALIDATE**: all commands and journeys in the Validation Commands section below.

---

## TESTING STRATEGY

### Unit and Component Tests

`receiptFile.test.ts` owns deterministic client logic: allowed types, empty-MIME extension fallback,
size boundary, quality-score math, and warning thresholds. It should use generated in-memory pixels,
not committed receipt images or brittle browser decoding.

`client.test.ts` owns HTTP shape: authentication, one-part `FormData`, untouched `File` identity,
abort signal, `201`, stable error code, malformed error fallback, and 401 sign-out.

`HomePage.test.tsx` owns user intent: selection is not submission, fallback is always available,
retake destroys the old selection, warnings are advisory, server errors are translated, and success
navigates exactly once.

`ProcessingPage.test.tsx` owns time and lifecycle: sequential requests, all statuses, finite timeout,
retry window, cleanup, and route replacement. Use fake timers only in this file.

### Integration Tests

No new API integration test is required because Task 06 does not alter the API. Run the existing
hosted suite unchanged to prove upload, owner filtering, source storage, and soft-delete contracts
still work. Do not add a fake server-side route just to make client tests convenient.

The Phase 8 browser journey is the integration layer for this task. Before Task 07, use the hosted
admin client only to move disposable rows between existing valid statuses; the browser still polls
the real Express/Supabase path.

### Manual Browser and Device Testing

Desktop responsive validation covers 320/375/768px widths, keyboard focus, no horizontal overflow,
image and PDF picker behavior, and translated copy. It cannot validate rear-camera preference or
permission UX.

Real-phone validation is mandatory on at least one current iOS Safari or Android Chrome device. Test
camera capture, cancel/deny then fallback, retake, same-file reselect, one-handed controls, rotation,
preview framing, upload over the same LAN, status changes, and timeout. Record device, OS, browser,
and any browser-specific picker behavior in Task 06 history.

### Edge Cases

| Case | Expected behavior |
| --- | --- |
| Camera input ignored by desktop/browser | Native picker opens; separate file fallback remains visible |
| Camera permission denied or capture cancelled | No state loss or error dead end; fallback works |
| Picker cancelled after a previous selection | Existing preview remains unchanged |
| Same file chosen after retake | `change` fires and preview is rebuilt |
| Empty `File.type`, supported extension | Client permits selection; server still sniffs bytes |
| Non-empty unsupported MIME with `.jpg` name | Client rejects early; server remains authoritative |
| Exactly 10 MiB | Client permits; server decides from configured limit |
| More than 10 MiB | Client blocks with translated size message before POST |
| Corrupt image or unsupported HEIC decode | Clear translated reselect message; no POST |
| PDF | Metadata/document preview; no image-quality warning |
| Low-resolution or low-focus image | Warning shown; `Use photo` remains enabled |
| Retake before `Use photo` | No network request; old object URL revoked |
| Double tap during upload | One POST only |
| Server rejects spoofed/invalid bytes | Existing translated `upload.*` message; preview retained |
| Poll request slower than 2 seconds | No overlapping request |
| `processing` for 60 seconds | Timeout with check-again and re-upload actions |
| `review` | Replace navigation to `/receipts/:id/review` and polling stops |
| `failed` | Polling stops; re-upload action shown |
| Network failure or 404 while polling | Polling stops; actionable translated state |
| Route unmount/Strict Mode remount | Active request ignored/aborted and timer cleared |

---

## VALIDATION COMMANDS

Run from the repository root. PowerShell 5.1 does not support `&&`; run commands separately or use
`;` only where the command's result does not depend on short-circuit behavior.

### Level 1: Syntax and Style

```powershell
npm run lint
npm run typecheck
npm run format:check
```

### Level 2: Unit and Component Tests

```powershell
npx vitest run --project client
npm test
```

Expected: all existing shared/API/client tests plus the new Task 06 cases pass. Do not update
snapshots to hide semantic or accessibility regressions; this plan does not require snapshots.

### Level 3: Build and Static Security

```powershell
npm run build
npm run validate
```

Then run all Phase 6 commands from `.claude/commands/validate.md`, including:

- no secret/service-role/Azure key in `client/dist`;
- no provider vocabulary in shared/client user-facing surfaces;
- no new raw `fetch` outside `client/src/api/client.ts`;
- translation-key and README consistency checks;
- logging inspection (no file name, file bytes, preview URL, or receipt content logged).

### Level 4: Hosted Integration

```powershell
npm run test:integration
```

Phase 7a local Docker schema suite is `SKIPPED - no migration changed`. If implementation changes a
migration despite this plan, the skip is invalid and the full local database sequence becomes
mandatory.

### Level 5: Live Desktop and Real Phone

First apply Phase 8 port hygiene. Start API and network-visible client in separate terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev --workspace @receipt/client -- --host 0.0.0.0 --strictPort
```

Use `http://localhost:5173` for desktop and Vite's printed `Network` URL on a phone connected to the
same trusted LAN. If Windows Firewall blocks the port, request/record the narrow firewall allowance;
do not disable the firewall globally.

Complete all Phase 8 journeys. For Task 06 specifically:

1. Confirm translated capture UI at `/`, 44px targets, no 320/375px overflow, and file fallback.
2. Capture a real receipt, cancel/deny once, then use fallback. Verify image preview and guidance.
3. Retake and confirm the first file was not posted; select again and submit.
4. Select a PDF and verify document preview/submit.
5. Exercise a quality warning and confirm it remains non-blocking.
6. Observe `processing`; with Task 07 absent, leave one receipt untouched for 60 seconds and verify
   timeout, check-again, and upload-another.
7. For two disposable uploads, set one hosted row to `review` and one to `failed` through the admin
   client. Verify real polling routes to review-ready and renders actionable failure.
8. Stop the API during a poll and verify the request-error state recovers through `Check again` after
   restart.
9. Repeat camera/fallback/retake/upload on a real phone and record device/OS/browser in history.
10. Stop both dev processes and rerun port hygiene so 3001 and 5173-5176 are free.

---

## ACCEPTANCE CRITERIA

- [ ] Authenticated `/` presents `Scan receipt` as the primary action and a simultaneously available
      file-picker fallback.
- [ ] Supporting phones receive `capture="environment"`; denial, cancellation, or ignored capture
      never removes the fallback path.
- [ ] JPEG/PNG/HEIC/HEIF (when browser-decodable) and PDF selections reach an explicit preview step.
- [ ] HEIC/HEIF that the current browser cannot decode is rejected with clear HR/EN fallback copy and
      no conversion dependency.
- [ ] Unsupported type and over-10-MiB files are rejected client-side; server validation remains
      authoritative.
- [ ] Low resolution and possible blur produce advisory warnings and never disable submission.
- [ ] Capture guidance asks for the whole readable receipt with minimal glare without claiming that
      framing/glare was automatically detected.
- [ ] Retake revokes/discards the prior preview and never uploads it; the same file can be selected
      again afterwards.
- [ ] Upload sends the original `File` unchanged as the sole `file` multipart part and does not set
      multipart `Content-Type` manually.
- [ ] A successful `201` routes to `/receipts/:id/processing` with visible feedback.
- [ ] Polling is immediate, sequential, 2 seconds apart, cleaned on unmount, and finite at 60 seconds.
- [ ] `review` transitions to the protected review-ready route; `failed`, timeout, and request error
      each stop polling and expose an actionable next step.
- [ ] No Task 07 retry endpoint or Task 09 review form is implemented.
- [ ] Every new user-facing string exists in Croatian and English; no raw key or provider/library
      vocabulary appears.
- [ ] The experience is keyboard accessible, has 44px touch targets, does not overflow at 320/375px,
      and is operable one-handed.
- [ ] The complete flow is verified on a real phone browser and the device details are recorded.
- [ ] All existing hosted integration tests, unit tests, lint, typecheck, format, security checks, and
      build pass.
- [ ] README, validation journeys, roadmap, and Task 06 history reflect actual shipped behavior.

---

## COMPLETION CHECKLIST

- [ ] Tasks 1-12 completed in order with each targeted validation passing.
- [ ] Diff contains no backend, database, Azure, custom-camera, conversion, or review-form work.
- [ ] `FormData` contains exactly one original `File` under `file`.
- [ ] Object URLs and polling resources are cleaned on retake, selection replacement, navigation,
      unmount, and Strict Mode remount.
- [ ] HR/EN locale parity test passes.
- [ ] Client targeted tests and full `npm test` pass.
- [ ] Full `/validate` sweep passes; Phase 7a skip is named, Phase 7b passes.
- [ ] Desktop and real-phone Phase 8 journey passes; ports are clean afterwards.
- [ ] Task 06 row is removed from validation Phase 9 and Task 07 remains untouched.
- [ ] History records real results and any deviation rather than planned claims.

---

## NOTES

### Key Risks and Mitigations

1. **Browser picker behavior varies.** `capture` cannot guarantee a rear camera or even a direct
   camera UI. The fallback is a first-class control, not an error-only escape hatch.
2. **HEIC decode support is uneven.** The server/Azure path can accept HEIF, but Task 06 requires a
   preview. Native decode plus clear fallback avoids a large client converter and preserves the
   original-source contract.
3. **Blur scores are content-dependent.** Thermal receipts can have naturally sparse edges and dark
   backgrounds can skew scores. Fixed-size sampling makes results deterministic, and advisory-only
   warnings contain the risk of false positives.
4. **Large camera images cost browser memory.** The 10 MiB file limit bounds input size but not
   decoded pixels. Analysis draws only 256px and releases URLs/canvas references promptly. Do not add
   full-resolution pixel copies or data URLs.
5. **Task 07 does not yet advance status.** A normal Task 06 upload timing out is expected, not a bug.
   Real status transitions are still testable through disposable hosted rows without adding product
   mocks or temporary API controls.
6. **Client size limit mirrors a configurable server default.** The deployed API remains the source
   of truth. If a deployment changes `MAX_UPLOAD_BYTES`, Task 12 should expose runtime limits through
   configuration rather than silently introducing another Task 06 endpoint.

### Deliberately Out of Scope

Azure submission/mapping and processing retry (Task 07); QR decode (Task 08); editable review and
confirmation (Task 09); history/detail/source presentation (Task 10); export (Task 11); custom camera
UI, flash/zoom controls, edge/framing detection, automatic glare detection, HEIC conversion,
client-side OCR, offline queue, multi-image stitching, upload progress percentages, and upload
downscaling.

### Confidence

**8.5 / 10** for one-pass implementation. The API contract, routing/auth patterns, status schema,
test stack, and browser standards are all explicit. Residual risk is concentrated in real-device
file-picker/HEIC behavior and in choosing a useful blur threshold without a representative receipt
fixture set; making the heuristic advisory prevents either risk from blocking the core upload flow.
