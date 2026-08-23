# Feature: UI shell, navigation & home-page polish

The following plan should be complete, but it is important that you validate documentation and
codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files.

> **Roadmap task:** none — the numbered roadmap finished at Task 11. This is user-directed iteration
> against the deployed prototype, which `.agents/ROADMAP.md` §3 explicitly says is how work proceeds
> from here. It still follows the standing rules in ROADMAP §5 and gets a history file.
> **Depends on:** the current `prototype/receipt-ocr` branch head.

---

## Feature Description

The application works end to end but looks like a prototype. Its shell is a two-row header holding a
plain text app name, a sign-out button, an HR/EN pair and two undifferentiated navigation links.
There is no indication of which page you are on, no identity display, no accent colour anywhere, and
on a desktop screen the content sits in a narrow column hard against the top of the viewport with
several hundred pixels of empty grey below it.

This task rebuilds the shell and the capture screen. It introduces a hamburger drawer on mobile and a
persistent sidebar on desktop, a shorter single-row header with a branded wordmark at top left, an
account disclosure showing who is signed in, a visually smaller but still accessible language
switcher, a vertically and horizontally centred capture card, and a single accent colour applied
consistently. It also closes three defects the research pass surfaced: no active-page state, an
invisible focus indicator on the two capture controls, and a missing navigation landmark.

## User Story

As a business user
I want the application to have clear, consistent navigation and a capture screen that looks
deliberately designed on both my phone and my laptop
So that I can tell where I am and what to do next, and so the prototype is credible to show to
someone else

## Problem Statement

Seven concrete gaps exist today, verified against the current source:

1. **No active-page indication, visual or programmatic.** `client/src/components/AppLayout.tsx:38-49`
   renders both destinations with a plain `<Link>` and identical classes. Nothing marks the current
   page and no `aria-current` is emitted. With two destinations and no marker, orientation depends
   entirely on reading the page heading.

2. **No navigation landmark.** The two links sit in a bare `<div>` (`AppLayout.tsx:37`). Screen-reader
   users get no `navigation` landmark to jump to.

3. **The header is two rows and therefore tall.** `AppLayout.tsx:21` renders a title/controls row
   (`py-3`) and `AppLayout.tsx:37` renders a second nav row (`pb-3`) beneath it. Combined with the
   44px controls inside, the header consumes roughly 110px of vertical space on a phone before any
   content renders.

4. **No identity anywhere.** `AppLayout.tsx:26-33` renders a bare "Sign out" button. The signed-in
   user's email is available on `session.user.email` and is never displayed, so there is no way to
   confirm which account you are in. Sign-out also sits permanently in the header competing with the
   language switcher for space.

5. **The desktop layout is a stretched phone layout.** `main` is `mx-auto max-w-3xl px-4 py-6`
   (`AppLayout.tsx:53`) and `HomePage` is `mx-auto max-w-lg` (`HomePage.tsx:114`). Both centre
   horizontally, which is correct, but the content is top-aligned with no bounding surface, so on a
   1440×900 screen the capture actions float in the upper-left third of an empty page.

6. **The two capture controls have no visible focus indicator — a live WCAG 2.4.7 failure.**
   `HomePage.tsx:172-196` wraps an `sr-only` `<input type="file">` inside a `<label>`. The input is
   focusable (it is `sr-only`, not `hidden`), so keyboard focus does land — but the focus ring is
   painted on the invisible input, not on the visible label. A keyboard user tabbing through the home
   page sees nothing move.

7. **No accent colour and no focus-visible policy.** `client/src/index.css` contains only
   `@import "tailwindcss"` and a font stack. Every colour in the app is a hardcoded `slate-*` at the
   call site, and `slate-900` as the primary button fill reads as an unstyled default rather than a
   chosen one.

Two smaller items in the agreed scope:

8. **Bare spinners on two data-loading screens.** `HistoryPage.tsx:139` and `ReviewPage.tsx:72` both
   render `<Spinner />` while fetching, which gives no sense of the shape of what is coming.

9. **A thin empty state.** `HistoryPage.tsx:149-159` renders one line of text and a button. It is the
   first screen a new account sees.

## Solution Statement

Rebuild `AppLayout` as a three-part shell — a single-row sticky header, a persistent desktop sidebar,
and a mobile drawer — with the account disclosure and language switcher in the header at every
breakpoint. Extract the drawer, the sidebar, the account menu and the nav-item styling into small
components under `client/src/components/`, and extract initials derivation into a pure, tested module
under `client/src/auth/`.

Add a minimal accent token set to `@theme` in `index.css` plus one global `:focus-visible` rule, and
apply them in the files this task touches. Rebuild the home page as a bounded, vertically centred
card with a clearly dominant primary action.

Navigation uses React Router's `NavLink`, which supplies both the `isActive` flag for styling and
`aria-current="page"` automatically — fixing gaps 1 and 2 in the same change that builds the drawer.

## Feature Metadata

