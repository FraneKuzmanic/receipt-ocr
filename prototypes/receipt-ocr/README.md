# Mobile Receipt Capture & OCR PoC

A mobile-first web application for digitizing Croatian retail receipts. A user photographs or uploads
a receipt, the backend extracts structured data with Azure Document Intelligence, and the user
reviews, corrects and confirms the result before exporting it as CSV or JSON.

OCR output is treated as a draft, never as authoritative accounting data — the human confirms the
final record. See [`PRD.md`](PRD.md) for the full product specification and
[`.agents/ROADMAP.md`](.agents/ROADMAP.md) for the implementation plan.

> **Status:** All 11 roadmap tasks are complete and the prototype is deployed. Authenticated users can
> photograph or choose a receipt, follow asynchronous Azure extraction, then review, correct,
> confirm, revisit, soft-delete and export confirmed receipts as CSV or JSON. Further testing and
> iteration now happens directly against the deployed prototype rather than through another planned
> task.

## Prerequisites

- **Node.js 24 LTS** (`.nvmrc` pins `24`; anything older fails the `engines` check)
- **npm 10+** (ships with Node 24)
- **Docker Desktop** (required only for local Supabase schema work — migrations, pgTAP and
  `npm run test:integration:local`. The default integration run does not need it.)

## Setup

```bash
npm install
cp .env.example .env
```

`npm install` also builds `shared` via the `prepare` script, so the workspaces resolve each
other immediately. `.env` is git-ignored; `.env.example` lists every variable name with no values.

> Do not run the copy step if `.env` already exists — it will overwrite credentials you have
> already filled in.

**Supabase credentials are now required to start.** `api/src/config.ts` refuses to boot without
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `STORAGE_BUCKET`, and the client throws at load without
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Failing at startup is deliberate: the
alternative is an app that starts fine and then rejects every authenticated request for reasons
that look like a bug in the code. The two `VITE_` values are the same URL and publishable key as
their server counterparts. The local database workflow still gets disposable credentials from the
Supabase CLI, and Azure values are not needed until Task 07.

## Database development

Task 03 uses the pinned Supabase CLI and a Docker-backed local stack. Migrations are the source of
truth; local Studio is only an inspection convenience.

```powershell
npm run db:start
npm run db:reset
npm run db:lint
npm run db:test
npm run db:types
npm run test:integration:local
npm run db:stop
```

`db:reset` drops and rebuilds only the local database, applies every migration in order, and runs
`supabase/seed.sql`. Running it twice must produce the same schema. `db:types` regenerates
`api/src/database.types.ts`; never hand-edit that file. Normal `npm test` remains fast and does not
require Docker.

### Which integration target to run

There are two, and the runner prints which one it resolved before a single test executes — an
automatic fallback between them is exactly the mistake this split prevents.

| Command | Target | When |
| --- | --- | --- |
| `npm run test:integration` | Hosted project, read from `.env` | The default. Required on every task. |
| `npm run test:integration:local` | Docker stack, credentials from the CLI | Whenever `supabase/migrations/` changes. |

The default is hosted because token verification only behaves realistically there: the hosted
project signs JWTs with **ES256**, while the local stack falls back to the legacy symmetric secret
(`signing_keys_path` is commented out in `supabase/config.toml`), and `supabase-js` takes a
different verification branch for each. A Docker-only auth test would pass while never exercising
the path production uses.

The trade-off is that these tests write to the real project. Each run creates two disposable users
with a greppable `task03-`/`task04-`/`task05-` email prefix and deletes them afterwards; because
`receipts.user_id` is declared `on delete cascade`, deleting the user removes its seeded rows. Storage
objects do not cascade, so Task 05's suite removes its own objects before removing its users. After a
crashed run, list any orphan users:

```powershell
node --env-file-if-exists=.env -e "const {createClient}=require('@supabase/supabase-js'); const a=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY); a.auth.admin.listUsers().then(r=>console.log(r.data.users.filter(u=>u.email?.startsWith('task')).map(u=>u.email)))"
```

Source documents live in the private `receipt-sources` bucket. Object names use
`<user_id>/<receipt_id>/source`; untrusted original filenames remain database metadata and never
become object paths. Normal repository and Storage operations require a signed-in, user-scoped
client. `SUPABASE_SECRET_KEY` is reserved for administrative provisioning and test cleanup because
it bypasses Row Level Security.

The generated Supabase types are an infrastructure description, not the domain model. The current
generator types PostgreSQL `numeric` as `number` and lists stored generated columns in `Insert` and
`Update`. Repository inputs deliberately omit those properties, canonical money is always read from
the validated JSON string, and pgTAP proves PostgreSQL rejects direct generated-column writes.

To prepare a hosted project, link and inspect before applying anything:

```powershell
npx --no-install supabase link --project-ref <project-ref>
npx --no-install supabase migration list --linked
npx --no-install supabase db push --linked --dry-run
```

