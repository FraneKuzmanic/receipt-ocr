# Feature Spec — Extraction accuracy, reliability & processing speed

**Status:** Draft for planning
**Date:** 2026-08-25
**Author:** drafted with the agent, from a client request and a live-evidence investigation
**Parent PRD:** [`PRD.md`](../../PRD.md) — refines §7.6 (Azure extraction), §7.7 (canonical mapping),
§7.8 (validation & warnings), §11.3 (data-quality evaluation) and §11.4 (performance targets)
**Roadmap position:** iteration 18, outside the numbered task list (see [`ROADMAP.md`](../ROADMAP.md) §3)
**Next step:** `/plan-feature Extraction accuracy, reliability & processing speed`

---

## 1. Summary

The prototype is functionally complete, but extraction quality and processing speed are now its
limiting factor. This spec covers four things, in priority order:

1. **Fix three confirmed extraction defects** — currency dropped when Azure supplies no symbol, VAT
   never extracted at all, and amounts silently lost to a `%` or a trailing tax-class letter.
2. **Make silent failures visible** — a receipt whose source plainly shows a VAT table must not
   arrive with an empty VAT section and no warning, and a failed upload must say why.
3. **Cut end-to-end latency** without changing hosting or the Azure model.
4. **Build a measurement harness**, so accuracy becomes a number that moves rather than a feeling.

The central finding is that **Azure is not the problem**. On both receipts the client supplied,
Azure returned the VAT table and the currency correctly. Our mapper discarded both. Every accuracy
fix below is a change to our own code, at no additional Azure cost and no additional latency.

---

## 2. Evidence

All figures below come from running the two client-supplied fixtures against the live Azure service
on 2026-08-25, and from running the recorded responses through the real pipeline
(`createAzureProvider` → `mapAnalyzeResult` → `applyTextFallbacks` → `computeWarnings`).

### 2.1 Currency is dropped when Azure supplies no symbol

`api/src/providers/document-extraction/azure-fields.ts:86` requires **both** a symbol and a code:

```ts
if (currency?.currencySymbol && currency.currencyCode) {
  fields.currency = currency.currencyCode;
}
```

| Fixture | Azure `valueCurrency` | Our result |
| --- | --- | --- |
| `receiptEuroMistake.jpg` | `{ amount: 103.69, currencyCode: "EUR" }` — no symbol | **dropped**, warning raised |
| `receiptWithTaxMistake.jpg` | `{ currencySymbol: "kn", amount: 13, currencyCode: "HRK" }` | `HRK` ✓ |

This is precisely why Document Intelligence Studio shows `EUR` and the application shows nothing.

**However, Azure's `EUR` on that receipt is wrong.** `receiptEuroMistake.jpg` is a **February 2020
receipt denominated in kuna**: `UKUPNO 103,69` is HRK, and the `EURO: 13,94 (1 Eur= 7,43567)` line is
a courtesy conversion. `prebuilt-receipt` returns `HRK` for the same document. Simply removing the
symbol requirement would therefore replace a blank field with a **wrong** one — which is why §4.1
below resolves currency from evidence rather than from the provider's guess alone.

### 2.2 VAT is never extracted — because we never read `tables`

`prebuilt-invoice` returned exactly eight fields on both receipts:

```
InvoiceDate, InvoiceId, InvoiceTotal, Items,
VendorAddress, VendorAddressRecipient, VendorName, VendorTaxId
```

Neither `TaxDetails` nor `TotalTax` is present on either document, so `FIELD_ALIASES.vatBreakdown`
finds nothing and `vatBreakdown` stays empty. But the same response carries `analyzeResult.tables`,
and **the VAT recap is fully parsed inside it**:

```
receiptEuroMistake.jpg (3 tables)        receiptWithTaxMistake.jpg (2 tables)
["Porez","%","Osnovica","Iznos"]         ["Vrsta poreza","Stopa%","Osnovica","Iznos"]
["PDV","25.00","82,95","20,74"]          ["PDV 25%","25.00","10.40","2.60"]
["Ukupno porezi","","","20,74"]
```

