# Iteration 13 - UI feedback, capture layout and clarity polish

**Date:** 2026-08-24
**Plan:** `.agents/plans/ui-feedback-and-capture-polish.md`
**Commit:** uncommitted

## What changed

- Rebuilt the capture screen as an unboxed responsive two-column workflow with a real three-step
  explanation on desktop and a single `Preparing your receipt` upload state.
- Added an accessible success toast provider that remains mounted across route changes, auto-dismisses
  after six seconds, pauses on hover/focus, supports Escape and offers a dismiss button.
- Made the confirm action primary, save secondary, and surfaced save/confirm feedback through toasts.
- Centralized review-field rendering so every low-confidence field has an amber border, warning icon,
  visible explanation and `aria-describedby`, without incorrectly using `aria-invalid`.
- Removed the redundant reload-source action, replaced remaining black primary buttons with accent blue,
  added consistent pointer/not-allowed cursors, and improved processing-state layout.
- Kept history action labels stable while export/delete is busy, using icon-only spinners,
  `aria-disabled` and separate status text. Croatian receipt counts now use CLDR plural categories.

## Tests and validation

- Added toast, upload-state, review accessibility/toast, history busy-state/plural and shell-region
  coverage. Locale parity now validates plural base keys and each language's CLDR categories.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` and `npm run build` all pass.
  Full test suite: **37 files, 356 tests**.
- Phase 6.1-6.15 all pass, including the deliberate negative VITE secret-prefix check, locale mojibake,
  raw-fetch, route-order and money-safety checks. Workspace-specific Vitest runs also pass.
- Phase 7a was skipped because no `supabase/migrations/` file changed. Phase 7b passed against the
  hosted Supabase project: 8 auth, 3 repository and 14 route integration tests.

## Browser UI review

The changed capture UI was inspected in a real Chromium browser at 375 x 812 and 1440 x 1000 in both
English and Croatian. The mobile layout kept the bottom navigation clear, showed no horizontal overflow
(`scrollWidth` 360 at a 375 px viewport), and the desktop layout showed the sidebar with no bottom bar.
The two-column capture composition, translated copy, controls and spacing rendered correctly; no browser
console errors were reported.

This iteration's browser check intentionally focused on the UI/UX changes. The full upload-to-review
journey was not counted as part of the browser result.

## Known follow-ups

- The existing production bundle advisory remains: the client JS chunk is over 500 kB after minification.
- Real-phone camera and safe-area testing remain outside this desktop-browser review.
