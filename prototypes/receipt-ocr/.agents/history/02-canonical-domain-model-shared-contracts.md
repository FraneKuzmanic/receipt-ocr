# Task 02 — Canonical domain model & shared contracts

**Date:** 2026-08-17
**Plan:** `.agents/plans/canonical-domain-model-shared-contracts.md`
**Commit:** `387d7c0` — 28 files, 2660 insertions

## What was built

One provider-independent definition of a receipt, in the `shared/` workspace Task 01 created, as Zod
schemas with the TypeScript types inferred from them. Nothing in this task persists, maps from Azure,
or evaluates a warning rule — it defines the vocabulary Tasks 03–11 speak.

Four layers, bottom up:

**Money** is a plain decimal string end to end (`^-?\d+(\.\d+)?$`), never a `number`, with trailing
zeros preserved. `big.js` does arithmetic and comparison, hand-written code does locale parsing, and
`Intl.NumberFormat` does display formatting. `Big.strict = true` is set at module scope, so a JS float
reaching the money path throws rather than quietly losing precision.

**Dates and times** are normalized to `yyyy-mm-dd` and `HH:mm[:ss]` by explicit regex and a hand-rolled
calendar check. A receipt date is a local wall-clock date, so no `Date` object is involved anywhere.

**The canonical model** is split into two tiers: `canonicalReceiptFieldsSchema` (what the user may
edit) and `canonicalReceiptSchema` (that plus the server-owned envelope). Every DTO in `api.ts` is
derived from those rather than redeclared, which is what makes the PATCH body structurally unable to
accept a `userId`.

**Warnings** ship as a taxonomy only — a stable code plus the dotted field path it concerns. The rules
are Task 08's.

The contract is proven on both sides of the wire: `api` now types its error response against the
shared `ApiErrorResponse`, and a client test imports `WARNING_CODES` from `@receipt/shared` and runs
under jsdom, which exercises Vite's `bundler` resolution as well as Node's `nodenext`.

## Files created / modified

**`shared/`** — created: `src/money.ts`, `src/money.test.ts`, `src/datetime.ts`,
`src/datetime.test.ts`, `src/warnings.ts`, `src/receipt.ts`, `src/receipt.test.ts`, `src/api.ts`,
`src/api.test.ts`, `tsconfig.test.json`, `vitest.config.ts`. Modified: `package.json` (zod, big.js,
`@types/big.js`, `@types/node`), `tsconfig.json` (exclude tests from the build), `src/index.ts`
(re-exports).

**`api/`** — modified: `src/middleware/error-handler.ts` (response body typed as `ApiErrorResponse`).
This is the only change made in `api/`.

**`client/`** — created: `src/i18n/warnings.test.ts`. Modified: `src/i18n/locales/en.json` and
`hr.json` (the `warnings.*` block).

**Root** — modified: `tsconfig.json` (reference `shared/tsconfig.test.json`), `vitest.config.ts`
(`projects: ["shared", "api", "client"]`), `README.md`, `.claude/commands/validate.md`,
`package-lock.json`.

## Decisions made

1. **`big.js`, not `decimal.js`, not hand-rolled.** This closes the deferred decision in ROADMAP §2.
   `decimal.js` is unusable under TypeScript 7 with a default import — its type declarations merge a
   class, a namespace and a function under one name and re-export it as `export default`, which
   TypeScript 7 resolves to the non-constructable member (`TS2351`). It is also 5.9 MB installed
   against big.js's 68 KB, and this package is bundled into the browser build. Hand-rolling exact
   decimal addition would be novel code on the one path where a bug corrupts financial data.
   The chosen split is deliberate: **`big.js` for arithmetic, hand-written code for parsing, `Intl`
   for formatting** — no library parses "the format a Croatian receipt happens to use", and `Intl`
   already formats arbitrary-precision strings correctly.
2. **`Big.strict = true`.** Converts ROADMAP standing rule 9 from a convention into a runtime
   guarantee. A test asserts it throws when handed a float.
3. **Money helpers never return `Big#toString()`.** It silently drops trailing zeros —
   `new Big("100.50").toString()` is `"100.5"`, and Task 11's definition of done is literally that
   `100.50` exports as `100.50`. `parseAmount` returns the string it built by concatenation and uses
   `Big` only to validate; `addAmounts` uses `toFixed` at the wider of its two arguments' scales.
4. **Warning *messages* live in the client locale files, not in `shared`.** A deviation from the
   literal Task 02 scope text in ROADMAP §4 — see Deviations below.
5. **The `1.234` / `1,234` ambiguity resolves to `1234`.** One separator with exactly three digits
   after it is genuinely ambiguous. A thousands group is far more common on a receipt than a
   three-decimal price, so both parse as 1234. Deliberate and lossy — see Known gaps.
6. **`id` and `userId` are `z.string()`, not `z.uuid()`.** PRD §10 shows `"rec_123"` and Task 03 has
   not chosen a key format yet. Tightening them is Task 03's call.
7. **`currency` is `.length(3)` but not an enum.** PRD Appendix A says to leave currency unknown when
   it cannot be confidently determined; an enum would force the mapper to invent or drop a value it
   actually read.

## Deviations from the plan

- **Warning messages in the client locale files, not `shared`.** ROADMAP §4 Task 02 says the warning
  enum ships "plus `hr`/`en` message resources", which reads as though the messages belong in
  `shared`. The codes are in `shared`; the messages are in `client/src/i18n/locales/*.json`, because
  the client already has exactly one translation system with typed keys, a parity test and a
  `/validate` check — a second set of resources inside `shared` would be a parallel, untested system,
  and the two would drift. It also matches the error convention established in Task 01: the server
  emits a stable machine code, the client owns the human copy. Nothing on the server ever renders a
  warning message. **Moving them later is cheap; the codes do not change.**