We read `documents[0].fields` and `content` and ignore `tables` entirely. The data is already paid
for and already in the response.

Both tables share the same column semantics — a label column, a rate column, a taxable-base column
and a VAT-amount column — which is what makes header-driven mapping viable rather than guesswork.

### 2.3 A `%` or a trailing letter silently destroys an amount

`shared/src/money.ts` strips currency tokens and whitespace, then requires `^[\d.,]+$`:

- `parseAmount("25%")` → `null`. So even if `TaxDetails` *were* populated, `VAT_CELL_ALIASES.rate`
  would resolve to nothing.
- `parseAmount("13,00 H")` → `null`. This is a real loss today: the single line item on
  `receiptWithTaxMistake.jpg` extracts with `total: null`, because the receipt prints a tax-class
  letter after the amount.

### 2.4 Silent failure: no VAT, no warning

`computeWarnings` produced **zero warnings** for `receiptWithTaxMistake.jpg` — a receipt whose source
clearly shows `Vrsta poreza / Stopa% / Osnovica / Iznos` and `PDV 25% 25.00 10.40 2.60`. The user is
shown an empty VAT section with no indication that anything was missed. This is the worst failure
mode in the system: wrong data announces itself, missing data does not.

### 2.5 A failed receipt cannot say why

`extractReceipt` records the cause:

```ts
extractionMetadata: { failure: { reason, retryable } }
```

`api/src/routes/receipts.ts:324` reads **only** `retryable`, to decide whether to offer a retry. The
`reason` never leaves the database. `ProcessingPage` therefore renders a fixed string —
*"This receipt could not be prepared."* — for every distinct cause, from a corrupt image to an
expired Azure key. This matches the client's report exactly.

### 2.6 Latency is dominated by bytes and by a serial pipeline

Measured against live Azure, `prebuilt-invoice`, three real sources:

| Source | Bytes | POST (upload) | Poll (analyze) | Total |
| --- | ---: | ---: | ---: | ---: |
| `receiptEuroMistake.jpg` | 105 KB | 669 ms | 7365 ms | 8035 ms |
| `receiptWithTaxMistake.jpg` | 481 KB | 1631 ms | 7118 ms | 8749 ms |
| `Screenshot_20190705-1907152.png` | 1.3 MB | 3870 ms | 7192 ms | 11062 ms |

Two conclusions:

- **Azure's analysis time is a flat ~7.1–7.4s floor**, independent of file size. It cannot be
  optimised away from our side.
- **Every millisecond that *is* controllable scales with bytes.** The same reduction pays off three
  times: browser→API, API→Supabase, API→Azure.

On top of that the API is serial: `await uploadSource(...)` completes *before* the `201` is sent and
*before* extraction begins, even though the bytes needed for extraction are already in memory.

**PRD §11.4's 2–5 second target is unreachable with this model** — Azure alone exceeds it at zero
bytes. §4.3 records the honest budget instead.

### 2.7 Model comparison, for the record

| | `prebuilt-invoice` | `prebuilt-receipt` |
| --- | --- | --- |
| Latency (euro / tax) | 8035 / 8749 ms | **4825 / 5606 ms** |
| Document number | **`InvoiceId` ✓** | absent — no field exists |
| `tables` (VAT recap) | **present ✓** | absent (0 tables) |
| Currency on the kuna receipt | `EUR` ✗ | **`HRK` ✓** |
| `TotalTax` | absent | **present on both ✓** |
| `TransactionTime` | absent | present on the tax receipt |

The receipt model is faster and reads currency and tax better, but has no document-number field —
a PRD §6.5 critical field — and returns no tables, so its VAT would be an undifferentiated total
with no rate or base. **Decision: stay on `prebuilt-invoice` and mine `tables`.** Revisit a
parallel two-model call only if measurement (§5) shows a residual gap that justifies doubling cost.

### 2.8 ZKI does not reproduce

The client reported that JIR is recognised on `receiptEuroMistake.jpg` but ZKI is not. Run through
the real pipeline, **both** are extracted:

