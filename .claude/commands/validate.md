# Validate

Full validation sweep for the Mobile Receipt Capture & OCR PoC.

Run every phase in order from the repository root (`prototypes/receipt-ocr/`). **Do not skip a phase
because an earlier one passed.** If a phase fails, fix the cause and re-run that phase before
continuing — never work around a failure or comment out a check.

> **Shell note:** the user runs Windows PowerShell 5.1, where `&&` is a parser error. Chain with `;`
> or run commands separately. `npm run <script>` chains internally via cmd.exe, so scripts that use
> `&&` are fine.

> **Scope note:** this project is built in 12 sequential tasks (`.agents/ROADMAP.md`). Phase 8 lists
> only journeys that actually exist today. Each task that ships a user-facing flow must add its
> journey to Phase 8 — an empty journey list for a shipped feature is a validation failure.

> **Cost note:** the full sweep below is run once, at the end of a task, before commit — it is not a
> loop to repeat after every small fix. Run each command once; after fixing something small, re-run
> only the specific check that fix could plausibly affect (e.g. `npx vitest run --project client
> ActiveRegionStrip` after editing that file, not the whole suite). Never re-run a command that
> already passed and that nothing has changed since — a documentation-only edit needs no re-run of
> anything. When reviewing someone else's already-reported-passing work, read their report and verify
> only what's actually in question, rather than redoing everything they already ran. This file's
> length and this session's own habit of matching it (a 90k-token, 30-minute validation pass on one
> feature) are exactly what this note exists to prevent.

---

## Phase 0: Clean install

Proves a fresh clone works, which PRD §12 Phase 4 requires.

```
npm install
```

Expected: no `ERESOLVE` errors, and the `prepare` script builds `shared` so the workspaces
resolve one another.

**Never** pass `--legacy-peer-deps` or `--force` to make this pass. A peer conflict here is real
information — see the ESLint/TypeScript 7 note in `README.md`.

---

## Phase 1: Linting

```
npm run lint
```

Runs oxlint. Expected: zero errors.

If you are tempted to install `eslint` or `typescript-eslint`, read the **Toolchain notes** section
of `README.md` first. They cannot work under TypeScript 7 and must not be reinstated.

---

## Phase 2: Type checking

```
npm run typecheck
```

Runs `tsc --build` across the project reference graph (`shared`, `api`, `client`,
`client/tsconfig.node.json`). This is the **authoritative** correctness gate — oxlint has no
type-aware rules, so nothing else catches type errors.

Expected: exit code 0 with no output.

Do not pipe this through `Select-Object`, `head` or `tail` in a script — the pipe masks the exit
code, and `tsc --build` signals failure with exit code 2.

If a change looks stale, force a full rebuild: `npx tsc --build --force`.

---

## Phase 3: Style checking

```
npm run format:check
```

Expected: `All matched files use Prettier code style!`

`.prettierignore` excludes `*.md` deliberately — the PRD, roadmap, plans and history files are
hand-authored prose with hand-aligned tables. Do not remove that exclusion to "format the docs".

To fix violations: `npm run format`.

---

## Phase 4: Unit and integration tests

```
npm test
```

Runs Vitest across three projects: `shared` (node), `api` (node) and `client` (jsdom).

Expected: all test files pass, zero failures.

Current coverage and what each test protects:

| Test | Protects |
|---|---|
| `shared/src/money.test.ts` | Croatian and English amounts parse to one canonical decimal string; trailing zeros survive (`100.50` never becomes `100.5`); values beyond float precision are exact; unreadable input returns `null` and never throws; `Big.strict` rejects a JS number at runtime; the Croatian kuna abbreviation `kn` (not only the ISO code `HRK`) is stripped like any other currency token — a real receipt's `total` was silently dropped before this was added |
| `shared/src/datetime.test.ts` | Croatian day-first dates normalize to `yyyy-mm-dd`; the calendar is validated by hand including leap years; a time with no seconds does not gain `:00`; output satisfies `z.iso.date()` / `z.iso.time()` |
| `shared/src/receipt.test.ts` | The canonical schema accepts an all-null and an all-absent receipt, requires UUID persisted identifiers, rejects an unknown status, rejects unnormalized money and dates, and rejects unknown keys. Also the **provider-independence guard**: no Azure vocabulary anywhere in `shared/src` (PRD §6.2) |
| `shared/src/api.test.ts` | DTOs are derived, not redeclared: a forged `userId` in a PATCH body is rejected with `unrecognized_keys` (PRD §9.1), server-owned fields are refused, paging defaults and bounds hold, and the JSON export DTO strips owner/delete fields while pinning `schemaVersion: 1` |
| `api/src/app.test.ts` | `GET /api/health` returns the shared `HealthResponse` shape at runtime; unknown routes return a JSON error body, never an HTML stack trace |
| `api/src/repositories/receipts.test.ts` | Database rows map explicitly to canonical objects, timestamps normalize, canonical JSON/warnings are validated, generated projections are ignored, owner/deleted filters survive list paging and export paging, inclusive range bounds and exact counts are correct, and provider errors become stable internal categories |
| `api/src/export/receipts.test.ts` | CSV and JSON export serialization preserves stable columns, UTF-8 BOM, CRLF, RFC 4180 escaping, formula neutralization, exact money strings, compact VAT JSON and private owner/delete field omission |
| `client/src/i18n/i18n.test.ts` | `hr` and `en` have identical key sets and no empty values (PRD §7.13) |
| `client/src/i18n/warnings.test.ts` | Every `WARNING_CODES` entry has a non-empty `hr` and `en` message, and no orphan message exists. Also proves the canonical model imports from `client` under Vite's `bundler` resolution |
| `client/src/i18n/receiptStatuses.test.ts` | Every `RECEIPT_STATUSES` entry has a non-empty `hr` and `en` history label, with no orphan status label |
| `client/src/components/LanguageSwitcher.test.tsx` | Switching language changes rendered copy and persists to `localStorage` |
| `client/src/auth/userIdentity.test.ts` | Avatar initials derive from an email local part across separator, digit, single-token, non-ASCII and unusable inputs, and never throw |
| `client/src/components/AppLayout.test.tsx` | The shell: a signed-out visitor gets no navigation; both the bottom tab bar and the desktop sidebar render with a `navigation` landmark and **no hidden-menu trigger or dialog**; exactly one item per navigation carries `aria-current="page"` on each route (the `end`-prop regression); the account disclosure opens, shows the signed-in email, signs out, and closes on `Escape` and on an outside pointer |
| `client/src/components/Toast.test.tsx` | The always-mounted status region, no-focus toast behavior, manual/Escape dismissal and six-second expiry |
| `api/src/auth/authenticator.test.ts` | Claims are accepted only when `role` is `authenticated` and `sub` is a UUID; an `anon` or `service_role` token is refused; every rejection returns `null` rather than throwing |
| `api/src/middleware/require-auth.test.ts` | Missing, non-`Bearer` and empty-token headers all fail `401 unauthorized`; a verification outage becomes a 500, never a silent 401; a success passes the proven `userId`; `authenticated()` used without `requireAuth` fails loudly instead of answering 401 |
| `api/src/app.test.ts` (extended) | The whole `/api/receipts` prefix answers 401 without a token — **including a path with no route defined**, which is what proves the guard sits on the prefix rather than on individual routes |
| `client/src/auth/authErrors.test.ts` | Every mapped Supabase error code has a non-empty `hr` and `en` message; unknown and missing codes fall back to `auth.errors.generic` |
| `client/src/auth/AuthProvider.test.tsx` | `loading` stays true until the first session read, so a signed-in user never sees a login flash on reload; the session follows `onAuthStateChange`; failures surface a translation key, never Supabase's English prose; the subscription unsubscribes on unmount |
| `client/src/auth/ProtectedRoute.test.tsx` | Spinner while loading — neither outcome rendered early — redirect to `/login` when signed out, children when signed in |
| `client/src/api/client.test.ts` | The bearer token is attached when a session exists and omitted when not; a 401 triggers exactly one `signOut`; a 403/404 triggers none; paged list queries, body-less deletes and export downloads use the shared authenticated wrapper |
| `client/src/capture/receiptFile.test.ts` | Client-only source classification accepts supported types and empty-MIME extension fallback, applies the 10 MB boundary, and keeps resolution/blur guidance advisory through deterministic pixel samples |
| `client/src/routes/HomePage.test.tsx` | Native camera hint and always-visible picker fallback, preview/retake, advisory warnings, exact-file upload, translated upload errors; the on-button `Loading…` state that keeps the preview and blocks retake mid-upload; and the pointer-driven picker split — a coarse pointer keeps both actions, a fine pointer drops the camera one |
| `client/src/routes/ReviewPage.test.tsx` (amber) | Amber marks **every** field needing attention — low-confidence readings *and* warned fields such as an empty critical field — each with `aria-describedby` and none with `aria-invalid`, and a warned field never shows the generic hint as well as its own warning |
| `client/src/routes/ProcessingPage.test.tsx` | Immediate sequential polling, no overlap, review/confirmed routing, failed/error/timeout actions, retry window and unmount abort cleanup |
| `client/src/review/reviewForm.test.ts` | Locale-formatted review input normalizes to canonical strings, preserves trailing zeroes and turns empty values into nulls. |
| `client/src/routes/ReviewPage.test.tsx` | Pre-population, warning and low-confidence rendering with descriptions, save/confirm toasts, non-blocking confirmation and failed-receipt redirection through the rendered UI. |
| `client/src/history/receiptSummary.test.ts` | Guarded history total formatting preserves decimal precision and falls back safely for malformed currency codes; every receipt status maps to the correct destination. |
| `client/src/history/download.test.ts` | Export filenames are date-stable and downloaded blobs revoke their object URLs after the synthetic click |
| `client/src/routes/HistoryPage.test.tsx` | History summary and CLDR plurals, empty/error states, filter, paging, two-step delete, stable busy labels, malformed-currency resilience, per-status destinations and CSV/JSON export button wiring. |
| `api/src/upload/source-file.test.ts` | Byte-sniffs the five accepted source types; rejects disguised executables, text and HEIC sequences; validates PDFs; preserves/caps filenames |
| `api/src/upload/multipart.test.ts` | Multipart limits and malformed forms become stable, translatable upload error codes before a route can reach Storage |
| `client/src/i18n/uploadErrors.test.ts` | Every upload error code has a non-empty Croatian and English message, with no orphan message |
| `api/src/providers/document-extraction/croatian.test.ts` | Croatian OIB, JIR, ZKI, issue date, issue time and document-number text fallbacks handle valid, absent and malformed receipt text |
| `api/src/providers/document-extraction/azure-fields.test.ts` | Recorded Azure fixtures map to canonical fields offline; exact decimal strings come from text rather than provider floats |
| `api/src/providers/document-extraction/receipt-amount.test.ts` (Iteration 18) | Receipt-specific OCR suffixes (`%`, a Croatian tax-class letter, `*`/`#`) normalize before the canonical money parser, while currency tokens and unreadable text retain their existing behavior |
| `api/src/providers/document-extraction/currency.test.ts` (Iteration 18) | All seven recorded fixtures resolve currency from explicit receipt text, corroborated provider evidence, or Croatian date inference; labels and conversion expressions never turn a kuna receipt into EUR |
| `api/src/providers/document-extraction/vat-tables.test.ts` (Iteration 18) | Header-driven VAT recap mapping handles sparse cells, optional label columns, summary rows and unrelated rows without changing canonical money formatting |
| `api/src/providers/document-extraction/tax-signals.test.ts` (Iteration 18) | The unread-VAT signal requires structural recap evidence and remains silent for the recorded VAT-exempt receipts |
| `api/src/providers/document-extraction/azure.test.ts` | Azure retryability classification, deterministic fallbacks isolated from the network, and — regression coverage for a real post-review bug — the request's abort signal is proven to reach the long-running poll, and a poll that outlives `EXTRACTION_TIMEOUT_MS` is proven to reject as a retryable failure rather than hang |
| `api/src/services/receipt-extraction.test.ts` | Background extraction writes review/original data together and contains expected and unexpected failures |
| `api/src/providers/document-extraction/fiscal-qr.test.ts` | Croatian fiscal QR URLs, a bare JIR UUID, case-insensitive parameters, ZKI, malformed payloads and separator-less `izn` parsing remain deterministic, local and non-throwing |
| `api/src/providers/document-extraction/azure-fields.test.ts` (Task 08) | Unreadable source values are tracked as `unreadableFields` without persisting bad data; structured Azure values still take precedence when valid |
| `api/src/providers/document-extraction/azure.test.ts` (Task 08) | Barcode feature propagation, QR extraction and marker-safe text fallbacks preserve normal field extraction when a QR is absent |
| `api/src/validation/warnings.test.ts` | Pure, stable-order warning rules cover critical gaps, unreadable values, exact VAT arithmetic, QR total/date/time mismatches and the not-enough-information path; corrected values clear warnings without OCR rerunning |
| `api/src/providers/document-extraction/azure-fields.test.ts` (Iteration 18) | Table VAT, inferred HRK currency and tax-class-suffixed line-item amounts reach the canonical mapper; structured `TaxDetails` retains precedence |
| `api/src/providers/document-extraction/source-regions.test.ts` (Iteration 18) | Table-sourced VAT cells project canonical review paths from their own geometry after skipped summary rows are removed |
| `api/src/validation/warnings.test.ts` (Iteration 18) | `vat_present_but_unread` is informational, emitted once only when a structural VAT signal exists without a mapped VAT row, and clears after a VAT row is present |
| `api/src/services/receipt-extraction.test.ts` (Iteration 18) | The VAT signal is persisted with extraction metadata and produces its warning alongside the normal review result |
| `api/src/services/receipt-extraction.test.ts` (Task 08) | Background extraction persists QR data and computed warnings together; no QR persists as `null` |
| `api/src/providers/document-extraction/source-regions.test.ts` (Iteration 15) | The read-time source-region projection: `total`/`currency` share one region, VAT and item cells are individually indexed, page coordinates normalize to `[0,1]` for both pixel (image) and inch (PDF) units, a fixture with a `:barcode:` marker still resolves fallback fields to the correct word span, and a fixture with no analysable pages yields an empty response rather than throwing |
| `client/src/review/regionSections.test.ts` (Iteration 15) | Canonical field paths map to the correct form section, including nested `vatBreakdown.N.*`/`items.N.*` prefixes; an unrecognized path returns `null` rather than throwing |
| `client/src/review/SourceOverlay.test.tsx` (Iteration 15) | The overlay is `aria-hidden`; clicking a region calls back with its first field; **an inactive region's whole area is clickable, not just its stroke** — `fill` is never `"none"` and `pointer-events` is explicitly `"all"`, guarding a real bug found only by driving a browser (`fireEvent.click` in jsdom dispatches directly on the element and cannot catch a hit-testing gap) |
| `client/src/components/ActionMenu.test.tsx` (Iteration 17) | The shared overflow menu: it reports `aria-expanded`/`aria-controls`, opens and closes, runs an item exactly once, returns focus to its trigger on both selection and Escape, closes on an outside pointer without stealing focus back, and stays operable while busy. **What it cannot prove** is anything positional — that the desktop dropdown is not clipped by an ancestor, or that the mobile sheet sits above the tab bar — because jsdom computes no layout |
| `client/src/routes/HistoryPage.test.tsx` (Iteration 17) | The table renders at `lg` and the card list below it, **never both** — a duplicated tree would put two of every row and every action menu in the accessibility tree; the six column headers in order; per-receipt CSV/JSON downloads calling the single-receipt endpoint; **a non-confirmed receipt offering no download at all**; and delete requiring the dialog's explicit confirmation |
| `client/src/history/download.test.ts` (Iteration 17) | A single receipt's filename leads with its document number and issue date, and stays safe and non-empty when OCR read something unusable — the document number is untrusted text that reaches a filesystem |
| `client/src/review/ActiveRegionStrip.test.tsx` (Iteration 15) | The mobile crop strip renders only with a matching active field, a known region and a non-PDF, safe source; `cropTransform`'s output, reproduced through the same `scale ∘ translate` composition the browser applies, centers the region's centroid in the **strip's own viewport**, not the full receipt image — the previous formula centered the whole image regardless of which field was active, verified wrong only by measuring a real rendered page |

