# Plan — Iteration 13: UI feedback, capture layout & clarity polish

**Status:** Ready for implementation
**Type:** User-directed iteration against the deployed prototype (ROADMAP §3), not a numbered roadmap task
**Depends on:** Iteration 12 (`39f4f54`, app shell rebuild)

---

## 1. Why this iteration exists

The user tested the deployed prototype and reported thirteen issues across five screens. They fall into
four groups:

1. **Colour inconsistency** — three screens still carry the pre-accent `bg-slate-900` black buttons
   that iteration 12 never reached.
2. **Missing or unreachable feedback** — saving and confirming a receipt give the user nothing they can
   see without scrolling; the upload flow gives them two competing messages at once.
3. **Unexplained affordances** — orange fields that sometimes explain themselves and sometimes do not,
   and a "Reload receipt" action with no discoverable purpose.
4. **Layout and polish** — a boxed capture card marooned in desktop whitespace, a grammatically wrong
   Croatian plural, and no `cursor: pointer` anywhere in the app.

Everything here is client-side. **No API, database, schema or extraction code changes.**

---

## 2. Decisions taken with the user before planning

These were asked and answered before this plan was written. They are settled; do not relitigate them
(ROADMAP §5, and the standing rule about answered decisions).

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Homepage desktop layout | **Two-column**: capture actions left, a real "how it works" step list right |
| Q2 | Save/confirm feedback | **Toast/snackbar**, auto-dismissing, independent of scroll position |
| Q3 | "Reload receipt" action | **Remove entirely**; the panel already auto-retries once and the error state already offers a retry |
| Q4 | Orange fields | **Every** amber field always carries a visible explanation — the specific warning, or a generic "please verify" when there is none |
| Q5 | Download/delete busy state | **Spinner beside an unchanged label**, never a text swap |
| Q6 | Single upload message | **"Preparing your receipt"**, covering upload and extraction as one continuous phase |
| Q7 | Review button hierarchy | **Confirm receipt is the primary blue button; Save changes becomes secondary/outlined** |
| Q8 | Verification | Full real-browser pass at 375 px and 1440 px to examine the mobile screen and desktop screen view |

---

## 3. Research findings that shape the implementation

Full report gathered before planning. The findings below **override the obvious implementation** in
several places, so read them before writing code.

### 3.1 Toasts

- **`role="status"`, never `role="alert"`.** `alert` is assertive, interrupts speech mid-sentence, and
  is for time-critical errors — wrong for "Changes saved".
  ([ARIA22](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22))