```
jir: "ac12e053-3300-496a-8ad4-1bd2c10b0ec6"   (source: text)
zki: "08a78e71e4e01080e6755ffe3bfdb1e6"       (source: text)
```

The same holds for `receiptWithTaxMistake.jpg`. One plausible explanation: the receipt's QR payload
is a **bare JIR UUID**, so `qr_extraction` legitimately has `jir` set and `zki: null` — if the
observation came from the QR data rather than the form, it is correct behaviour. This is an open
question (§8), not a scoped fix.

---

## 3. Decisions taken

Settled with the client during this investigation. These are inputs to the plan, not open items.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Stay on `prebuilt-invoice`; parse `analyzeResult.tables` for VAT** | Keeps the document number and the table data; costs nothing extra. See §2.7. |
| D2 | **No LLM in the extraction path** | PRD §4.7 stands unamended. The deterministic fixes address both reported defects at zero cost. |
| D3 | **Currency: explicit token first, then infer from the issue date** | Never write a currency the source contradicts; use Croatia's 2023-01-01 euro changeover only as a last resort, and mark it as inferred. |
| D4 | **Downscale in the browser above a size threshold; the uploaded file is the stored source** | The mobile upload leg is the slowest and only a client-side resize shortens it. |
| D5 | **Start Azure analysis concurrently with the storage upload** | The bytes are already in memory; the current serial order buys nothing. |
| D6 | **Target corpus is current EUR receipts, without corrupting legacy HRK ones** | Optimise for what users will actually scan; keep historical receipts correct rather than mislabelled. |
| D7 | **Warn when the source shows tax text but no VAT was extracted** | Catches §2.4 precisely, without warning on receipts that genuinely carry no VAT line. |
| D8 | **Client supplies more receipts; the agent builds the harness and proposes labels for spot-checking** | Makes §5 achievable without heavy manual labelling. |

Explicitly **not** changing: the hosting tier (Render free, with its 30–50s cold start), the client
polling cadence (2s / 100s), the Azure API version (`2024-11-30`), and `queryFields` (a premium
add-on that would roughly double per-receipt cost; barcodes remain free).

---

## 4. Scope

### 4.1 Currency resolution

Replace the symbol gate with an ordered resolution, recording **how** the value was obtained.

1. **Explicit token in the source text.** Scan the OCR `content` for `kn`, `HRK`, `EUR`, `€`, `$`,
   `£`, `USD`, `GBP`. If exactly one distinct currency is present, use it. `source: "text"`.
   - On `receiptWithTaxMistake.jpg` this yields `HRK` from `13.00 kn`.
   - On `receiptEuroMistake.jpg` both `kn`-less `EURO:` and no other token appear; the `EURO:`
     conversion line means this rule must **not** fire on the bare word `EURO` used as a label. Only
     a currency token adjacent to an amount counts.
2. **Azure's `currencyCode`, when it is not contradicted.** If Azure supplied a code *and* a symbol,
   trust it (`source: "model"`) — the symbol is the evidence.
3. **Infer from the issue date**, only for a receipt identifiable as Croatian (an OIB, JIR or ZKI was
   found): `issueDate < 2023-01-01` → `HRK`, otherwise `EUR`. `source: "inferred"`.
4. **Otherwise leave `null`** and let the existing `missing_critical_field` warning stand.

`ExtractionFieldMetadata.source` gains `"inferred"` alongside `"model"` and `"text"`. An inferred
currency **must** be treated as low-confidence so the review form paints it amber and the user is
prompted to confirm it. This keeps PRD §7.7 ("never invent data") honest: the value is a labelled
inference the user is asked to check, not a silent assertion.

On `receiptEuroMistake.jpg` this produces `HRK` — matching the receipt — rather than Azure's `EUR`.

### 4.2 VAT breakdown from `tables`

Add a Croatian/English VAT-recap table reader. Precedence for `vatBreakdown`:

1. `TaxDetails` (existing behaviour) when present and non-empty.
2. **New:** the VAT recap table.
3. `TotalTax` as a single rate-less row (existing fallback).

