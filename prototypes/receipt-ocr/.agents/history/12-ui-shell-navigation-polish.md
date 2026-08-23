# Task 12 — UI shell, navigation & home-page polish

**Date:** 2026-08-23
**Plan:** `.agents/plans/ui-shell-navigation-polish.md`
**Commit:** _uncommitted at time of writing — awaiting human review_

> This is the first piece of work outside the numbered roadmap. `.agents/ROADMAP.md` §3 records that
> the structured task list ended at Task 11 and that further work is user-directed iteration against
> the deployed prototype. It still followed the standing rules in ROADMAP §5 and gets a history file,
> so it is numbered 12 for continuity with the existing history sequence.

## What was built

The application shell was rebuilt. It had been a two-row header holding a plain text app name, a
sign-out button, an HR/EN pair and two undifferentiated links, with no active-page indication, no
identity display, no accent colour, and a desktop layout that was a stretched phone layout.

It is now a single-row sticky header (56 px mobile, 64 px desktop) carrying an accent wordmark at top
left and the language switcher plus an account disclosure at the right, over a responsive navigation
that is a **fixed bottom tab bar** on mobile and a persistent 240 px sidebar from `lg`. The capture
screen became a bounded, vertically centred card with a dominant primary action. Three defects the
plan identified were closed: no active-page state, an invisible focus indicator on the two capture
controls, and a missing navigation landmark.

## Files created / modified

**Client — new**

- `client/src/auth/userIdentity.ts`, `client/src/auth/userIdentity.test.ts`
- `client/src/components/NavItems.tsx`
- `client/src/components/BottomNav.tsx`
- `client/src/components/AccountMenu.tsx`
- `client/src/components/Skeleton.tsx`
- `client/src/components/AppLayout.test.tsx`

**Client — modified**

- `client/src/components/AppLayout.tsx` (rebuilt), `client/src/components/LanguageSwitcher.tsx`
- `client/src/components/AuthForm.tsx`
- `client/src/routes/HomePage.tsx`, `client/src/routes/HistoryPage.tsx`,
  `client/src/routes/ReviewPage.tsx`, `client/src/routes/ProcessingPage.tsx`,
  `client/src/routes/NotFoundPage.tsx`
- `client/src/index.css`
- `client/src/i18n/locales/en.json`, `client/src/i18n/locales/hr.json`

**Documentation**

- `README.md` (new "Application shell" section), `.claude/commands/validate.md`,
  `.agents/ROADMAP.md`, this history

## Decisions made

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **A bottom tab bar replaced the planned hamburger drawer.** | The plan recorded the hamburger as settled and told the executing agent not to propose an alternative. The user overrode that after seeing it rendered and asked for the standard mobile pattern. The research agrees, and the plan's own NOTES had already recorded most of it: NN/g measured that hidden navigation roughly halves discoverability, raises perceived difficulty and cuts task completion by ~21%, and their rule is to keep navigation visible at four or fewer destinations — this app has two. Tap accuracy is ~96% in the bottom thumb zone against ~61% at the top, which is where the drawer trigger sat. Apps switching hamburger → visible tabs measured 30%+ gains in feature discovery. Google deprecated the navigation drawer in Material 3 Expressive (May 2025). **The drawer, its focus trap, `inert` handling and scroll lock were deleted entirely.** |
| D2 | The desktop sidebar stays; only one navigation is ever displayed | `hidden lg:block` and `lg:hidden` mean exactly one is `display: none` at any width, so only one `navigation` landmark reaches the accessibility tree despite both carrying the same label. |
| D3 | `NAV_ITEMS` is defined once in `NavItems.tsx` and consumed by both navigations | Two hand-maintained copies of the destinations is how a sidebar and a tab bar drift apart. |
| D4 | The active tab is marked by an accent pill behind the icon, not colour alone | Colour alone fails a grayscale screenshot and colour-vision differences. `NavLink` supplies `aria-current="page"` for the programmatic half. |
| D5 | `<main>` carries `pb-16 lg:pb-0` when signed in | The tab bar is `position: fixed`, so without it the last history row and the pagination controls sit behind the bar with no way to scroll clear. |
| D6 | Five route files received container classes, not the two the plan named | Moving `mx-auto max-w-3xl px-4 py-6` off `main` also stranded `AuthForm`, `ProcessingPage` and `NotFoundPage` edge-to-edge. Each kept its own max-width; only padding was added. |
| D7 | `ReviewPage` now renders at its own declared `max-w-6xl` | Its root already declared `max-w-6xl`, which `main`'s `max-w-3xl` had been silently clamping. With the clamp gone the two-pane review/source split renders at the width its author intended. Verified in the browser: form left, source document right. **Flagged to the user as a visible change to a screen the plan put out of scope.** |
| D8 | One extra translation key, `common.noEmail` | `displayEmail()` needs a translated fallback for a session without an email; the plan's key table omitted one. |
| D9 | Accent tokens only; neutrals stay `slate-*` | A full semantic-token migration would touch every client file for zero visual change. Recorded as a follow-up. |
| D10 | The language switcher was resized, not restructured | Its `role="group"` + `aria-pressed` + per-button `lang` contract is correct; converting it to a `radiogroup` would oblige a roving-tabindex implementation. |

## Deviations from the plan

- **The hamburger drawer was built, verified as broken, and then deleted.** See D1 and the defect
  below. `NavigationDrawer.tsx` no longer exists.
- **The Stage A checkpoint happened as specified**, and was what surfaced both defects below. The
  user reviewed the screenshots and redirected the navigation pattern at that point.