**The auth-error translation test is load-bearing for the same reason as the warning one.** Those
keys are computed from a Supabase error code, so Phase 6.5's literal-`t("…")` scan cannot follow
them. Without this test a mapped code with no translation would reach a user as a raw key.

**The warning-message test is load-bearing in a way 6.5 cannot replace.** Phase 6.5 only scans
literal `t("…")` calls; the review form will render warnings with a template literal, which that scan
cannot follow. A new warning code without translations would otherwise reach a user as a raw key.

**The receipt-status test is load-bearing for the same template-literal reason.** History maps a
receipt status to `history.status.*` at render time, so both the compiler and Phase 6.5 need this
parity test to prevent a missing message from reaching a user as a raw key.

**The locale parity test is load-bearing.** Every task that adds user-facing copy must add the key to
both `en.json` and `hr.json`. A failure here means a language was left behind — translate it, never
delete the key from the other file to make the test pass.

---

## Phase 5: Build

```
npm run build
```

Compiles all workspaces (`tsc --build`) and bundles the web app (`vite build`).

Expected: `client/dist/` contains `index.html`, a JS chunk and a CSS chunk. A CSS bundle of only a
few hundred bytes means Tailwind did not run — check that `@tailwindcss/vite` is in
`client/vite.config.ts` and that `src/index.css` starts with `@import "tailwindcss";`.

---

## Phase 6: Security and configuration checks

These enforce PRD §9.2–§9.4 and must pass on every task.

### 6.1 No secret reaches the browser bundle

```
node -e "const fs=require('fs'); const ALLOWED=new Set(['VITE_SUPABASE_PUBLISHABLE_KEY']); const bad=[]; for(const line of fs.readFileSync('.env.example','utf8').split(/\r?\n/)){ const m=/^([A-Z0-9_]+)=/.exec(line.trim()); if(!m) continue; const name=m[1]; if(!name.startsWith('VITE_')) continue; if(ALLOWED.has(name)) continue; if(/(KEY|SECRET|TOKEN|PASSWORD)$/.test(name)) bad.push(name); } if(bad.length) throw new Error('secret-bearing variable carries a VITE_ prefix: '+bad.join(', ')); console.log('ok');"
```

Only `VITE_`-prefixed variables reach the client. `AZURE_DOCUMENT_INTELLIGENCE_KEY` and
`SUPABASE_SECRET_KEY` are server-only.

**Why `VITE_SUPABASE_PUBLISHABLE_KEY` is allow-listed rather than renamed.** Its name ends in `KEY`,
but it is public by design: it is the successor to the anon key, it is exactly what Row Level
Security assumes the browser holds, and it authorizes nothing on its own — every row a request can
reach is decided by the user's own access token and the RLS policies, not by this key. Renaming a
correctly-named variable to dodge a grep would be working around a check, which the header of this
file forbids. Adding anything else to `ALLOWED` demands the same standard of justification: the
value must be safe in the hands of any visitor who opens DevTools.

Verify the check still bites, rather than trusting the allow-list: temporarily add
`VITE_AZURE_DOCUMENT_INTELLIGENCE_KEY=` to `.env.example`, re-run, confirm it **throws**, then
remove the line.

### 6.1b `.env.example` contains names only, never real values

`.env.example` **is committed** — it is the template, so it is deliberately not git-ignored. Any real
value pasted into it goes straight into git history. PRD §9.2 requires variable names with no values.
Only the harmless local defaults (`PORT`, `NODE_ENV`, `LOG_LEVEL`, `WEB_ORIGIN`) may carry a value.

```
node -e "const fs=require('fs'); const SAFE=new Set(['PORT','NODE_ENV','LOG_LEVEL','WEB_ORIGIN']); const bad=[]; for(const line of fs.readFileSync('.env.example','utf8').split(/\r?\n/)){ const m=/^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if(!m) continue; if(!SAFE.has(m[1]) && m[2].trim()!=='') bad.push(m[1]); } if(bad.length) throw new Error('.env.example must contain names only, no values. Populated: '+bad.join(', ')); console.log('ok');"
```

If this fails: move the value into `.env` (git-ignored), blank it in `.env.example`, and if the value
was ever committed or pushed, **rotate the credential** — removing it from a later commit does not
remove it from history.

### 6.2 No real secret in the built bundle

Run after Phase 5. Scans the production bundle for anything resembling a leaked credential.

