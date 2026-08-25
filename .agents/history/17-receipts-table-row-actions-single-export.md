# Iteration 17 — Receipts table, row actions & single-receipt export

**Date:** 2026-08-25
**Plan:** none — the user asked for research, questions, then direct implementation, explicitly
skipping `/plan-feature` and `/execute` and asking for a proportionate rather than full validation
sweep.
**Commit:** see this task's commit.

## Why this iteration exists

The user raised four things about the receipts screen:

1. The desktop layout wasted most of the available width on a card list.
2. There was no way to export a **single** receipt — only every confirmed one at once.
3. The mobile card list was broadly fine, but per-receipt download and phone pagination were unproven
   and worth checking against current practice.
4. The standalone "Export" card felt wrong, and its placement needed rethinking at both widths.

## Research, and what it settled

A subagent gathered current guidance from IBM Carbon, Material 3, Shopify Polaris, GOV.UK, Nielsen
Norman Group, Atlassian and the WAI-ARIA APG. Six findings shaped the build:

- **Row actions belong in an overflow menu at three or more actions** (Carbon), and on touch devices
  the trigger must be persistently visible rather than hover-revealed. NN/g's caveat — hidden
  controls are clicked far less than visible ones (27% vs 48%) — is why only *secondary* actions went
  behind the ⋮ and opening a receipt stayed a plain visible link.
- **Bulk actions belong in a toolbar tied to the table** (Polaris, Carbon), not a detached card.
- **A destructive action is confirmed in a modal dialog before the fact** (Material 3, GOV.UK);
  snackbar-with-undo is for acknowledging something already done reversibly. The APG requires focus
  trapping, an inert background, `aria-labelledby`/`aria-describedby`, initial focus on the *least*
  destructive action, and Escape returning focus to the invoker.
- **On mobile web the expected substitute for an inline menu is a bottom sheet** (Material 3);
  swipe-only actions are discouraged (NN/g) for discoverability.
- **Pagination beats infinite scroll** for a records list a user needs to return to (NN/g), with
  44×44px targets.
- **Two download formats want one control with two entries**, not two standalone buttons (Atlassian
  split button, Carbon export pattern).

## Decisions the user made when asked

Export scope stays **confirmed-only** at both scopes; delete is confirmed in a **native modal
dialog**; bulk export moves into a **toolbar Export menu** at both widths; the phone keeps its cards
but gains the same **⋮ menu**; the table appears at **`lg` (1024px)**; columns are **issue date,
seller, number, total, status, actions**; and a confirmed receipt is **also downloadable from its own
review screen**.

## What was built

**A single-receipt export endpoint.** `GET /api/receipts/:id/export?format=csv|json` reuses the
existing `toCsv`/`toJsonExport` serializers with a one-element array, so a single-receipt CSV has the
identical columns and a single-receipt JSON body the identical `schemaVersion` envelope. Only a
`confirmed` receipt exports; anything else is `409 export_not_allowed`, which makes the scope an API
guarantee rather than a hidden button. Two path segments mean Express can never confuse it with the
bulk `/export` route.

**`ActionMenu`, one overflow menu with two CSS-driven presentations.** A dropdown under the trigger
at `lg`; a modal bottom sheet with a scrim below it, where `position: fixed` means the sheet cannot
be clipped by the card that owns it. It follows `AccountMenu`'s precedent as a disclosure rather than
an ARIA menu, avoiding a roving-tabindex implementation for what is a short list of plain commands.

**`ConfirmDialog`, a native `<dialog>` opened with `showModal()`.** The element was chosen precisely
because it promotes itself into the top layer and makes the page inert — which is where iteration
12's hand-rolled drawer failed, marking the app root `inert` from inside that root and opening
unfocusable. A top-layer dialog structurally cannot repeat that.

**The table and the card list, as mutually exclusive layouts.** `useWideLayout` reads
`(min-width: 1024px)` and only one tree renders. Rendering both and hiding one with CSS — the
existing precedent from `AppLayout`'s two navigations — was rejected here: a whole receipts list
would put two copies of every row *and every action menu* in the tree.

**The toolbar.** Status filter left, Export menu right, at both widths; the Export card is gone.

## Files created / modified

**API** — `api/src/routes/receipts.ts` (the `/:id/export` route);
`api/src/routes/receipts.integration.ts` (one test covering all five outcomes).

**Client** — new: `components/ActionMenu.tsx`, `components/ConfirmDialog.tsx`,
`history/ReceiptActions.tsx`, `history/ReceiptTable.tsx`, `history/ReceiptCards.tsx`,
`history/useWideLayout.ts`, `components/ActionMenu.test.tsx`. Modified: `routes/HistoryPage.tsx`
(rewritten around the toolbar, the two layouts and the dialog), `routes/ReviewPage.tsx` (a Download
menu for a confirmed receipt), `api/client.ts` (`exportReceipt`), `history/download.ts`
(`receiptExportFilename`), `test/setup.ts` (the jsdom `<dialog>` stub), `routes/HistoryPage.test.tsx`,
`history/download.test.ts`, and both locale files.

**Docs** — `README.md` (the endpoint, the two layouts, the menu and dialog rationale, the two export
scopes), `.claude/commands/validate.md` (three Phase 4 rows, the new Phase 8.15 journey, and the
Phase 6.14 correction below), `.agents/ROADMAP.md`.

## Decisions made

- **Single-receipt export reuses the bulk serializers rather than gaining its own.** One receipt is
  an array of one; a second code path would be a second place for the CSV columns to drift.