**Feature Type**: Enhancement — no new API surface, no schema change, no new npm dependency.
**Estimated Complexity**: Medium — the visual work is straightforward; the mobile drawer's modal
accessibility contract (focus trap, `inert`, scroll lock, focus restoration) is where this task can
silently ship something broken.
**Primary Systems Affected**: `client/src/components/AppLayout.tsx`, four new components under
`client/src/components/`, `client/src/auth/userIdentity.ts` (new), `client/src/routes/HomePage.tsx`,
`client/src/routes/HistoryPage.tsx`, `client/src/routes/ReviewPage.tsx`, `client/src/index.css`, both
locale files, `README.md`, `.claude/commands/validate.md`.
**Dependencies**: None. `lucide-react` and `react-router` are already installed; no component library
is to be added (CLAUDE.md §2 — pulling in Radix or Headless UI to obtain one disclosure is a larger
surface than the code it replaces).

---

## DESIGN DECISIONS — settled with the user, do not relitigate

These were decided in the planning conversation. Implement them as written. If one turns out to be
technically impossible, stop and report rather than substituting a different choice.

| # | Decision | Notes |
| --- | --- | --- |
| D1 | **Hamburger drawer on mobile, persistent sidebar on desktop.** | The user chose this over a bottom tab bar after being shown the research against it. Recorded trade-off in NOTES. Do not re-open. |
| D2 | **The account menu shows the email, not a name.** | There is no first/last name anywhere in the system: `AuthProvider.tsx:42-48` calls `supabase.auth.signUp({ email, password })` with no metadata, and `AuthForm.tsx` collects only those two fields. Adding names was explicitly declined to keep this a pure UI pass. Derive an initials avatar from the email. |
| D3 | **Scope is the shell and the home page**, plus three named extras (active state, skeletons, empty state). | Do not restyle the login/register forms, the processing page internals, the review form internals, or the history list rows beyond what the extras require. |
| D4 | **Neutral base plus one accent: deep blue.** | `#1d4ed8` (Tailwind blue-700) on white is ≈7:1, comfortably AAA. Used for the primary action, the active nav item, the brand mark and focus rings. Nothing else changes colour. |
| D5 | **The capture card is centred both horizontally and vertically** on desktop. | Must not clip when a tall preview image is showing — see Task 3 for the exact technique. |
| D6 | **No dark mode.** | Deliberately skipped. Do not add `prefers-color-scheme` blocks or a theme toggle. |
| D7 | **Language switcher stays in the header at every breakpoint**, visually smaller on mobile. | Not folded into the account menu: a user who lands in the wrong language needs the escape hatch visible. |
| D8 | **Keep the name "Receipt Scanner" / "Skener računa" and add a small accent-coloured mark.** | A lucide glyph in a rounded accent tile. No image asset, no new dependency, no custom font. |
| D9 | **The drawer contains navigation only.** The account disclosure lives in the header at all sizes. | Putting identity and sign-out in both places would ship two sign-out controls. If the user wants it in the drawer instead, that is a checkpoint decision, not an implementation choice. |
| D10 | **Sign out is styled neutrally and has no confirmation step.** | Red is reserved for deleting a receipt, which is the one genuinely destructive action in the app. Signing out is reversible. |
| D11 | **Skeletons on the history list and the review screen only — not on the processing page.** | Polling for OCR is an indeterminate multi-second wait, not a page load; a skeleton there would imply content is imminent. Keep its spinner. |
| D12 | **Accent tokens only; neutrals stay as `slate-*` utilities.** | A full semantic-token migration would touch every file in the client for zero visual change, which fails CLAUDE.md §3. Recorded as a follow-up. |

---

## CONTEXT REFERENCES

### Files to read before starting

| Path | Why |
| --- | --- |
| `client/src/components/AppLayout.tsx` | The file being rebuilt. Note the `useEffect` at lines 13-16 that syncs `document.documentElement.lang` and `document.title` — it must survive verbatim. |
| `client/src/components/LanguageSwitcher.tsx` | Being resized, not rewritten. Its `role="group"` + `aria-pressed` + per-button `lang` attributes are correct and must be preserved (see NOTES). |
| `client/src/routes/HomePage.tsx` | Being re-laid-out. All capture logic — `selectFile`, `clearSelection`, `upload`, `selectionVersion`, the object-URL lifecycle — must survive untouched. |
| `client/src/auth/AuthProvider.tsx`, `client/src/auth/AuthContext.ts`, `client/src/auth/useAuth.ts` | Source of `session` and `signOut`. `session.user.email` is `string \| undefined`. |
| `client/src/routes/HistoryPage.tsx` | Lines 139 (spinner) and 149-159 (empty state) are the only parts in scope. |
| `client/src/routes/ReviewPage.tsx` | Line 72 (`if (receipt === null) return <Spinner />`) is the only part in scope. |
| `client/src/i18n/index.ts` | Translation keys are compiler-checked against `en.json` via the `CustomTypeOptions` declaration at lines 14-18. A key added to `hr.json` but not `en.json` is invisible to the type system; a key used in code but absent from `en.json` is a compile error. |
| `client/src/components/Spinner.tsx` | Existing loading primitive. Keep it; the skeletons are additive. |
| `.claude/commands/validate.md` | The checks this work will be measured against. Phases 4, 6.5, 6.11 and 8 all apply. |

### Conventions that will bite

- **`react-router`, never `react-router-dom`.** `NavLink` imports from `react-router`.
- **`client` uses `bundler` module resolution** — extensionless relative imports are correct here.
  (`api` and `shared` use `nodenext` and need `.js`; that does not apply to any file in this task.)