```
node -e "const fs=require('fs'),p=require('path'),d='client/dist/assets'; if(!fs.existsSync(d)){throw new Error('run npm run build first');} const bad=[]; for(const f of fs.readdirSync(d)){ const s=fs.readFileSync(p.join(d,f),'utf8'); for(const k of ['SERVICE_ROLE','service_role','AZURE_DOCUMENT_INTELLIGENCE_KEY','eyJhbGciOi']) if(s.includes(k)) bad.push(f+' contains '+k); } if(bad.length) throw new Error(bad.join('; ')); console.log('ok');"
```

### 6.3 `.env` is git-ignored, `.env.example` is not

```
node -e "const s=require('fs').readFileSync('.gitignore','utf8'); if(!/^\.env$/m.test(s)) throw new Error('.env is not ignored'); if(/^\.env\.example$/m.test(s)) throw new Error('.env.example must be committed'); console.log('ok');"
```

### 6.4 No committed `.env`

```
git ls-files --error-unmatch .env
```

Expected: **fails** with "did not match any file". A success here means a secrets file is tracked —
remove it from the index immediately.

### 6.5 Every translation key resolves

Catches a `t("some.key")` that was never added to the locale files, which would render the raw key
to the user.

```
node -e "const fs=require('fs'),path=require('path'),q=String.fromCharCode(34,39); const en=JSON.parse(fs.readFileSync('client/src/i18n/locales/en.json','utf8')); const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?flat(v,p+k+'.'):[p+k]); const known=new Set(flat(en)); const files=[]; const calls=new RegExp('\\bt\\(\\s*['+q+']([^'+q+']+)['+q+']','g'); (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name); if(e.isDirectory())walk(f); else if(/\.tsx?$/.test(e.name))files.push(f);}})('client/src'); const bad=[]; for(const f of files){const s=fs.readFileSync(f,'utf8'); for(const m of s.matchAll(calls)) if(!known.has(m[1])) bad.push(f+' -> '+m[1]);} if(bad.length) throw new Error('unknown translation keys: '+bad.join(', ')); console.log('ok');"
```

### 6.6 Documentation matches the code

Out-of-date documentation is worse than none. This checks that every `npm run` script the README
mentions exists, that every script is documented, that every file path and local link it references
resolves, and that the documented environment variables match `.env.example` exactly.

```
node -e "const fs=require('fs'); const r=fs.readFileSync('README.md','utf8'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); const fail=[]; const tick=String.fromCharCode(96); const mentioned=new Set([...r.matchAll(/npm run ([a-z:-]+)/g)].map(m=>m[1])); const defined=new Set(Object.keys(pkg.scripts)); const a=[...mentioned].filter(s=>!defined.has(s)); if(a.length) fail.push('undefined scripts: '+a); const b=[...defined].filter(s=>!mentioned.has(s) && !r.includes('npm '+s) && s!=='prepare'); if(b.length) fail.push('undocumented scripts: '+b); const paths=[...r.matchAll(new RegExp(tick+'([a-zA-Z0-9_.\\/-]+\\.(?:ts|tsx|json|md|css|html|example))'+tick,'g'))].map(m=>m[1]); const c=[...new Set(paths)].filter(p=>!fs.existsSync(p)); if(c.length) fail.push('broken paths: '+c); const links=[...r.matchAll(/\]\(([^)h][^)]*)\)/g)].map(m=>m[1]).filter(l=>!l.startsWith('#')); const d=links.filter(l=>!fs.existsSync(l)); if(d.length) fail.push('broken links: '+d); const cfg=r.split('## Configuration')[1].split('## Logging')[0]; const env=new Set([...fs.readFileSync('.env.example','utf8').matchAll(/^([A-Z0-9_]+)=/gm)].map(m=>m[1])); const doc=new Set([...cfg.matchAll(new RegExp('\\| '+tick+'([A-Z][A-Z0-9_]{2,})'+tick,'g'))].map(m=>m[1])); const e=[...env].filter(v=>!doc.has(v)); if(e.length) fail.push('env vars not documented: '+e); const f=[...doc].filter(v=>!env.has(v)); if(f.length) fail.push('documented but absent from .env.example: '+f); if(fail.length) throw new Error(fail.join(' | ')); console.log('ok');"
```

Also confirm by hand that the per-workspace commands the README documents still work — a workspace
rename can leave a stale Vitest project name that `npm test` will not catch, because it runs every
project regardless of name:

```
npx vitest run --project shared
npx vitest run --project api
npx vitest run --project client
```

### 6.7 Logging never leaks receipt data

`api/src/logger.ts` must keep its `redact` configuration (PRD §9.4). Confirm by inspection that
`req.headers.authorization`, `req.headers.cookie`, `*.file` and `*.signedUrl` are still redacted, and
that no task has added a log line containing full receipt contents, a source file body, or a signed
URL.

### 6.8 Money never becomes a JS number

PRD §6.4 and ROADMAP §5 rule 9: monetary values are decimal-safe strings end to end. `parseFloat`,
`Number(...)` and `z.number()` on a money path are how that silently stops being true.

```
node -e "const fs=require('fs'),path=require('path'); const dir='shared/src'; const bad=[]; for(const name of fs.readdirSync(dir)){ if(!name.endsWith('.ts')||name.endsWith('.test.ts')) continue; const src=fs.readFileSync(path.join(dir,name),'utf8'); if(/parseFloat/.test(src)) bad.push(name+': parseFloat'); if(name!=='api.ts' && /z\.(coerce\.)?number\(/.test(src)) bad.push(name+': z.number()'); } if(bad.length) throw new Error('money may have become a number: '+bad.join(', ')); console.log('ok');"
```

`api.ts` is exempt because `page` and `limit` are counts, not money — that is the one place
`z.coerce.number()` is correct.

**Know this check's limits.** It is a grep, not a type analysis: `datetime.ts` legitimately uses
`Number(...)` on date parts, so `Number(` is not banned outright, and a `number` typed onto a money
field elsewhere in the repo would slip past. The authoritative guarantee is `Big.strict = true` in
`shared/src/money.ts`, which throws at runtime, plus the test that asserts it. If either is ever
removed, this check is not a substitute.

### 6.9 Authenticated API access stays centralized

Route components must not introduce a second raw `fetch` path that omits the bearer token, 401 sign-out
or stable error parsing in `client/src/api/client.ts`.

```
node -e "const fs=require('fs'),path=require('path'); const bad=[],allowed=path.normalize('client/src/api/client.ts'); (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name); if(e.isDirectory()) walk(f); else if(/\.tsx?$/.test(e.name)&&path.normalize(f)!==allowed&&/\bfetch\s*\(/.test(fs.readFileSync(f,'utf8'))) bad.push(f);}})('client/src'); if(bad.length) throw new Error('raw fetch outside client API module: '+bad.join(', ')); console.log('ok');"
```

### 6.10 Extraction never reads provider float values

```
node -e "const fs=require('fs'); const s=fs.readFileSync('api/src/providers/document-extraction/azure-fields.ts','utf8'); if(/valueCurrency\s*\.\s*amount|\.valueNumber\b/.test(s)) throw new Error('mapper reads a float money value'); console.log('ok');"
```