Table selection and column mapping:

- A candidate table's header row contains at least two of: `porez`, `stopa`, `osnovica`, `iznos`,
  `pdv`, `tax`, `rate`, `base`, `net`, `vat`, `%`.
- Columns are mapped from the header, not by position:
  `rate` ← `stopa` / `%` / `rate`; `taxableBase` ← `osnovica` / `base` / `net`;
  `vatAmount` ← `iznos` / `amount` / `vat` / `tax`.
- **Summary rows are skipped**, matched on a leading `ukupno` / `total` in the label column. This is
  required: `receiptEuroMistake.jpg` carries `["Ukupno porezi","","","20,74"]`, which is the total of
  the breakdown, not another rate.
- A row is kept only when at least one of rate / base / amount parses.

Expected results on the two fixtures:

| Fixture | rate | taxableBase | vatAmount |
| --- | --- | --- | --- |
| `receiptEuroMistake.jpg` | `25.00` | `82.95` | `20.74` |
| `receiptWithTaxMistake.jpg` | `25.00` | `10.40` | `2.60` |

**Integration requirement.** Iteration 15's source-region projection
(`api/src/providers/document-extraction/source-regions.ts`) indexes VAT cells so the review page can
outline them on the receipt image. VAT sourced from a table must project its regions from the table
cells' own `boundingRegions`, or field highlighting silently stops working for the VAT section. This
is part of the scope, not a follow-up.

### 4.3 Amount parsing hardening

`shared/src/money.ts` is the canonical money contract used by the review form, the database and the
export. It is **not** changed. Instead the extraction layer gains a small
`parseReceiptAmount(raw)` helper that normalises receipt-specific noise before delegating to
`parseAmount`:

- strip a trailing `%` (VAT rates: `"25%"` → `25`)
- strip a trailing single-letter tax class (`"13,00 H"` → `13.00`)
- strip a trailing `*`, `#` or similar receipt annotation marker

Everything else — Croatian/English grouping, negatives, currency tokens — continues to be
`parseAmount`'s job. `mapVatBreakdown` and `mapItems` use the new helper; nothing else does.

### 4.4 Secondary-field fallbacks

`prebuilt-invoice` returned neither `PaymentTerm` nor `TransactionTime` on either Croatian receipt,
so two fields the form displays are structurally unfillable today:

- **Payment method** — add a Croatian text fallback for `Način plaćanja:` and the abbreviated
  `NAC.PLAC.:` form (`Gotovina`, `Kartica`, `Novčanice i kovanice`, `Transakcijski račun`).
- **Issue time** — the current `ISSUE_TIME` regex requires a `vrijeme` label. On
  `receiptEuroMistake.jpg` the time is embedded in the date field's own content
  (`"21.02.2020,14:26:38"`) and is lost. Extract a time from the matched issue-date span when the
  date carries one.

### 4.5 Warnings

Add one warning code, per D7:

- **`vat_present_but_unread`** on `vatBreakdown` — raised when the OCR content matches a tax-recap
  signal (`PDV`, `osnovica`, `stopa`, `porez`, `VAT`, `tax rate`) but `vatBreakdown` is empty after
  extraction.

Follows every existing rule: a stable machine code, a dotted field path, `hr` and `en` messages in
the client locale files, informational only, never blocking (PRD §7.8). `client/src/i18n/warnings.test.ts`
enforces the translation parity automatically.

### 4.6 Failure transparency

Surface the stored failure cause, without leaking provider terminology (PRD §7.6).

- `GET /api/receipts/:id` gains `failureReason` — a stable code, present only when `status` is
  `failed`, derived from the persisted `extractionMetadata.failure.reason`.
- Codes map to the existing `ExtractionError` reasons: `unreadable_document`, `provider_rejected`,
  `provider_unavailable`.
- The client maps each to translated copy with an actionable next step, and keeps the retry action
  gated on `retryable` as it is today. `unreadable_document` should read as *"we could not read this
  receipt — please retake the photo with the whole receipt in frame"*, not as a retry prompt, since
  retrying identical bytes cannot succeed.