- **No hardcoded user-facing strings.** Every new string needs a key in both `en.json` and `hr.json`.
  `client/src/i18n/i18n.test.ts` enforces parity and non-emptiness.
- **Write locale files as UTF-8.** Mojibake in `hr.json` has shipped twice on this project (Task 07
  and Task 10) and `/validate` Phase 6.11 exists because of it. Croatian text in this task includes
  `č`, `ž` and `ć`. Do not edit these files through a shell heredoc.
- **Prettier does not format `*.md`** — do not run it over this plan or the README.
- **`agent-browser set viewport` hangs indefinitely if no browser session is open.** Run
  `agent-browser open <url>` first. This cost four minutes in Task 11; the note is in its history.

---

## IMPLEMENTATION PLAN

Three stages. **Stage A ends at a mandatory human checkpoint.**

```
Stage A — the shell
  1. Accent tokens + global focus-visible          → verify: npm run build, ring visible on Tab
  2. Shell components + AppLayout rebuild          → verify: typecheck, AppLayout.test.tsx green
  ── CHECKPOINT: screenshots, both widths, both languages, human approval ──

Stage B — the home page
  3. Centred bounded capture card + focus fix      → verify: HomePage.test.tsx green, ring visible

Stage C — the three extras
  4. Skeletons (history + review)                  → verify: both page tests green
  5. Polished history empty state                  → verify: HistoryPage.test.tsx green
  6. Docs, validate.md, history file               → verify: full /validate sweep
```

Stage A's checkpoint is not optional and not a formality. Build it, screenshot it, stop, and wait.

---

## STEP-BY-STEP TASKS

### Task 1 — Accent tokens and a global focus-visible rule

**File:** `client/src/index.css`

Add a `@theme` block and extend the base layer. Tailwind v4 generates utilities from `@theme`
variables, so `--color-accent` yields `bg-accent`, `text-accent`, `border-accent`, `ring-accent`.

```css
@import "tailwindcss";

@theme {
  --color-accent: #1d4ed8; /* blue-700 — ≈7:1 on white, AAA for normal text */
  --color-accent-hover: #1e40af; /* blue-800 */
  --color-accent-soft: #eff6ff; /* blue-50 — active nav background */
  --color-accent-ring: #3b82f6; /* blue-500 — focus ring, visible on both */
}

@layer base {
  html {
    -webkit-text-size-adjust: 100%;
    /* Keeps form controls and scrollbars light; the app has no dark mode by design (D6). */
    color-scheme: light;
  }

  body {
    margin: 0;
    font-family:
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      sans-serif;
  }

  /* One policy for the whole app. `outline` is used rather than Tailwind's `ring` because it
     follows border-radius, takes no part in layout, and is not clipped by `overflow: hidden`. */
  :focus-visible {
    outline: 2px solid var(--color-accent-ring);
    outline-offset: 2px;
  }
}
```

Do **not** use `@theme inline` — it bakes values at build time and forfeits the real CSS variables.
Do **not** nest `@theme` inside a selector or media query; it must be top level.

**Verify:** `npm run build` succeeds and `client/dist/assets/*.css` is not a few hundred bytes (a tiny
CSS bundle means Tailwind did not run — see `/validate` Phase 5).

---

### Task 2 — The shell

Five files. Build them in this order; each is small.

#### 2a. `client/src/auth/userIdentity.ts` (new)

A pure module, so it is unit-testable without rendering anything.

```ts
/**
 * Two-letter avatar initials from an email address. There is no name in the system — sign-up
 * collects email and password only — so the local part is all we have to work with.
 */
export function initialsFromEmail(email: string | undefined): string
```

Rules, in order:

1. `undefined`, empty, or whitespace-only → `"?"`.
2. Take the local part (everything before the first `@`; if there is no `@`, the whole string).
3. Split on `.`, `_`, `-`, `+` and digit runs; discard empty segments.
4. Two or more segments → first letter of the first two, uppercased (`frane.kuzmanic9` → `FK`).
5. One segment → its first two letters, uppercased (`frane` → `FR`); a single character → that one
   letter uppercased.
6. If nothing alphabetic survives (`123456@x.com`) → `"?"`.

Non-ASCII must not throw: `žarko.ćurić@x.hr` → `ŽĆ`. Use `String.prototype.toUpperCase()`, which
handles this correctly; do not hand-roll a char-code uppercase.

Also export a display helper for the panel:

```ts
/** The email, or a translated fallback the caller supplies when the session has no email. */
export function displayEmail(email: string | undefined, fallback: string): string
```

#### 2b. `client/src/components/NavItems.tsx` (new)

The two destinations, defined once and rendered by both the sidebar and the drawer. Keeping this in
one place is what stops the two navigations drifting apart.

```tsx
import { Camera, ReceiptText } from "lucide-react";
import { NavLink } from "react-router";
```

Export a `NAV_ITEMS` constant — `{ to: "/", labelKey: "common.navCapture", Icon: Camera }` and
`{ to: "/receipts", labelKey: "common.navHistory", Icon: ReceiptText }` — and a `NavItems`
component taking `{ onNavigate?: () => void }` so the drawer can close itself on selection.