### 6.11 Locale files contain no mojibake

A Task 07 review shipped `"PokuÅ¡ajte ponovno"` instead of `"Pokušajte ponovno"` — UTF-8 bytes for `š`
re-interpreted as Latin-1 and re-saved. Every automated check passed: `i18n.test.ts` only verifies
key presence and non-emptiness, and Prettier does not validate string *content*. Croatian text never
legitimately contains `À`–`Å` (U+00C0–U+00C5), so one of those immediately followed by a Latin-1
Supplement punctuation character (U+0080–U+00BF) is essentially always this exact corruption.

```
node -e "const fs=require('fs'); const hi=String.fromCharCode(0xC0)+'-'+String.fromCharCode(0xC5); const lo=String.fromCharCode(0x80)+'-'+String.fromCharCode(0xBF); const pattern=new RegExp('['+hi+']['+lo+']','g'); const bad=[]; for (const f of ['client/src/i18n/locales/hr.json','client/src/i18n/locales/en.json']) { const s=fs.readFileSync(f,'utf8'); const m=[...s.matchAll(pattern)]; if (m.length) bad.push(f+': '+m.map(x=>JSON.stringify(x[0])).join(', ')); } if(bad.length) throw new Error('possible mojibake (UTF-8 misread as Latin-1) in locale files: '+bad.join(' | ')); console.log('ok');"
```

If this fails, do not just retype the affected key — check how the edit was made (a shell heredoc or
tool that assumed the wrong source encoding is the usual cause) so the same key does not get corrupted
again on the next edit.

### 6.12 QR handling never performs a network request

The fiscal QR URL is evidence to parse, never a destination to follow (PRD §9.3).

```
node -e "const fs=require('fs'),p=require('path'); const bad=[]; for(const f of ['api/src/providers/document-extraction/fiscal-qr.ts','api/src/validation/warnings.ts']){ const s=fs.readFileSync(f,'utf8'); if(/\bfetch\s*\(|https?\.(get|request)\s*\(|axios/.test(s)) bad.push(f);} if(bad.length) throw new Error('QR handling must never perform a network request: '+bad.join(', ')); console.log('ok');"
```

### 6.13 Warnings never gate an action

```
node -e "const fs=require('fs'),path=require('path'); const bad=[]; (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name); if(e.isDirectory())walk(f); else if(/\.ts$/.test(e.name)&&!/\.test\.ts$/.test(e.name)){const s=fs.readFileSync(f,'utf8'); if(/if\s*\([^)]*warnings[^)]*\.length/.test(s)) bad.push(f);}}})('api/src'); if(bad.length) throw new Error('a warning count is being used as a gate: '+bad.join(', ')); console.log('ok');"
```

This is a grep, not a proof. The durable guarantee is that no endpoint consults `warnings` at all.

### 6.14 Receipt routes never rewrite machine extraction

```
node -e "const fs=require('fs'); const s=fs.readFileSync('api/src/routes/receipts.ts','utf8'); if(/originalExtraction\s*:/.test(s)) throw new Error('a receipt route writes original extraction; machine values must stay frozen'); console.log('ok');"
```

**Narrowed during iteration 17, after this check spent a whole iteration silently red.** It used to
reject the mere *mention* of `originalExtraction`. Iteration 16 then added the `editedFields`
projection, which legitimately **reads** `state.originalExtraction` to mark which fields a user has
since corrected — a read the rule never meant to forbid — and because that iteration deliberately ran
only the checks its diff implicated, nothing noticed. The check now looks for the property being
*assigned*, which is what a write into a repository input actually looks like, and still fails on
`update(id, { originalExtraction: … })`. The lesson is the general one: a grep encodes an intention
it cannot actually see, so when one fires, establish whether the code or the grep is wrong before
touching either.

### 6.15 Export route is registered before `/:id`

Express matches routes in registration order. `GET /api/receipts/export` must appear before
`GET /api/receipts/:id`, or `export` is parsed as an invalid UUID and the endpoint returns
`400 invalid_request`.

```
node -e "const fs=require('fs'); const s=fs.readFileSync('api/src/routes/receipts.ts','utf8'); const q=String.fromCharCode(34); const exportIndex=s.indexOf(q+'/export'+q); const idIndex=s.indexOf(q+'/:id'+q); if(exportIndex<0) throw new Error('missing /export route'); if(idIndex<0) throw new Error('missing /:id route'); if(exportIndex>idIndex) throw new Error('/export route is registered after /:id and will be shadowed'); console.log('ok');"
```

### 6.16 The spinner glyph keeps an explicit display

A sized `<span>` is `display: inline`, and `width`/`height` do not apply to inline boxes. The spinner
glyph therefore sized correctly only where its parent happened to be a flex container, and collapsed
to a 4 px sliver inside the plain wrapper the history buttons used — measured in a real browser at
`4x25` against the intended `16x16`. **jsdom computes no layout, so every unit test passed while the
buttons shipped a visibly broken placeholder.** This is the cheap guard.

```
node -e "const fs=require('fs'); const s=fs.readFileSync('client/src/components/Spinner.tsx','utf8'); if(!/inline-block/.test(s)) throw new Error('Spinner glyph lost its explicit display; a bare sized span is display:inline and collapses outside a flex parent'); console.log('ok');"
```

The wider lesson, which no grep covers: anything whose size depends on the parent being a flex
container must be looked at in a real browser, not asserted in jsdom.

### 6.17 The source-regions projection never leaks Azure vocabulary

`shared/src/receipt.test.ts` already bans this vocabulary inside `shared/src`, where it would matter
most (PRD §6.2). The regions endpoint's *response body* is the other place it could leak — the
projection module itself (`api/src/providers/document-extraction/source-regions.ts`) legitimately
imports Azure SDK types, so the guard there has to check the JSON it emits, not the file's source.

```
node -e "const fs=require('fs'); const s=fs.readFileSync('api/src/providers/document-extraction/source-regions.ts','utf8'); if(!/sourceRegionsResponseSchema\.parse/.test(s)) throw new Error('mapSourceRegions no longer validates its own output against the shared schema'); console.log('ok');"
```

This is a proxy, not a full body scan: it confirms the projection is still forced through the strict
Zod schema before it ever reaches an HTTP response, which is what makes an accidental Azure field
name a parse failure rather than a silent leak. `source-regions.test.ts` covers the positive case —
that real fixtures parse cleanly and expose only `fields`, `page`, `corners` and `origin`.

### 6.18 Receipt-noise parsing leaves the canonical money contract unchanged

Iteration 18 normalizes OCR-only suffixes in the extraction adapter. The canonical parser must remain
the shared decimal contract, so this task must not modify `shared/src/money.ts`.

```
git diff --quiet -- shared/src/money.ts || (echo 'shared/src/money.ts changed during receipt-noise parsing' && exit 1)
```

---

## Phase 7: Supabase integration

