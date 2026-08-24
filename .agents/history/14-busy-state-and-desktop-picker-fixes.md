# Iteration 14 — Busy-state, capture-loading and desktop-picker corrections

**Date:** 2026-08-24
**Plan:** none. The user reviewed iteration 13 against the running app, reported four issues, and
asked for them to be fixed directly rather than through plan → execute → validate.
**Commit:** uncommitted

## Why this iteration exists

Iteration 13 was still uncommitted and under review when the user exercised it and found four
problems. Three are defects in that iteration's own work; the fourth is a question about behaviour
that turned out to be correct but poorly presented.

## What changed

### 1. The busy spinner rendered as a broken placeholder — fixed at its root

**Reported:** the CSV, JSON and delete-confirm buttons each had dead space on the left, and clicking
one put "some kind of broken placeholder" in it rather than a spinner.

Two separate bugs, both real.

**The glyph.** `Spinner`'s indicator is a `<span>` carrying `size-4` and nothing else. A bare
`<span>` is `display: inline`, and **`width`/`height` do not apply to a non-replaced inline box**. It
therefore sized correctly only where its parent happened to be a flex container — which is true of
every earlier call site, and false inside the plain `<span className="size-4">` wrapper the history
buttons used. Measured in Chromium, the old markup rendered **4×25 px** (width collapsed to the two
2 px borders, height inherited from line-height) against the intended 16×16: a squashed, spinning
sliver. Fixed by giving the glyph `inline-block`, so it no longer depends on its parent's display.

The glyph's border also became `currentColor` (`border-current/30` + `border-t-current`). It had been
hard-coded slate, which is close to invisible on the accent-blue primary button. One component now
works on white-on-accent and slate-on-white with no variant prop. `Spinner` gained a `className`
prop so the glyph can match whichever icon it stands in for.

**The hole.** The busy state reserved a permanently-rendered empty box so the spinner would not
reflow the button. That reserved box is the dead space the user saw. Replaced with a real leading
icon — `Download` on both export buttons, `Trash2` on the delete confirmation — that the spinner
**replaces in place**. Measured idle and busy: `Download CSV` 142 px both, `Download JSON` 153 px
both, `Delete this receipt` 163 px both. No hole, no reflow, and the label still never changes.

The low-emphasis `Delete` trigger was deliberately left icon-free: it was not part of the report, and
the quiet trigger / loud confirmation contrast is intentional.

### 2. The upload loading state moved onto the button

**Requested:** replace the full-panel loading state with a spinner and `Loading…` on the button
itself.

Iteration 13 replaced the entire capture panel — preview included — with a centred spinner and
"Preparing your receipt", then navigated to a processing route that says the same thing. Now the
`uploading` branch is gone: the approved preview stays on screen and the pressed button shows a
spinner plus `Loading…` (`capture.uploading`, re-added; iteration 13 had removed the key when it
caused the "Loading Uploading" defect).

Both the upload and retake buttons take `aria-disabled` with a handler guard, so a mid-flight retake
can no longer discard the file being uploaded — a real correctness gap that only appeared once the
buttons stayed on screen during the upload. A visually-hidden `role="status"` carries the
announcement, because a changed accessible name is re-announced unreliably.

**Noted tension, accepted deliberately.** Iteration 13's research concluded "do not swap the label
text" and that rule still governs the export and delete buttons, where the action is repeatable and
the button survives it. The user asked for the swap here specifically, and this button is a different
case: it fires once and the route navigates away on success. The inconsistency is intentional and
recorded rather than silently resolved.

### 3. The empty-currency warning is correct — the presentation was not

**Asked:** why does an empty currency field warn when other empty fields do not?

**Answer: intentional, and it is the PRD.** `api/src/validation/warnings.ts` emits
`missing_critical_field` for exactly five fields — `sellerName`, `documentNumber`, `issueDate`,
`total`, `currency` — which are the critical review fields named in PRD §6.5 and Appendix A.
Everything else is secondary or optional and is legitimately blank on many real receipts; warning on
those would contradict PRD §7.7's "missing stays missing" and train the user to ignore warnings.

Reproduced live to confirm rather than asserting it from the code. On a real extracted receipt,
buyer name, buyer address, buyer OIB, subtotal, payment method, JIR and three unit prices were all
empty and silent, while `currency` alone carried the warning.

**But one real presentation defect sat behind the confusion.** `ReviewField` painted amber for
`lowConfidenceFields` only, while the hint text below rendered for a low-confidence reading *or* a
warning. An empty critical field therefore showed an amber explanation underneath an ordinary slate
input — two conventions for one idea. Amber is now driven by `hasHint`, so every field needing
attention looks identical whichever signal raised it. A warned field still shows its own warning and
never the generic hint as well, and `aria-invalid` remains unused.

### 4. Desktop has one picker, not two

**Reported:** on desktop, "Scan receipt" and "Choose file" do exactly the same thing.

Correct, and it is a platform behaviour rather than a bug in the app: `<input capture>` is a
mobile-only hint that desktop browsers parse and then ignore.

`client/src/capture/useCameraCapture.ts` now reads `(pointer: coarse)`. A touch-first pointer keeps
both actions unchanged; a fine pointer renders only `Choose file`, promoted to the primary style.

`(pointer: coarse)` was chosen over `navigator.maxTouchPoints` because it describes the *primary*
pointer: a touchscreen laptop driven by a trackpad reports `fine` and correctly keeps the single
button, where `maxTouchPoints` would have reintroduced the original bug on that hardware. With no
`matchMedia` the hook keeps both actions, since a spare button is harmless and withholding capture on
a real phone is not. The query is re-read on change for detachable tablets.