Each item renders a `NavLink`:

- `to={item.to}`, and **`end` on the `/` item only** — without `end`, the index route matches every
  path and both items would show as active on `/receipts`. This is the single easiest thing to get
  wrong here.
- `className` takes the `({ isActive })` callback form.
- Active: `bg-accent-soft text-accent font-semibold`. Inactive:
  `text-slate-700 hover:bg-slate-100`.
- Shared: `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm`.
- Icon `className="size-5 shrink-0"` with `aria-hidden="true"`.
- `onClick={onNavigate}`.

`NavLink` sets `aria-current="page"` on the active link by itself — do not add it manually, and do
not use `aria-selected` or `aria-pressed` (wrong roles for navigation).

#### 2c. `client/src/components/AccountMenu.tsx` (new)

A **disclosure**, not an ARIA menu. Do not add `role="menu"` or `role="menuitem"`: the panel holds a
static identity block plus one action, and `role="menu"` would oblige a roving-tabindex arrow-key
implementation and cause screen readers to announce the email as a menu item.

Trigger:

```tsx
<button
  type="button"
  aria-expanded={open}
  aria-controls="account-panel"
  aria-label={t("common.accountMenu")}
  className="grid min-h-11 min-w-11 place-items-center rounded-full"
>
  <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
    {initials}
  </span>
</button>
```

The 36px circle sits inside a 44px target — padding counts toward the pointer target, so this
satisfies WCAG 2.5.5 while looking compact.

Panel (`id="account-panel"`), rendered only when open, absolutely positioned under the trigger,
`right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg z-40`:

- A non-interactive identity block: `t("common.signedInAs")` in `text-xs text-slate-500`, then the
  email in `text-sm font-medium text-slate-900 break-all`.
- A separator.
- A sign-out `<button>`: full width, `min-h-11`, left-aligned, `text-sm font-medium text-slate-700
  hover:bg-slate-100 rounded-lg px-3`, with a lucide `LogOut` icon at `size-4`. **Neutral, not red,
  and no confirmation** (D10).

Behaviour — all four are required:

1. `Escape` closes the panel **and returns focus to the trigger button**.
2. A `pointerdown` listener on `document` closes it when the target is outside the container.
3. `focusout` on the container closes it when `relatedTarget` is outside (WCAG 2.1 SC 1.4.13).
4. No focus trap, no scroll lock, no arrow-key handling — this is a disclosure, not a dialog.

Remove all three listeners in the `useEffect` cleanup, and attach them only while `open` is true.

#### 2d. `client/src/components/NavigationDrawer.tsx` (new)

The mobile drawer. This is a **modal dialog** and carries the full APG contract. Every item below is
mandatory; a drawer missing any of them is a defect, not a simplification.

Props: `{ open: boolean; onClose: () => void; triggerRef: React.RefObject<HTMLButtonElement | null> }`.

Render nothing at all when `open` is false — this keeps a second copy of the nav links out of the
DOM, which matters both for the landmark structure and for the tests.

Structure when open:

```tsx
<div className="lg:hidden">
  {/* backdrop */}
  <div className="fixed inset-0 z-40 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="drawer-title"
    ref={panelRef}
    className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80vw] flex-col gap-2 border-r border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
  >
    <div className="flex items-center justify-between">
      <h2 id="drawer-title" className="px-2 text-sm font-semibold text-slate-900">
        {t("common.mainNav")}
      </h2>
      <button type="button" ref={closeRef} onClick={onClose} aria-label={t("common.closeMenu")} …>
        <X aria-hidden="true" className="size-5" />
      </button>
    </div>
    <ul>…NavItems with onNavigate={onClose}…</ul>
  </div>
</div>
```

Note there is **no nested `<nav>` landmark inside the dialog** — the persistent sidebar owns the one
`navigation` landmark, and two identically-labelled landmarks would be worse than one.

Required behaviour:

- **On open:** move focus to the close button (`closeRef.current?.focus()`).
- **On close:** restore focus to `triggerRef.current`.
- **`Escape`** closes.
- **Focus trap:** a `keydown` handler on the panel intercepts `Tab`/`Shift+Tab`, queries focusable
  descendants, and wraps at both ends. Query selector:
  `'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'`.
- **Background inert:** set the `inert` attribute on the app root element while open. `inert` is
  baseline in all current browsers and is far more reliable than sweeping `aria-hidden` and
  `tabindex`. Give the root container in `main.tsx` a stable `id` if it does not have one, and
  restore the attribute's previous state on close.
- **Scroll lock:** `document.documentElement.style.overflow = "hidden"` while open, restored on
  close. Pair with `scrollbar-gutter: stable` on `html` in `index.css` so desktop does not shift —
  though the drawer is `lg:hidden`, a narrow desktop window can still open it.

Every one of these belongs in a `useEffect` keyed on `open`, with a cleanup that reverses it. A
cleanup that forgets to restore `overflow` leaves the whole app unscrollable — check this explicitly.

#### 2e. `client/src/components/AppLayout.tsx` (rebuild)

Preserve verbatim: the `useEffect` syncing `document.documentElement.lang` and `document.title`
(lines 13-16 of the current file). It fixes a real bug and is not part of this task.