- **`Intl.NumberFormat#format` needed a local type declaration.** The plan's verified finding #4
  established the *runtime* behaviour (a string keeps arbitrary precision) but not the *type*.
  TypeScript's bundled lib still types the parameter as `number` only — confirmed, adding
  `"lib": ["ES2023", "ESNext.Intl"]` does **not** help, and TypeScript 7 embeds its lib files in the
  native binary so they cannot be inspected on disk. Resolved with one narrow local interface in
  `money.ts` rather than widening the project's `lib`; the `lib` experiment was reverted.
- **`shared/tsconfig.test.json` uses `"types": ["node"]`, not `[]` as the plan specified**, and
  `@types/node` was added to `shared`'s dev dependencies. The provider-independence guard in
  `receipt.test.ts` reads `shared/src` from disk, which needs node types. The **build** config still
  uses `"types": []`, so the shipped package stays browser-safe — the split is the point.
- **Two `/validate` checks needed their *input* corrected, not the check.** Phase 6.6 read a
  backticked `.d.ts` in the README as a file path, and Phase 6.5 read a `t("…")` inside a code comment
  as a translation key. Both were reworded. Neither check was weakened — a check that a comment can
  break is still catching the shape of thing it exists to catch.
- **Prettier reformatted four of the new files** on first `format:check`. Expected; `npm run format`
  fixed it.

## Validation results

Full `/validate` sweep, every phase in order.

```
Phase 0  clean install ... 297 packages, 0 vulnerabilities, no ERESOLVE
Phase 1  lint (oxlint) ... PASS
Phase 2  typecheck ....... PASS (exit 0)
Phase 3  format:check .... PASS (after one npm run format)
Phase 4  tests ........... 8 files, 140 tests passed  (was 3 files / 7 tests)
Phase 5  build ........... index.html 0.39 kB · CSS 9.02 kB · JS 360.42 kB (gzip 112.58 kB)
Phase 6  security/docs ... 6.1, 6.1b, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8 all ok
Phase 7  journeys ........ 7.1–7.4 all pass
```

**Client bundle grew 286.45 kB → 360.42 kB (+73.97 kB, +26 %)**, because Zod and big.js are now
transitive dependencies of the browser build via `@receipt/shared`. Expected, not a regression.

`shared/dist/` contains `money`, `datetime`, `warnings`, `receipt`, `api` and `health` as `.js`,
`.d.ts` and `.js.map`, and **no `*.test.*`** — the build exclusion works.

All three Vitest projects select tests by name (`--project shared` / `api` / `client`), so the stale
project-name bug from Task 01 did not recur.

The built package was sanity-checked rather than only the source:

```
parseAmount: 1234.56 1234.56 100 null
parseIssueDate('17.08.2026.'): 2026-08-17
formatAmount('100.50', hr-HR/EUR): "100,50 €"
warning codes: 7
patch rejects a forged userId: true
```

Phase 7 was run against a freshly started stack after the port-cleanup command; Vite reported **5173**
and the API 3001, so nothing was tested against stale code. Ports were confirmed free again
afterwards, with no orphaned `tsx watch` left behind this time.

Phase 7.4 in a real browser at 375×812: translated copy with no raw keys, service shown as available,
HR/EN toggle switches all copy and persists across reload, tap targets 44×44 px, no horizontal
overflow (scrollWidth 375 = innerWidth 375), translated not-found page, and API-offline → retry →
recovery with **zero page errors**.

## Known gaps / follow-ups

- **Pre-existing bug found during Phase 7.4, deliberately not fixed here.** `client/index.html`
  hardcodes `<html lang="hr">` and `<title>Skener računa</title>`, and `document.documentElement.lang`
  is only updated inside the switcher's click handler (`LanguageSwitcher.tsx:9`). So on a fresh load
  in English the document still advertises `lang="hr"` and a Croatian tab title — the page lies to
  screen readers, and the title is a hardcoded user-facing string, which PRD §7.13 forbids. Task 01
  recorded this area as passing because it tested the *click* path, which is exactly the case where
  the hardcoded value happens to be correct. Out of scope for Task 02 (which touches no components);
  it belongs to whichever task next owns the app shell, and is a one-line `useEffect` plus a
  translated title.
- **The Postgres `numeric` round-trip is not yet proven.** The Task 02 definition of done asks that
  money round-trip through `numeric` without loss, but there is no database until Task 03. The string
  representation was chosen for exactly this, and `numeric` preserves scale — but it is untested.
  **Task 03 must assert it**, including that `100.50` comes back as `100.50` and not `100.5`.
- **The `1.234` / `1,234` ambiguity will occasionally be wrong.** A weight in kilograms is the
  realistic case. Task 08 may choose to raise a warning when a parsed amount came from the ambiguous
  branch; Task 12's evaluation should watch for it in real receipts.
- **`parseAmount` preserves leading zeros** (`"007"` parses to `"007"`). Harmless for comparison,
  since `amountsEqual` is numeric, but it will not survive a `numeric` round trip unchanged. Worth a
  glance in Task 03.
- **No DTO yet for the source-document shape (§10.3) or the export body's `schemaVersion` (§10.9).**
  Deliberately deferred to Tasks 05 and 11 rather than invented now. `GET /api/receipts/:id` returns
  `canonicalReceiptSchema`; Task 05 extends it.
- **Zod's `z.iso.datetime()` is used for the envelope timestamps.** Task 03 should confirm what
  Supabase actually returns (offset vs. `Z`) and tighten or loosen accordingly.