Only after reviewing the dry run, apply migrations with `supabase db push --linked`, then run
`npm run db:provision-storage` with the hosted `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
`STORAGE_BUCKET=receipt-sources` in `.env`. On an IPv4-only network, use the project's Supavisor
**session-mode** connection string for `DATABASE_URL`; the direct database hostname may be IPv6-only.

## Running

```bash
npm run dev
```

- Client: <http://localhost:5173>
- API: <http://localhost:3001>

Vite proxies `/api` to the API in development, so the browser only ever talks to one origin locally.

The API fails fast and clearly if its port is taken:

```text
"msg":"port already in use — another server is still running; stop it or set PORT"
```

Vite behaves differently — it silently moves to 5174, 5175, and so on. **If Vite reports a port other
than 5173, a previous dev server is still holding it, and you will be testing stale code.** Stopping
`npm run dev` does not reliably kill its children: the `tsx watch` process in particular survives,
keeps watching `api/`, and blocks renaming or deleting that folder. Kill the stragglers first:

```powershell
foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force } }
```

Note that this only catches processes holding a port. A `tsx watch` that lost its port still lingers;
find those with `Get-Process node`.

## Deployment

A PoC instance runs on [Render](https://render.com)'s free tier: `receipt-ocr-api` (a Node web
service running the Express API) and `receipt-ocr-client` (a static site serving the Vite build).
Both are created and configured from the single `render.yaml` Blueprint committed at the
repository root, so recreating the deployment from scratch is one "New Blueprint" action.

### Why a GitHub mirror exists

This repository's `origin` remote is Azure DevOps, but Render's automatic build-on-push only
connects to GitHub or GitLab. A second remote, `github`, points at a **separate, PoC-only** GitHub
repository containing just this folder's history, extracted with `git subtree split` so the
monorepo's other prototypes and branches never leave Azure DevOps. Pushing to `origin` — the
normal day-to-day workflow — does **not** update the deployed app; only a push to the `github`
mirror does.

To redeploy after committing on this branch, from the parent monorepo's repository root:

```powershell
git subtree split --prefix=prototypes/receipt-ocr -b receipt-ocr-standalone
git push github receipt-ocr-standalone:main
git branch -D receipt-ocr-standalone
```

Render auto-deploys both services on a push to that mirror's `main` branch.

### Cross-origin wiring

The client and API are deployed as separate origins, which has two consequences the local dev
setup does not need:

- `VITE_API_BASE_URL` (client, baked in at **build** time) must be the API service's real URL, or
  every request silently lands on the client's own static site instead of the API — see
  `client/src/api/client.ts`. Because the client's SPA rewrite (`/* → /index.html`) matches any
  path, a wrong or missing value fails with a `200` and an HTML body rather than an obvious error.
- `WEB_ORIGIN` (API) must be the client service's real URL, or the browser's CORS check rejects
  every request.

Both are plain, non-secret values set directly in `render.yaml`; every other required variable
(Supabase, Azure) is entered as a real secret through Render's dashboard, never committed.

### Known limitations

- Render's free web service sleeps after roughly 15 minutes of inactivity; the next request pays a
  30–50 second cold start. Worth a warm-up request before a timed demo.
- Nothing beyond the Blueprint is currently automated: no CI, no preview environments, no
  automatic rollback.

## Scripts

All scripts run from the repository root.

| Script                 | What it does                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run dev`          | Starts the client and the API concurrently                         |
| `npm run dev:client`   | Starts only the client (Vite)                                      |
| `npm run dev:api`      | Starts only the API (`tsx watch`)                                  |
| `npm run build`        | Compiles all workspaces, then bundles the client                   |
| `npm run typecheck`    | `tsc --build` across the project references — the type gate         |
| `npm run lint`         | oxlint                                                             |
| `npm run format`       | Prettier, writing changes                                          |
| `npm run format:check` | Prettier, check only                                               |
| `npm test`             | Vitest across `shared` (node), `api` (node) and `client` (jsdom)    |
| `npm run test:integration` | Repository, RLS, auth and private Storage tests against the hosted project |
| `npm run test:integration:local` | The same suite against the Docker stack, for schema work |
| `npm run score:extraction` | Replays recorded Azure fixtures offline against the production mapper and reports extraction accuracy |
| `npm run db:start`     | Starts the Docker-backed local Supabase stack                      |
| `npm run db:stop`      | Stops the local Supabase stack without deleting its volumes        |
| `npm run db:reset`     | Rebuilds the local database from migrations and seed               |
| `npm run db:lint`      | Runs Supabase database linting against `public`                    |
| `npm run db:test`      | Runs the pgTAP database contract and RLS tests                     |
| `npm run db:types`     | Regenerates the committed local database types                     |
| `npm run db:provision-storage` | Creates or repairs the configured private bucket          |
| `npm run validate`     | typecheck → lint → format:check → test                             |

`npm run validate` is the gate to run before committing. To test one workspace only:
`npx vitest run --project shared`, `--project api` or `--project client`. Run those occasionally even
though `npm test` covers them: `npm test` runs every project regardless of its configured `name`, so
only a per-project run catches a stale project name.

## API

| Method | Path                | Auth | Response                                      |
| ------ | ------------------- | ---- | --------------------------------------------- |
| `GET`  | `/api/health`       | —    | `200 {"status":"ok","uptimeSeconds":number}`   |
| `GET`  | `/api/receipts/:id` | Yes  | `200` canonical receipt plus review metadata and nullable `failureReason`, `404` if not yours |
| `GET` | `/api/receipts` | Yes | `200 {"items","page","limit","total"}`; accepts `page`, `limit` and optional `status` |
| `PATCH` | `/api/receipts/:id` | Yes | `200` updated review receipt, `409 edit_not_allowed` outside `review`/`confirmed` |
| `POST` | `/api/receipts/:id/confirm` | Yes | `200 {"id", "status", "confirmedAt"}`, `409 confirm_not_allowed` outside `review` |
| `POST` | `/api/receipts` | Yes | `201 {"id", "status", "createdAt"}` after one multipart `file` part |
| `POST` | `/api/receipts/:id/retry` | Yes | `202 {"id", "status"}` for retryable `failed` or stranded `processing` receipts; otherwise `409 retry_not_allowed` |
| `GET` | `/api/receipts/:id/source` | Yes | `200 {"url", "contentType", "originalFilename", "expiresAt"}`, `404` if not yours or deleted |
| `GET` | `/api/receipts/:id/regions` | Yes | `200 {"pages","regions"}` source-location projection, `404` if not yours or deleted |
| `DELETE` | `/api/receipts/:id` | Yes | `204`, then the receipt and source endpoint return `404` |
| `GET` | `/api/receipts/export` | Yes | `200` CSV or JSON for confirmed, non-deleted receipts; requires `format=csv\|json` |
| `GET` | `/api/receipts/:id/export` | Yes | `200` CSV or JSON for one confirmed receipt, `409 export_not_allowed` outside `confirmed` |

The health path and response type are defined once in `shared/src/health.ts` (`HEALTH_PATH`,
`HealthResponse`) and imported by both sides, so a change to either breaks the build rather than
production. `GET /api/receipts/:id` returns the canonical receipt plus the provider-neutral
`lowConfidenceFields` projection used by review; provider metadata stays private.

`GET /api/receipts` is owner-scoped and excludes soft-deleted rows. Its strict query accepts
`page` (default `1`), `limit` (default `20`, maximum `100`) and an optional receipt `status`; `total`
is the unpaged count of the filtered result.

`GET /api/receipts/export` is owner-scoped, excludes soft-deleted rows and exports only confirmed
receipts. The route must stay registered before `GET /api/receipts/:id`; Express matches routes in
registration order, so a later `/export` route would be parsed as `:id = "export"`.

Protected requests carry the Supabase access token:

```text
Authorization: Bearer <access token>
```

Anything else under `/api/receipts` — a missing header, a non-`Bearer` scheme, an empty, expired or
forged token — is `401 {"error":{"code":"unauthorized"}}`.

**Error convention — every task follows this.** Failures return a stable machine `code`, never prose:

```json
{ "error": { "code": "not_found" } }
```

The client translates codes into `hr`/`en` copy, which is how PRD §7.13 stays true for error states
too. Server faults (5xx) are logged with the error object; client errors (4xx) are logged at `warn`
without a stack trace, so a URL scanner cannot flood the error log.

That body is not a convention held up by prose: `api/src/middleware/error-handler.ts` types it as
`ApiErrorResponse` from `@receipt/shared`, so a route that invents a different error shape fails to
compile.

### Receipt uploads

`POST /api/receipts` accepts exactly one `multipart/form-data` part named `file` and no text fields.
The source's bytes, not its filename or declared content type, are sniffed before persistence. JPEG,
PNG, HEIC, HEIF and PDF are accepted; multi-image HEIC/HEIF sequences and unclassified bytes are
rejected. This is why a Windows executable called `receipt.jpg` still receives
`415 unsupported_media_type`.

The default limits are **10 MB** and **10 PDF pages**. A missing/malformed file is
`400 file_required`; a file that exceeds the byte limit is `413 file_too_large`; unreadable,
encrypted or overlong PDFs receive `422 pdf_unreadable`, `pdf_encrypted` or `pdf_too_many_pages`.
Each code has Croatian and English UI copy.

The API generates a receipt UUID, starts extraction and uploads to `<user_id>/<receipt_id>/source`
concurrently, then inserts the `processing` row. If insertion fails it attempts to delete the
just-uploaded object, so a user never sees a receipt row without a source document. The one accepted
trade-off is a wasted extraction call when that insertion fails. The client sends only the `file`
part: `fields: 0` rejects any incidental `userId` or other text field at the multipart parser.

`GET /api/receipts/:id/source` produces a signed URL valid for 300 seconds. It is a bearer capability:
soft deletion immediately prevents new URLs, but cannot revoke a URL already issued; it remains valid
until its expiry. The original object is deliberately retained for auditability.

### Mobile capture and processing

The protected home page is the receipt capture flow, and it offers a different number of actions per
device. `client/src/capture/useCameraCapture.ts` reads `(pointer: coarse)`, the media feature that
describes a touch-first primary pointer:

- **Touch-first pointer (phones, tablets).** **Scan receipt** is the primary action and asks
  supporting phones to prefer the rear camera through the native `capture="environment"` hint; it is
  a preference, not a camera guarantee. **Choose file** stays visible beside it at all times for an
  existing JPEG, PNG, HEIC, HEIF or PDF, including after a camera cancellation or denial.
- **Fine pointer (desktop).** Only **Choose file** is rendered, promoted to the primary style.
  Desktop browsers parse `capture` and then ignore it, so a second button there opened the identical
  file dialog and offered a choice that did not exist.

`(pointer: coarse)` rather than `navigator.maxTouchPoints` is deliberate: it describes the *primary*
pointer, so a touchscreen laptop driven by a trackpad correctly reports `fine` and keeps the single
desktop button, while a phone reports `coarse`. When `matchMedia` is unavailable the hook keeps both
actions, because offering a spare button is harmless where withholding capture on a real phone is
not. The query is re-read on change, so a detachable tablet switches layout without a reload.

Driving a webcam with `getUserMedia` was considered and rejected for the PoC: it needs a live video
surface, a canvas grab, permission and device-selection states, and a laptop webcam is a poor
receipt scanner — typically fixed-focus and at an oblique angle to a document lying on a desk, which
is the input PRD §7.4 asks the product to avoid rather than manufacture.

The selected image or PDF is previewed before upload. The browser checks the advertised type or, only
when it is absent, the filename extension, and it rejects files over 10 MB early. These checks are
advisory UX only: the server still validates the source bytes. Images with a short edge below **800 px**
or a 256-pixel sample blur score below **80** show a warning but can still be uploaded. Images above
**2 MP** or **1.5 MB** are re-encoded as JPEG with a 1,600 px long edge before upload; the preview is
made from that exact uploaded file. This deliberately amends the source-preservation rule: private
Storage retains the OCR-appropriate derivative, not byte-exact camera source. PDFs, small images and
any image that the browser cannot decode (including unsupported HEIC/HEIF) remain unchanged.

HEIC/HEIF previews depend on native browser support. If the selected image cannot be decoded, the app
asks the user to choose a JPEG, PNG or PDF instead; it does not convert the original file in the
browser.

While the source uploads, the busy state stays **on the button that was pressed**: it shows a spinner
and reads `Loading…`, the approved preview stays on screen behind it, and both the upload and retake
buttons take `aria-disabled` with a handler guard so a mid-flight retake cannot discard the file
being sent. `aria-disabled` rather than the native attribute keeps the buttons in the tab order and
stops focus being silently moved out from under the user. Replacing the whole panel with a separate
loading screen was tried first and removed: it threw away the preview and duplicated the message the
processing route shows a moment later.

After a successful upload, the client polls the receipt every **2 seconds** for up to **100 seconds**.
It moves a `review` receipt to the review-ready destination. A failed receipt carries a stable,
translated reason: unreadable input offers a new-upload path only, while a temporary provider failure
keeps Retry. Network errors and timeouts expose Check again plus Upload another.

### Review and confirmation

A receipt in review opens a mobile-friendly editable form with the source document one tap away on a
narrow screen and alongside it on larger screens. Saving is explicit rather than debounced:
locale-formatted dates and amounts are normalized only when the user chooses Save, avoiding errors
while a value is half typed. React Hook Form performs that interaction validation directly; the
canonical Zod schema remains the server-boundary contract and is intentionally not used as a form
resolver.

Every field that needs attention is marked the same way, by one `ReviewField` component: an amber
border and background, a warning icon, a visible explanation, and `aria-describedby` linking the two.
Two different signals raise it — a low-confidence reading, or a warning such as an empty critical
field — but they share one appearance, because painting amber for only the first left warned fields
wearing an amber explanation beneath an ordinary slate input, which reads as two unrelated
conventions. A field with a specific warning shows that warning; a field that is merely low-confidence
shows the generic "may need extra checking" hint, never both. `aria-invalid` is deliberately never
used here: an uncertain-but-plausible OCR value is not a validation failure, and claiming otherwise
would collide with the form's real errors.

**The items section is the one exception to the label-above-every-input rule, and deliberately so.**
Repeating a full label above each of description, quantity, unit price and total is right for the
fifteen one-off header fields and wrong for a receipt with twenty items — four stacked label/input
pairs each turned that section into most of the page. The field name is therefore stated once and
each item occupies a single row. `client/src/review/ItemRows.tsx` picks the layout through the same
`useWideLayout` hook the receipts list uses, so there is one definition of "desktop" and the two
layouts never both reach the accessibility tree:

- **Desktop (`lg`+): a real `<table>`** with the four column headers, one row per item and an icon
  remove button. The inputs have no visible label, so each carries an `aria-label` naming both the
  field and the item number — a `<th scope="col">` labels a cell, not the control inside it.
- **Phone: a condensed card** — description on its own line with the remove button beside it, then
  quantity, unit price and total in one three-column row, each under a small caption.

A dense row has no room for an explanation beneath each cell, so a flagged value keeps its amber
cell and `aria-describedby`, while the words collapse to **one note per item** listing the affected
field names. Warnings still win over the generic low-confidence hint on the same field, exactly as in
`ReviewField`. Every input keeps its `review-field-…` id, so clicking a source outline still focuses
the individual item cell and focusing a cell still raises its outline.

The detail response exposes lowConfidenceFields, a provider-neutral list of canonical field names.
Inputs keep canonical strings after a save but accept Croatian and English locale formatting on entry.
PATCH is allowed only in review and confirmed; it never changes status. Confirm moves only review to
confirmed and is idempotent afterwards. Warnings are always informational, so confirmation remains
available with warnings outstanding.

The original-source URL expires after 300 seconds. The source panel reloads it once after a failed
image request and also offers a manual reload; it never displays or logs the signed URL.

For image receipts, the review source panel draws provider-neutral, normalized quadrilateral
outlines over fields that were read from the document. Colours match the form section; focusing a
field raises its outline and clicking an outline focuses the field. The API returns page-relative
fractions, so the browser does not receive provider coordinates or need to measure the image. The
overlay is suppressed when the browser's rendered image ratio disagrees with the extracted page ratio
(for example, after an EXIF orientation mismatch). PDF receipts retain their existing viewer with a
translated notice because a browser PDF object cannot accept an overlay.

### History and soft delete

The signed-in header exposes **Receipts**, which renders as one of two layouts — never both, so only
one copy of each row reaches the accessibility tree. `client/src/history/useWideLayout.ts` reads
`(min-width: 1024px)`, the same `lg` line where the shell swaps its bottom tab bar for the sidebar,
so the app has one definition of "desktop" rather than two.

- **Phone: a card list.** Seller, document number and status on top, issue date and total beneath.
- **Desktop (`lg`+): a table** — issue date, seller, document number, total, status, actions. It is
  `table-fixed` with explicit column widths, which is what makes an over-long seller name or OCR
  document number truncate rather than widen the table and give the page a horizontal scrollbar. Its
  container sets **no `overflow`**: an `overflow-x: auto` ancestor also clips vertically and would
  cut off an open row menu.

Only the seller cell is a link. A fully clickable row would swallow the action menu's clicks and
leaves a keyboard user nothing to target.

Both layouts share `ActionMenu`, one overflow menu with two CSS-driven presentations: a dropdown
under the trigger at `lg`, and a modal bottom sheet with a scrim on a phone, where `position: fixed`
means the sheet can never be clipped by the card it belongs to. IBM Carbon puts row actions behind an
overflow menu at three or more actions, and Material 3 names the bottom sheet as the mobile
substitute for an inline menu. Like `AccountMenu` it is a disclosure rather than an ARIA menu, for
the same reason: `role="menu"` would oblige a roving-tabindex arrow-key implementation.

Bulk export lives in a toolbar above the list — status filter left, **Export** menu right — instead
of the card it used to occupy above the receipts, which gave a secondary action more visual weight
than the list it operates on.

Deleting is confirmed in a **native `<dialog>` opened with `showModal()`**. The element is used
rather than a hand-built overlay because it promotes itself into the browser's top layer and makes
the rest of the page inert — precisely where this project's earlier hand-rolled drawer went wrong,
marking the app root `inert` from inside that same root and opening unfocusable. Focus starts on the
least destructive action and returns to the invoking control on close, per WAI-ARIA. jsdom implements
none of this, so `client/src/test/setup.ts` stubs `showModal`/`close` to toggle the `open` attribute
and the real modality is verified in a browser.

Buttons that run an action carry a permanent leading icon — a download glyph, a trash glyph — that is
**replaced in place** by the spinner while the action runs. The label never changes, so a
voice-control user who said "click Download CSV" keeps their target and nothing reflows; the icon and
the spinner occupy the same 16 px box, so the button width is identical busy and idle. An earlier
attempt reserved an empty box for the spinner instead, which left a visible hole in every idle
button. Busy buttons take `aria-disabled` with a handler guard rather than the native attribute, and
a visually-hidden `role="status"` carries the announcement.

History sorts by `created_at desc`, not `issue_date`: creation time is non-null and backed by the
active-receipt partial index, while OCR issue dates can be absent. The API defaults each page to 20
rows and echoes its applied limit. Deletion is a translatable two-step action that sets `deleted_at`;
the row and source object remain retained, but it disappears from history and no new source URL can be
issued.

Totals remain decimal strings. A malformed three-character currency code cannot take down history:
the UI falls back to a locale-formatted amount followed by the raw code, and preserves trailing zeros
when no currency is available.

### Export

The history page offers CSV and JSON downloads at two scopes:

- **Everything confirmed**, from the toolbar's Export menu. The current history status filter does
  not change that scope.
- **One receipt**, from its row's overflow menu or from its own review screen once confirmed.

A single receipt exports through `GET /api/receipts/:id/export` in the same two formats, reusing the
same serializers, so a one-row CSV carries the identical columns and a one-receipt JSON body carries
the identical `schemaVersion` envelope. **Only a confirmed receipt can be exported**, at either
scope: an unconfirmed extraction is a draft, and PRD §7.12 keeps drafts inside the application.
Asking for any other status returns `409 export_not_allowed`, so this is enforced by the API and not
merely hidden in the UI. Downloads are named from the receipt's own document number and issue date,
with the untrusted OCR text reduced to a conservative safe set of filename characters.

CSV v1 has one row per receipt and these columns, in order:

```text
id
status
sellerName
sellerAddress
sellerOib
buyerName
buyerAddress
buyerOib
documentNumber
issueDate
issueTime
subtotal
total
currency
vatBreakdown
paymentMethod
jir
zki
confirmedAt
createdAt
updatedAt
```

Line items are intentionally excluded from CSV v1. `vatBreakdown` is serialized as compact JSON in a
single CSV column so any number of VAT rates can round-trip without an arbitrary column cap. Empty
canonical values export as empty CSV fields, never as `null` or guessed defaults.

The CSV response is UTF-8 with a BOM and uses CRLF row breaks, so Windows spreadsheet tools preserve
Croatian characters such as `š`, `č`, `ć`, `ž` and `đ`. RFC 4180 escaping is used: fields containing
quotes, commas or line breaks are quoted, and embedded quotes are doubled.

Spreadsheet formula neutralization applies to untrusted text columns only. A text value beginning
with `=`, `+`, `-`, `@`, tab, carriage return, line feed or the full-width formula variants is prefixed
with a single quote before CSV escaping. Money, date and timestamp columns are not neutralized because
their schemas already restrict them; this keeps a valid negative total such as `-12.50` usable as a
number in spreadsheets.

JSON export returns this envelope:

```json
{
  "schemaVersion": 1,
  "receipts": []
}
```

Each JSON receipt uses canonical field names only, omits the caller's own `userId`, omits `deletedAt`
because deleted rows are outside the export scope, preserves nested `vatBreakdown`, and includes
optional `items` when they exist. Money remains the exact confirmed decimal string, so `100.50`
exports as `"100.50"`.

### Extraction

The API starts Azure Document Intelligence before the private Storage write completes, then continues
the extraction asynchronously after returning `201`. It uses API version `2024-11-30` and the
`prebuilt-invoice` model. Recorded runs over seven supplied
examples (six photos and one PDF) found seller, document number and total in all seven; the issue date
in six, with labelled Croatian text as the fallback; and symbol-backed currency in four. The receipt
model was retained only in the comparison harness because it does not expose a document-number field.

Every request enables Azure's free `barcodes` feature. It adds QR data without changing the mapped
field values; Azure's inline `:barcode:`/layout markers are stripped before Croatian text fallbacks run
so a marker can never become a canonical value.

The retained raw response also supports a read-only source-region projection for review. The mapper
shares the extraction alias table, reads Croatian VAT recaps from the provider's table geometry when
the structured VAT field is absent, recomputes Croatian fallback spans against the original content,
and normalizes source geometry at read time. This makes highlighting work for previously analysed
receipts without reprocessing, a migration or a provider call.

Azure field names stay inside the provider adapter. The result is mapped to the application's canonical
receipt fields, stored once as both `original_extraction` and `canonical_data`, and the raw provider
response is retained separately for debugging. Failed, retryable calls can re-run from the private
source object; malformed content, bad credentials and missing provider resources are non-retryable,
while throttling, service faults, timeouts and network failures are retryable.

Six deterministic rules were added in iteration 21, each earned from a real receipt in the corpus:

- **The issue time is read beside the issue date, not from a label.** A clock time is matched only
  with colon separators, because admitting `.` let `17.08.2026.` be stored as the time `17:08:20`.
  A date-adjacent time (`21.02.2020,14:26:38`, `16.07.2023. u 14:19:14`) outranks a `Vrijeme:` label,
  which on a taxi receipt holds the ride duration rather than the issue time.
- **JIR and ZKI are collected past thermal-print noise.** The value may begin on the line below its
  label and may itself wrap once; both are tolerated, then the result is validated strictly, so
  tolerant scanning never widens what counts as an identifier.
- **A VAT header cell may name two columns.** OCR merges `Stopa%` and `Osnovica` into one cell, so a
  cell naming several roles hands the later ones to the columns that follow it. A role's value is
  then accepted anywhere between its own header and the next — the span the label visually covers —
  because a header and its column of numbers routinely drift apart by one column.
- **Header terms match within one character**, so an OCR `osnavica` still names the taxable base, and
  a recap's own total row is detected wherever in the row its label lands.
- **A VAT rate discards a leading tax-group code** (`D1 25,00 %`, misread `01 25.00 %`, previously
  became the rate `0125.00`) and a value outside 0-100 is reported unreadable rather than stored.
- **A tax id is accepted only once it normalizes to a checksum-valid OIB.** `VendorTaxId` returns the
  VAT number printed above the OIB on some receipts; stripping the `HR` prefix and verifying the
  ISO 7064 MOD 11,10 check digit is what lets the labelled `OIB:` text win when it should.

Two mapper corrections came with them: a receipt issued on or after **2023-01-01** showing both
currencies takes the euro amount it asks for rather than the kuna equivalent the provider sometimes
returns as the invoice total — which otherwise corrupts the total and the currency together, since
both derive from that one field — and a totals block returned as `Items` no longer becomes purchased
lines called "Osnovica bez PDV".

Confidence is recorded per canonical field but never suppresses a readable value. The review flow can
therefore highlight a low-confidence value later without forcing a person to retype it. Amounts and
quantities are parsed from the provider's text `content`, never from `valueCurrency.amount` or
`valueNumber`: those are JavaScript numbers and would lose the required decimal precision.

`npm run score:extraction` replays recorded fixtures through the real mapper and warning pipeline,
without an Azure call. **A fixture is only scored when both its recorded Azure response and its
ground-truth file exist**, and the harness silently skips an expectation whose fixture is missing —
which is how eight receipts — including every one with a known defect — sat outside the corpus while
it reported healthy numbers. Iteration 21 recorded them all, so **all 15 expectations are now scored**
and the figures below cover every sample receipt rather than the ones that happened to pass.

Document number, issue date, total and currency match exactly on all 15. Seller name is 14 of 15 and
no critical-field correction is needed on 14 of 15; the single miss is one badly degraded photo whose
seller line OCR reads as `fte bars\nANTIQUE"`. Of the supplementary fields, issue time is 7 of 7,
seller OIB 1 of 1, and VAT breakdown 9 of 12.

The remaining gaps are documented rather than smoothed over. JIR and ZKI sit at 1 of 2 because on one
receipt OCR substitutes characters (`8`→`B`, `0`→`8`) inside an identifier carrying no checksum, so the
value is surfaced for correction but cannot be verified or repaired — an OCR ceiling, not a mapping
gap. Of the three VAT misses, one receipt states its recap as inline `label: value` pairs that neither
the table mapper nor the line-oriented text fallback reads; one is the degraded photo, which loses a
second rate; and one is a 0%-VAT receipt whose printed `Stopa 0% / Osnovica 100.00 / PDV 0.00` recap is
now extracted faithfully while its ground truth still records "no VAT" — an open question about what a
zero-rate recap should map to, not a defect. The same corpus's recorded provider durations are p50 3 s
and p95 5 s. A live warm
1,600 px upload measured 8.3 s inside the provider (1.2 s initial request, 7.1 s polling), so the PoC
uses approximately **8 seconds warm** as its current UX baseline rather than the old 2-5 s aspiration.
Render's separate 30-50 s free-tier cold start still applies before that work begins.

### QR decoding

Azure supplies QR payloads server-side for JPEG, PNG, HEIF and PDF sources; no QR-decoding dependency
or client image conversion is needed. The Croatian parser accepts fiscal URLs containing JIR or ZKI,
and the observed bare-JIR UUID variant. It stores the decoded record in the private `qr_extraction`
column and never uses it to fill, replace or overwrite canonical values.

`izn` is comparable only when it contains `,` or `.`. A real receipt has `izn=199` while its total is
`1,99 EUR`; interpreting it as `199.00` would manufacture a false mismatch. The raw payload remains
preserved as evidence, but the QR URL is never fetched, resolved or rendered as HTML.

## Authentication

Supabase owns email/password registration, login and session persistence, so this repository
contains no password hashing, no session table and no signed-cookie handling.

**The API never trusts a client-supplied identity** (PRD §9.1). `api/src/auth/authenticator.ts`
verifies the access token with `supabase.auth.getClaims(token)` and takes `userId` from the token's
`sub` claim. Because the hosted project signs with **ES256**, that verification happens in-process
against a cached JWKS — no network round trip per request, which is why `getClaims` is used rather
than `getUser` (a call to the auth server every time) or `getSession` (which does not verify at
all). A token is accepted only when its `role` is `authenticated` and its `sub` is a UUID.

Three structural choices keep this honest rather than merely intended:

- **`AuthContext` is a handler argument, not `req.auth`.** `authenticated()` in
  `api/src/middleware/require-auth.ts` passes the proven identity into the route as a parameter.
  An optional property on `Request` would invite `req.auth!` in some future route and quietly lose
  the guarantee.
- **`requireAuth` guards the `/api/receipts` prefix, not each route.** Every route a later task adds
  is protected by default, and a path with no route defined yet answers `401` rather than `404`.
- **The secret key is never read on a request path.** Each authenticated request gets its own
  Supabase client carrying the caller's own token, so PostgREST and Storage evaluate every query
  under that user's RLS context. `SUPABASE_SECRET_KEY` stays reserved for provisioning and test
  cleanup.

**A receipt belonging to someone else returns `404`, never `403`.** Telling a caller that an id
exists but is not theirs leaks exactly what ownership is meant to hide. This falls out of
`findById` already filtering on `user_id` and `deleted_at` — there is no separate ownership check to
keep in sync, and a soft-deleted receipt correctly returns `404` to its own owner too.

On the client, `AuthProvider` holds the session and `ProtectedRoute` gates the routes. A `401` from
any API call triggers a sign-out, which lets `ProtectedRoute` perform the redirect, so no navigation
logic is duplicated in the fetch layer.

### Known limitations

- **Email confirmation is disabled** on the hosted project (`enable_confirmations = false` in
  `supabase/config.toml`, pushed with `supabase config push`). It has to be: Supabase's built-in SMTP
  for new projects is heavily rate-limited, so a confirmation email would never arrive and no test
  account could ever sign in. Email addresses are therefore unverified — acceptable for a PoC with no
  email flow at all, and worth recording if this PoC continues toward production.
- **Password reset is deferred.** PRD §7.1 qualifies it with "if readily available from the
  provider", and it is not: it needs custom SMTP, an email template, a redirect allow-list entry,
  `detectSessionInUrl: true` and a set-new-password screen.
- No roles, companies, tenants, MFA or SSO — all explicitly out of scope (PRD §4.6, §9.5).

## Workspace layout

Three npm workspaces, flat at the repository root:

```text
client/    React 19 + Vite mobile-first web app   (@receipt/client)
api/       Express 5 API — routes, middleware, config, logging   (@receipt/api)
shared/    Canonical receipt model, money, dates, warnings, API DTOs   (@receipt/shared)
```

`shared/` is the reason this is a workspace repo rather than two unrelated folders: the canonical
receipt model and its Zod schemas are defined once and used by both the API (request validation,
mapping, persistence) and the client (review-form validation). Duplicating that model is how a mapper
and a form silently drift apart.

Cross-workspace imports always use the package name (`@receipt/shared`), never a relative path into
another workspace. That is what keeps the folders renameable without touching a single import.

## Application shell

`client/src/components/AppLayout.tsx` wraps every route and is responsive in two parts.

- **Header** — one sticky row, 56 px on mobile and 64 px from `lg` (1024 px). It carries the accent
  mark and the app name at top left, and the language switcher plus the account control at the right,
  at every breakpoint. The language switcher stays in the header rather than folding into a menu, so a
  user who lands in the wrong language always has a visible escape hatch.
- **Navigation** — the destinations live in `client/src/components/NavItems.tsx` and are defined once,
  which is what stops the two navigations drifting apart. On mobile
  `client/src/components/BottomNav.tsx` renders them as a **fixed bottom tab bar**; from `lg` a
  persistent 240 px sidebar takes over and the tab bar is hidden. Only one is ever displayed, so only
  one `navigation` landmark is exposed to assistive technology at a time. Both use React Router's
  `NavLink`, which supplies the active styling and emits `aria-current="page"` on its own; the index
  route carries `end` so it does not match every path.
- **Account** — `client/src/components/AccountMenu.tsx` is a disclosure, not an ARIA menu: it holds a
  static identity block and one action, so `role="menu"` would oblige a roving-tabindex arrow-key
  implementation and make screen readers announce the email as a menu item. Initials come from
  `client/src/auth/userIdentity.ts`, derived from the email local part because sign-up collects no
  name.

A bottom tab bar replaced an earlier hamburger drawer. Nielsen Norman Group's testing found hidden
navigation roughly halves discoverability and lowers task completion by about 21%, and their guidance
is to keep navigation visible at four or fewer destinations — this app has two. Tap accuracy is also
far higher in the bottom thumb zone than at the top of the screen, where the drawer's trigger sat.

Colour lives in `client/src/index.css`: a `@theme` block defines `--color-accent` (`#1d4ed8`, about
7:1 on white) plus hover, soft and ring variants, which Tailwind turns into `bg-accent`,
`text-accent`, `bg-accent-soft` and `outline-accent-ring`. Neutrals stay as `slate-*` utilities at the
call site. One global `:focus-visible` rule gives the whole app a single focus policy; it uses
`outline` rather than a ring because an outline follows `border-radius`, takes no part in layout and
is not clipped by `overflow: hidden`. The app is deliberately light-only — there is no dark mode.

`client/src/components/Spinner.tsx` renders either a labelled standalone indicator or, with
`label={false}`, the bare glyph for use inside a button whose text already says what is happening.
Two details in it are load-bearing. The glyph is `inline-block`, because `width`/`height` do not
apply to an inline box: without it the glyph sized correctly only where its parent happened to be a
flex container and collapsed to a 4 px sliver everywhere else — measured, not theorised. Its border
is drawn in `currentColor`, so the same component is visible on the white-on-accent primary buttons
and on the slate-on-white outlined ones with no variant prop. `className` overrides the size so the
glyph can match whichever icon it replaces.

`client/src/components/Skeleton.tsx` provides the loading placeholders used by the history list and
the review form. Each block is `aria-hidden`, with the announcement on a single `role="status"`
container, so a screen reader hears one "Loading" rather than a stream of boxes. The processing screen
deliberately keeps its spinner: polling for OCR is an indeterminate multi-second wait, and a skeleton
there would imply content is imminent.

## Domain model

`shared/` owns one definition of a receipt, provider-independent by design: no Azure vocabulary may
appear anywhere in it, and `shared/src/receipt.test.ts` fails the build if it does (PRD §6.2).

Zod schemas are the source of truth and the TypeScript types are inferred from them, so a schema and
its type cannot drift.

### Money is a string, never a number

Canonical money is a plain decimal string — `"100.50"` — matching `^-?\d+(\.\d+)?$`: no grouping
separators, no currency, no exponent, and **trailing zeros preserved**. `100.50` that comes back as
`100.5` is a bug; a total must export as exactly what was confirmed.

`shared/src/money.ts` sets `Big.strict = true`, which makes `Big` throw if a JS `number` is ever
passed in. That turns "money is never a JS float" from a convention into a runtime guarantee.

- `parseAmount` reads what a receipt actually shows — Croatian `1.234,56`, English `1,234.56`,
  currency symbols and codes, non-breaking spaces, and negatives written `-12,50`, `12,50-` or
  `(12,50)`. It returns `null` for anything it cannot read and **never throws**: an unreadable value
  is a missing value, and missing stays missing rather than being guessed (PRD §7.7).
- `addAmounts` works at the wider of its two arguments' scales, so `100.50 + 0.00` is `100.50`.
- `formatAmount` delegates to `Intl.NumberFormat`, passing the **string**. That preserves arbitrary
  precision; passing a number would corrupt large values.

**Known limitation — the `1.234` ambiguity.** A single separator with exactly three digits after it
is genuinely ambiguous: `"1.234"` and `"1,234"` could each be 1234 or 1.234. Both resolve to
**1234**, because a thousands group is far more common on a receipt than a three-decimal price. This
is a deliberate, lossy judgement call and it will occasionally be wrong — a weight in kilograms is
the realistic case. Watch for it during real-receipt testing.

### Dates and times

A receipt date is a local wall-clock date with no timezone, so it is carried as a string:
`yyyy-mm-dd` for the date, `HH:mm` or `HH:mm:ss` for the time. `shared/src/datetime.ts` normalizes
Croatian forms (`17.08.2026.`, day-first) and validates the calendar by hand, including leap years.

Two rules that matter:

- **Seconds are never padded on.** A receipt showing `14:30` normalizes to `14:30`, not `14:30:00`;
  inventing the second would be inventing data.
- **`Date.parse` and `new Date(string)` are not used, anywhere in that module.** `Date.parse` returns
  `NaN` for `"17.08.2026."`, and reads `"08/17/2026"` as the day *before* in any timezone behind UTC
  — a plausible-looking answer that is silently wrong.

### The two-tier schema split

The receipt schema comes in two tiers, and the split is load-bearing:

- `canonicalReceiptFieldsSchema` — everything the user may edit in the review form.
- `canonicalReceiptSchema` — that, extended with the server-owned envelope: `id`, `userId`, `status`,
  `warnings`, timestamps.

Every DTO in `shared/src/api.ts` is *derived* rather than redeclared. The PATCH body is
`canonicalReceiptFieldsSchema.partial()`, and because Zod's `.strict()` survives `.partial()`,
`.extend()`, `.pick()` and `.omit()`, that body is structurally incapable of accepting a `userId`.
"Never trust a client-supplied `userId`" (PRD §9.1) is therefore a property of the type system rather
than a rule a route has to remember. **Do not flatten the two tiers into one schema.**

### Warnings

`shared/src/warnings.ts` holds the warning **taxonomy** — a stable machine code plus the dotted field
path it concerns. `api/src/validation/warnings.ts` computes the rules after extraction and can be
reused by Task 09 when an editable field changes; warnings are codes, not server-rendered prose.

The API currently produces seven informational checks: `missing_critical_field` (`sellerName`,
`documentNumber`, `issueDate`, `total`, `currency`); `unparseable_date`/`unparseable_amount` when
source text existed but could not normalize; `vat_arithmetic_mismatch` on a complete `vatBreakdown`;
`vat_present_but_unread` when a non-exempt receipt shows a VAT recap that could not map to a VAT row;
`qr_total_mismatch` on `total`; and `qr_datetime_mismatch` on `issueDate`. Incomplete VAT or QR data
emits nothing rather than guessing.

**Only those five fields warn when they are empty, and that asymmetry is deliberate.** PRD §6.5 and
Appendix A name seller name, document number, issue date, total and currency as the critical review
fields; everything else — buyer details, seller and buyer OIB, issue time, subtotal, payment method,
JIR, ZKI and line items — is secondary or optional and is legitimately absent from many real
receipts. Warning on those would train the user to ignore warnings, and PRD §7.7's "missing stays
missing" means a blank secondary field is a correct outcome, not a defect. So a receipt whose
currency Azure could not determine shows one warning on `currency` while its empty buyer fields stay
silent. That is the design working, not a bug. `document_quality` intentionally remains unproduced because Azure
confidence data is not a reliable quality signal; see
`.agents/history/08-qr-decoding-validation-warnings-engine.md` for the evidence.

Warning **messages** live in the client locale files, not in `shared`, matching the error convention
above: the server emits a code, the client owns the human copy. Every code needs an `hr` and an `en`
message, enforced by `client/src/i18n/warnings.test.ts` — `/validate` Phase 6.5 cannot catch this
one, because the review form will render these with a template literal rather than a literal key.

Warnings are informational and must never block confirmation (PRD §7.8).

### What `@receipt/shared` exports

Everything below is re-exported from the package root, so `import { … } from "@receipt/shared"` is
always the right form — never a deep path into `shared/src`. Each schema also exports its inferred
type under the obvious name (`canonicalReceiptSchema` → `CanonicalReceipt`).

| Module | Exports |
| --- | --- |
| `shared/src/money.ts` | `AMOUNT_PATTERN`, `isAmount`, `parseAmount`, `addAmounts`, `compareAmounts`, `amountsEqual`, `formatAmount` |
| `shared/src/datetime.ts` | `ISO_DATE_PATTERN`, `ISO_TIME_PATTERN`, `parseIssueDate`, `parseIssueTime` |
| `shared/src/warnings.ts` | `WARNING_CODES`, `warningCodeSchema`, `receiptWarningSchema` |
| `shared/src/upload.ts` | `SOURCE_CONTENT_TYPES`, `sourceContentTypeSchema`, `UPLOAD_ERROR_CODES`, `uploadErrorCodeSchema` |
| `shared/src/receipt.ts` | `RECEIPT_STATUSES`, `receiptStatusSchema`, `vatBreakdownSchema`, `receiptItemSchema`, `canonicalReceiptFieldsSchema`, `canonicalReceiptSchema` |
| `shared/src/api.ts` | `apiErrorResponseSchema`, `createReceiptResponseSchema`, `sourceDocumentResponseSchema`, `listReceiptsQuerySchema`, `listReceiptsResponseSchema`, `updateReceiptRequestSchema`, `confirmReceiptResponseSchema`, `EXPORT_FORMATS`, `EXPORT_SCHEMA_VERSION`, `exportFormatSchema`, `exportedReceiptSchema`, `jsonExportResponseSchema` |
| `shared/src/health.ts` | `HEALTH_PATH`, `HealthResponse` |

The export body is versioned with `schemaVersion: 1`. `GET /api/receipts/:id` returns
`canonicalReceiptSchema` plus `lowConfidenceFields`; JSON export returns the derived
`exportedReceiptSchema` inside `jsonExportResponseSchema`.

### Adding tests to `shared`

`shared/tsconfig.json` excludes `src/**/*.test.ts` from the build so test files never land in
`shared/dist/` and ship inside the package surface. They are still typechecked, by the sibling
`shared/tsconfig.test.json`, which is listed in the root `tsconfig.json` references — **a project
config missing from that list is never typechecked at all**, so broken test files would pass silently.
`api/` uses the identical pattern. One difference worth knowing: the `shared` build config sets
`"types": []` to keep the package browser-safe, while its test config sets `"types": ["node"]`,
because tests run in Node.

## Toolchain notes

**The linter is oxlint, not ESLint. Do not reinstate ESLint without reading this.**

The PRD mandates TypeScript 7, which is the native Go port of the compiler. TypeScript 7 no longer
exports the JavaScript compiler API from its main entry point:

```console
$ node -e "const ts=require('typescript'); console.log(Object.keys(ts).length, typeof ts.createProgram)"
2 undefined
```

`typescript-eslint` is built entirely on that API and declares a peer range of `>=4.8.4 <6.1.0`.
There is no v9 release. Installing it under TypeScript 7 produces a package that cannot function.
oxlint parses TypeScript and JSX directly and has no `typescript` peer dependency.

The trade-off is that oxlint offers no type-aware rules (`no-floating-promises` and friends).
`tsc --build` under `strict` with `noUncheckedIndexedAccess` is the authoritative type gate and
covers most of that ground. If `typescript-eslint` ships TypeScript 7 support later, revisiting this
is cheap.

**The decimal library is `big.js`, not `decimal.js`.** This is the same class of trap. `decimal.js`
merges a class, a namespace and a function under one name in its type declarations and re-exports it
as `export default`; TypeScript 7 resolves that default to the non-constructable member:

```ts
import Decimal from "decimal.js"; // error TS2351: This expression is not constructable.
```

**PDF inspection uses `pdf-lib` server-side only.** Its installed package is about 22 MB, though the
runtime CJS entry is roughly 3 MB; that does not affect the browser bundle. It reads encryption and
page counts from the document structure, which a byte scan cannot do reliably. Its transpiled error
subclasses do not survive `instanceof`, so the code reads `isEncrypted` after loading with
`ignoreEncryption: true`. If maintenance becomes a concern, `@cantoo/pdf-lib` is the compatible fork
to evaluate rather than changing the upload contract speculatively.

`big.js` typechecks either way and is **58 KB installed** (measured), where the `decimal.js` probe
during planning measured ~5.9 MB — and this dependency is bundled into the browser build. `Big.strict`
gives the float guarantee described under **Domain model**. This PoC only ever adds, compares and
formats money, so arbitrary-precision transcendental functions buy nothing.

One related gap: TypeScript's bundled lib still types `Intl.NumberFormat#format` as taking only a
`number`, including under `ESNext.Intl`, even though the runtime has accepted strings since ES2023
and Node 24 honours it. `shared/src/money.ts` declares that capability in one narrow local interface
rather than widening the project's `lib`.