Split in two, because the halves have different costs and different triggers. **7b runs on every
task. 7a runs whenever the schema changes.**

### 7a — Schema and migrations (requires Docker)

Validates migration repeatability, the database contract, owner-only RLS, exact decimals, the typed
repository and private Storage against a disposable local stack. Normal `npm test` does not start
Docker and is not a substitute.

**Required whenever `supabase/migrations/` changes; skippable when it does not** — starting a
container to re-prove an unchanged schema is ceremony, not verification. A skip must be **reported**
with that reason, per the Reporting rule at the end of this file. A phase that was not run is not a
passing phase.

Run separately so PowerShell preserves every exit code:

```powershell
npm run db:start
npm run db:reset
npm run db:reset
npm run db:lint
npm run db:test
npm run db:types
npm run test:integration:local
npx --no-install supabase migration list --local
```

Expected: both resets apply the same migration cleanly; database lint reports no errors; all pgTAP
and Vitest integration tests pass; generated types remain unchanged when regenerated; the local
bucket is private; and the local migration list contains every committed migration exactly once.

When finished with database work, `npm run db:stop` stops the stack without deleting its volumes.

### 7b — Live integration against the hosted project (no Docker)

```
npm run test:integration
```

Runs `api/src/repositories/receipts.integration.ts`, `api/src/auth/auth.integration.ts` and
`api/src/routes/receipts.integration.ts` against
the hosted project. **Required on every task.**

Hosted is the default target for fidelity, not convenience: the hosted project signs JWTs with
**ES256**, so `getClaims` verifies in-process against a cached JWKS, while the local stack falls back
to the legacy symmetric secret and `supabase-js` takes a different verification branch entirely. A
Docker-only auth test would pass while never exercising the path production uses.

Confirm the runner prints the **hosted** host before any test executes — it always names its
resolved target, and there is deliberately no automatic fallback between the two.

Each run creates two disposable users and deletes them afterwards; `receipts.user_id` is
`on delete cascade`, so their rows go with them. After any failed or interrupted run, check for
orphans, which carry a greppable `task03-`/`task04-`/`task05-` prefix. Task 05 also removes its
private Storage objects explicitly because deleting a user does not cascade to Storage:

```
node --env-file-if-exists=.env -e "const {createClient}=require('@supabase/supabase-js'); const a=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY); a.auth.admin.listUsers().then(r=>console.log(r.data.users.filter(u=>u.email?.startsWith('task')).map(u=>u.email)))"
```

Expected: an empty array. Anything listed is an orphan — delete it.

---

## Phase 8: End-to-end journeys

**As of Iteration 17 there are twelve journeys: the shared contract, authentication, source-document
lifecycle, mobile capture/processing, extraction/retry, QR/warnings, review/confirmation, history,
export, the application shell, source-document field highlighting, and the receipts table with its
row actions and single-receipt export. Everything below runs against real servers, not mocks.**

### 8.1 Start the stack

**First, confirm no stale servers are holding the ports.** Killing `npm run dev` kills the `run-p`
parent but can leave the Vite and API children alive. A leftover Vite then answers on 5173 while the
new one silently moves to 5174/5175/…, so every check below would be testing **old code and passing
falsely**.

```
foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "cleaned port $p" } else { "port $p free" } }
```

Start the API and network-visible client in separate terminals:

```
npm run dev:api
```

```
npm run dev --workspace @receipt/client -- --host 0.0.0.0 --strictPort
```

Expected: the API logs `api listening` on port 3001 and Vite serves on **port 5173**. If Vite reports
any other port, stop and clean up again, because something is still holding 5173. Record Vite's Network
URL for the phone journey. Neither process logs an error. Leave both running for the rest of Phase 8.

When Phase 8 is done, run the cleanup command above again so the next run starts clean.

### 8.2 Journey — the shared contract survives the whole stack

This is the scaffold's reason to exist: one type defined in `shared`, served by Express,
proxied by Vite, consumed by the React client.

```
(Invoke-WebRequest -Uri "http://localhost:3001/api/health" -UseBasicParsing).Content
```

Expected: `{"status":"ok","uptimeSeconds":N}`.

```
(Invoke-WebRequest -Uri "http://localhost:5173/api/health" -UseBasicParsing).Content
```

Expected: identical body. This proves the Vite dev proxy works, which is why the browser never hits
CORS locally.

### 8.3 Journey — unknown route returns a translatable error code

