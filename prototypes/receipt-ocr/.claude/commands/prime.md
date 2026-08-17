---
description: Prime agent with project context before starting a task
---

# Prime: Load Project Context

You are joining the **Mobile Receipt Capture & OCR PoC** with zero context. This command exists to
give you an accurate mental model of what exists, what was decided, and what to do next.

**Output a summary only. Do not write or change any code during priming.** Implementation begins with
`/plan-feature`, not here.

---

## 1. Read these four things, in this order

This order is prescribed by `.agents/ROADMAP.md` §1 "Session bootstrap". Do not skip a file because
another one seems to cover it — they answer different questions.

1. **`PRD.md`** — what the product is and, just as importantly, what is deliberately **out of scope**.
   Pay attention to §4.6–4.8 (out of scope), §6.2 (canonical model), §6.4 (schema), §7.13 (i18n),
   §9 (security) and Appendix A–B.
2. **`CLAUDE.md`** — the behavioural rules: think before coding, simplicity first, surgical changes,
   goal-driven execution, and push back when the request or the plan is wrong.
3. **`.agents/ROADMAP.md`** — the plan of record. Read §1 (task loop), §2 (**locked decisions and
   their amendments** — do not relitigate these), §3 (progress table: which task is next) and the
   scope block for the next task. Also §5, the standing rules for every task.
4. **The most recent 1–2 files in `.agents/history/`** — what *actually* happened, including
   deviations from plan, decisions taken, bugs found and gaps deliberately left. These exist because
   the plan is not the reality.

Then read:

5. **`README.md`** — setup, scripts, the API and error conventions, the toolchain rationale, the
   configuration table and the logging rules. This is also the contract a fresh clone relies on.
6. **`.claude/commands/validate.md`** — the checks every task must pass. Know what will be run
   against your work before you start it.
7. **The plan for the next task**, if `.agents/plans/` already has one.

History files present:

!`git ls-files .agents/history`

Plans present:

!`git ls-files .agents/plans`

---

## 2. Orient in the code

The prototype is a TypeScript npm-workspaces monorepo with **three flat workspaces** at the root of
`prototypes/receipt-ocr/`:

```text
client/    React 19 + Vite    @receipt/client
api/       Express 5          @receipt/api
shared/    types used by both @receipt/shared
```

Skim, do not exhaustively read:

- `package.json` (root) — workspaces and scripts
- `tsconfig.base.json` and root `tsconfig.json` — the project-reference graph
- `shared/src/` — every type shared across the boundary
- `api/src/app.ts`, `api/src/config.ts`, `api/src/middleware/error-handler.ts` — the API conventions
  later routes must follow
- `client/src/i18n/` — how translation keys are typed and enforced

Current state:

!`git log --oneline -5`

!`git status --short`

Installed dependency versions, when a version matters:

!`npm ls --depth=0`

---

## 3. Conventions that are easy to get wrong

Verify these against the code rather than assuming; they have already caused mistakes.

- **The linter is oxlint, not ESLint.** TypeScript 7 is the native Go port and no longer exports the
  JS compiler API, so `typescript-eslint` cannot function. Do not reinstate ESLint. `tsc --build`
  under `strict` is the authoritative type gate. See README "Toolchain notes".
- **`react-router`, never `react-router-dom`.**
- **Module resolution differs by workspace.** `api` and `shared` use `nodenext`, so relative imports
  need a `.js` extension even in `.ts` source. `client` uses `bundler` resolution, where
  extensionless imports are correct.
- **Cross-workspace imports use the package name** (`@receipt/shared`), never a relative path.
- **Prettier does not touch `*.md`.** Do not remove that exclusion — running it over the docs
  reflows every hand-aligned table in `PRD.md` and `ROADMAP.md`.
- **`.env.example` is committed and must hold names only.** Real values go in `.env`, which is
  git-ignored. `/validate` Phase 6.1b enforces this.
- **No hardcoded user-facing strings, ever.** Keys are typed against
  `client/src/i18n/locales/en.json`, and a test enforces `hr`/`en` parity.
- **Before any live check, confirm ports 3001 and 5173 are free and that Vite reports 5173.**
  Stopping `npm run dev` does not reliably kill its children; a surviving `tsx watch` keeps watching
  `api/`, and a stale Vite on 5173 will answer while the current one silently moves to 5174+, so
  checks can pass against old code. See `/validate` Phase 7.1.

---

## 4. Report

Keep it scannable. Cover:

**Where the project stands** — the last completed task, the next task, and anything the most recent
history file flags as an open question or deliberate gap.

**The next task** — its goal, scope, definition of done, and which deferred decisions it owns.

**Architecture and stack** — only what is actually present, plus the locked decisions that constrain
the next task.

**Concerns** — anything in the roadmap, plan or PRD for the next task that looks wrong, ambiguous, or
in conflict with what the code now does. Raise it now, before planning, per `CLAUDE.md` §1 and §5.

Then stop and state the next command, which is normally:

```text
/plan-feature <exact task title from the roadmap progress table>
```

---

## Notes on what does and does not carry over

- `.agents/ROADMAP.md` and `.agents/history/` are committed, so they are the primary handoff between
  sessions and machines. Anything learned and not written there is lost.
- `.claude/` **is** committed as of `4f00f38`, so these commands and `validate.md` travel with a
  clone. Earlier revisions of this file said the opposite, back when `.gitignore` excluded it — that
  is no longer true, and `validate.md` in particular must be hand-extended and committed with each
  task rather than treated as a local scratch file.