Add a locale-parity test in the shape of `uploadErrors.test.ts`, because these keys are built from a
code and Phase 6.5's literal-key scan cannot follow them.

### 4.7 Speed

Three changes, none of which touch hosting or the Azure call itself.

**a. Client-side downscale above a threshold (D4).** An image over ~2 MP or ~1.5 MB is resized to a
1600 px long edge and re-encoded as JPEG at ~0.82 quality before upload. Smaller images and all PDFs
upload untouched. If decoding fails (HEIC on an unsupporting browser) the original is uploaded
unchanged — the existing behaviour.

Consequences to handle explicitly:

- The uploaded file becomes the stored source. PRD §7.3 permits an OCR-friendly derivative but says
  the original is preserved; here the derivative *is* what the user uploaded. **This must be recorded
  as a deliberate PRD §7.3 amendment** in the history file and README, not left implicit.
- Canvas re-encoding **bakes in EXIF orientation**, which removes the rotation mismatch that
  currently suppresses the source overlay (README, "Review and confirmation"). This is a side benefit
  worth verifying rather than assuming.
- 1600 px on the long edge must be validated against real receipts for text readability before the
  threshold is fixed — a long thermal receipt is the stress case. Measure, do not assume.

**b. Concurrent analysis and storage upload (D5).** In `POST /api/receipts`, begin
`provider.extract({ bytes, contentType })` *before* awaiting `uploadSource`, attaching a no-op
`.catch` immediately so an early rejection is never an unhandled rejection. Await the storage upload
and row insert as today, send the `201`, then resolve the already-in-flight analysis and persist.

The invariant that a receipt row never exists without a source object is preserved, because the row
is still created only after the upload succeeds. The accepted cost is that a failed row insert wastes
one Azure call that has already started.

**c. Record a latency breakdown.** `extractionMetadata` already stores `latencyMs` for the whole
provider call. Split it into upload-to-Azure and analyze phases so §5 can report where time actually
goes, rather than inferring it.

**Honest budget after these changes**, for a typical phone photo, excluding Render's cold start:

| Phase | Today | After |
| --- | ---: | ---: |
| Browser → API (4 MB photo) | ~4–10 s | ~0.5–1.5 s |
| API → Supabase | ~2–4 s | overlapped |
| API → Azure POST | ~3–10 s | ~0.7 s |
| Azure analyze | ~7 s | ~7 s (floor) |
| Poll granularity | 0–2 s | 0–2 s |

PRD §11.4 should be amended from "2–5 seconds" to a realistic **8–12 seconds warm**, with the
30–50 second cold start called out separately as a free-tier property rather than an application
characteristic.

### 4.8 Review form — verdict

**Keep the form as it is.** The client asked whether the VAT fields should exist given they never
populate; the answer is that the fields were never the problem. Once §4.2 lands they populate
correctly on both fixtures, and PRD §4.2 and Appendix A both list VAT breakdown as in-scope data.

Two small changes only:

- When `vatBreakdown` is empty, render one blank VAT row rather than only an "Add VAT row" link, so
  the section reads as an empty form rather than an absent feature.
- No other structural change. Field order, sectioning and the amber attention treatment stay.

---

## 5. Measurement

Without this, none of the above can be shown to have worked.

- **Corpus.** The client supplies additional receipts into `.agents/fixtures/receipts/`, weighted
  toward post-2023 EUR receipts (D6), and including genuine phone photos, at least one PDF, at least
  one English-language receipt, and difficult cases — glare, moderate blur, imperfect framing, faded
  thermal print, missing QR (PRD §12 Phase 4).
- **Ground truth.** For each source, a committed `expected/<name>.json` holding the correct values
  for the five critical fields plus VAT and currency. The agent proposes these by reading each
  receipt; the client spot-checks them (D8). A wrong label is worse than no label, so anything
  ambiguous is left out rather than guessed.