- **`409 export_not_allowed`, not a silently hidden button.** The UI hides the action for a
  non-confirmed receipt, but the rule lives in the API.
- **Download filenames lead with the document number**, which is what a person recognizes a receipt
  by — reduced to a conservative safe character set first, because it is untrusted OCR text heading
  for a filesystem, and falling back to a short id when OCR read nothing usable.
- **The table container sets no `overflow`.** `overflow-x: auto` also clips vertically and would cut
  off an open row menu; `table-fixed` with explicit column widths handles long text instead.
- **jsdom's missing `<dialog>` is stubbed in the test setup, not worked around in the component.**
  The stub only restores visibility to queries; modality is verified in a browser.

## Deviations from the plan

No plan existed. One deviation from the *research*: Carbon's export pattern puts format choice in a
modal with radio buttons, which for two formats and a PoC would be a dialog to open a dialog. The
Atlassian/menu shape was used instead, and the same menu component then serves both the row actions
and the two export controls.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, exit 0 |
| `npm run lint` | Pass, zero errors (after fixing two `consistent-function-scoping` errors in the test stub) |
| `npm run format:check` | Pass |
| `npm test` | Pass: **44 files, 404 tests** (was 43 files / 392 at the end of iteration 16) |
| `npm run test:integration` (hosted) | Pass: 8 auth + 3 repository + **16** route (was 15; added the single-export test) |
| Phase 6.5, 6.6, 6.9, 6.11, 6.14, 6.15 | Pass — the checks this diff implicates (i18n, docs, fetch centralization, encoding, extraction freezing, route order) |
| Phase 7a (Docker migrations) | Skipped, legitimately — no file under `supabase/migrations/` changed |
| Phase 8.15 (new journey) | Run in full, in Chromium at 1440×1000 and 390×844, in both languages |

### Phase 6.14 was already red before this iteration

The check rejected any *mention* of `originalExtraction` in `api/src/routes/receipts.ts`. Iteration
16's `editedFields` projection legitimately **reads** `state.originalExtraction`, so the check had
been failing at `a887d67` — unnoticed, because that iteration deliberately ran only the checks its
own diff implicated. The grep now looks for the property being *assigned*, which is what a write into
a repository input actually looks like, and still fails on `update(id, { originalExtraction: … })`.
The code was never wrong; the grep was. Confirmed against `git show HEAD` before changing anything.

### Real-browser verification

Chromium via `agent-browser`, against a disposable `uicheck-17@example.test` account seeded directly
through the admin client — 26 receipts across all four statuses, no Azure call, deleted afterwards
(`receipts.user_id` cascades; no Storage objects were created). No orphan users remained.

- **1440×1000.** Table renders with the six expected headers; `scrollWidth` 1425 against a 1440
  viewport, so no horizontal overflow even with a deliberately over-long seller name and a
  22-character document number, both truncating. An open row menu measures 240×150, sits inside the
  viewport, and `elementFromPoint` at its centre resolves to a menu item — the check that would catch
  an `overflow` regression. Focus lands on the first item. A confirmed row shows three actions, a
  `review` row shows only Delete.
- **The delete dialog.** `dialog.matches(":modal")` true, so genuinely top-layer;
  `aria-labelledby`/`aria-describedby` both resolve; the body names the seller and states the
  consequence; initial focus on "Keep it"; `elementFromPoint` outside its box hits the dialog's
  backdrop rather than the page; Escape closes it and returns focus to the ⋮ trigger. A real delete
  removed the row and the count fell from 5 to 4.
- **390×844.** Card list, no table, `scrollWidth` 375. The sheet anchors to the viewport bottom,
  covers the fixed tab bar, its three items are each exactly 44 px tall, and a pointer on the scrim
  closes it. With 26 receipts: "Page 1 of 2", Previous correctly disabled, the pagination bar clears
  the tab bar, and paging forward lands at the **top** of page 2 (the loading skeleton collapses the
  page height, which clamps the scroll — verified `scrollY === 0`, not assumed).
- **Single-receipt export.** `GET /api/receipts/:id/export?format=csv` from a row menu and
  `?format=json` from the review screen both returned 200 against the real API.
- **Croatian.** Row menu, sheet heading, Export label and the full delete dialog all render
  translated with correct diacritics and no raw keys.

### One defect found and fixed by looking

The labelled `ActionMenu` variant rendered the overflow ellipsis as its leading glyph, so the toolbar
read "⋮ Export ⌄". Every test passed — nothing asserts which icon a button carries. Fixed by giving
the labelled variant its own icon (a download glyph); the icon variant keeps the ellipsis.

## Known gaps / follow-ups

- **A row menu opened on the last visible row of a long desktop table can extend below the fold.**
  The page scrolls, so nothing is unreachable, but the menu does not flip upward near the viewport
  bottom. Left alone deliberately: flipping needs measurement and a re-render, and the case did not
  look bad at 26 rows.
- **Bulk export still ignores the status filter**, unchanged from Task 11 and still per PRD §7.12 —
  "Export" always means every confirmed receipt. Worth revisiting if a user reads the filter as
  scoping it.
- **The table has no column sorting.** History remains `created_at desc` server-side; sortable
  headers would need API support and were not asked for.
- **`ReceiptCards` and `ReceiptTable` each render the same five values** in their own markup. Their
  layouts share nothing visually, so no abstraction was introduced, but a sixth field would have to
  be added in two places.
- Not re-verified on a real phone — the mobile checks were Chromium at 390×844. The standing
  real-device checklist from iteration 6 is unchanged.