```tsx
const signedIn = session !== null;
```

Every navigation affordance — hamburger, sidebar, drawer, account menu — renders only when
`signedIn`. The login and register routes sit inside `AppLayout` but outside `ProtectedRoute`
(`App.tsx:16-17`), so this component genuinely renders with a null session and must not offer
navigation to a signed-out visitor.

Structure:

```tsx
<div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900">
  <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 lg:h-16 lg:px-4">
    {signedIn && (
      <button type="button" ref={hamburgerRef} onClick={() => setDrawerOpen(true)}
              aria-label={t("common.openMenu")} aria-expanded={drawerOpen}
              className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-slate-100 lg:hidden">
        <Menu aria-hidden="true" className="size-6" />
      </button>
    )}

    {/* Wordmark — top left, vertically centred, at every breakpoint */}
    <Link to="/" className="flex items-center gap-2 rounded-lg">
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-accent text-white">
        <ReceiptText className="size-5" />
      </span>
      <span className="text-base font-semibold">{t("common.appName")}</span>
    </Link>

    <div className="ml-auto flex items-center gap-1">
      <LanguageSwitcher />
      {signedIn && <AccountMenu />}
    </div>
  </header>

  <div className="flex min-h-0 flex-1">
    {signedIn && (
      <nav aria-label={t("common.mainNav")}
           className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-3 lg:block">
        <ul className="flex flex-col gap-1"><NavItems /></ul>
      </nav>
    )}
    <main className="min-w-0 flex-1">
      <Outlet />
    </main>
  </div>

  {signedIn && (
    <NavigationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} triggerRef={hamburgerRef} />
  )}
</div>
```

Two things moved out of `main`: the `mx-auto max-w-3xl` and the `px-4 py-6`. Each route now owns its
own container, because the home page needs a full-height centring wrapper that a shared padded
`max-w-3xl` would prevent. **`HistoryPage` and `ReviewPage` therefore need
`mx-auto max-w-3xl px-4 py-6` added to their own root elements** or they will render edge-to-edge.
This is the one place where an out-of-scope file must be touched, and it is a container class only —
do not restyle anything inside them beyond the two extras in Stage C.

Also note the wordmark is now a `<Link to="/">`. That is a third route into the capture screen and is
conventional, but it means a signed-out visitor on `/login` can click it; `ProtectedRoute` will bounce
them straight back, which is correct behaviour and worth confirming in the browser.

**Verify:** `npm run typecheck`, then `npx vitest run --project client`.

---

### 🛑 CHECKPOINT — stop here and wait for approval

Do not start Task 3. Bring up the stack and capture evidence.

1. Free the ports first — a stale Vite answers on 5173 while the new one silently moves to 5174 and
   every check then passes against old code (`/validate` Phase 8.1):

   ```powershell
   foreach ($p in 3001,5173,5174,5175,5176) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "cleaned port $p" } else { "port $p free" } }
   ```

2. `npm run dev:api`, and separately
   `npm run dev --workspace @receipt/client -- --host 0.0.0.0 --strictPort`. Confirm Vite reports
   **5173**.

3. Drive it with `agent-browser` — **`open` the URL before `set viewport`**, or the viewport command
   hangs indefinitely (Task 11 history). Sign in with a disposable account.

4. Capture screenshots and report them:

   | Viewport | Language | What must be shown |
   | --- | --- | --- |
   | 375 × 667 | en | Header closed, then the drawer open |
   | 375 × 667 | hr | Header closed, then the drawer open |
   | 1440 × 900 | en | Sidebar + header, then the account panel open |
   | 1440 × 900 | hr | Sidebar + header |

5. Report these measured facts, not impressions:
   - `document.documentElement.scrollWidth` equals the viewport width at 375 (no horizontal overflow),
     in both languages.
   - The header's computed height is 56px at 375 and 64px at 1024+.
   - Every interactive control in the header measures ≥44px in both dimensions
     (`getBoundingClientRect()` on the hamburger, each language button, the avatar).
   - Tabbing from the top reaches every header control with a **visible** focus outline.
   - With the drawer open: `Escape` closes it and focus returns to the hamburger; `Tab` cycles inside
     the drawer and never reaches the page behind it.
   - The active destination is visibly distinct and carries `aria-current="page"` — check on both `/`
     and `/receipts`, and confirm **only one** item is marked on each.

Then stop and ask for approval. Do not proceed on your own judgement.

---

### Task 3 — The home page

**File:** `client/src/routes/HomePage.tsx`

**Leave every piece of logic alone**: `selectFile`, `clearSelection`, `upload`, `selectionVersion`,
the `previewUrl` ref and its revocation, the quality warnings, the error handling. This task changes
layout and classes only. If you find yourself editing anything inside `async function upload()`, stop.

Replace the root `<section className="mx-auto flex max-w-lg flex-col gap-5">` with a centring wrapper
plus a bounded card:

```tsx
<div className="flex min-h-[calc(100dvh-3.5rem)] flex-col justify-center px-4 py-8 lg:min-h-[calc(100dvh-4rem)]">
  <section className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
    …
  </section>
</div>
```

