# Feature: Canonical domain model & shared contracts (Roadmap Task 02)

The following plan should be complete, but it is important that you validate documentation, codebase
patterns and task sanity before you start implementing.

Pay special attention to the naming of existing utils, types and models. Import from the right files.

> **Everything in the "Verified findings" section below was proven empirically during planning** by
> installing the candidate libraries in a scratch project and compiling them with the repository's
> exact `tsconfig.base.json` options under TypeScript 7.0.2. Do not re-litigate those findings from
> intuition — but do re-run the probes if something surprises you.

## Feature Description

One provider-independent definition of a receipt, shared by the client and the API, expressed as Zod
schemas with TypeScript types inferred from them. It ships four things:

1. The **canonical receipt model** from PRD §6.4 — `CanonicalReceipt`, `VatBreakdown`, `ReceiptItem`,
   `ReceiptStatus`, `ReceiptWarning` — with no Azure vocabulary anywhere.
2. **Decimal-safe money helpers** that parse Croatian and English number formats off a receipt,
   compare exactly, format for display, and round-trip through Postgres `numeric` without loss.
3. **Date/time normalization** producing ISO `yyyy-mm-dd` and `HH:mm[:ss]` strings.
4. **API DTO schemas** for the endpoints in PRD §10, derived from the canonical model rather than
   redeclared, so the wire contract cannot drift from the domain model.

Nothing here persists, maps from Azure, or evaluates a warning rule. This task defines the vocabulary
that Tasks 03–11 speak.

## User Story

As a developer building the receipt pipeline
I want one schema-validated definition of a receipt, with money that is never a JS float
So that the API, the database and the review form cannot silently disagree about what a receipt is,
and a total of `100.50` is still exactly `100.50` after a round trip through the database and an
export.

## Problem Statement

Task 01 shipped a scaffold whose only shared contract is a health-check response. Every task from 03
onward needs the receipt model: Task 03 persists it, Task 05 returns it, Task 07 maps Azure output
into it, Task 08 attaches warnings to its fields, Task 09 edits it in a form, Task 11 exports it.

If each of those tasks declares its own shape, the mapper and the form drift apart, and the drift
surfaces as wrong data on a user's receipt rather than as a build failure. Money is the sharpest
edge: JavaScript's `0.1 + 0.2` is `0.30000000000000004`, and `1234567.89 * 100` is
`123456788.99999999`. A PoC whose stated purpose is accurate transcription of financial documents
cannot represent money as a `number`.

There is a second, security-shaped problem. PRD §9.1 requires that the backend never trust a
client-supplied `userId`. If the PATCH body schema is a hand-written duplicate of the receipt shape,
nothing structurally prevents someone adding `userId` to it later.

## Solution Statement

Put a single Zod schema layer in the existing `shared/` workspace, built in two tiers:

- `canonicalReceiptFieldsSchema` — the **user-editable** receipt data from PRD §6.4, declared
  `.strict()`.
- `canonicalReceiptSchema` — that schema `.extend(…)`ed with the **server-owned** envelope (`id`,
  `userId`, `status`, `warnings`, timestamps).

Every DTO is then *derived*: the PATCH body is `canonicalReceiptFieldsSchema.partial()`, so it
mechanically cannot accept `userId` — Zod's `.strict()` survives `.partial()`, `.extend()`, `.pick()`
and `.omit()` (verified). PRD §9.1 stops being a rule someone has to remember and becomes a property
of the type system.

Money is a **plain decimal string** end to end, with `big.js` used for arithmetic and comparison and
`Intl.NumberFormat` — fed a **string**, not a number — for display. Locale-format parsing is
hand-written on top, because no library parses "the format a Croatian receipt happens to use".

## Feature Metadata

**Feature Type**: New Capability (foundational)
**Estimated Complexity**: Medium — no I/O, no async, no UI, but high blast radius and subtle parsing
**Primary Systems Affected**: `shared/` (almost everything), `api/` (one type annotation),
`client/` (locale files + one test), root build/test configuration
**Dependencies**: `zod@4.4.3`, `big.js@7.0.1`, `@types/big.js@7.0.0` — all new, none currently installed

---

## CONTEXT REFERENCES

### Relevant Codebase Files — YOU MUST READ THESE BEFORE IMPLEMENTING

- `shared/src/health.ts` (7 lines) — Why: the entire existing content of the package you are
  extending. Note the shape: a `const` and an `interface`, no runtime logic.
- `shared/src/index.ts` (1 line) — Why: the barrel. Every new module must be re-exported here, and
  note the `.js` extension on the relative import — `shared` uses `nodenext` resolution.
- `shared/tsconfig.json` — Why: `"types": []`, `rootDir: src`, `outDir: dist`, and
  **`"include": ["src/**/*"]` with no `exclude`**. You are adding `*.test.ts` files to this package,
  so without a change they will be compiled into `shared/dist/`. See Task 3 below.
- `shared/package.json` — Why: `main`/`types`/`exports` all point into `dist`, which is why the root
  `prepare` script must build `shared` before anything can import it.
- `api/tsconfig.json` (lines 10–12) — Why: **the exact pattern to mirror** for keeping tests out of
  `dist`: `"exclude": ["src/**/*.test.ts"]` plus a sibling `tsconfig.test.json`.
- `api/tsconfig.test.json` (13 lines) — Why: copy this file almost verbatim for `shared`.
- `tsconfig.json` (root, lines 3–9) — Why: the solution file. Every new project config must be added
  to `references` or `npm run typecheck` will not check it.
- `vitest.config.ts` (root) — Why: `projects: ["api", "client"]`. `shared` is **not** listed, so
  tests you add there will not run until you add it.
- `api/vitest.config.ts` — Why: the per-project config to mirror (`name`, `environment`, `include`).
  **The `name` field caused a real bug in Task 01** — a stale name made `--project <x>` fail while
  `npm test` stayed green. Set `name: "shared"` and verify `npx vitest run --project shared` works.
- `api/src/app.test.ts` (lines 1–13) — Why: the test style to follow — explicit `describe/expect/it`
  imports from `vitest`, no globals.
- `client/src/i18n/i18n.test.ts` (all 35 lines) — Why: the locale-parity test you will extend the
  idea of. Reuse its `flatten` approach rather than inventing another.
- `client/src/i18n/index.ts` (lines 14–18) — Why: the `CustomTypeOptions` augmentation that makes
  translation keys compile-checked against `en.json`. Adding a key to `en.json` is what makes
  `t("warnings.…")` typecheck.
- `client/src/i18n/locales/en.json` and `hr.json` — Why: both must gain the identical new key set or
  the parity test fails. Note the namespacing convention (`common.*`, `home.*`, `errors.*`).
- `api/src/middleware/error-handler.ts` (line 37) — Why: it already emits `{ error: { code } }`. You
  will type that response against the new shared `ApiErrorResponse` so the convention is enforced by
  the compiler rather than by prose in the README.
- `README.md` — the "Workspace layout", "Configuration" and "Scripts" sections — Why: `/validate`
  Phase 6.6 mechanically checks that every documented path exists and every script is documented.

### New Files to Create