Three smaller conventions worth knowing:

- **`react-router`, never `react-router-dom`.** v8 consolidated into the single package;
  `react-router-dom` is frozen at 7.18.2.
- **Module resolution differs by workspace.** `api` and `shared` use `nodenext`, so
  relative imports need a `.js` extension even in `.ts` source. `client` uses `bundler`
  resolution, where extensionless imports are correct.
- **Prettier does not touch `*.md`.** Markdown tables in the PRD and roadmap are hand-aligned;
  letting Prettier reflow them creates noise in every diff.

## Internationalization

The UI ships in Croatian (`hr`) and English (`en`). The initial language comes from the browser and
is overridable with the header switcher, which persists the choice to `localStorage`.

Resources live in `client/src/i18n/locales/en.json` and `client/src/i18n/locales/hr.json`. Keys are
namespaced by feature (`common.*`, `home.*`, `errors.*`, `warnings.*`) so later tasks can add
`capture.*`, `review.*` and `history.*` without collision.

**No user-facing string may be hardcoded in any component** (PRD §7.13). Translation keys are typed
against `client/src/i18n/locales/en.json` via a `CustomTypeOptions` augmentation, so an unknown key
is a compile error.

Three tests guard the locale files, and all are load-bearing:

- `client/src/i18n/i18n.test.ts` — `hr` and `en` have identical key sets and no empty values. If it
  fails, translate the missing key rather than deleting it from the other file.