**A webcam scan path was considered and rejected.** It needs `getUserMedia`, a live video surface, a
canvas grab, and permission/denial/device-selection states — and a laptop webcam is a poor receipt
scanner: typically fixed-focus, low resolution, and at an oblique angle to a document on a desk. That
is precisely the unusable input PRD §7.4 asks the product to avoid, and PRD §11.5 designs the primary
flow for a phone. Recorded as reversible if desktop capture becomes a real need.

## Files created / modified

**Client — new**

- `client/src/capture/useCameraCapture.ts`

**Client — modified**

- `client/src/components/Spinner.tsx`
- `client/src/routes/HomePage.tsx`, `client/src/routes/HistoryPage.tsx`,
  `client/src/routes/ReviewPage.tsx`
- `client/src/routes/HomePage.test.tsx`, `client/src/routes/ReviewPage.test.tsx`
- `client/src/i18n/locales/en.json`, `client/src/i18n/locales/hr.json` (`capture.uploading`)

**Documentation**

- `README.md`, `.claude/commands/validate.md` (new check 6.16), `.agents/ROADMAP.md`, this history

## Validation results

| Check | Result |
| --- | --- |
| `npm run lint` | Pass, zero errors |
| `npm run typecheck` | Pass, exit 0 |
| `npm run format:check` | Pass |
| `npm test` | Pass: **37 files, 358 tests** |
| `npm run build` | Pass; only the pre-existing >500 kB JS advisory |
| Phase 7a — Docker migrations | **Skipped, legitimately**: no file under `supabase/migrations/` changed |
| Phase 7b — hosted integration | Pass: 8 auth + 3 repository + 14 route |

Also confirmed the two Tailwind classes the spinner now depends on are actually emitted:
`.border-current\/30` and `.border-t-current` are both present in the built CSS, with a
`currentColor` fallback beside the `color-mix` form.

## Real-browser verification

Ports freed first; Vite confirmed on **5173** under `--strictPort`. Driven headless in Chromium with
a disposable `uicheck-` account, at 1440×1000 and 390 px.

- **Root cause, measured.** The old markup inside a non-flex wrapper renders **4×25**; the fixed
  markup renders **16×16**. This is the entire bug, proven rather than argued.
- **Export and delete buttons.** Idle icons 16×16 tight against the label, no dead space. Busy glyph
  16×16, `display: block`, arc `rgb(255,255,255)` on the accent button and slate on the outlined one.
  Widths identical idle and busy (142 / 153 / 163).
- **Upload button.** Busy glyph 20×20 matching the `size-5` icon it replaces, white arc, label
  `Loading…`, width unchanged at 505 px, preview still rendered, both buttons `cursor: not-allowed`
  and `bg-slate-400` under `aria-disabled`.
- **Desktop capture.** Exactly one picker, `Choose file`, `rgb(29,78,216)`, `min-height: 56px`,
  `cursor: pointer`; `matchMedia("(pointer: coarse)")` false.
- **Mobile capture.** `Scan receipt` primary (56 px, accent, `capture="environment"`) plus
  `Choose file` secondary (48 px, white), `scrollWidth` 390 against a 390 px viewport — no overflow.
- **Review.** A real extracted receipt with no currency: `currency` amber, `aria-describedby` set,
  `aria-invalid` absent, hint "This field is empty. Check the receipt and fill it in."; nine other
  empty fields plain and silent.
- **Delete.** A real two-step delete took history from 2 receipts to 1. No page errors; the console
  carried only Vite HMR messages.

The disposable user, its two receipt rows and its two storage objects were removed afterwards; the
orphan-user check and the storage listing both returned `[]`.

### Two honest gaps in this verification

1. **The live busy state was never caught mid-flight.** Uploads and exports complete in a few hundred
   milliseconds here, and the browser CLI offers no request delay, so the busy states were measured by
   painting the component's exact busy markup onto the real buttons in the live page. That proves the
   rendering — size, contrast, layout, zero reflow — which was the only thing jsdom could not. The
   state wiring itself (label, `aria-disabled`, retained preview, blocked retake, status region) is
   covered by passing unit tests.
2. **The two-button mobile branch was proven by inverting the query, not by emulation.** Playwright's
   iPhone descriptor sets `hasTouch` but does **not** flip `(pointer: coarse)` in headless Chromium,
   which still reported `false` at 390 px. The coarse branch was therefore verified by temporarily
   switching the constant to `(pointer: fine)`, confirming the rendering in a real browser, and
   reverting. Real iOS Safari and Android Chrome do report `coarse` — that is the media feature's
   entire purpose — but **this has not been confirmed on physical hardware**, and if it were ever
   wrong the camera button would vanish on a phone. It joins the existing real-device checklist and
   should be the first thing checked there.

## Known gaps / follow-ups

- The real-device checklist inherited from iterations 6, 12 and 13 is unchanged, and now also owns
  the `(pointer: coarse)` confirmation above.
- `capture.uploading` swaps a button label, which the export and delete buttons deliberately do not.
  Intentional, at the user's request; see §2.
- Pre-existing orphan translation keys (`common.openMenu`, `common.closeMenu`, `home.apiStatus`,
  `home.apiOnline`, `home.apiOffline`) remain flagged and untouched.
- The >500 kB JS chunk advisory is unchanged.