| File | Purpose |
|---|---|
| `shared/src/money.ts` | Parse / normalize / compare / add / format decimal-safe money strings |
| `shared/src/money.test.ts` | Money unit tests, including every case named in the roadmap DoD |
| `shared/src/datetime.ts` | Receipt date and time normalization to ISO strings |
| `shared/src/datetime.test.ts` | Date/time unit tests |
| `shared/src/warnings.ts` | `WARNING_CODES`, `warningCodeSchema`, `receiptWarningSchema` |
| `shared/src/receipt.ts` | Canonical receipt schemas + inferred types (PRD §6.4) |
| `shared/src/receipt.test.ts` | Schema validation tests |
| `shared/src/api.ts` | DTO schemas/types for the PRD §10 endpoints |
| `shared/src/api.test.ts` | DTO derivation tests, including the forged-`userId` rejection |
| `shared/tsconfig.test.json` | Keeps `*.test.ts` typechecked but out of `dist` |
| `shared/vitest.config.ts` | Registers the `shared` Vitest project |
| `client/src/i18n/warnings.test.ts` | Every `WARNING_CODES` entry has an `hr` and `en` message |

### Files to Modify

| File | Change |
|---|---|
| `shared/package.json` | Add `zod` and `big.js` dependencies |
| `shared/tsconfig.json` | Add `"exclude": ["src/**/*.test.ts"]` |
| `shared/src/index.ts` | Re-export the new modules |
| `tsconfig.json` (root) | Add `{ "path": "./shared/tsconfig.test.json" }` to `references` |
| `vitest.config.ts` (root) | Add `"shared"` to `projects` |
| `client/src/i18n/locales/en.json` | Add the `warnings.*` block |
| `client/src/i18n/locales/hr.json` | Add the identical `warnings.*` block, translated |
| `api/src/middleware/error-handler.ts` | Type the response body as the shared `ApiErrorResponse` |
| `README.md` | Document the money/date contract, the new workspace content, `--project shared` |
| `.claude/commands/validate.md` | Add Phase 4 rows + a Phase 6 check (see Task 16) |

### Relevant Documentation — READ THESE BEFORE IMPLEMENTING

