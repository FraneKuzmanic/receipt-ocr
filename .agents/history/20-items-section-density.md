# Iteration 20 — Items section density

**Date:** 2026-08-26
**Plan:** _none — user asked for research, a recommendation, then a direct implementation_
**Commit:** _pending human review_

## Why this iteration exists

The user reported visual clutter in the review form's items section: a receipt with many items rendered
each item as four **stacked, individually labelled, full-width** fields, so a ten-item receipt produced
roughly forty label/input blocks and the section became most of the page.

## What was decided, and why

The app already had a precedent for exactly this problem. Iteration 17 solved "too much per row" on
the receipts history screen with a responsive split — a dense `<table>` at `lg` and condensed cards
below it, chosen once through `client/src/history/useWideLayout.ts`. The same shape applies here, and
the general pattern for editable line-item lists is the same idea: stop repeating the field label on
every row, state it once as a column header, and let the row carry the value.

Three options were put to the user: a real table, condensed single-row cards, or collapsed rows that
expand on tap. They chose, per breakpoint:

- **Desktop: a real compact table** with column headers.
- **Phone: condensed cards** with all fields still visible — no tap-to-expand.
- **Warnings: amber cell plus one note below the row**, rather than a full amber explanation under
  every flagged cell.
- **No item-count cap** — no "show first N" toggle; the denser row is expected to carry any length.

## What was built

`client/src/review/ItemRows.tsx` renders the items list and nothing else; `ReviewPage` keeps the
`<fieldset>` and its `SectionLegend` and now delegates the rows. It reuses `useWideLayout` rather than
introducing a second breakpoint, so only one layout ever exists in the accessibility tree.

**Wide:** a `table-fixed` `<table>` — description 40%, quantity 16%, unit price and total 20% each,
and a 44 px actions column. Because a `<th scope="col">` labels a *cell* and not the control inside
it, every input carries an `aria-label` built from the new `review.itemFieldLabel` key, naming the
field and the item number.

**Narrow:** a card per item — description with the remove button beside it, then quantity, unit price
and total in a three-column grid, each under a small caption.

**Flagged values.** A dense row has no space for prose under each cell, so the amber cell styling and
`aria-describedby` are preserved verbatim from `ReviewField`, while the explanations collapse into one
note per item that names each affected field. Warnings still take precedence over the generic
low-confidence hint on the same field, matching `ReviewField` exactly.

**Remove** became a 44 px icon button with a translated `aria-label` (`review.removeItem`) instead of
a full-width "Remove row" text link, which at one link per item was itself part of the clutter.

Every input keeps its `review-field-items-N-<field>` id. That id is load-bearing in two directions —
`selectRegion` focuses by it when a source outline is clicked, and the form's `onFocusCapture` parses
it back into a canonical path to raise the matching outline — so source-region highlighting still
works per item cell.

## Files created / modified

**Created** — `client/src/review/ItemRows.tsx`, this file.

**Modified** — `client/src/routes/ReviewPage.tsx` (items block replaced by `<ItemRows />`),
`client/src/i18n/locales/{en,hr}.json` (`review.removeItem`, `review.itemFieldLabel`), `README.md`.

## Deviations

None. The implementation follows the four choices the user made.

## Validation results

Per the user's instruction this iteration was implemented directly and validated only where the diff
implicated something; they are verifying the visual result themselves.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass, exit 0 |
| `npx vitest run --project client ReviewPage i18n` | Pass: 5 files, 23 tests — includes the `hr`/`en` parity test that covers the two new keys |
| `npx oxlint` on both changed source files | Pass, exit 0 |
| `npx prettier --write` on the four changed files | Applied, no further changes |

Not run, deliberately: the full `npm test`, `npm run build`, Phase 6 security checks, Phase 7
integration and the Phase 8 browser journeys. Nothing in this diff touches the API, the schema,
configuration or money handling.

## Known gaps / follow-ups

- **Real-browser verification is outstanding**, and this change is layout work — the table's fit
  inside the form's `max-w-lg` column at 1024 px, and the three-column numeric grid at 320 px, are
  exactly the kind of thing jsdom cannot see. The user is checking it manually.
- **The VAT breakdown section still uses the old stacked-field cards.** It was left alone on purpose:
  the user's report was about items, and a VAT recap is typically one to three rows, where the
  clutter does not arise. If it ever should match, `ItemRows` is the template.
- **Item field validation errors are still invisible, and this is pre-existing.** `ReviewPage` renders
  `formError(...)` only for top-level fields; neither the VAT rows nor the item rows ever did, so an
  unparseable item amount blocks submission with no message. This iteration deliberately did not
  change that — it is a separate defect, not a consequence of the new layout, but the denser layout
  makes it slightly more visible since the amber cell now stands alone.
- **There are no unit tests for `ItemRows`.** `ReviewPage.test.tsx` never asserted anything about
  items, so nothing broke; the table-versus-cards branch and the one-note-per-item rule are currently
  unguarded.