Why this exact combination (D5): `min-h-` rather than `h-`, plus `justify-center`, plus vertical
padding. Because the height is a **minimum**, content taller than the viewport — a 60dvh preview
image with two warnings and an error — simply grows the container and `justify-center` has no spare
space left to distribute. A `grid place-items-center` with a fixed height would centre the overflow
and clip the top of the image off-screen. Verify this specific case in the browser with a tall
portrait photo.

The `3.5rem`/`4rem` subtractions are the header heights from Task 2. If you change the header height,
change these too.

Remaining changes inside the card:

- **Heading block:** keep `text-2xl font-semibold` on the `h1`. Add `max-w-prose` to the guidance
  paragraph. Text stays **left-aligned** — do not centre body copy inside the centred card.
- **Primary action** (`capture.scanReceipt` label): `min-h-14` (56px), `bg-accent hover:bg-accent-hover`,
  `text-base font-semibold text-white`.
- **Secondary action** (`capture.chooseFile` label): stays `min-h-12` (48px), outline style unchanged.
  The two currently share `min-h-12`, which reads as two equal choices; they are not equal.
- **The focus fix (gap 6 — a live WCAG 2.4.7 failure).** Add to *both* `<label>` elements:
  `focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-ring`. The label
  is the visible element; the focusable `sr-only` input is inside it, so `focus-within` is what paints
  a ring where the user is actually looking. Confirm by tabbing, not by reading the class list.
- **Upload / retake buttons** in the selected state: the upload button becomes `bg-accent
  hover:bg-accent-hover`; retake keeps its outline style. Both keep `min-h-11`.
- Keep the `role="alert"` error paragraph and the amber warning paragraphs exactly as they are.

**Verify:** `npx vitest run --project client` — `HomePage.test.tsx` queries by accessible role and
label, so it should pass unchanged. If a query breaks, fix the markup, not the test, unless the test
asserts a class name.

---

### Task 4 — Skeletons

**New file:** `client/src/components/Skeleton.tsx`

```tsx
/** A single shimmering placeholder block. Purely decorative — the announcement lives on the
 *  container, so every instance is aria-hidden. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded bg-slate-200 ${className ?? ""}`} />;
}
```

Both call sites wrap their skeletons in a container carrying the accessible announcement, so a screen
reader gets one "Loading" rather than a stream of meaningless boxes:

```tsx
<div role="status" aria-label={t("common.loading")} className="flex flex-col gap-3">…</div>
```

**`client/src/routes/HistoryPage.tsx` line 139** — replace `<Spinner />` with three skeleton cards
whose geometry matches the real rows at lines 164-229: `rounded-xl border border-slate-200 bg-white
p-4`, containing a wide title bar (`h-4 w-2/3`), a narrower subtitle (`h-3 w-1/3 mt-2`), and a
right-aligned pill. Three rows, not more — and match the real height, or the swap causes a jump that
feels worse than a spinner did.

**`client/src/routes/ReviewPage.tsx` line 72** — replace `<Spinner />` with a form-shaped skeleton:
a heading bar and four label/input pairs (`h-3 w-24` above `h-11 w-full`).

Do **not** touch `ProcessingPage` (D11).

---

### Task 5 — The history empty state

**File:** `client/src/routes/HistoryPage.tsx`, lines 149-159.

Keep the existing `history.empty` and `history.emptyAction` keys — deleting a key that both locales
already carry is churn. Add one new key, `history.emptyTitle`, and restructure:

```tsx
<div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-10 text-center">
  <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-slate-100">
    <ReceiptText className="size-6 text-slate-400" />
  </span>
  <h2 className="text-lg font-semibold text-slate-900">{t("history.emptyTitle")}</h2>
  <p className="max-w-prose text-sm text-slate-600">{t("history.empty")}</p>
  <Link to="/" className="mt-1 flex min-h-11 items-center rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover">
    {t("history.emptyAction")}
  </Link>