```
try { Invoke-WebRequest -Uri "http://localhost:3001/api/nope" -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected: `404`, and the body is `{"error":{"code":"not_found"}}` — a stable machine code, never
prose and never an HTML stack trace. The UI translates the code (PRD §7.13).

### 8.4 Manual browser checks

Open <http://localhost:5173>.

1. The shell renders real translated copy — **no raw keys** such as `home.title` are visible.
2. The protected home page shows the dominant Scan receipt action and independently available Choose
   file fallback; no API status card remains.
3. Toggle the language control: all visible copy switches between Croatian and English.
4. Reload the page: the chosen language persists.
5. DevTools → device toolbar → iPhone SE (375px): the layout is usable, nothing overflows
   horizontally, and the language buttons are comfortably tappable (44px minimum, PRD §11.5).
6. Visit <http://localhost:5173/nonexistent>: the translated not-found page renders inside the
   layout.
7. Select an image and PDF separately; verify the image preview, document panel, retake/choose-another,
   translated guidance and no horizontal overflow at 320/375 px. A low-quality warning must not
   disable upload.

---

### 8.5 Journey — register, stay signed in, sign out

Ownership is the one thing a user cannot verify for themselves, so it is checked here directly
rather than trusted to the unit tests.

```
try { Invoke-WebRequest -Uri "http://localhost:3001/api/receipts" -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected: `401`, body `{"error":{"code":"unauthorized"}}` — note this path has **no route defined**,
so a `404` here would mean the guard has slipped off the prefix and onto individual routes.

```
try { Invoke-WebRequest -Uri "http://localhost:3001/api/receipts/00000000-0000-0000-0000-000000000000" -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected: `401`, not `404`. Identity is checked before existence.

In the browser at <http://localhost:5173>:

1. Visiting `/` while signed out redirects to `/login`, with no flash of the home page first.
2. Register a new account → land on the home page, signed in.
3. Reload → still signed in, and **no login screen flash** on the way. A flash means `loading`
   is being cleared before the first `getSession()` resolves.
4. Toggle HR/EN on the login screen: every label, button and link switches — including a failed
   sign-in error, which must never appear as Supabase's English prose.
5. Sign in with a wrong password → a translated error.
6. Sign out → redirected to `/login`; navigating back to `/` redirects again.
7. Visit an unknown URL while signed out: it redirects to `/login` rather than rendering. The
   catch-all route lives inside the protected branch precisely so it cannot become a bypass.
8. At 375 px width both forms are usable one-handed, with 44 px targets and no horizontal overflow.
9. `document.documentElement.lang` matches the active language on a fresh load, and the tab title
   is translated.

The cross-user 404 is proven by `api/src/auth/auth.integration.ts` in Phase 7b rather than by hand:
it needs two real accounts and genuine ES256 tokens.

---

### 8.6 Journey — upload, fetch the source, soft-delete

Sign in through the browser to obtain a real access token, then submit a real JPEG with only the
`file` multipart part. Expect `201` and a `processing` receipt. Submit an executable renamed to
`.jpg` with a claimed `image/jpeg` type and expect `415 unsupported_media_type`; submit a file over
10 MB and expect `413 file_too_large`.

Fetch `GET /api/receipts/:id/source` as the owner: expect a `200` response with an image URL and an
expiry about five minutes in the future. The URL must fetch the original bytes. The same endpoint as a
second authenticated user must return `404`. Finally, `DELETE /api/receipts/:id` returns `204`, and
both `GET /api/receipts/:id` and `GET /api/receipts/:id/source` return `404` afterwards. An already
issued URL is expected to remain usable until its short expiry; verify a one-second directly signed
URL stops serving the file after it expires in the hosted integration suite.

---

### 8.7 Journey — mobile capture, processing and fallback

On desktop, sign in and verify that cancelling the Scan receipt picker leaves Choose file visible and
usable. Select a real image, inspect its preview, retake it, then select the same file again and submit.
Verify the request sends the exact selected file as its only multipart part, then reaches the processing
route. Repeat with a PDF and verify the document preview.

Stop the API during a poll and verify the actionable request-error state recovers through Check again
after restart. A failed extraction must expose Retry and resume polling after a `202` response. Do not
add product-only test controls.

On a current iOS Safari or Android Chrome phone connected to the same trusted LAN, open Vite's Network
URL. Capture a real receipt, cancel or deny capture once, use the fallback, retake, upload, rotate the
phone and check one-handed 44 px controls. Record the device, OS, browser and actual camera-picker
behavior in the Task 06 history. A desktop emulator does not satisfy this journey.

### 8.8 Journey — extraction and retry

Upload a real Croatian receipt photo and the supplied PDF. Each must reach `review`; inspect the row to
confirm `original_extraction` equals `canonical_data`, `raw_provider_result` is present and extraction
metadata contains latency and field confidence. Temporarily use an unreachable Azure endpoint, upload a
disposable receipt and confirm it reaches `failed`; restore the endpoint, use Retry, and confirm it
reaches `review`. Check both languages and confirm no provider field name appears in the API response
or UI.

### 8.9 Journey — QR decoding and warnings

1. Upload `C:\Users\Frane\Desktop\računi\racuntaksi1.jpg`. It reaches `review`; its private row's
   `qr_extraction` has JIR, `issueDate` `2025-03-31`, `issueTime` `23:59` and total `"132.72"`.
2. Upload `C:\Users\Frane\Desktop\računi\26515835.jpg`. Its QR raw value preserves `izn=199`, total
   remains `null`, and no `qr_total_mismatch` is stored.
3. Upload `C:\Users\Frane\Desktop\računi\images.jpg`. It reaches `review` normally with
   `qr_extraction` null.
4. In a disposable stored row, compare its canonical total against the QR total with
   `computeWarnings`; a mismatch yields exactly one `qr_total_mismatch`, and restoring the matching
   total clears it without OCR rerunning.
5. Confirm the API response and application logs expose neither QR payload content nor Azure field
   names.

---

### 8.10 Journey - review, edit and confirmation

Upload a receipt that reaches `review`, open its review route, and confirm the source is easy to
compare with the pre-populated form. Correct a wrong document number, save, and verify the returned
warnings recalculate. Confirm while an informational warning remains; it must succeed only after the
explicit action. Verify the stored machine extraction remains unchanged, repeat the visible flow in
Croatian, and check the 375 px layout is usable one-handed.

---

### 8.11 Journey - history, detail and soft delete

Sign in, upload two receipts and confirm one. Open `/receipts` and verify newest-first ordering; use
each status filter to isolate `processing`, `review`, `confirmed` and `failed`; and verify paging with
`limit=1`. A `review` or `confirmed` row must open the review screen with its original source, while a
`processing` or `failed` row opens the processing route. Soft-delete one row through the two-step
control: it disappears from the list, while its real database row retains `deleted_at`. At 375 px,
the list and controls must have 44 px targets and no horizontal overflow. Repeat the visible flow in
Croatian.

---

### 8.12 Journey - CSV and JSON export

Sign in, upload and confirm a real Croatian receipt, then open `/receipts` and download both CSV and
JSON. Open the CSV in a spreadsheet and verify Croatian characters are intact, a seller name starting
with `=`, `+`, `-` or `@` is neutralized, and a total of `100.50` remains exactly `100.50`. Verify the
JSON response has `schemaVersion: 1`, contains no Azure property name, keeps nested VAT and optional
items, and preserves exact money strings. Confirm a `review` receipt, a soft-deleted confirmed
receipt and another user's confirmed receipt are absent from both formats. Repeat the visible export
controls in Croatian at 375 px.

### 8.13 Journey - the application shell

Sign in, then verify the navigation shell at both breakpoints and in both languages.

At **375 px**: the primary navigation is a **fixed bottom tab bar** carrying both destinations, always
visible — there is no hamburger, no drawer and no `role="dialog"` anywhere in the shell. Each tab
measures at least 44 px in both dimensions and sits in the bottom thumb zone. The desktop sidebar is
`display: none`. `document.documentElement.scrollWidth` does not exceed the viewport width in
Croatian or English, on `/` and `/receipts`. The header is a single 56 px row with the accent mark
and app name at top left, and the app name is **not truncated** in either language. Scroll the
history list to its end and confirm the last row is not trapped behind the tab bar.

At **1440 px**: the sidebar is permanently visible at 240 px, the bottom tab bar is `display: none`,
and the header measures 64 px.

On the capture screen at **1440 px** confirm there is exactly **one** file picker, reading
`Choose file` and painted in the primary accent style — the camera action must be absent, because
`matchMedia("(pointer: coarse)")` is false there. Playwright's device emulation does **not** flip
that media feature, so a touch device descriptor is not a way to check the two-button branch; assert
the branch through the unit tests, or temporarily invert the query constant while looking at a real
browser, and never conclude from the emulator that a phone would hide the camera.

At both widths: exactly **one** link per rendered navigation carries `aria-current="page"`, and it
matches the current route on both `/` and `/receipts`. The account control shows initials derived
from the signed-in email, opens a panel exposing that email and a sign-out action, uses
`aria-expanded`/`aria-controls`, carries **no `role="menu"`**, and closes on `Escape` with focus
restored to its trigger. Tab through the header and confirm every control paints a visible
`2px solid` accent outline. On the capture screen, focus each of the two file inputs and confirm the
ring is painted on the **visible label** — the inputs are `sr-only`, so a ring on the input itself is
invisible and is a WCAG 2.4.7 failure. Finally, select a tall portrait photo and confirm the capture
card **grows and the page scrolls** rather than the image being clipped off the top.

### 8.14 Journey - source-document field highlighting

Upload a real image receipt and open its review page. At **1440 px**, confirm the source panel draws
a coloured, unfilled quadrilateral over every field the form shows a value for, that `total` and
`currency` share exactly one outline, and that the image is not visually distorted regardless of how
tall the receipt is (a receipt around 1:2.7 width:height is a good stress case — check `img`'s
rendered aspect ratio against `naturalWidth/naturalHeight` directly, since a subtle CSS regression
here reads as "slightly squished," not as an obvious break). Focus a form field and confirm its
outline becomes the visibly emphasized one; click an inactive outline **away from its border, in the
middle of its area** and confirm it focuses the matching input — clicking only the 1-2 px stroke line
is not a real check, because a `fill="none"` region would pass that and still be unusable.

At **390 px**, focus a field and confirm a fixed strip appears below the header showing that field's
location, zoomed to a legible size, and that **nothing else on the page moves** — compare
`document.documentElement.scrollHeight` immediately before and after the strip appears; it must be
identical. Focus a field near the top of the receipt and one near the bottom and confirm the strip
recenters correctly for both — a transform that always centers the same point regardless of which
field is active is a real failure mode here and will not be obvious from a single screenshot.

Upload a PDF receipt and confirm its existing viewer is unchanged, that a translated
"not available for PDF" note appears, and that nothing errors.

Repeat the outline/strip checks in Croatian. Confirm `GET /api/receipts/:id/regions` is not called
for another user's receipt (cross-user 404 is proven in `receipts.integration.ts`, not by hand here).

**None of this is safely assertable from jsdom.** Region-click hit-testing depends on the browser's
real paint-based pointer-event resolution, the distortion check depends on real image layout, and the
mobile-strip centering depends on real measured pixel geometry — three separate real bugs were found
only by driving an actual browser during this journey's first run, none caught by 372 passing unit
tests. See the Iteration 15 history file for what those were and why the unit tests could not see
them.

### 8.15 Journey - the receipts table, row actions and single-receipt export

At **1440 px**, `/receipts` must render a **table**, not cards: six columns, only the seller cell a
link, and `document.documentElement.scrollWidth` no greater than the viewport width even with a
seller name and a document number long enough to truncate. Open a row's ⋮ menu and confirm with
`document.elementFromPoint` that a point in the **middle of the open panel** resolves to a menu item.
That is the check that matters: the panel is absolutely positioned inside the table container, so
giving that container `overflow-x: auto` — which also clips vertically — would cut the menu off, and
no unit test can see it.

A **confirmed** row offers Download CSV, Download JSON and Delete; a `review`, `processing` or
`failed` row offers only Delete. Downloading must call `/api/receipts/:id/export?format=…` and return
200. Confirm the same Download menu appears on a confirmed receipt's own review screen.

Choose Delete and confirm the dialog is genuinely modal — `dialog.matches(":modal")` is true, not
merely visible — that initial focus is on the least destructive button, that
`document.elementFromPoint` outside its box hits the dialog's backdrop rather than the page beneath,
and that Escape closes it and returns focus to the ⋮ trigger. Then complete a delete and confirm the
list reloads with one fewer receipt.

At **390 px** the same menu must open as a **bottom sheet**: anchored to the viewport bottom,
covering the fixed tab bar, over a scrim that closes it on tap, with every item at least 44 px tall.
With more than one page of receipts, scroll to the end and confirm the pagination controls clear the
tab bar, then page forward and confirm the new page starts at the top rather than at the previous
scroll offset.

Repeat the row menu and the delete dialog in Croatian and confirm no raw translation key appears.

**Two of these are provable only in a browser** — the dropdown's clipping and the dialog's real
modality both depend on layout and the top layer, neither of which jsdom implements at all. Its
`showModal` is stubbed in `client/src/test/setup.ts` purely so the components mount.

---

### 8.16 Journey - extraction accuracy

Upload a Croatian receipt with a VAT recap and confirm the review form contains its VAT rate, taxable
base and VAT amount. Confirm the currency is populated; when it is inferred from a pre-2023 Croatian
receipt, it must use the existing amber low-confidence treatment. At 1440 px, focus each VAT field and
confirm its table-cell source outline appears. Upload a VAT-exempt receipt and confirm it shows no
`vat_present_but_unread` warning. Repeat the visible copy in Croatian.

The table-cell outlines require a real browser; jsdom cannot verify painted SVG geometry or pointer
hit testing.

---

## Phase 9: Journeys to add as the roadmap progresses

Phase 8 must grow with the product. When a future task ships a new user-facing flow, add its journey
here and delete its row once it lands in Phase 8.

| Task | Journey to add |
|---|---|
| — | none pending. The remaining real-phone checklist (§8.7) and any Playwright suite are no longer owned by a planned roadmap task; the user is covering them directly against the deployed prototype. |

---

## Maintaining this file

**Do not re-run `/ultimate_validate_command` to refresh this file.** That command is a one-shot
generator, it writes to this exact path, and it overwrites rather than merges. Its template defines
only five phases — lint, typecheck, style, unit tests, E2E. Phase 0, the whole of Phase 6, Phase 7,
the port hygiene in Phase 8 and all of Phase 9 are **not** in that template: they came from real incidents
during Task 01, not from reading the code, so a regeneration cannot recover them and would silently
delete roughly 140 lines.

Instead, `/execute` must **extend this file by hand during its automatic validation stage for every
task**. The user should never need to request this as a separate step:

- new tests → add a row to the Phase 4 table saying what they protect
- a new user-facing flow → add a journey to Phase 8 and delete its row from Phase 9
- a new class of mistake → add a check that would have caught it
- new env vars → they are covered automatically by 6.1, 6.1b and 6.6

There is one case where running the generator is worth it: when a task introduces **new tooling** it
could discover — Supabase and migrations in Task 03 is the precedent. Even then:

1. generate to a scratch path, never over this file
2. diff it against this file
3. cherry-pick only genuinely new commands or phases
4. keep every existing phase

A task that adds only application code within the existing toolchain — Task 02, for instance — gains
nothing from the generator, because the commands it would find are already here.

## Success criteria

`/validate` passes only when **all** of these hold:

- [ ] `npm install` succeeds on a clean checkout with no peer-dependency overrides
- [ ] `npm run lint` reports zero errors
- [ ] `npm run typecheck` exits 0
- [ ] `npm run format:check` passes
- [ ] `npm test` passes with zero failures
- [ ] `npm run build` produces a web bundle and compiled API output
- [ ] Every Phase 6 security check passes
- [ ] Phase 7b (hosted integration) passes, and Phase 7a passes whenever the schema changed —
      a skipped 7a is named and justified, never counted as green
- [ ] Every Phase 8 journey completes, including the manual browser checks
- [ ] Any feature shipped since the last run has a journey in Phase 8

## Reporting

Report honestly. State which phases passed, paste the real output of anything that failed, and name
any check you skipped and why. A phase that was not run is **not** a passing phase.