- **Harness.** `scripts/score-extraction.mjs` replays recorded Azure fixtures through the real
  mapper — offline, no cost — and reports:
  - exact-match rate per canonical field, before any user correction (PRD §11.3)
  - share of receipts needing no critical-field correction
  - which fields are corrected most often
  - latency percentiles from the recorded metadata
- **Report before and after**, in the iteration's history file. The before-numbers are the baseline
  this work is judged against, and they must be recorded before any fix lands.

---

## 6. Out of scope

- LLM extraction, verification or fallback (D2; PRD §4.7 unchanged).
- Azure `queryFields`, custom-trained models, and multi-model orchestration (D1).
- Leaving Render's free tier, and the 30–50 s cold start it implies.
- Changing the polling cadence or moving to server-sent events.
- Business-level duplicate detection, OIB checksum validation, merchant-specific templates — all
  still PRD §4.6/§13 material.
- The receipts-table row-click change currently uncommitted in `client/src/history/ReceiptTable.tsx`,
  which is unrelated to this work and needs its own decision.

---

## 7. Definition of done

- [ ] `receiptEuroMistake.jpg` extracts `currency: "HRK"` with `source: "inferred"`, marked
      low-confidence in the review form.
- [ ] Both fixtures extract a complete `vatBreakdown` row: rate `25.00`, and the base/amount pairs
      in §4.2.
- [ ] `receiptWithTaxMistake.jpg` extracts its line-item total as `13.00`, not `null`.
- [ ] A receipt whose source shows tax text but yields no VAT raises exactly one
      `vat_present_but_unread` warning, in both languages.
- [ ] The VAT section's source-document outlines still render, sourced from table cell geometry.
- [ ] A failed receipt shows a translated, cause-specific message; an unreadable document does not
      offer a pointless retry.
- [ ] A >2 MP photo is downscaled before upload; the review page, the source panel and field
      highlighting all still work against the downscaled source.
- [ ] Azure analysis starts before the storage upload completes, proven by the recorded phase split.
- [ ] `scripts/score-extraction.mjs` runs offline and reports per-field accuracy across the corpus,
      with before/after numbers in the history file.
- [ ] No Azure field name reaches the API surface, the database canonical column or the UI.
- [ ] `/validate` passes, with new Phase 4 rows and an extended Phase 8 journey.

---

## 8. Open questions

1. **ZKI (§2.8).** Both fixtures extract ZKI correctly through the form. Was the observation made
   against the QR panel — where a bare-JIR payload legitimately yields `zki: null` — or against a
   different receipt? Needed before anything is "fixed" here.
2. **Inferred values in the UI.** Should `source: "inferred"` get its own visual treatment, or reuse
   the existing amber low-confidence styling? Reusing it is simpler and consistent with the README's
   argument that one appearance for "needs checking" beats two conventions.
3. **HEIC.** A browser that cannot decode HEIC also cannot downscale it, so those uploads keep full
   size. Acceptable, or should the API downscale server-side as a second line of defence?
4. **Downscale threshold.** 1600 px is a starting point, not a measured one. It must be validated
   against a long thermal receipt before being fixed.

---

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Date-inferred currency is wrong on a foreign receipt bought in Croatia | Medium | Only infer when an OIB/JIR/ZKI marks the receipt as Croatian, mark it inferred, and surface it as low-confidence for the user to confirm |
| Downscaling degrades OCR on faded or long thermal receipts | High | Validate the threshold against real difficult receipts and measure critical-field accuracy before and after, on the same corpus |
| Table-based VAT misreads an unrelated table as a tax recap | Medium | Require two header keyword matches, map columns by header rather than position, skip summary rows, and keep `TaxDetails` ahead of it in precedence |
| VAT source-region highlighting breaks silently when VAT moves to tables | Medium | Named as an explicit scope item (§4.2) with its own definition-of-done line and browser verification |
| The stored source is no longer the byte-exact original | Low | Deliberate, client-approved (D4); recorded as a PRD §7.3 amendment in the history file and README rather than left implicit |
| Ground-truth labels proposed by the agent are wrong | Medium | Client spot-checks; ambiguous fields are omitted from the labels rather than guessed |
