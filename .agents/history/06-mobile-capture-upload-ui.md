# Task 06 — Mobile capture & upload UI

**Date:** 2026-08-18
**Plan:** `.agents/plans/mobile-capture-upload-ui.md`
**Commit:** `feat(receipts): add mobile capture and upload UI`

## What was built

Authenticated users can now select a receipt from the primary scan action or the file picker,
inspect a local preview, receive non-blocking quality guidance, replace the selection, and upload
the exact selected file to `POST /api/receipts`. The primary image input requests the environment
camera on supporting mobile browsers and falls back to the operating system's normal file-picker
behavior when capture is unavailable.

The processing route polls the canonical receipt endpoint immediately and then every two seconds.
It routes `review` and `confirmed` receipts to the review placeholder, presents `failed` receipts
with an actionable retry path, and turns a still-processing receipt into an actionable timeout after
60 seconds. Task 07 will supply the OCR worker that changes a newly uploaded receipt out of
`processing`.

## Files created / modified

- `client/src/capture/receiptFile.{ts,test.ts}` — file classification, local preview analysis and
  quality guidance.
- `client/src/api/client.{ts,test.ts}` — multipart receipt creation, canonical receipt polling and
  structured API errors.
- `client/src/routes/{HomePage,ProcessingPage,ReviewReadyPage}.{tsx,test.tsx}` and
  `client/src/App.tsx` — capture, processing and review-ready routes plus their focused tests.
- `client/src/i18n/locales/{en,hr}.json`, `client/package.json`, `package-lock.json` — translated
  UI copy and `lucide-react` icons.
- `README.md`, `.claude/commands/validate.md`, this history and the roadmap — usage and validation
  records.

## Decisions made

1. **D1 — Native mobile capture hint.** The scan input is an `image/*` file input with
   `capture="environment"`. It is the smallest implementation that opens a rear-camera flow where
   the browser supports it and naturally falls back to choosing an existing image. Desktop browsers
   commonly ignore this hint and open a file picker; live webcam capture was not in Task 06 scope.
2. **D2 — Client quality checks are advisory.** Type, size, resolution and blur checks provide
   translated guidance but do not reject a borderline readable receipt. The server remains the
   security and acceptance boundary.
3. **D3 — Upload originals unchanged.** Preview analysis creates only temporary browser object URLs;
   it never downscales or transforms the file sent to the API.
4. **D4 — 60-second processing timeout.** Until Task 07 wires extraction, a `processing` receipt is
   expected to reach the timeout state. The UI makes this explicit and offers a fresh status check.
5. **D5 — `lucide-react` 1.32.0.** Used for the small, accessible action icons required by the
   capture UI rather than adding custom SVG assets.

## Deviations from the plan

No implementation changes beyond the approved plan. The plan's mandatory real-phone Phase 8 journey
was not performed because the prototype is only locally accessible. The user explicitly accepted
deferring that validation until a hosted/prod-like deployment is available.

## Validation results

```
npm run lint .................... PASS
npm run typecheck ............... PASS
npm run format:check ............ PASS
npm test ........................ PASS — 21 files, 235 tests
npm run build ................... PASS — existing Vite >500 kB chunk warning
npm run validate ................ PASS
npm run test:integration ........ PASS — 3 files, 18 tests against the hosted Supabase project
```

Desktop manual validation was reported by the user as successful for the states they exercised.
A PNG upload reached the processing screen and showed “This is taking longer than expected” at about
60 seconds. That timeout is expected before Task 07: Task 06 creates the receipt in `processing`,
but Task 07 is responsible for OCR and the transition to `review` or `failed`.

## Known gaps / follow-ups

- **Deferred validation:** on a real iOS or Android browser against a hosted deployment, test the
  rear-camera capture flow, deny camera permission and confirm the file-picker fallback, retake an
  image, and complete the one-handed journey. This is a validation gap, not an implementation claim.
- Task 07 owns the OCR worker and server-side `processing` → `review`/`failed` status transitions.
