# Validate

Full validation sweep for the Mobile Receipt Capture & OCR PoC.

Run every phase in order from the repository root (`prototypes/receipt-ocr/`). **Do not skip a phase
because an earlier one passed.** If a phase fails, fix the cause and re-run that phase before
continuing — never work around a failure or comment out a check.

> **Shell note:** the user runs Windows PowerShell 5.1, where `&&` is a parser error. Chain with `;`
> or run commands separately. `npm run <script>` chains internally via cmd.exe, so scripts that use
> `&&` are fine.

> **Scope note:** this project is built in 12 sequential tasks (`.agents/ROADMAP.md`). Phase 5 lists
> only journeys that actually exist today. Each task that ships a user-facing flow must add its
> journey to Phase 5 — an empty journey list for a shipped feature is a validation failure.

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
| `shared/src/money.test.ts` | Croatian and English amounts parse to one canonical decimal string; trailing zeros survive (`100.50` never becomes `100.5`); values beyond float precision are exact; unreadable input returns `null` and never throws; `Big.strict` rejects a JS number at runtime |
| `shared/src/datetime.test.ts` | Croatian day-first dates normalize to `yyyy-mm-dd`; the calendar is validated by hand including leap years; a time with no seconds does not gain `:00`; output satisfies `z.iso.date()` / `z.iso.time()` |
| `shared/src/receipt.test.ts` | The canonical schema accepts an all-null and an all-absent receipt, rejects an unknown status, rejects unnormalized money and dates, and rejects unknown keys. Also the **provider-independence guard**: no Azure vocabulary anywhere in `shared/src` (PRD §6.2) |
| `shared/src/api.test.ts` | DTOs are derived, not redeclared: a forged `userId` in a PATCH body is rejected with `unrecognized_keys` (PRD §9.1), server-owned fields are refused, paging defaults and bounds hold |
| `api/src/app.test.ts` | `GET /api/health` returns the shared `HealthResponse` shape at runtime; unknown routes return a JSON error body, never an HTML stack trace |
| `client/src/i18n/i18n.test.ts` | `hr` and `en` have identical key sets and no empty values (PRD §7.13) |
| `client/src/i18n/warnings.test.ts` | Every `WARNING_CODES` entry has a non-empty `hr` and `en` message, and no orphan message exists. Also proves the canonical model imports from `client` under Vite's `bundler` resolution |
| `client/src/components/LanguageSwitcher.test.tsx` | Switching language changes rendered copy and persists to `localStorage` |

**The warning-message test is load-bearing in a way 6.5 cannot replace.** Phase 6.5 only scans
literal `t("…")` calls; the review form will render warnings with a template literal, which that scan
cannot follow. A new warning code without translations would otherwise reach a user as a raw key.

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
node -e "const s=require('fs').readFileSync('.env.example','utf8'); if(/VITE_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/.test(s)) { throw new Error('secret-bearing variable carries a VITE_ prefix'); } console.log('ok');"
```

Only `VITE_`-prefixed variables reach the client. `AZURE_DOCUMENT_INTELLIGENCE_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are server-only.

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
node -e "const fs=require('fs'),path=require('path'); const en=JSON.parse(fs.readFileSync('client/src/i18n/locales/en.json','utf8')); const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?flat(v,p+k+'.'):[p+k]); const known=new Set(flat(en)); const files=[]; (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name); if(e.isDirectory())walk(f); else if(/\.tsx?$/.test(e.name))files.push(f);}})('client/src'); const bad=[]; for(const f of files){const s=fs.readFileSync(f,'utf8'); for(const m of s.matchAll(/\bt\(\s*[\"']([^\"']+)[\"']/g)) if(!known.has(m[1])) bad.push(f+' -> '+m[1]);} if(bad.length) throw new Error('unknown translation keys: '+bad.join(', ')); console.log('ok');"
```

### 6.6 Documentation matches the code

Out-of-date documentation is worse than none. This checks that every `npm run` script the README
mentions exists, that every script is documented, that every file path and local link it references
resolves, and that the documented environment variables match `.env.example` exactly.

```
node -e "const fs=require('fs'); const r=fs.readFileSync('README.md','utf8'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); const fail=[]; const mentioned=new Set([...r.matchAll(/npm run ([a-z:]+)/g)].map(m=>m[1])); const defined=new Set(Object.keys(pkg.scripts)); const a=[...mentioned].filter(s=>!defined.has(s)); if(a.length) fail.push('undefined scripts: '+a); const b=[...defined].filter(s=>!mentioned.has(s) && !r.includes('npm '+s) && s!=='prepare'); if(b.length) fail.push('undocumented scripts: '+b); const paths=[...r.matchAll(/\`([a-zA-Z0-9_.\/-]+\.(?:ts|tsx|json|md|css|html|example))\`/g)].map(m=>m[1]); const c=[...new Set(paths)].filter(p=>!fs.existsSync(p)); if(c.length) fail.push('broken paths: '+c); const links=[...r.matchAll(/\]\(([^)h][^)]*)\)/g)].map(m=>m[1]).filter(l=>!l.startsWith('#')); const d=links.filter(l=>!fs.existsSync(l)); if(d.length) fail.push('broken links: '+d); const cfg=r.split('## Configuration')[1].split('## Logging')[0]; const env=new Set([...fs.readFileSync('.env.example','utf8').matchAll(/^([A-Z0-9_]+)=/gm)].map(m=>m[1])); const doc=new Set([...cfg.matchAll(/\| \`([A-Z][A-Z0-9_]{2,})\`/g)].map(m=>m[1])); const e=[...env].filter(v=>!doc.has(v)); if(e.length) fail.push('env vars not documented: '+e); const f=[...doc].filter(v=>!env.has(v)); if(f.length) fail.push('documented but absent from .env.example: '+f); if(fail.length) throw new Error(fail.join(' | ')); console.log('ok');"
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