</div>
```

This is the one place centred text is right — it is a short, deliberately composed empty state, not
body copy.

---

### Task 6 — Translations, docs and validation

#### New translation keys

Add to **both** `en.json` and `hr.json`. `en.json` drives the compile-time key type, so add there
first. Write the files as UTF-8 — see the warning in CONTEXT REFERENCES.

| Key | `en` | `hr` |
| --- | --- | --- |
| `common.openMenu` | `Open menu` | `Otvori izbornik` |
| `common.closeMenu` | `Close menu` | `Zatvori izbornik` |
| `common.mainNav` | `Main navigation` | `Glavna navigacija` |
| `common.accountMenu` | `User menu` | `Korisnički izbornik` |
| `common.signedInAs` | `Signed in as` | `Prijavljeni ste kao` |
| `history.emptyTitle` | `No receipts yet` | `Još nema računa` |

`common.accountMenu` deliberately avoids "Račun", which in Croatian means both *account* and
*receipt* — in an application about receipts that would be genuinely ambiguous.

#### `README.md`

Update the client-architecture description to cover the shell: the header, the desktop sidebar
breakpoint (`lg`, 1024px), the mobile drawer and its modal semantics, the account disclosure, and the
accent token set in `index.css`. Keep it factual and brief.

`/validate` Phase 6.6 parses the README: every `` `path.tsx` `` in backticks must exist on disk and
every documented `npm run` script must be defined. New component paths mentioned there must be real.

#### `.claude/commands/validate.md`

Hand-extend it — **never regenerate** (the header of that file explains why: roughly 140 lines came
from real incidents and a regeneration would silently delete them).

Add Phase 4 rows:

| Test | Protects |
| --- | --- |
| `client/src/auth/userIdentity.test.ts` | Avatar initials derive from an email local part across separator, digit, single-token, non-ASCII and unusable inputs, and never throw |
| `client/src/components/AppLayout.test.tsx` | The drawer's modal contract — focus moves in on open, `Escape` closes and restores focus to the hamburger, `Tab` is trapped, the background is `inert` and scroll is restored on close; the account disclosure opens, signs out and closes on `Escape`; exactly one nav item carries `aria-current="page"` per route |

Add a Phase 8 journey **8.13 — the application shell**, covering: the drawer opens and closes on a
375px viewport with keyboard and pointer, the sidebar is persistent at 1440px and the drawer absent,
the active destination is marked on both routes, the account panel shows the signed-in email and
signs out, HR/EN remains ≥44px while visually smaller, the header measures 56/64px, and there is no
horizontal overflow in either language.

---

## TESTING STRATEGY

### New unit tests

**`client/src/auth/userIdentity.test.ts`** — pure, no rendering. Cover: `undefined`; `""`;
`"frane.kuzmanic9@gmail.com"` → `FK`; `"frane@x.hr"` → `FR`; `"f@x.hr"` → `F`;
`"žarko.ćurić@x.hr"` → `ŽĆ`; `"123456@x.com"` → `?`; a local part with no `@`; and
`"a_b-c@x.hr"` → `AB` (separator handling).

**`client/src/components/AppLayout.test.tsx`** — render inside a `MemoryRouter` with a mocked
`useAuth` returning a session, following the existing pattern in `ProtectedRoute.test.tsx`.

Cover:

1. Signed out: no hamburger, no sidebar, no account menu.
2. Signed in on `/`: exactly one element has `aria-current="page"`, and it is Scan. Then on
   `/receipts`: exactly one, and it is Receipts. *(This is the `end`-prop regression test — without
   `end` on the index route, both match on `/receipts`.)*
3. Clicking the hamburger renders a `role="dialog"` with `aria-modal="true"`; focus lands on the
   close button.
4. `Escape` closes the dialog and focus returns to the hamburger button.
5. While open, `document.documentElement.style.overflow` is `"hidden"`; after close it is restored.
6. Selecting a drawer link closes the drawer.
7. The account trigger toggles `aria-expanded`; the panel shows the session email; the sign-out
   button calls the mocked `signOut` exactly once.
8. `Escape` closes the account panel and returns focus to its trigger.

**A jsdom caveat to plan around:** jsdom does not evaluate Tailwind's responsive classes, so the
desktop sidebar is present in the DOM even at a notional mobile width. Scope drawer assertions with
`within(screen.getByRole("dialog"))` rather than by bare label text, or you will match the sidebar's
copy of the same link. This is exactly why the drawer renders nothing when closed.

Focus-trap wrapping is only partially testable in jsdom — real `Tab` traversal is not simulated. Test
what is deterministic (the keydown handler calls `preventDefault` at the boundary) and prove the rest
in the browser at the checkpoint.

### Updated tests

- `HistoryPage.test.tsx` — the empty state now has a heading; a skeleton container replaces the
  spinner during load. Adjust the queries; do not weaken the assertions.
- `ReviewPage.test.tsx` — same substitution for the loading branch.
- `HomePage.test.tsx` — expected to pass unchanged. Run it; if a role/label query breaks, the markup
  regressed.
- `i18n.test.ts` — passes automatically once both locale files carry all six new keys.

---

## VALIDATION COMMANDS

Run the full sweep from `prototypes/receipt-ocr/`. PowerShell 5.1 — chain with `;`, never `&&`.

```
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
npx vitest run --project client
```

Phase 6 checks that specifically bite on this task:

- **6.5** — every literal `t("…")` key resolves against `en.json`. Six new keys.
- **6.6** — README paths and scripts resolve.
- **6.9** — no raw `fetch(` outside `client/src/api/client.ts`. This task adds no network call; the
  check must still pass.
- **6.11** — no mojibake in either locale file. This task adds Croatian text containing `č`, `ž`
  and `ć`, so 6.11 is a live risk, not a formality.

Phase 7b (`npm run test:integration`) is required on every task by the roadmap even though this one
touches no API code. Run it and report the result. Phase 7a is legitimately skippable — no file under
`supabase/migrations/` changes — but the skip must be **named** in the report, not silently omitted.

Then the browser journeys: existing 8.4, 8.7, 8.11 (the shell now wraps every screen, so a shell
regression would surface there), plus the new 8.13.

---

## ACCEPTANCE CRITERIA

- [ ] On a 375px viewport a hamburger opens a left drawer holding both destinations; the backdrop
      dims the page; tapping a link navigates and closes it.
- [ ] The drawer traps `Tab`, closes on `Escape`, returns focus to the hamburger, marks the
      background `inert`, and restores page scrolling on close.
- [ ] At ≥1024px the sidebar is permanently visible, the hamburger is gone, and no drawer exists.
- [ ] Exactly one navigation item carries `aria-current="page"` and a visible active style, on both
      `/` and `/receipts`.
- [ ] The header is a single row: 56px on mobile, 64px on desktop, with the mark and app name at top
      left, vertically centred, at every breakpoint.
- [ ] The account control shows initials derived from the signed-in email, opens a panel showing that
      email, and signs out. It uses `aria-expanded`/`aria-controls` and has no `role="menu"`.
- [ ] HR/EN is visually smaller than before, and every language button still measures ≥44×44.
- [ ] On desktop the capture card is centred horizontally and vertically inside a bounded surface,
      and a tall portrait preview image makes the page scroll rather than clipping off the top.
- [ ] Tabbing to either capture control paints a visible focus ring on the visible label.
- [ ] The primary capture action is visibly dominant over the file-picker fallback.
- [ ] History and review render shaped skeletons while loading; the processing page still shows its
      spinner.
- [ ] The history empty state has an icon, a heading, an explanation and a primary action.
- [ ] Every new string is translated in both locales; no raw key renders in either language.
- [ ] No horizontal overflow at 320px or 375px, in Croatian or English, on any route.
- [ ] `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` and `npm run build` all
      pass.

---

## COMPLETION CHECKLIST

- [ ] Stage A built and the checkpoint screenshots delivered, **with approval received** before
      Stage B began.
- [ ] All three stages implemented.
- [ ] New tests written; existing client tests updated and passing.
- [ ] `README.md` updated to describe the shell.
- [ ] `.claude/commands/validate.md` hand-extended with two Phase 4 rows and journey 8.13.
- [ ] Full `/validate` sweep run and reported honestly, naming Phase 7a as a justified skip.
- [ ] A history file written at `.agents/history/12-ui-shell-navigation-polish.md` following the
      template in `.agents/ROADMAP.md` §1, recording the hamburger trade-off (see NOTES) as a
      decision so a future session does not reopen it.
- [ ] `.agents/ROADMAP.md` §3 given a short note that this iteration happened outside the numbered
      task list.
- [ ] The working tree left uncommitted for human review.

---

## NOTES

### The hamburger decision, and what it costs

The user chose a hamburger drawer over a bottom tab bar after being shown research arguing against
it. Recording the trade-off here so it is not rediscovered and re-litigated later:

Nielsen Norman Group's multi-site study measured hidden navigation against visible navigation and
found it used 57% of the time versus 86% on mobile, a >20% drop in content discoverability, a 21%
increase in perceived task difficulty, and 15–39% slower task completion. Their stated rule is to
display navigation visibly at four or fewer top-level links; this app has two. Google deprecated the
navigation drawer in Material 3 Expressive (May 2025) with no small-screen replacement.

The counter-arguments the user's choice rests on are real: a drawer keeps the mobile header to one
short row, it scales if destinations are added later, and it is the pattern most users have seen. The
mitigation is to build it to the full APG modal-dialog contract rather than a cheap approximation —
which is why Task 2d is specified in as much detail as it is.

**This decision is settled. Do not propose a bottom tab bar during execution.**

### Deliberately out of scope

Raised during research, agreed as not part of this task. Do not implement any of these:

- Dark mode in any form (D6).
- Keyboard shortcuts beyond `Escape` closing the drawer and the account panel.
- A FAB on the history screen. Genuinely well-motivated — it is the one screen where a floating
  action button meets Material's own criterion of floating over a scrollable list — but it is outside
  the agreed scope.
- Restyling the review form: the two-pane desktop split, a sticky source image, and per-field
  confidence indicators are all high-value and all separate work.
- Croatian-correct money and date formatting (`12,50 €` and `dd.MM.yyyy.`), and an OIB checksum
  check. Real quality gaps, unrelated to this task.
- `inputmode` / `enterkeyhint` on the review form inputs.
- Migrating neutrals to semantic tokens (D12).
- Client-side image downscaling, auto-crop, offline queue, PWA packaging.

### Things that are correct today and must not be "improved"

- **`LanguageSwitcher`'s `role="group"` + `aria-pressed` + per-button `lang`.** Converting it to a
  `radiogroup` looks more correct on paper but obliges a roving-tabindex arrow-key implementation,
  and GitHub Primer specifically warns that segmented controls and radio groups have incompatible
  keyboard contracts. The per-button `lang` attribute is a detail most implementations miss. Resize
  it; do not restructure it.
- **`system-ui` as the font stack.** Zero network cost, and Croatian diacritics are guaranteed
  present — which is not true of an arbitrary webfont subset. No Google Font.
- **Inline `role="alert"` errors.** Do not replace them with a toast library; an inline error next to
  its cause beats a toast that times out before it is read.
- **The `capture="environment"` / plain-input pair on the home page.** Two separate inputs is the
  documented approach precisely because desktop browsers ignore `capture` entirely. One input cannot
  serve both intents.

### Unattended-execution caveat

The standing pattern on this project is to hand an approved plan to an executing agent with no human
in the loop. **This plan deliberately breaks that pattern once**, at the Stage A checkpoint, because
the user asked for a visual review before the home page and the extras are built. The executing agent
must stop there and wait. Everything else runs unattended, and nothing in this plan requires a
physical device or a human hand — the real-phone camera checklist stays where it is, outside this
task.