- [Zod 4 — Defining schemas](https://zod.dev/api)
  - Sections: `.strict()`, `.partial()`, `.extend()`, `.pick()`/`.omit()`, `z.enum`, `z.iso.date`,
    `z.iso.time`, `z.discriminatedUnion`
  - Why: every schema in this task is built from these, and the derivation behaviour (strictness
    surviving `.partial()`) is the security property the PATCH DTO relies on.
- [Zod 4 — Error handling / `z.treeifyError`](https://zod.dev/error-formatting)
  - Why: Zod 4 removed `.format()`; `z.treeifyError` is the replacement. Task 09's form needs it.
- [Zod 4 changelog / migration](https://zod.dev/v4/changelog)
  - Why: most Zod examples online are v3 and will mislead you (`.strict()` semantics, error shapes,
    `z.string().datetime()` → `z.iso.datetime()`).
- [big.js API](https://mikemcl.github.io/big.js/)
  - Sections: `Big.strict`, `toFixed`, `cmp`, `eq`, `plus`, `times`
  - Why: `Big.strict` is what mechanically enforces roadmap standing rule 9, and `toFixed` vs
    `toString` is the trailing-zero trap described below.
- [MDN — `Intl.NumberFormat.prototype.format`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/format)
  - Section: "Using format with a string"
  - Why: passing a **string** preserves arbitrary precision; passing a number does not. This is what
    lets display formatting avoid floats entirely.
- PRD §6.4 (schema + schema rules), §6.5 (critical fields), §7.7 (canonical mapping), §7.8
  (warnings), §10 (API spec), Appendix A (field inventory) — the normative source for every field.

---

## VERIFIED FINDINGS (proven during planning — do not re-derive)

### 1. Zod 4.4.3 compiles cleanly under TypeScript 7.0.2

This was the single biggest risk, given that TypeScript 7 already made `typescript-eslint`
unusable. A probe compiling `z.object`, `.strict()`, `.extend()`, `.partial()`, `.pick()`,
`.omit()`, `.refine()`, `.superRefine()`, `z.enum`, `z.discriminatedUnion`, `z.iso.date()`,
`z.iso.time()`, `z.uuid()`, `z.treeifyError()` and `z.infer<>` under the repository's exact
compiler options produced **zero errors**. Zod declares no `typescript` peer dependency.

### 2. `decimal.js` is BROKEN under TypeScript 7 with a default import — use `big.js`

```ts
import Decimal from "decimal.js";   // error TS2351: This expression is not constructable.
import { Decimal } from "decimal.js"; // OK
```

`decimal.js`'s `.d.ts` merges a class, a namespace and a function under one name and re-exports it
as `export default`; TypeScript 7 resolves that default to the non-constructable member. This is the
same class of trap as Task 01's `pino-http` named-export issue.

**`big.js` was chosen instead**, and typechecks with either import style. Rationale beyond dodging
the trap:

- 68 KB installed vs. 5.9 MB for `decimal.js` — and this package is bundled into the browser build.
- This PoC only ever adds, compares and formats money. Arbitrary-precision transcendental functions
  are not needed.
- **`Big.strict = true` throws if a JS `number` is ever passed in.** That converts roadmap standing
  rule 9 ("money is never a JS float") from a convention into a runtime guarantee.

### 3. `Big.prototype.toString()` silently drops trailing zeros

```
new Big("100.50").toString()  ->  "100.5"     ← WRONG for our contract
new Big("100.50").toFixed(2)  ->  "100.50"    ← correct
new Big("0.00").toString()    ->  "0"
```

Task 11's definition of done is literally *"A total of `100.50` exports as exactly `100.50`"*. Never
return `Big#toString()` from a money helper. Prefer building the normalized string directly (the
reference implementation below does) and use `toFixed(scale)` when a scale is required.

### 4. `Intl.NumberFormat.format()` accepts a string and keeps full precision

```
new Intl.NumberFormat("hr-HR",{style:"currency",currency:"EUR"}).format("1234.56")
  ->  "1.234,56 €"
format("12345678901234567890.99") -> "12.345.678.901.234.567.890,99 €"
(12345678901234567890.99 as a float) -> 12345678901234567000     ← corrupted
```

So display formatting needs no custom code and never touches a float. **Gotcha for tests:** the
space before `€` in `hr-HR` output is U+00A0 (non-breaking space), not U+0020. A test asserting
`"1.234,56 €"` typed with a normal space will fail. Assert with ` `, or normalize whitespace in
the assertion.

### 5. `hr-HR` grouping is `.` and decimal is `,` — the inverse of `en`

Confirmed via `formatToParts`. This is the whole reason the parser exists.

### 6. `Date.parse` cannot be used for receipt dates

```
Date.parse("17.08.2026.")  -> NaN
Date.parse("17/08/2026")   -> NaN
Date.parse("08/17/2026")   -> 2026-08-16T22:00:00.000Z   ← silently a day early (timezone)
```

The last one is the dangerous case: a plausible-looking result that is off by one day because
`Date` applied a local-timezone offset. **Do not use `Date.parse` or `new Date(string)` anywhere in
`datetime.ts`.** Parse with explicit regexes and validate the calendar by hand.

### 7. `.strict()` survives every derivation — this is the PRD §9.1 guarantee

| Derivation | Rejects an unknown `userId` key? |
|---|---|
| `base.strict()` | yes |
| `.partial()` | yes |
| `.extend({...})` | yes |
| `.pick({...})` | yes |
| `.omit({...})` | yes |

Zod issue code for the rejection is `unrecognized_keys`.

### 8. `z.iso.date()` validates the calendar, not just the format

`2026-02-31` and `2026-13-01` are both rejected; `2026-8-7` is rejected (padding required).
`z.iso.time()` accepts `HH:mm`, `HH:mm:ss` and `HH:mm:ss.sss`, and rejects `24:00` and `2:30`. So
the schema layer does calendar validation for free — `datetime.ts` only has to *produce* those
formats.

### 9. TypeScript 7 has a new `--ignoreConfig` flag

Passing files on the command line while a `tsconfig.json` exists is now an error (`TS5112`) unless
you pass `--ignoreConfig`. Relevant only if you typecheck a single file ad hoc; the project builds
are unaffected.

---

## Patterns to Follow

**Module resolution (this bites every task):** `shared` and `api` use `nodenext`, so relative
imports need a `.js` extension in `.ts` source. `client` uses `bundler`, where they must not.

```ts
// shared/src/index.ts — correct
export { HEALTH_PATH, type HealthResponse } from "./health.js";
```

**Cross-workspace imports use the package name, never a relative path:**

```ts
import { HEALTH_PATH } from "@receipt/shared";   // api/src/app.ts:5
```

**`verbatimModuleSyntax: true` is on** — type-only imports must say `type`:

```ts
import { z } from "zod";              // value import: z is used at runtime
import type { Request } from "express";
export { CANONICAL_STATUSES, type ReceiptStatus } from "./receipt.js";
```

**`noUncheckedIndexedAccess: true` is on.** Any array or index access yields `T | undefined`. The
parsing code below does a lot of `parts[0]` / `parts[parts.length - 1]`; each needs a guard or a
destructure with a fallback. **This is the most likely source of typecheck failures in this task.**

**Error convention** (`api/src/middleware/error-handler.ts`): failures return a stable machine
`code`, never prose. `{"error":{"code":"not_found"}}`. The client translates the code.

**Test style** (`api/src/app.test.ts`): explicit imports from `vitest`, no globals, one `describe`
per unit of behaviour.

**Documentation comments** are used sparingly and explain *why*, citing the PRD section:

```ts
/**
 * Errors carry a stable machine `code` rather than prose, so the UI can translate them
 * (PRD §7.13). Never put provider or infrastructure detail in a code.
 */
```

**Anti-patterns to avoid in this task:**

- Any `number` type on a monetary value. Anywhere.
- `parseFloat` / `Number()` on receipt data.
- `Date` objects in the canonical model — receipt dates are local wall-clock dates with no timezone.
- Defaulting a missing field to `""`, `0` or today's date. Missing stays `null` (PRD §7.7).
- Adding fields to the canonical model that PRD §6.4 does not list.
- Any Azure vocabulary in `shared/`.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — dependencies and build wiring

Get `shared` able to hold dependencies, tests and a second module before writing domain code. If the
build wiring is wrong, every later step fails confusingly.

**Tasks:** install `zod` / `big.js` / `@types/big.js` into `shared`; add `shared/tsconfig.test.json`
and exclude tests from the build; register the `shared` Vitest project; prove a trivial test runs.

### Phase 2: Core Implementation — money and datetime primitives

The lowest layer, depended on by the schemas. Pure functions, no Zod, fully unit-tested. Written
first because the schema layer validates the formats these produce.

### Phase 3: The canonical model and DTOs

Zod schemas for the receipt, the warning taxonomy, and the PRD §10 DTOs derived from them.

### Phase 4: Integration

Prove the contract is real on both sides of the wire: the API types its error response against the
shared DTO, and the client's locale files gain a translated message for every warning code with a
test enforcing it.

### Phase 5: Testing, documentation & validation

Full `/validate` sweep, README updates, and hand-extension of `validate.md`.

---

## STEP-BY-STEP TASKS

Execute in order, top to bottom. Run each task's `VALIDATE` command before moving on.

---

### 1. UPDATE `shared/package.json` — add the runtime dependencies

- **IMPLEMENT**: Install Zod and big.js as dependencies **of the `shared` workspace**, not the root.
  ```
  npm install zod@4.4.3 big.js@7.0.1 --workspace @receipt/shared
  npm install --save-dev @types/big.js@7.0.0 --workspace @receipt/shared
  ```
- **PATTERN**: `client/package.json` and `api/package.json` already hold their own dependencies;
  only tooling lives at the root.
- **GOTCHA**: `big.js` ships **no** bundled types (`types` field absent from its `package.json`), so
  `@types/big.js` is mandatory. `zod` ships its own.
- **GOTCHA**: these become transitive dependencies of the **browser bundle**, since `client` imports
  `@receipt/shared`. Expect `npm run build` to report a larger JS chunk than Task 01's 286 kB. That
  is expected, not a regression — record the new number in the history file.
- **VALIDATE**: `npm install; npx tsc --build shared --force`

### 2. VERIFY the toolchain accepts Zod before writing anything real

- **IMPLEMENT**: Temporarily add to `shared/src/index.ts`:
  ```ts
  import { z } from "zod";
  export const __probe = z.object({ a: z.string() }).strict();
  ```
  Build, confirm exit 0, then delete it.
- **GOTCHA**: This was verified during planning and passed. Do it anyway — it takes ten seconds, and
  if it fails, **stop and report** rather than working around it. A failure here means the Zod
  decision in ROADMAP §2 needs revisiting, which is a decision for the user, not for you.
- **VALIDATE**: `npx tsc --build shared --force` exits 0.

### 3. CREATE `shared/tsconfig.test.json` and UPDATE `shared/tsconfig.json`

- **IMPLEMENT**: Mirror `api/tsconfig.test.json` exactly, but with `"types": []` to match
  `shared/tsconfig.json`, and no `references` (shared depends on nothing):
  ```json
  {
    "extends": "../tsconfig.base.json",
    "compilerOptions": {
      "module": "nodenext",
      "moduleResolution": "nodenext",
      "types": [],
      "noEmit": true,
      "declaration": false,
      "composite": false
    },
    "include": ["src/**/*"]
  }
  ```
  Then add `"exclude": ["src/**/*.test.ts"]` to `shared/tsconfig.json`.
- **PATTERN**: `api/tsconfig.json:11` + `api/tsconfig.test.json` — the identical problem was solved
  there in Task 01 (see history file, "Deviations").
- **GOTCHA**: Without the `exclude`, your test files land in `shared/dist/` and ship inside the
  published package surface. Verify `shared/dist/` contains no `*.test.js` after building.
- **VALIDATE**: `npx tsc --build shared --force; ls shared/dist` shows no `*.test.*`

### 4. UPDATE root `tsconfig.json` — reference the new test project

- **IMPLEMENT**: Add `{ "path": "./shared/tsconfig.test.json" }` to `references`, immediately after
  `./shared`.
- **GOTCHA**: A project config not listed here is **never typechecked** by `npm run typecheck`, so
  broken test files pass CI silently.
- **VALIDATE**: `npm run typecheck` exits 0.

### 5. CREATE `shared/vitest.config.ts` and UPDATE root `vitest.config.ts`

- **IMPLEMENT**:
  ```ts
  import { defineConfig } from "vitest/config";

  export default defineConfig({
    test: {
      name: "shared",
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  });
  ```
  and change the root to `projects: ["shared", "api", "client"]`.
- **PATTERN**: `api/vitest.config.ts` verbatim, minus the `env` block (no config module to silence).
- **GOTCHA**: **Task 01 shipped a bug here.** A stale `name` made `--project <name>` fail while
  `npm test` stayed green, because `npm test` runs every project regardless of name. Explicitly run
  `npx vitest run --project shared` and confirm it selects tests.
- **VALIDATE**: add a throwaway `shared/src/smoke.test.ts` with one passing assertion, then
  `npx vitest run --project shared` — confirm it runs, then delete the file.

---

### 6. CREATE `shared/src/money.ts`

- **IMPLEMENT**: The decimal-safe money layer. Canonical representation is a **plain decimal
  string** matching `/^-?\d+(\.\d+)?$/` — no grouping separators, no currency, no exponent, `.` as
  the decimal point, **trailing zeros preserved** as parsed.

  Public surface (keep it to exactly this — no speculative extras):

  ```ts
  export const AMOUNT_PATTERN: RegExp;                       // /^-?\d+(\.\d+)?$/
  export function isAmount(value: unknown): value is string;
  export function parseAmount(raw: string | null | undefined): string | null;
  export function addAmounts(a: string, b: string): string;
  export function compareAmounts(a: string, b: string): -1 | 0 | 1;
  export function amountsEqual(a: string, b: string): boolean;
  export function formatAmount(
    amount: string | null,
    options: { locale: string; currency?: string | null },
  ): string | null;
  ```

  Set `Big.strict = true` once at module scope, with a comment explaining that it makes roadmap rule
  9 a runtime guarantee.

  `parseAmount` is the only complex function. This algorithm was **prototyped and passed all 27
  cases** during planning — implement it as described:

  1. Strip currency tokens (`€ $ £` and `EUR|HRK|USD|GBP`, case-insensitive) **before** collapsing
     whitespace. *(Order matters: `"1234.56 EUR"` collapses to `"1234.56EUR"`, where `\bEUR\b` no
     longer matches because `6` and `E` are both word characters. This was a real failure in the
     prototype.)*
  2. Collapse all whitespace, including U+00A0 and U+202F, which appear in `Intl` output and in OCR
     text.
  3. Detect and strip a negative sign in leading (`-12,50`), trailing (`12,50-`) or parenthesised
     (`(12,50)`) form. Reject anything not then matching `^[\d.,]+$` — this also rejects `1e5`.
  4. Decide which separator is the decimal point:
     - **Both `.` and `,` present** → the **last** one is the decimal point, the other is grouping.
     - **One separator, appearing more than once** → it is grouping (`1.234.567`). Every group after
       the first must be exactly 3 digits, else `null`.
     - **One separator appearing once, with exactly 3 digits after it, and 1–3 digits before it** →
       **ambiguous** (`1.234` / `1,234`). Treat it as **grouping**, because money with three decimal
       places is far rarer on a receipt than a thousands group. **Document this rule in a comment
       and in the README** — it is a deliberate, lossy judgement call.
     - **Otherwise** → decimal point.
  5. Build the result string by concatenation — **not** via `Big#toString()`, which would drop
     trailing zeros. Use `new Big(normalized)` inside a `try/catch` purely to validate, then return
     the string you built.
  6. Return `null` for `null`, `undefined`, `""` and anything unparseable. **Never throw.**

  `formatAmount` delegates entirely to `Intl.NumberFormat`, passing the **string**:
  ```ts
  new Intl.NumberFormat(locale, currency ? { style: "currency", currency } : {}).format(amount)
  ```
  Return `null` when `amount` is `null`, so the caller decides what an empty field looks like.

- **IMPORTS**: `import Big from "big.js";`
- **GOTCHA**: `noUncheckedIndexedAccess` makes `parts[0]` and `parts[parts.length - 1]` typed
  `string | undefined`. Guard them; do not use `!`.
- **GOTCHA**: `addAmounts` and `compareAmounts` take **validated** amount strings. Passing raw OCR
  text will throw from `Big`. Callers parse first. State this in the doc comment.
- **VALIDATE**: `npx tsc --build shared --force`

### 7. CREATE `shared/src/money.test.ts`

- **IMPLEMENT**: Cover, at minimum, every case the roadmap definition of done names, plus the traps
  found during planning:

  | Input | Expected | Why it is in the list |
  |---|---|---|
  | `"1.234,56"` | `"1234.56"` | Croatian format — roadmap DoD |
  | `"1,234.56"` | `"1234.56"` | English format — roadmap DoD |
  | `"100"` | `"100"` | No separator — roadmap DoD |
  | `""` | `null` | Roadmap DoD |
  | `null` | `null` | Roadmap DoD |
  | `"9007199254740993.01"` | unchanged | Exceeds float precision — roadmap DoD |
  | `"100,50"` | `"100.50"` | **Trailing zero preserved** |
  | `"0,00"` | `"0.00"` | Trailing zeros preserved |
  | `"1 234,56"` / `"1 234,56"` | `"1234.56"` | NBSP from OCR and from `Intl` |
  | `"12,50 €"`, `"€ 1.234,56"`, `"1234.56 EUR"` | parsed | Currency stripping, incl. the `\b` trap |
  | `"1.234.567,89"`, `"1,234,567.89"` | `"1234567.89"` | Multiple groups |
  | `"1.234"`, `"1,234"` | `"1234"` | The documented ambiguity rule |
  | `"1,5"`, `"1.5"` | `"1.5"` | One separator, not 3 trailing digits |
  | `"-12,50"`, `"12,50-"`, `"(12,50)"` | `"-12.50"` | Negative forms |
  | `"abc"`, `"1.2.3"`, `"1,23,45"`, `"1e5"` | `null` | Malformed |

  Then: `addAmounts("0.1","0.2") === "0.3"` (the float trap), `addAmounts("80.65","20.16")` equals
  `"100.81"` exactly, `amountsEqual("100.50","100.5") === true` (numeric equality despite differing
  scale), `compareAmounts` ordering, and `formatAmount("1234.56",{locale:"hr-HR",currency:"EUR"})`.

- **GOTCHA**: The `hr-HR` currency assertion must use ` ` before `€`, not a normal space.
- **GOTCHA**: Node must have full ICU for `hr-HR` formatting. Node 24 official builds do. If a
  formatted string comes back with `HRK`-style fallbacks or Latin-1 separators, check
  `process.versions.icu` before assuming the code is wrong.
- **VALIDATE**: `npx vitest run --project shared`

### 8. CREATE `shared/src/datetime.ts`

- **IMPLEMENT**:
  ```ts
  export const ISO_DATE_PATTERN: RegExp;   // ^\d{4}-\d{2}-\d{2}$
  export const ISO_TIME_PATTERN: RegExp;   // ^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$
  export function parseIssueDate(raw: string | null | undefined): string | null;
  export function parseIssueTime(raw: string | null | undefined): string | null;
  ```

  `parseIssueDate` — prototyped and passing all 12 planning cases:
  1. Strip whitespace and one optional trailing `.` (Croatian dates are written `17.08.2026.`).
  2. Match `^(\d{4})-(\d{1,2})-(\d{1,2})$` → `y,m,d`; else match
     `^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$` → `d,m,y` (**day first** — Croatian and European
     convention); else `null`.
  3. Expand a 2-digit year: `< 70` → `20xx`, else `19xx`.
  4. Validate the calendar by hand, including leap years (`29.02.2024` valid, `29.02.2026` not).
  5. Return zero-padded `yyyy-mm-dd`.

  `parseIssueTime` — strip whitespace, accept `H:mm`, `HH:mm`, `HH:mm:ss` (and `.` or `,` as the
  H/M separator, which OCR sometimes produces), zero-pad the hour, and **preserve the precision
  present in the source**: emit `HH:mm` when no seconds were given.

- **GOTCHA**: **Emitting `HH:mm:ss` when the receipt showed `14:30` invents data** and violates PRD
  §7.7. Do not pad seconds.
- **GOTCHA**: **Never use `Date.parse` or `new Date(string)`.** Verified during planning:
  `"17.08.2026."` returns `NaN`, and `"08/17/2026"` returns a date one day earlier because of the
  local timezone offset. A receipt date is a local wall-clock date with no timezone.
- **GOTCHA**: `noUncheckedIndexedAccess` affects the regex match destructuring and any lookup table
  of days-per-month.
- **VALIDATE**: `npx tsc --build shared --force`

### 9. CREATE `shared/src/datetime.test.ts`

- **IMPLEMENT**: `"17.08.2026."` → `"2026-08-17"`; `"17. 8. 2026."` → same; `"2026-08-17"`
  unchanged; `"17/08/2026"` → same; `"1.1.2026"` → `"2026-01-01"`; `"17.8.26"` → `"2026-08-17"`;
  `"31.02.2026"` → `null`; `"29.02.2024"` → `"2024-02-29"`; `"29.02.2026"` → `null`; `""`, `null`,
  `"nope"` → `null`. Times: `"14:30"` → `"14:30"` (**not** `"14:30:00"`), `"9:05"` → `"09:05"`,
  `"14:30:05"` unchanged, `"24:00"` → `null`.
- **IMPLEMENT**: One test asserting the output of `parseIssueDate`/`parseIssueTime` is accepted by
  `z.iso.date()` / `z.iso.time()` — that is the seam where the two layers must agree.
- **VALIDATE**: `npx vitest run --project shared`

---

### 10. CREATE `shared/src/warnings.ts`

- **IMPLEMENT**: The warning **taxonomy only**. No rules — those are Task 08.
  ```ts
  export const WARNING_CODES = [
    "missing_critical_field",
    "unparseable_date",
    "unparseable_amount",
    "vat_arithmetic_mismatch",
    "qr_total_mismatch",
    "qr_datetime_mismatch",
    "document_quality",
  ] as const;

  export const warningCodeSchema = z.enum(WARNING_CODES);
  export type WarningCode = z.infer<typeof warningCodeSchema>;

  export const receiptWarningSchema = z.object({
    code: warningCodeSchema,
    field: z.string().nullable().optional(),   // dotted path, e.g. "total", "vatBreakdown.0.vatAmount"
  }).strict();
  export type ReceiptWarning = z.infer<typeof receiptWarningSchema>;
  ```
- **PATTERN**: These seven codes are taken **directly** from the ROADMAP Task 08 rule list — they
  are derived, not invented. Do not add an eighth speculatively.
- **GOTCHA**: A warning carries no severity, no human message and no computed values. Messages live
  in the client locale files (see the decision note at the end of this plan); severity is not in the
  PRD; per-warning detail values are Task 08's problem if it turns out to need them.
- **VALIDATE**: `npx tsc --build shared --force`

### 11. CREATE `shared/src/receipt.ts`

- **IMPLEMENT**: The canonical model, in **two tiers**.

  ```ts
  export const RECEIPT_STATUSES = ["processing", "review", "confirmed", "failed"] as const;
  export const receiptStatusSchema = z.enum(RECEIPT_STATUSES);
  export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

  const amountSchema = z.string().regex(AMOUNT_PATTERN);

  export const vatBreakdownSchema = z.object({
    rate: amountSchema.nullable().optional(),
    taxableBase: amountSchema.nullable().optional(),
    vatAmount: amountSchema.nullable().optional(),
  }).strict();

  export const receiptItemSchema = z.object({
    description: z.string().nullable().optional(),
    quantity: amountSchema.nullable().optional(),
    unitPrice: amountSchema.nullable().optional(),
    total: amountSchema.nullable().optional(),
  }).strict();

  /** Tier 1 — everything the user may edit in the review form. */
  export const canonicalReceiptFieldsSchema = z.object({
    sellerName / sellerAddress / sellerOib,
    buyerName / buyerAddress / buyerOib,
    documentNumber,
    issueDate: z.iso.date().nullable().optional(),
    issueTime: z.iso.time().nullable().optional(),
    subtotal / total: amountSchema.nullable().optional(),
    vatBreakdown: z.array(vatBreakdownSchema).nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
    paymentMethod, jir, zki: z.string().nullable().optional(),
    items: z.array(receiptItemSchema).nullable().optional(),
  }).strict();

  /** Tier 2 — tier 1 plus the fields only the server may set. */
  export const canonicalReceiptSchema = canonicalReceiptFieldsSchema.extend({
    id: z.string(),
    userId: z.string(),
    status: receiptStatusSchema,
    warnings: z.array(receiptWarningSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    confirmedAt: z.iso.datetime().nullable().optional(),
    deletedAt: z.iso.datetime().nullable().optional(),
  });
  ```
- **PATTERN**: Field names and optionality come from **PRD §6.4 verbatim**. Cross-check every field
  against PRD Appendix A before finishing. `warnings` and `status` are required; every data field is
  optional-and-nullable.
- **GOTCHA**: The two-tier split is the whole point — it is what makes the PATCH DTO structurally
  unable to accept `userId`. Do not flatten it into one schema.
- **GOTCHA**: `id`/`userId` are `z.string()`, **not** `z.uuid()`. PRD §10 examples show `"rec_123"`,
  and Task 03 has not yet chosen a key format. Tightening this is Task 03's call.
- **GOTCHA**: `currency` is `.length(3)` (ISO 4217) but **not** an enum of known currencies —
  PRD Appendix A says "leave unknown when not confidently determined", and an enum would force the
  mapper to invent or drop a value.
- **VALIDATE**: `npx tsc --build shared --force`

### 12. CREATE `shared/src/receipt.test.ts`

- **IMPLEMENT**:
  - Accepts a receipt with **every optional field `null`** (roadmap DoD).
  - Accepts a receipt with every optional field **absent** (roadmap DoD's sibling case).
  - **Rejects an unknown status** (roadmap DoD) — e.g. `"pending"`.
  - Rejects `total: "1.234,56"` — canonical money is already normalized; the raw locale form must
    not reach the model.
  - Rejects `issueDate: "17.08.2026"` and `issueDate: "2026-02-31"`.
  - Rejects an unknown top-level key with issue code `unrecognized_keys`.
  - Accepts a `vatBreakdown` array and a nested `items` array.
  - **A guard test asserting no Azure vocabulary appears in the built model**: read
    `shared/src/*.ts` and assert none of `/azure|prebuilt|documentintelligence|analyzeresult|
    boundingRegion|polygon/i` matches (roadmap DoD, "No Azure-specific name appears anywhere in
    `shared`"). Keep the word list short and obvious.
- **VALIDATE**: `npx vitest run --project shared`

### 13. CREATE `shared/src/api.ts`

- **IMPLEMENT**: DTOs for PRD §10, **derived** from `receipt.ts`, never redeclared.

  ```ts
  /** The API's universal failure body. Mirrors api/src/middleware/error-handler.ts. */
  export const apiErrorResponseSchema = z.object({
    error: z.object({ code: z.string() }).strict(),
  }).strict();
  export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

  // §10.1 POST /api/receipts
  export const createReceiptResponseSchema = canonicalReceiptSchema.pick({
    id: true, status: true, createdAt: true,
  });

  // §10.2 GET /api/receipts
  export const listReceiptsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: receiptStatusSchema.optional(),
  }).strict();
  export const listReceiptsResponseSchema = z.object({
    items: z.array(canonicalReceiptSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  }).strict();

  // §10.4 PATCH /api/receipts/:id — the security-critical one
  export const updateReceiptRequestSchema = canonicalReceiptFieldsSchema.partial();

  // §10.5 POST /api/receipts/:id/confirm
  export const confirmReceiptResponseSchema = canonicalReceiptSchema.pick({
    id: true, status: true, confirmedAt: true,
  });

  // §10.9 GET /api/receipts/export
  export const EXPORT_FORMATS = ["csv", "json"] as const;
  export const exportFormatSchema = z.enum(EXPORT_FORMATS);
  ```
  Export an inferred `type` alongside every schema.
- **GOTCHA**: `page`/`limit` are **counts, not money** — `z.coerce.number()` is correct there and
  nowhere else in this codebase.
- **GOTCHA**: Do **not** add a source-document access shape for §10.3 or a `schemaVersion` for
  §10.9's JSON body. Those are Task 05's and Task 11's decisions; inventing them now is speculative
  scaffolding (CLAUDE.md §2). `GET /api/receipts/:id` returns `canonicalReceiptSchema`; Task 05
  extends it.
- **GOTCHA**: `GET /api/receipts/:id` for a `processing` receipt may legitimately have most fields
  null — that is already allowed by the schema, so no separate DTO is needed.
- **VALIDATE**: `npx tsc --build shared --force`

### 14. CREATE `shared/src/api.test.ts`

- **IMPLEMENT**:
  - **`updateReceiptRequestSchema` rejects `{ total: "10.00", userId: "attacker" }`** with issue
    code `unrecognized_keys`. This is the test that proves PRD §9.1 structurally, and Task 04's
    definition of done depends on it.
  - `updateReceiptRequestSchema` also rejects `id`, `status`, `warnings` and `createdAt`.
  - `updateReceiptRequestSchema` accepts `{}` (an empty PATCH) and a single-field PATCH.
  - `listReceiptsQuerySchema` applies its defaults, coerces `"2"` → `2`, and rejects `limit=0`,
    `limit=101` and an unknown status.
  - `createReceiptResponseSchema` accepts exactly `{ id, status, createdAt }` and rejects extra keys.
- **VALIDATE**: `npx vitest run --project shared`

### 15. UPDATE `shared/src/index.ts` — re-export everything

- **IMPLEMENT**: Add re-exports for `money.js`, `datetime.js`, `warnings.js`, `receipt.js`,
  `api.js`, keeping the existing `health.js` line first.
- **PATTERN**: `export { X, type Y } from "./mod.js";` — note `type` on type-only names
  (`verbatimModuleSyntax`), and the `.js` extension.
- **GOTCHA**: Do not use `export * from` — the explicit form is what the existing line does, and it
  keeps the public surface reviewable.
- **VALIDATE**: `npm run typecheck`

---

### 16. UPDATE `api/src/middleware/error-handler.ts` — type the response against the shared DTO

- **IMPLEMENT**: Import `type ApiErrorResponse` from `@receipt/shared` and annotate the body:
  ```ts
  const body: ApiErrorResponse = { error: { code } };
  res.status(status).json(body);
  ```
- **PATTERN**: `api/src/app.ts:5` — the same "import the contract from `shared`" move that
  `HEALTH_PATH` makes.
- **GOTCHA**: This is the only change permitted in `api/` in this task. Do not touch routing,
  logging, or the `HttpError` class. Every other line must trace to the task (CLAUDE.md §3).
- **VALIDATE**: `npm run typecheck; npx vitest run --project api` — `app.test.ts:20` already asserts
  the exact body shape, so it must still pass.

### 17. UPDATE `client/src/i18n/locales/en.json` and `hr.json` — warning messages

- **IMPLEMENT**: Add a `warnings` block with one plain-language message per code in `WARNING_CODES`,
  to **both** files. Suggested English copy (rewrite if you can do better; keep it non-technical and
  non-blaming, per PRD §11.5):
  | Key | en |
  |---|---|
  | `warnings.missing_critical_field` | This field is empty. Check the receipt and fill it in. |
  | `warnings.unparseable_date` | This date could not be read. Check it against the receipt. |
  | `warnings.unparseable_amount` | This amount could not be read. Check it against the receipt. |
  | `warnings.vat_arithmetic_mismatch` | The VAT amounts do not add up to the total. |
  | `warnings.qr_total_mismatch` | The total differs from the amount in the receipt's QR code. |
  | `warnings.qr_datetime_mismatch` | The date or time differs from the receipt's QR code. |
  | `warnings.document_quality` | The image is hard to read. Check the values carefully. |
- **GOTCHA**: No Azure or OCR jargon in user-facing copy (PRD §7.6, §11.5) — say "could not be read",
  not "extraction failed".
- **GOTCHA**: The two files must end up with **identical key sets**, or `i18n.test.ts` fails. That
  test is load-bearing — translate the missing key, never delete it from the other file.
- **VALIDATE**: `npx vitest run --project client`

### 18. CREATE `client/src/i18n/warnings.test.ts`

- **IMPLEMENT**: Assert that for **every** code in `WARNING_CODES` imported from `@receipt/shared`,
  both `en.json` and `hr.json` contain a non-empty `warnings.<code>`, and that neither file contains
  a `warnings.*` key that is not a known code.
- **PATTERN**: `client/src/i18n/i18n.test.ts` — same import style and `describe`/`it` shape.
- **GOTCHA**: `/validate` Phase 6.5 only scans **literal** `t("…")` calls. Task 09 will render these
  messages as `` t(`warnings.${code}`) ``, which that check cannot see. **This test is the only
  thing standing between a new warning code and a raw key rendered to a user.** Say so in a comment.
- **GOTCHA**: This test is also the proof that the canonical model is importable from `client`,
  which is half of the roadmap's "importable from both `client` and `api`" definition of done. The
  other half is Task 16.
- **VALIDATE**: `npx vitest run --project client`

---

### 19. UPDATE `README.md`

- **IMPLEMENT**: Add a **"Domain model"** section documenting, for a future reader:
  - the canonical money representation and the `parseAmount` ambiguity rule for `1.234` / `1,234`;
  - that money is never a `number`, and that `Big.strict` enforces it;
  - the canonical date (`yyyy-mm-dd`) and time (`HH:mm[:ss]`, seconds only when the source had them);
  - the two-tier schema split and why the PATCH DTO cannot accept `userId`;
  - the warning taxonomy, and that messages live in the client locale files.

  Update the **"Workspace layout"** description of `shared/` (it currently says the canonical model
  "lands there in Task 02" — that is now done). Add `npx vitest run --project shared` next to the
  existing per-workspace commands. Add the `decimal.js`/TypeScript 7 trap to **"Toolchain notes"**,
  beside the ESLint note — a future session will otherwise "fix" `big.js` back to `decimal.js`.
- **GOTCHA**: `/validate` Phase 6.6 mechanically verifies that every `` `path.ts` `` in the README
  exists, every `npm run x` is a real script, every script is documented, and the Configuration
  table matches `.env.example` exactly. **This task adds no environment variables**, so leave the
  Configuration table alone.
- **VALIDATE**: the Phase 6.6 node one-liner from `.claude/commands/validate.md`.

### 20. UPDATE `.claude/commands/validate.md`

- **IMPLEMENT**: Per its own "Maintaining this file" section — **hand-extend, never regenerate**:
  - Add Phase 4 table rows for `shared/src/money.test.ts`, `datetime.test.ts`, `receipt.test.ts`,
    `api.test.ts` and `client/src/i18n/warnings.test.ts`, each stating what it protects.
  - Note in Phase 4 that Vitest now runs **three** projects, and add
    `npx vitest run --project shared` to the per-workspace commands in 6.6.
  - Add a Phase 6 check **6.8 — money is never a JS number in the shared model**: grep
    `shared/src/*.ts` for `parseFloat|Number(|: number` on the money path and for `z.number()`
    outside `api.ts`'s paging fields. Keep it a simple, honest check; note its limits.
  - Phase 7 gains **nothing** — this task ships no user-facing flow. Do not invent a journey. Leave
    Phase 8 untouched.
- **GOTCHA**: Do **not** run `/ultimate_validate_command`. Its template has five phases and would
  delete Phase 0, Phase 6, the port hygiene in Phase 7 and all of Phase 8 — roughly 140 lines earned
  from real Task 01 incidents. The file says this explicitly, and Task 02 is named there as a task
  that gains nothing from the generator.
- **VALIDATE**: read the file back and confirm no existing phase was lost.

### 21. RUN the full `/validate` sweep

- **IMPLEMENT**: Run every phase in `.claude/commands/validate.md` in order, from the repository
  root. Do not skip a phase because an earlier one passed.
- **GOTCHA**: Phase 7 needs live servers. **Before starting them, run the port-cleanup command in
  Phase 7.1 and confirm Vite reports 5173.** Task 01 had twelve orphaned dev processes at one point,
  and a stale Vite answering on 5173 made a check pass against old code.
- **GOTCHA**: Phase 5's bundle size will have grown because Zod and big.js are now in the client
  bundle. That is expected. Record the new number.
- **VALIDATE**: every phase green; paste real output for anything that fails.

### 22. WRITE `.agents/history/02-canonical-domain-model-shared-contracts.md`

- **IMPLEMENT**: Follow the template in ROADMAP §1. It **must** record:
  - the money decision (`big.js` + `Intl`, not `decimal.js`, not hand-rolled) and its evidence —
    this closes a deferred decision in ROADMAP §2;
  - the `decimal.js` TypeScript 7 default-import failure, so nobody re-tries it;
  - the `Big#toString()` trailing-zero trap;
  - the decision to put warning **messages** in the client locale files rather than in `shared`,
    with the reasoning (see the note below) — this is a documented deviation from the Task 02 scope
    text in ROADMAP §4;
  - the `1.234` / `1,234` ambiguity rule as a known, deliberate limitation;
  - the new client bundle size.
- **VALIDATE**: the file exists and every section of the template is filled.

### 23. UPDATE `.agents/ROADMAP.md`

- **IMPLEMENT**: Flip Task 02 to ✅ with links to the plan and history files; update the status line
  at the top; and in the "Deliberately deferred decisions" list, mark the decimal-library question
  resolved with a pointer to the history file.
- **VALIDATE**: `git diff .agents/ROADMAP.md` shows only those edits.

### 24. COMMIT

- **IMPLEMENT**: `/commit` — one commit for the whole task, per ROADMAP §1 step 9.
- **VALIDATE**: `git status` clean; `git show --stat` lists only files this plan names.

---

## TESTING STRATEGY

Vitest across three projects (`shared`, `api`, `client`), explicit imports, no globals.

### Unit Tests

Everything in this task is a pure function or a schema, so unit tests are the whole strategy. Target
**100 % of the exported surface of `shared/`** — there is no I/O to make that expensive, and this
code is the foundation eleven later tasks build on.

- `money.test.ts` — the table in Task 7. Use `it.each` for the parse table; it keeps the failure
  message readable when one row breaks.
- `datetime.test.ts` — the table in Task 9, plus the cross-check that output satisfies `z.iso.date`.
- `receipt.test.ts` — accepts all-null, accepts all-absent, rejects unknown status, rejects unknown
  keys, rejects unnormalized money and dates, plus the no-Azure-vocabulary guard.
- `api.test.ts` — DTO derivation, defaults, coercion bounds, and the forged-`userId` rejection.
- `client/src/i18n/warnings.test.ts` — warning-code ↔ locale-key parity in both languages.

### Integration Tests

There is no I/O in this task, so "integration" means **the contract crossing a workspace boundary**:

- `api` compiles against `ApiErrorResponse`, and the existing `api/src/app.test.ts` still asserts the
  literal `{ error: { code: "not_found" } }` body at runtime.
- `client` imports `WARNING_CODES` from `@receipt/shared` in a test that actually runs under jsdom,
  proving `shared/dist` resolves through Vite's `bundler` resolution as well as Node's `nodenext`.

Together these are the roadmap's "importable from both `client` and `api`" definition of done.

### Edge Cases

Explicitly required:

- Money that loses precision as a float: `9007199254740993.01`, `0.1 + 0.2`.
- Money whose scale must survive: `100.50`, `0.00`.
- Both locale groupings, and the genuinely ambiguous `1.234` / `1,234`.
- NBSP (U+00A0) and narrow NBSP (U+202F) inside numbers.
- Negative money in three notations.
- `null`, `undefined`, `""` and pure garbage into every parser — **must return `null`, never throw**.
- Leap-year boundaries: `29.02.2024` valid, `29.02.2026` invalid.
- 2-digit years across the 70 pivot.
- A time with no seconds — must **not** gain `:00`.
- A receipt object with every optional field absent, and one with every optional field `null`.
- A PATCH body carrying `userId`, `id`, `status` or `createdAt`.

---

## VALIDATION COMMANDS

Run from `prototypes/receipt-ocr/`. PowerShell 5.1 does not support `&&` — chain with `;`.

### Level 1: Syntax & Style

```
npm run lint
npm run format:check
```

### Level 2: Type checking (the authoritative gate — oxlint has no type-aware rules)

```
npm run typecheck
```

Exit code 0, no output. If it looks stale: `npx tsc --build --force`. Never pipe it through
`Select-Object`/`head` — that masks the exit code, and `tsc --build` signals failure with code 2.

### Level 3: Unit Tests

```
npm test
npx vitest run --project shared
npx vitest run --project api
npx vitest run --project client
```

The three per-project runs are not redundant with `npm test`: `npm test` runs every project
regardless of its configured `name`, so it cannot catch the stale-project-name bug Task 01 hit.

### Level 4: Build & manual validation

```
npm run build
```

Then confirm by inspection:

- `shared/dist/` contains `money.js`, `datetime.js`, `warnings.js`, `receipt.js`, `api.js` and their
  `.d.ts` files, and **no `*.test.*`**.
- `client/dist/assets/` — record the new JS chunk size for the history file.

Sanity-check the contract in a REPL against the **built** package, not the source:

```
node -e "const s=require('./shared/dist/index.js');" 2>/dev/null || node --input-type=module -e "import('@receipt/shared').then(m=>{console.log(m.parseAmount('1.234,56'), m.parseAmount('1,234.56'), m.parseAmount('100'), m.parseAmount(''));})"
```

Expected: `1234.56 1234.56 100 null`.

### Level 5: Full sweep

```
/validate
```

Every phase, in order, including the Phase 7.1 port hygiene before any live check.

---

## ACCEPTANCE CRITERIA

Roadmap Task 02 definition of done:

- [ ] `shared` builds and the canonical model is importable from both `client` and `api`.
- [ ] Money helpers have tests covering `1.234,56`, `1,234.56`, `100`, `""`, `null`, and a value that
      would lose precision as a JS float.
- [ ] The Zod schema rejects an unknown status and accepts a receipt with every optional field null.
- [ ] No Azure-specific name appears anywhere in `shared` — enforced by a test, not by inspection.

Additional criteria for this plan:

- [ ] The deferred "decimal library vs. string helpers" decision is **made and documented** in the
      history file with its evidence.
- [ ] `updateReceiptRequestSchema` rejects a forged `userId`, proven by a test.
- [ ] `100.50` survives parse → store-shaped string → format without becoming `100.5`.
- [ ] No `number` type on any monetary value anywhere in `shared/`.
- [ ] No `Date.parse` or `new Date(string)` in `datetime.ts`.
- [ ] Every warning code has a non-empty `hr` and `en` message, enforced by a test.
- [ ] `npx vitest run --project shared` selects and runs the new tests.
- [ ] `shared/dist/` contains no compiled test files.
- [ ] `validate.md` is hand-extended, with every pre-existing phase intact.
- [ ] All 10 standing rules in ROADMAP §5 hold — in particular rule 9 (money) and rule 8 (no
      hardcoded user-facing strings).

---

## COMPLETION CHECKLIST

- [ ] All 24 tasks completed in order
- [ ] Each task's `VALIDATE` command run immediately, not batched to the end
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` all clean
- [ ] `npm test` green across all three projects, and each `--project` run selects tests
- [ ] `npm run build` succeeds; `shared/dist` free of test files
- [ ] Full `/validate` sweep green, with port hygiene observed before Phase 7
- [ ] README documents the money, date and schema contracts
- [ ] `validate.md` extended by hand; no phase lost
- [ ] History file written, including the money decision and its evidence
- [ ] ROADMAP Task 02 flipped to ✅ and the deferred decision marked resolved
- [ ] One commit, containing only files this plan names

---

## NOTES

### Decision: `big.js`, not `decimal.js`, not hand-rolled

The roadmap left this open. The evidence is in "Verified findings" 2–4. Summary: `decimal.js` is
unusable with a default import under TypeScript 7 and is 87× larger installed; hand-rolling exact
decimal addition is more code than it looks once VAT arithmetic (Task 08) needs it, and would be
novel code on the one code path where a bug corrupts financial data.

The chosen split is deliberate: **`big.js` for arithmetic, hand-written code for parsing, `Intl` for
formatting.** No library parses "the number format a Croatian receipt happens to use", and `Intl`
already formats arbitrary-precision strings correctly, so writing either of those by hand or
reaching for another dependency would be wasted effort.

### Decision: warning **messages** live in the client locale files, not in `shared`

ROADMAP §4 Task 02 says the warning enum ships "plus `hr`/`en` message resources", which reads as
though the messages belong in `shared`. This plan puts the **codes** in `shared` and the **messages**
in `client/src/i18n/locales/*.json`, because:

1. The client already has exactly one translation system, with keys typed against `en.json`, a
   parity test, and a `/validate` check. A second set of locale resources inside `shared` would be a
   parallel, untested system, and the two would drift.
2. It matches the error convention already established in Task 01 and documented in the README: the
   API emits a stable machine `code`, the client owns the human copy. A warning is the same shape of
   thing as an error code.
3. Nothing on the server ever renders a warning message. Shipping Croatian prose into the API bundle
   would be dead weight.

This is a deviation from the literal scope text and **must be recorded in the history file** per
ROADMAP §2. If the user disagrees, moving the messages later is cheap — the codes do not change.

### Known limitation to carry forward: the `1.234` ambiguity

`"1.234"` and `"1,234"` are genuinely ambiguous — 1234, or 1.234? This plan resolves both to
**1234**, on the reasoning that a thousands group is far more common on a receipt than a
three-decimal price. It is still a lossy guess, and it will occasionally be wrong (a quantity in
kilograms is the realistic case). Record it as a known limitation; Task 08 may choose to raise a
warning when a parsed amount came from the ambiguous branch, and Task 12's evaluation should watch
for it in real receipts.

### Scope discipline

Things that will be tempting and are **out of scope for this task**:

- Warning **rules** — Task 08. This task ships codes and a type, nothing that decides when a warning
  applies.
- A `source` / signed-URL shape on the get-receipt DTO — Task 05.
- `schemaVersion` and the export column list — Task 11.
- Postgres column mappings or a repository interface — Task 03.
- OIB checksum validation — PRD §13 "Future considerations", explicitly not the PoC.
- A `severity` field on warnings, "info/warn/error" levels, or i18n interpolation parameters —
  nothing in the PRD asks for them.
- React Hook Form resolvers — Task 09.

### Confidence

**8.5 / 10** for one-pass success. The two historically risky unknowns (Zod under TypeScript 7, and
the money library) were resolved empirically during planning rather than left to the implementer,
and both parsing algorithms were prototyped against their full test tables and pass. The residual
risk is mechanical: `noUncheckedIndexedAccess` friction in the parsers, and the build-wiring steps
(Tasks 3–5), where a missed `references` entry or a stale Vitest project name fails quietly rather
than loudly.