---

## Phase 7: End-to-end journeys

**As of Task 01 there is one journey, because the application is a scaffold with no receipt
functionality yet.** Everything below runs against real servers, not mocks.

### 7.1 Start the stack

**First, confirm no stale servers are holding the ports.** Killing `npm run dev` kills the `run-p`
parent but can leave the Vite and API children alive. A leftover Vite then answers on 5173 while the
new one silently moves to 5174/5175/…, so every check below would be testing **old code and passing
falsely**.

```
foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "cleaned port $p" } else { "port $p free" } }
```

```
npm run dev
```

Expected: the API logs `api listening` on port 3001 and Vite serves on **port 5173** — if Vite reports
any other port, stop and clean up again, because something is still holding 5173. Neither logs an
error. Leave this running for the rest of Phase 7.

When Phase 7 is done, run the cleanup command above again so the next run starts clean.

### 7.2 Journey — the shared contract survives the whole stack

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

### 7.3 Journey — unknown route returns a translatable error code

```
try { Invoke-WebRequest -Uri "http://localhost:3001/api/nope" -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }
```

Expected: `404`, and the body is `{"error":{"code":"not_found"}}` — a stable machine code, never
prose and never an HTML stack trace. The UI translates the code (PRD §7.13).

### 7.4 Manual browser checks

Open <http://localhost:5173>.

1. The shell renders real translated copy — **no raw keys** such as `home.title` are visible.
2. The API status card shows the available state (proves the client reached the API).
3. Toggle the language control: all visible copy switches between Croatian and English.
4. Reload the page: the chosen language persists.
5. DevTools → device toolbar → iPhone SE (375px): the layout is usable, nothing overflows
   horizontally, and the language buttons are comfortably tappable (44px minimum, PRD §11.5).
6. Visit <http://localhost:5173/nonexistent>: the translated not-found page renders inside the
   layout.
7. Stop the API (`Ctrl+C` on the API process) and reload: the offline state and a retry button
   appear — never a blank screen or an unhandled rejection. Restart the API and click retry; it
   recovers.

---

## Phase 8: Journeys to add as the roadmap progresses

Phase 7 must grow with the product. When a task below ships, add its journey and delete its row here.

| Task | Journey to add |
|---|---|
| 04 | Register → log in → reload (still authenticated) → log out → protected route redirects. Cross-user access to a receipt returns 404, and a forged `userId` in a request body has no effect. |
| 05 | Upload each supported type creates a row and stores the object. A `.exe` renamed to `.jpg` is rejected by content sniffing. An oversized file fails cleanly. A non-owner gets 404 for `/source`. An expired signed URL no longer serves the file. |
| 06 | Capture → preview → retake → submit → processing state resolves to review or an actionable failure. Denying camera permission still leaves a working upload path. |
| 07 | A real Croatian receipt photo reaches `review` with seller, document number, issue date, total and currency populated. A simulated Azure 429/500 produces `failed` with a working retry. No Azure field name appears in any API response. |
| 08 | A readable fiscal QR decodes and stores. Missing and damaged QR codes still reach `review`. A deliberate QR/total mismatch raises exactly one warning that clears after correction. |
| 09 | Pre-populated review form → edit a wrong document number → save → confirm **with a warning outstanding** succeeds. `original_extraction` still holds the pre-edit machine values. |
| 10 | History lists only the current user's receipts, newest first, paged and status-filtered. Soft delete removes it from history while the row persists with `deleted_at` set. |
| 11 | CSV opens in a spreadsheet with Croatian characters intact; a seller name starting with `=`, `+`, `-` or `@` is neutralized. JSON contains no Azure property name. `100.50` exports as exactly `100.50`. |
| 12 | Full journey on a real phone against the deployed environment; Playwright critical-path suite passes. |

---

## Maintaining this file

**Do not re-run `/ultimate_validate_command` to refresh this file.** That command is a one-shot
generator, it writes to this exact path, and it overwrites rather than merges. Its template defines
only five phases — lint, typecheck, style, unit tests, E2E. Phase 0, the whole of Phase 6, the port
hygiene in Phase 7 and all of Phase 8 are **not** in that template: they came from real incidents
during Task 01, not from reading the code, so a regeneration cannot recover them and would silently
delete roughly 140 lines.

Instead, **extend this file by hand at step 6 of every task**:

- new tests → add a row to the Phase 4 table saying what they protect
- a new user-facing flow → add a journey to Phase 7 and delete its row from Phase 8
- a new class of mistake → add a check that would have caught it
- new env vars → they are covered automatically by 6.1, 6.1b and 6.6

There is one case where running the generator is worth it: when a task introduces **new tooling** it
could discover — Supabase and migrations in Task 03, Playwright and deployment in Task 12. Even then:

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
- [ ] Every Phase 7 journey completes, including the manual browser checks
- [ ] Any feature shipped since the last run has a journey in Phase 7

## Reporting

Report honestly. State which phases passed, paste the real output of anything that failed, and name
any check you skipped and why. A phase that was not run is **not** a passing phase.