- **`common.noEmail`** was added beyond the plan's key table (D8).
- **Five route containers instead of two** (D6).
- The plan's `AppLayout.test.tsx` cases for the drawer's modal contract were replaced by cases for
  the tab bar, including an explicit assertion that **no `Open menu` button and no `role="dialog"`
  exist anywhere in the shell**, so the hamburger cannot silently return.

## Defects found during execution

1. **The drawer opened dead — and the unit test could not see it.** The plan specified marking the
   app root `inert` while the drawer is open. But the whole React tree renders inside `#root`, so the
   drawer marked *itself* inert: focus fell to `BODY`, and the close button and both links were
   unfocusable and unclickable. **jsdom does not implement `inert` semantics**, so the jsdom test
   asserting focus-on-open passed while the real browser shipped a dead drawer — exactly the failure
   mode the plan flagged as "where this task can silently ship something broken". Fixed at the time
   with `createPortal(..., document.body)` plus a jsdom-testable containment guard
   (`expect(root.contains(drawer)).toBe(false)`). The drawer was subsequently deleted for D1, but the
   lesson stands for any future modal: **`inert` correctness cannot be proven in jsdom.**
2. **The wordmark wrapped to two lines at 375 px**, making the "single-row 56 px header" taller than
   specified. Fixed with `text-sm lg:text-base` and tighter mobile header padding
   (`px-2 gap-1`, restored to `px-4 gap-2` at `lg`). Both "Receipt Scanner" (101 px) and
   "Skener računa" (90 px) now fit untruncated at 320 px and 375 px.

## Validation results

Full sweep run against the working tree.

| Phase | Result |
| --- | --- |
| 0 — clean install | Not re-run; no dependency change in this task |
| 1 — `npm run lint` | Pass, zero errors |
| 2 — `npm run typecheck` | Pass, exit 0 |
| 3 — `npm run format:check` | Pass — `All matched files use Prettier code style!` |
| 4 — `npm test` | Pass: **36 files, 348 tests** (was 34 / 330) |
| 4 — per project | `shared` 137, `api` 99, `client` 112 (was 94) |
| 5 — `npm run build` | Pass; CSS bundle 19.99 kB (was 17.61 kB), only the pre-existing >500 kB JS advisory |
| 6.1–6.15 | All pass, including 6.5 translation keys, 6.6 README parity, 6.9 no raw `fetch`, 6.11 locale mojibake |
| 7a — Docker migrations | **Skipped, legitimately**: no file under `supabase/migrations/` changed in this task |
| 7b — hosted integration | Pass: 8 repository + 3 auth + 14 route tests against the hosted project |
| 8.13 — application shell | Pass — see below |
| 8.4 / 8.10 / 8.11 / 8.12 | Re-run because the shell now wraps every screen; all pass |

### Journey 8.13 — measured, not impressions

Ports 3001 and 5173 were freed first and Vite confirmed **5173** under `--strictPort`, so nothing was
checked against stale code. Driven with a disposable `shell-check-` account.

At **375 × 667**, both languages:

- `document.documentElement.scrollWidth` **360** against a 375 px viewport; **305** against 320 px —
  no horizontal overflow at either width, in Croatian or English.
- Header **56 px**; wordmark not truncated in either language.
- Bottom tab bar pinned to the viewport bottom (`bottom: 667`), each tab **180 × 64** at 375 px and
  **153 × 64** at 320 px — comfortably past the 44 px minimum, in the thumb zone.
- Exactly **one** `aria-current="page"` per rendered navigation, correct on `/` and `/receipts`.
- No `Open menu` button and no `role="dialog"` anywhere.
- Tabbing the header paints `2px solid rgb(59, 130, 246)` on every control.
- Focusing each capture input paints the ring on the **visible label** (`Scan receipt` 56 px,
  `Choose file` 48 px) — the WCAG 2.4.7 fix, confirmed by focus, not by reading class names.
- A tall portrait photo (1232 × 1616) made the page grow to `scrollHeight` **862** against a 667 px
  viewport with the image top at **+221** — it scrolls rather than clipping off the top (D5 of the
  plan). Upload and retake buttons stayed clear of the tab bar.
- Croatian copy correct with diacritics intact: `Skeniranje`, `Računi`, `Skener računa`.

At **1440 × 900**: header **64 px**, sidebar `display: block` at **240 px**, bottom bar
`display: none`, capture card centred horizontally and vertically. The account panel shows
`Signed in as` + the session email + `Sign out`, toggles `aria-expanded`, exposes
`aria-controls="account-panel"`, has **no `role="menu"`**, and closes on `Escape` with focus restored
to its trigger and on an outside pointer.

Signed out: **zero** `navigation` landmarks, no account control — the shell offers a visitor nothing.

A full live journey also ran end to end under the new shell: upload a real Croatian receipt → Azure
extraction → review pre-populated (`S.A.L.N. SYSTEMS j.d.o.o.`, `224/STP/3`, `132.72`) → confirm →
history shows the confirmed row → CSV download with zero page errors. The disposable user, its
receipt row and its stored source object were deleted afterwards; the orphan check returned `[]`.

## Known gaps / follow-ups

- **Real-phone validation of the tab bar has not happened.** Everything above is a 320/375 px
  headless viewport, not a physical device. The bottom bar is the component most affected by real
  hardware — iOS home-indicator inset, Android gesture bar, and browser chrome that hides on scroll.
  `env(safe-area-inset-bottom)` is applied but unverified on a real handset. This joins the existing
  real-device checklist the user covers directly.
- **`ReviewPage` is now visibly wider on desktop** (D7). Intended by its original author, but it was
  out of the plan's scope and is worth a second look.
- Neutral colours were not migrated to semantic tokens (D9).
- Task 09's duplicate source-panel signed-URL request and two-query detail polling remain open,
  untouched by this task.
- The `>500 kB` JS chunk advisory is unchanged and still unaddressed.