- `client/src/i18n/warnings.test.ts` — every code in `WARNING_CODES` has a non-empty message in both
  languages, and no orphan message exists. This one exists because `/validate` Phase 6.5 only sees
  translation calls whose key is a string literal; warnings will be rendered from a template literal
  built out of the code, which that scan cannot follow.
- `client/src/i18n/receiptStatuses.test.ts` — every `RECEIPT_STATUSES` value has a non-empty history
  label in both languages, with no orphan label. History builds this key from a template literal, so
  the literal-key scan cannot protect it.

## Configuration

Every variable lives in a single `.env` at the repository root, read by `api/src/config.ts`, which
validates it at startup and reports **all** invalid variables at once rather than failing on the
first.

| Variable                               | Default                 | Notes                    |
| -------------------------------------- | ----------------------- | ------------------------ |
| `PORT`                                 | `3001`                  | API port                 |
| `NODE_ENV`                             | `development`           | `development` \| `test` \| `production` |
| `LOG_LEVEL`                            | `info`                  | pino level, or `silent`  |
| `WEB_ORIGIN`                           | `http://localhost:5173` | CORS allow-list origin   |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | —                       | **Required at startup**, server-only |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY`      | —                       | **Required at startup**, server-only |
| `AZURE_DI_MODEL_ID`                    | `prebuilt-invoice`       | Azure model id           |
| `AZURE_DI_LOCALE`                      | `hr-HR`                  | Azure locale hint        |
| `EXTRACTION_TIMEOUT_MS`                | `90000`                  | Azure extraction timeout in milliseconds |
| `SUPABASE_URL`                         | —                       | **Required at startup**  |
| `SUPABASE_PUBLISHABLE_KEY`             | —                       | **Required at startup**; safe in a browser |
| `SUPABASE_SECRET_KEY`                  | —                       | Task 03, **server-only** — bypasses RLS |
| `STORAGE_BUCKET`                       | —                       | **Required at startup**; `receipt-sources` |
| `MAX_UPLOAD_BYTES`                     | `10485760`               | Maximum multipart source size (10 MB) |
| `MAX_PDF_PAGES`                        | `10`                     | Maximum source PDF page count |
| `DATABASE_URL`                         | —                       | Task 03; Supabase CLI only, not read at runtime |
| `VITE_SUPABASE_URL`                    | —                       | Browser; same value as `SUPABASE_URL` |
| `VITE_SUPABASE_PUBLISHABLE_KEY`        | —                       | Browser; same value as `SUPABASE_PUBLISHABLE_KEY` |
| `VITE_API_BASE_URL`                    | *(empty)*                | Browser; only needed when the client and API are deployed as separate origins |

Supabase issues the two keys as **publishable** and **secret**; they replace the older **anon** and
**service_role** pair, and map onto them one for one. The names here follow what the dashboard now
shows, so there is nothing to translate when copying values across.

Because every variable lives in one root `.env` while Vite's project root is `client/`,
`client/vite.config.ts` sets `envDir` to the repository root. Without it every `VITE_` variable
would silently read as `undefined`.

Two rules that are enforced, not merely documented:

1. **Only `VITE_`-prefixed variables reach the browser bundle.** Azure keys and the Supabase secret
   key must never gain that prefix. The only `VITE_` variables are the Supabase URL and publishable
   key — the latter is public by design (it is the successor to the anon key and is what RLS assumes
   the browser holds), which is why `/validate` Phase 6.1 allow-lists it by name while still
   rejecting every other secret-shaped `VITE_` name.
2. **`.env.example` holds names only, never real values.** It is deliberately *not* git-ignored —
   it is the committed template — so a value pasted into it goes straight into git history, where
   deleting it later does not remove it. Only the harmless local defaults (`PORT`, `NODE_ENV`,
   `LOG_LEVEL`, `WEB_ORIGIN`) may carry a value. Real credentials belong in `.env`.

Both rules are checked by `/validate` Phase 6. If a credential ever does reach a commit, rotate it —
removing it in a later commit is not sufficient.

## Logging

`api/src/logger.ts` configures pino with redaction for `authorization` and `cookie` headers and any
`*.file`, `*.bytes`, `*.content`, `*.raw` or `*.signedUrl` field (PRD §9.4). Receipt images, extracted
receipt contents, raw provider results and signed URLs must never be logged. That redaction list is
inherited by every later task — extend it rather
than working around it.