- **The live region must exist in the DOM, empty, from first render.** Most screen readers only report
  mutations on a region they were already observing; a region created at the moment the toast fires is
  frequently never announced. It must not be toggled with `display:none` or `aria-hidden` either.
  ([Adrian Roselli](https://adrianroselli.com/2020/01/defining-toast-messages.html),
  [Sara Soueidan](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/))
- **Never move focus to the toast.** WCAG 4.1.3 requires a status message to be perceivable *without* a
  change of context. A focused toast behaves like a modal and defeats the pattern.
  ([Understanding SC 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html))
- **Auto-dismiss at ~6 s** for a short non-actionable confirmation, with a manual dismiss button as the
  WCAG 2.2.1 safety net. Sources genuinely disagree here — Roselli argues most auto-dismissing toasts
  violate 2.2.1 outright and prefers persistent messaging; mainstream design systems treat 4–6 s as
  standard for non-actionable messages. **We take the mainstream position and mitigate it** with the
  dismiss button and the persistent inline indicator below.
- **A toast alone is not sufficient.** Live-region announcements are non-replayable — a user who scrolls
  away or misses it has no way to recover the information. Pair it with a persistent inline indicator.
- **Placement must clear the mobile tab bar.** The bar is fixed and 64 px (`pb-16`), so a bottom-anchored
  toast collides with it. Anchor at `calc(4rem + env(safe-area-inset-bottom) + 1rem)` below `lg`, and at
  the normal bottom offset from `lg` where the bar is `display: none`.
- **`prefers-reduced-motion`**: drop translate/slide entrance, keep only a short opacity fade.

### 3.2 Busy buttons

- **Do not swap the label text.** Three separate problems: layout shift, an accessible name that changes
  mid-interaction (unreliably re-announced), and loss of identity for voice-control users who said
  "click Delete". This directly validates decision Q5.
  ([Bekk Christmas](https://www.bekk.christmas/post/2023/24/accessible-loading-button))
- **Use `aria-disabled="true"`, not the `disabled` attribute**, during the busy state. `disabled` removes
  the button from the tab order and can silently move focus elsewhere mid-action. Block the handler with
  an early return instead, and style the state explicitly since the browser will not.
  ([MDN aria-disabled](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-disabled))
- **`aria-busy` is unreliable** across screen readers — some skip the button's content entirely. Use a
  visually-hidden `role="status"` message instead as the announcement channel.
- A file download **should** show a brief busy state: the browser's own download UI only appears once
  bytes start streaming, and says nothing about the server generating the export first.

### 3.3 Low-confidence fields

- **`aria-invalid` is wrong here** and must not be used. ARIA21 reserves it for genuine validation
  failures; an uncertain-but-plausible OCR value is not invalid, and misusing it makes screen readers
  announce a false error, colliding with the form's real validation errors.
  ([ARIA21](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA21),
  [Deque](https://www.deque.com/blog/aria-invalid-error-indication/))
- **Use `aria-describedby`** pointing at the hint element instead.
- **Colour alone fails WCAG 1.4.1.** Amber must be accompanied by a non-colour affordance — an icon plus
  visible hint text.
- **Inline hint per field beats a global legend.** A legend at the top of a long scrollable form is
  missed, particularly by anyone landing mid-form. A legend is acceptable only as a supplement.
- Amber-for-uncertain and red-for-error is the established traffic-light convention in production
  document-AI review tools, so the existing colour choice is right — only its consistency is wrong.

### 3.4 `cursor: pointer`

- The spec-purist objection ("pointer means link") is **genuinely unresolved**, but has **no
  accessibility stake whatsoever** — `cursor` does not touch the accessibility tree, keyboard order or
  screen readers. It is purely a mouse affordance.
- **Tailwind v4 deliberately removed the default pointer cursor from buttons.** That is the direct cause
  of the user's complaint — it is a known upstream change, not an oversight in this codebase.
  ([tailwindlabs#8961](https://github.com/tailwindlabs/tailwindcss/issues/8961))
- **`cursor: not-allowed` on disabled controls** is the one point with no dispute — it is an extra
  non-colour affordance that the action is unavailable.

### 3.5 Full-screen loading and error states

- **Use `min-h-svh`, not `100vh` or `100dvh`.** `100vh` is computed against the collapsed-chrome viewport
  and clips content on mobile at first paint; `100dvh` reflows as the address bar hides during scroll,
  which is visible jitter on a static screen. `svh` is the stable worst-case choice. `min-height`, not
  `height`, so a tall error state grows rather than clipping.
- **Do not re-announce on every poll tick.** WAI explicitly warns against a chatty live region. Announce
  once on entry and again only at a real state transition (success, failure, timeout).
- **Error hierarchy is: heading → plain-language explanation → primary retry → secondary escape hatch.**
  ([NN/g Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/))

---

## 4. Scope — the thirteen changes

### A. Global foundations

**A1 — `cursor: pointer` policy** · `client/src/index.css`

Add one base-layer rule rather than 40 call-site utilities, mirroring how the existing `:focus-visible`
policy is expressed:

```css
button:not(:disabled):not([aria-disabled="true"]),
label:has(> input[type="file"]),
select,
summary,
[role="button"] { cursor: pointer; }

button:disabled,
button[aria-disabled="true"] { cursor: not-allowed; }
```

`<a>` already gets it from the UA stylesheet. Verify `:has()` support is acceptable — it is, in all
current evergreen browsers, and this is a progressive enhancement with no functional consequence.

**A2 — Toast system** · new `client/src/components/Toast.tsx`, `ToastProvider`, `useToast`

- Provider mounts an **always-present, empty** `role="status"` region (§3.1) in `AppLayout`, outside
  `<main>`, so it is not remounted by route changes.
- `useToast().show(message)` renders one toast; a second call replaces the first.
- Auto-dismiss 6 s, pause on hover/focus, manual dismiss button, `Escape` dismisses.
- Positioned `fixed`, bottom-anchored above the tab bar below `lg` (§3.1).
- Success variant only in this iteration — no speculative error/warning variants (CLAUDE.md §2).
- Fade-only under `prefers-reduced-motion`.

**A3 — Spinner gets an icon-only mode** · `client/src/components/Spinner.tsx`

`Spinner` currently renders `role="status"` **plus the visible word "Loading"**. Inside the upload button
that produces the literal text **"Loading Uploading"** — this is the root cause of the user's
double-message report, not the `ProcessingPage` message.

Add a `label={false}` (or a sibling `SpinnerIcon`) that renders only the `aria-hidden` spinning glyph
with no text and no `role="status"`, for use inside buttons whose label already says what is happening.
Standalone uses keep the current labelled behaviour.

### B. Header — remove the icon · `client/src/components/AppLayout.tsx`

Delete the `ReceiptText` accent square (lines 30–35) and its now-unused import. The wordmark remains.
Iteration 12's `text-sm lg:text-base` sizing and truncation guard stay — removing the 32 px square only
gives the name more room, so the 320 px no-wrap guarantee is preserved a fortiori.

### C. Login/register button → accent blue · `client/src/components/AuthForm.tsx`

`bg-slate-900 hover:bg-slate-800` → `bg-accent hover:bg-accent-hover`. Shared by both auth screens, so
registration matches for free. Keeps `disabled:bg-slate-400`.

### D. Homepage — unbox and rebuild · `client/src/routes/HomePage.tsx`

**D1.** Remove the card: drop `rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8` from
the `<section>`. Content sits directly on the page background.

**D2.** Two-column from `lg` (Q1), single column below:

```text
lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]

left                                    right
  h1  capture.title                       "How it works"
  p   capture.guidance                    1  Capture or choose a file
  [ Scan receipt ]  (primary, blue)       2  The receipt is read automatically
  [ Choose file  ]  (secondary)           3  Check the values and confirm
```

The step list is genuine product information — it is the actual pipeline this app runs, and it is what a
first-time user needs in order to understand that OCR output is a draft they must confirm (PRD §1, §6.6).
**It is not filler.** No gradients, no decorative emoji, no invented marketing copy, no third column
added to balance the grid — the user explicitly rejected AI-slop design.

**D3.** Vertical rhythm: keep `min-h-[calc(100svh-…)]` centring (switching `dvh` → `svh` per §3.5) but
raise the max width from `max-w-md` to roughly `max-w-5xl` at `lg` so the two columns have room. On
mobile the column order is heading → guidance → buttons → steps, so the primary action stays above the
fold.

**D4 — one upload message (Q6).** While `uploading` is true, replace the preview/actions block with the
same centred spinner + **"Preparing your receipt"** that `ProcessingPage` shows, so the message does not
change when the route does. The in-button `<Spinner />` + `capture.uploading` pairing is removed
entirely, which also disposes of the "Loading Uploading" defect (A3).

`capture.uploading` becomes unused — flag it, and remove it only because *this change* orphans it
(CLAUDE.md §3 permits removing orphans your own change creates).

### E. Processing screen · `client/src/routes/ProcessingPage.tsx`

**E1.** Centre both the polling state and the error state vertically and horizontally:
`min-h-[calc(100svh-…)] flex flex-col items-center justify-center` — same `min-h`/`svh` reasoning as D3.

**E2.** Restructure the error state to heading → explanation → primary → secondary (§3.5). It currently
renders the message as an `<h1>` with no explanatory line.

**E3.** `bg-slate-900` → `bg-accent` on both the **Try again** and **Check again** buttons. "Upload
another receipt" stays a secondary outlined link — it is the escape hatch.

**E4.** Keep the single static `role="status"` announcement; do not add per-poll text (§3.5).

### F. Review screen · `client/src/routes/ReviewPage.tsx`

**F1 — button hierarchy (Q7).** Confirm receipt becomes `bg-accent` primary; Save changes becomes the
outlined secondary. Confirm keeps its existing `disabled` when the form is dirty — that is a genuine
correctness guard, not a busy state, so the native attribute remains correct there.

**F2 — toasts (Q2).** On a successful save, show "Changes saved". On a successful confirm, show
"Receipt confirmed". The existing green `review.confirmed` line stays as the **persistent inline
indicator** the research requires alongside the transient toast (§3.1) — it is not redundant.

**F3 — orange fields (Q4).** This is the real bug. `fieldClass()` (line 109) paints amber on **every**
field in `lowConfidenceFields`, but the `review.lowConfidence` hint is rendered for only the three seller
fields and `documentNumber`. Date, time, subtotal, total, currency, payment method, JIR, ZKI, buyer
fields, VAT cells and item cells all get unexplained orange.

Fix by extracting a single `<ReviewField>` component that owns border, icon, hint and warnings together,
so the two can never drift apart again. Per field it must render:

- amber border **plus a small warning icon** — colour alone fails WCAG 1.4.1 (§3.3)
- any specific warnings for that field path (existing `messages()`)
- the generic `review.lowConfidence` hint **only when the field is amber and has no specific warning**,
  so the user never sees both a real explanation and a vague one
- `aria-describedby` linking the input to those hints — **not `aria-invalid`** (§3.3)

Amber must remain visually distinct from the red validation-error styling.

**F4 — remove "Reload receipt" (Q3)** · `client/src/review/SourceDocumentPanel.tsx`

Delete the button (lines 81–87) and the `review.reloadSource` key. The `onError` auto-retry (lines 64–69)
and the `ErrorMessage onRetry` path (line 37) both remain, so the expiry case the button existed for is
still covered. "Open in a new tab" stays.

### G. History screen · `client/src/routes/HistoryPage.tsx`

**G1 — Croatian plural.** `history.count` is a flat `"{{count}} računa"`, which is wrong for 1 and for
2–4. Croatian CLDR has three categories; English has two:

| Language | Keys |
| --- | --- |
| `hr` | `count_one` "{{count}} račun" · `count_few` "{{count}} računa" · `count_other` "{{count}} računa" |
| `en` | `count_one` "{{count}} receipt" · `count_other` "{{count}} receipts" |

**This breaks `client/src/i18n/i18n.test.ts`**, which asserts `hr` and `en` have *identical* key sets.
Do **not** fabricate an English `count_few` to satisfy it — CLDR never selects that category for English,
so it would be permanently dead. Instead strengthen the test: strip plural suffixes before comparing base
key sets, and additionally assert that each pluralised key carries exactly the categories
`new Intl.PluralRules(lang).resolvedOptions().pluralCategories` reports for its language. That is a
stronger check than the one it replaces.

**G2 — busy states (Q5).** Download CSV, Download JSON and the delete-confirm button keep their labels
and gain a leading `SpinnerIcon`, per §3.2. Switch the busy state from `disabled` to `aria-disabled`
with an early-return guard in the handler, style it explicitly, and reserve width so adding the icon does
not reflow the button. Add one visually-hidden `role="status"` announcement for the in-flight action.

`history.exporting` and `history.deleting` become orphans — remove, as this change orphans them.

> **Test impact:** jest-dom's `toBeDisabled()` only recognises the native attribute, so
> `HistoryPage.test.tsx` assertions around the disabled busy state need updating to check
> `aria-disabled`. The existing `toBeEnabled()` assertion on Download JSON while CSV is in flight is
> unaffected and still meaningful.

### H. Translations · `client/src/i18n/locales/{en,hr}.json`

New keys: `common.dismiss`, `home.stepsTitle`, `home.step1/2/3`, `review.saved`, `history.exportingStatus`,
`history.deletingStatus`, plus the `history.count_*` plural set.
Removed: `capture.uploading`, `review.reloadSource`, `history.exporting`, `history.deleting`.

**Pre-existing orphans, flagged not removed** (CLAUDE.md §3 — not created by this change):
`common.openMenu`, `common.closeMenu` (left by iteration 12's deleted drawer), `home.apiStatus`,
`home.apiOnline`, `home.apiOffline`. `home.title`/`home.subtitle` may become live again in D2.

Croatian copy must be written directly as UTF-8 — `/validate` 6.11 exists because a previous task
shipped `PokuÅ¡ajte` by editing through a tool that assumed the wrong encoding.

---

## 5. Verification

### Automated
`npm run lint` · `npm run typecheck` · `npm run format:check` · `npm test` · `npm run build`, then
`/validate` Phases 6 (all sub-checks) and 7b. **Phase 7a is legitimately skippable** — no file under
`supabase/migrations/` changes — and the skip must be reported, never counted as green.

New/updated tests:

| File | Covers |
| --- | --- |
| `client/src/components/Toast.test.tsx` (new) | Region exists empty before any toast; message announced via `role="status"`; focus is **not** moved; manual dismiss and `Escape` work; auto-dismiss clears |
| `client/src/i18n/i18n.test.ts` | Plural-aware key parity; correct CLDR categories per language |
| `client/src/routes/ReviewPage.test.tsx` | Save and confirm each raise a toast; **every** amber field carries a hint; `aria-describedby` is wired; `aria-invalid` is **absent** |
| `client/src/routes/HistoryPage.test.tsx` | Labels stay stable while busy; `aria-disabled` replaces `disabled`; the other export button stays usable; singular Croatian renders "1 račun" |
| `client/src/routes/HomePage.test.tsx` | Uploading shows exactly one message and no "Loading Uploading" |
| `client/src/components/AppLayout.test.tsx` | No header icon; toast region present from first render |

### Real browser (Q8)

Free ports 3001/5173 first and confirm Vite reports **5173** under `--strictPort` — `/validate` 8.1 exists
because a stale server has already caused checks to pass against old code on this project.

At **375 px** and **1440 px**, in **both languages**: header without icon and still unwrapped; homepage
two-column at `lg` and single-column stacked on mobile with no horizontal overflow; upload showing one
message; processing and error states genuinely centred; toast visible **without scrolling** and clearing
the bottom tab bar; every amber field explained; blue buttons on login, processing and confirm; spinner
busy states on export and delete; `cursor: pointer` on buttons, file labels and the status select.

Plus one live end-to-end journey on a real Croatian receipt: upload → extraction → review → save (toast)
→ confirm (toast) → history shows "1 račun" → CSV download. Delete the disposable user, its rows and its
storage objects afterwards and confirm the orphan check returns `[]`.

Measured values, not impressions — iteration 12's history is the precedent.

> **jsdom cannot prove this iteration.** Iteration 12 shipped a dead drawer whose unit test passed
> because jsdom does not implement `inert`. jsdom likewise does not lay out `position: fixed`, does not
> compute `env()`, and does not evaluate `cursor`. The toast's clearance of the tab bar and the pointer
> cursors **must** be confirmed in a real browser.

---

## 6. Documentation

- `README.md` — "Application shell" gains the toast pattern and the cursor policy; the review section
  gains the low-confidence treatment; the history section drops the text-swap busy states.
- `.claude/commands/validate.md` — Phase 4 rows for the new tests; extend journey 8.13 with the toast,
  cursor and centring checks; a new check that `aria-invalid` never appears on a low-confidence field.
- `.agents/ROADMAP.md` — iteration 13 row.
- `.agents/history/13-ui-feedback-and-capture-polish.md` — written at the end, per the template.

---

## 7. Explicitly out of scope

No API, schema, extraction or export-format changes. No dark mode. No semantic-token migration for
neutrals (iteration 12 D9 — still deferred). No new dependency: the toast is ~60 lines and does not
justify a library. No Playwright suite. No fix for the >500 kB chunk advisory. No touching the
pre-existing orphan translation keys listed in §H.

---

## 8. Open risks

1. **The homepage is the only genuinely subjective item.** D2 is a layout the user picked from a sketch,
   not a rendered screen. Show it before continuing past it — this is exactly the point at which
   iteration 12's navigation pattern was redirected.
2. **`aria-disabled` changes test semantics** (G2). Expect `HistoryPage.test.tsx` churn; the tests are
   being made more accurate, not weakened.
3. **The `<ReviewField>` extraction (F3) is the largest single refactor here.** It touches roughly twenty
   inputs. It is justified — the duplication is the direct cause of the bug — but it must not change any
   field's registered name, validation or value handling.
