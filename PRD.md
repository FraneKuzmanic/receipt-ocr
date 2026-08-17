# Product Requirements Document (PRD)

## Mobile Receipt Capture & OCR PoC

**Status:** Final for PoC planning  
**Date:** 8 August 2026  
**Revision:** v3 — revalidated final  
**Product stage:** Proof of Concept / MVP  
**Primary market:** Croatian businesses  
**Primary document extraction platform:** Azure Document Intelligence

> **Scope note:** This PRD intentionally defines the product, data contract, user experience, and high-level technical architecture without over-specifying Azure model choice, OCR fallback logic, confidence thresholds, or provider-specific extraction rules. Those belong in the later OCR implementation task.

---

# 1. Executive Summary

The product is a mobile-first web application for digitizing retail receipts and receipt-like business purchase documents. A user can take a photo of a receipt with a mobile phone camera or upload an existing image/PDF. The application sends the document to **Azure Document Intelligence**, maps extracted values into an application-owned receipt schema, pre-populates an editable review form, and allows the user to verify, correct, and confirm the structured data.

The core value proposition is to replace routine manual transcription with a fast **capture → extract → review → confirm → export** workflow. OCR output is treated as a draft, not as authoritative accounting data. The original document remains available beside the structured record, and the user remains responsible for confirming the final values.

The PoC is intentionally integration-agnostic. The final structured data must be stored in a stable canonical format and exportable as CSV and JSON so that future iterations can integrate with accounting software, APIs, email delivery, e-invoicing workflows, or other downstream systems without redesigning the capture and review experience.

**MVP goal:** prove that Croatian receipts can be captured or uploaded, converted into useful structured data with Azure Document Intelligence, efficiently reviewed by a human, saved, viewed in history, and exported in a reusable format.

---

# 2. Mission

## Mission statement

Make business receipt digitization fast and reliable enough that users prefer scanning a receipt over manually transcribing or forwarding its accounting information later.

## Core principles

1. **Human-confirmed data** — OCR accelerates data entry; the user confirms the final record.
2. **Mobile first** — the primary flow must work comfortably on a smartphone immediately after a purchase.
3. **Provider-independent domain model** — Azure Document Intelligence is the chosen PoC extraction platform, but Azure-specific fields must not become the application data model.
4. **Warnings over blocking** — the PoC should surface missing or inconsistent information without preventing the user from confirming a record.
5. **Preserve the source** — the uploaded receipt remains available as the source of truth for human review.
6. **PoC simplicity** — avoid company administration, accounting integrations, LLM orchestration, custom OCR training, and other premature complexity.
7. **Structured for the future** — data should be useful for later API/accounting integrations even though no integration is implemented in this PoC.

---

# 3. Target Users

## Primary persona: Business employee or business owner

A person who makes business purchases, receives a paper or digital receipt, and needs to preserve the document and its structured data for later accounting or expense processing.

### Technical comfort level

Low to medium. The user should not need to understand OCR models, Azure, fiscalization systems, document formats, or accounting APIs.

### Key user needs

- Capture a receipt quickly from a phone.
- Upload an existing receipt image or PDF.
- Avoid manually typing values that OCR can extract.
- See the source receipt while reviewing extracted information.
- Correct extraction mistakes before confirmation.
- Preserve the original receipt together with the structured record.
- See previously processed receipts.
- Export structured data for later use.
- Use the UI in Croatian or English.

### Primary pain points

- Physical receipts can be lost or forgotten.
- Photos of receipts are unstructured and require later transcription.
- Manual transcription is slow and error-prone.
- Some retail business purchases are not automatically available in the same digital workflow as other business documents.
- The future recipient/integration is not yet known, so structured data must remain portable.

## Explicitly not modeled in this PoC

- Company entity or company onboarding.
- Tenant administration.
- Accountant users.
- Manager/approval roles.
- Multiple-company membership.
- Buyer-OIB-to-company matching.

A simple authenticated user owns and sees only their own receipt records.

---

# 4. MVP Scope

## 4.1 Core functionality — In Scope

- ✅ Simple registration and login using email/password.
- ✅ Mobile-first responsive web application.
- ✅ Croatian and English UI.
- ✅ Capture a receipt using a mobile phone camera.
- ✅ Upload an existing image or PDF.
- ✅ One receipt/document per upload.
- ✅ Require the full receipt to be represented in the selected photo/document.
- ✅ Detect or handle clearly unusable inputs such as severe blur, corruption, or obviously incomplete framing where practical.
- ✅ Ask the user to retake/re-upload when the document cannot be read reliably.
- ✅ Attempt to decode a Croatian fiscal QR code when present.
- ✅ Process the document with Azure Document Intelligence.
- ✅ Map provider output into a canonical application-owned receipt schema.
- ✅ Pre-populate an editable review form.
- ✅ Display warnings for missing or inconsistent data.
- ✅ Recalculate relevant warnings after the user edits data.
- ✅ Allow confirmation even when warnings remain.
- ✅ Store the original source image/PDF.
- ✅ Preserve the original machine extraction separately from the current/final user-confirmed values.
- ✅ Store supplementary QR extraction when available.
- ✅ Receipt history for the authenticated user.
- ✅ View receipt detail together with the original source document.
- ✅ Soft-delete a receipt.
- ✅ Export confirmed receipt data as CSV.
- ✅ Export confirmed receipt data as JSON.

## 4.2 Data — In Scope

The PoC should support the following canonical data when present on the receipt:

- ✅ Seller name.
- ✅ Seller address.
- ✅ Seller OIB.
- ✅ Buyer name.
- ✅ Buyer address.
- ✅ Buyer OIB.
- ✅ Document/receipt number.
- ✅ Issue date.
- ✅ Issue time.
- ✅ Subtotal.
- ✅ VAT breakdown.
- ✅ Total.
- ✅ Currency.
- ✅ Payment method.
- ✅ JIR.
- ✅ ZKI.
- ✅ Optional line items when extraction provides useful item data.

Not every field is expected to exist on every receipt. Missing optional fields remain empty; the system must not invent data.

## 4.3 Technical — In Scope

- ✅ Azure Document Intelligence as the OCR/document extraction platform.
- ✅ Internal OCR/extraction provider abstraction.
- ✅ Backend-only Azure credentials.
- ✅ Canonical receipt schema independent of Azure field names.
- ✅ Deterministic post-processing/validation for simple consistency checks.
- ✅ QR cross-checking for overlapping values when QR data is available.
- ✅ Basic processing/error states.
- ✅ Basic retry path for temporary processing failures.
- ✅ Basic logging and error handling.
- ✅ Basic ownership authorization: users can access only their own records.
- ✅ Exact/decimal-safe handling of monetary values.
- ✅ Store enough extraction metadata/raw provider information for PoC debugging and later extraction improvements.

## 4.4 Integration — In Scope

- ✅ CSV export.
- ✅ JSON export.
- ✅ Stable canonical schema suitable for future API/accounting integrations.

## 4.5 Deployment — In Scope

- ✅ Simple managed PoC hosting.
- ✅ Managed PostgreSQL database.
- ✅ Managed object/file storage.
- ✅ HTTPS.
- ✅ Environment-based secret/configuration management.

## 4.6 Core functionality — Out of Scope

- ❌ Company entity and company onboarding.
- ❌ Tenant architecture and tenant administration.
- ❌ Buyer OIB matching or company verification.
- ❌ Accountant accounts.
- ❌ Approval workflows.
- ❌ Business-level duplicate receipt detection or duplicate warnings.
- ❌ Offline capture/upload queue.
- ❌ Multiple independent receipts in one image/document.
- ❌ Multi-image stitching for a long paper receipt.
- ❌ Receipt fraud/tampering detection.
- ❌ Merchant learning or merchant-specific extraction templates.
- ❌ Automatic expense categorization.
- ❌ GL/account suggestions.
- ❌ Push notifications.
- ❌ Email notifications.
- ❌ Native mobile wrapper/application.
- ❌ Certified legal document archival system.

## 4.7 OCR / AI — Out of Scope

- ❌ PaddleOCR, Tesseract, or another open-source OCR engine in the PoC.
- ❌ LLM-based extraction, verification, or fallback in the initial implementation.
- ❌ Custom-trained Azure extraction model.
- ❌ Mandatory multi-model Azure fallback orchestration.
- ❌ Proprietary OCR training dataset.

**Azure model choice, confidence policy, fallback behavior, and Croatia-specific field extraction strategy are intentionally deferred to the dedicated OCR implementation task.**

## 4.8 Integration — Out of Scope

- ❌ Direct accounting software integrations.
- ❌ ERP integrations.
- ❌ Fina/e-invoice integrations.
- ❌ Automatic delivery to an accountant.
- ❌ Email delivery.
- ❌ Webhooks.
- ❌ Automated downstream posting.

---

# 5. User Stories

## US-01 — Capture a receipt

**As a business user, I want to photograph a receipt with my phone, so that I can digitize it without manually entering all of its data.**

Example: After a purchase at a petrol station, the user opens the application, selects **Scan receipt**, photographs the whole receipt, and submits it for processing.

## US-02 — Upload an existing receipt

**As a business user, I want to upload an existing image or PDF, so that I can process receipts I already received digitally or photographed earlier.**

Example: The user selects a PDF receipt from their phone's files.

## US-03 — Receive pre-populated receipt data

**As a business user, I want the application to pre-populate receipt fields from OCR, so that I only need to verify or correct values instead of typing everything from scratch.**

Example: Seller, date, document number, VAT and total appear in the form after processing.

## US-04 — Correct OCR errors

**As a business user, I want extracted values to be editable, so that I can correct OCR mistakes before confirmation.**

Example: The detected document number is `381/1/2`, but the source shows `381/1/3`; the user corrects it.

## US-05 — Understand warnings without being blocked

**As a business user, I want warnings about missing or inconsistent data without being prevented from confirming, so that I remain in control of unusual receipts.**

Example: OCR total and QR total differ. The application highlights the mismatch, but the user can inspect the receipt, edit the value, and confirm.

## US-06 — Preserve and review the source document

**As a business user, I want the original receipt stored with the structured record, so that I can later verify where the data came from.**

Example: Opening a saved receipt shows the structured fields and the original image/PDF.

## US-07 — Access receipt history

**As a business user, I want to see my previously processed receipts, so that I can find and review past submissions.**

Example: History shows issue date, seller, document number, total and status.

## US-08 — Export structured data

**As a business user, I want to export confirmed receipt data as CSV or JSON, so that it can be reused outside the PoC before direct integrations exist.**

Example: The user downloads a CSV containing confirmed receipt records for further accounting preparation.

---

# 6. Core Architecture & Patterns

## 6.1 High-level architecture

```text
Mobile / Desktop Browser
        │
        ▼
React Web Application
        │
        ├── Authentication
        ├── Camera / File Upload
        ├── Processing State
        ├── Review Form
        ├── History
        └── Export
        │
        ▼
Node.js / TypeScript API
        │
        ├── Authentication / Ownership
        ├── Receipt Workflow
        ├── QR Decoding
        ├── Validation / Warnings
        ├── OCR Provider Abstraction
        │       │
        │       ▼
        │  Azure Document Intelligence
        │
        ├── PostgreSQL
        └── Object Storage
```

## 6.2 Core pattern: provider-independent canonical model

Azure response objects must not become the database or frontend schema.

```text
Azure Document Intelligence
        │
        ▼
Azure Provider Adapter
        │
        ▼
Canonical Receipt Mapper
        │
        ▼
Canonical Receipt
        │
        ├── Review UI
        ├── Database
        └── Export
```

This allows later changes to Azure model selection, mapping logic, fallback strategies, or even the extraction provider without rewriting the rest of the product.

## 6.3 OCR provider abstraction

Conceptual TypeScript interface:

```ts
export interface DocumentExtractionProvider {
  extract(input: ExtractionInput): Promise<ProviderExtractionResult>;
}
```

The initial implementation has one provider: **Azure Document Intelligence**.

The interface exists to isolate provider-specific logic, not because the PoC needs multiple OCR engines.

## 6.4 Canonical receipt schema

Conceptual domain model:

```ts
export interface CanonicalReceipt {
  id: string;
  userId: string;

  sellerName?: string | null;
  sellerAddress?: string | null;
  sellerOib?: string | null;

  buyerName?: string | null;
  buyerAddress?: string | null;
  buyerOib?: string | null;

  documentNumber?: string | null;
  issueDate?: string | null;
  issueTime?: string | null;

  subtotal?: string | null;
  vatBreakdown?: VatBreakdown[];
  total?: string | null;
  currency?: string | null;

  paymentMethod?: string | null;
  jir?: string | null;
  zki?: string | null;

  items?: ReceiptItem[] | null;

  warnings: ReceiptWarning[];
  status: "processing" | "review" | "confirmed" | "failed";

  createdAt: string;
  updatedAt: string;
  confirmedAt?: string | null;
  deletedAt?: string | null;
}

export interface VatBreakdown {
  rate?: string | null;
  taxableBase?: string | null;
  vatAmount?: string | null;
}

export interface ReceiptItem {
  description?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  total?: string | null;
}
```

### Schema rules

- A field existing in the schema does not mean every receipt must contain it.
- Missing values remain `null`/empty rather than being invented.
- `documentNumber` is presented to the user as one editable string.
- Monetary values use exact decimal-safe representations rather than JavaScript binary floating-point calculations.
- Line items are optional and non-critical for PoC success.
- Buyer fields, including buyer OIB, are optional data only; there is **no company matching or buyer-OIB validation workflow**.
- Provider-specific confidence/provenance may be stored as metadata but does not replace the canonical value.
- The machine-extracted data and final user-confirmed data remain distinguishable.

## 6.5 Critical review fields

The most important fields for PoC review and quality evaluation are:

1. Seller name.
2. Document/receipt number.
3. Issue date.
4. Total.
5. Currency.

VAT information is also important when present, but not every receipt will contain the same tax structure.

Other fields are useful supplementary data and should still be extracted when possible.

## 6.6 Receipt states

Use a simple state model:

```text
PROCESSING
    │
    ├── success ──► REVIEW ──► CONFIRMED
    │
    └── failure ──► FAILED
```

- `processing`: extraction is in progress.
- `review`: extraction finished and the user can review/edit.
- `confirmed`: the user explicitly confirmed the current data.
- `failed`: the document could not be processed; the UI should offer an actionable retry/re-upload path where appropriate.

Detailed retry counts, timeout policies, concurrency tokens, and provider polling mechanics are implementation decisions, not PRD requirements.

## 6.7 Suggested repository structure

```text
receipt-ocr-poc/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── components/
│   │       ├── features/
│   │       │   ├── auth/
│   │       │   ├── capture/
│   │       │   ├── receipts/
│   │       │   └── history/
│   │       ├── i18n/
│   │       ├── api/
│   │       └── routes/
│   └── api/
│       └── src/
│           ├── routes/
│           ├── services/
│           ├── providers/
│           │   └── document-extraction/
│           ├── mappers/
│           ├── validation/
│           └── repositories/
├── packages/
│   ├── domain/
│   └── shared/
└── README.md
```

A TypeScript monorepo is recommended because frontend and backend can share schemas/types while keeping provider logic isolated.

---

# 7. Tools / Features

## 7.1 Authentication

### Purpose

Provide simple receipt ownership and personal history.

### Requirements

- Email/password registration.
- Email/password login.
- Logout.
- Persist authenticated session.
- Password reset if readily available from the selected auth provider.
- No roles.
- No company registration.

---

## 7.2 Receipt Capture

### Purpose

Allow a user to photograph a receipt directly from a mobile phone.

### Requirements

- Mobile-friendly **Scan receipt** action.
- Prefer the device rear camera when browser support allows.
- File-picker fallback if camera access is denied or unavailable.
- Preview before submission.
- Guidance to keep the full receipt visible, readable and with minimal glare.
- Retake option before upload.
- One image/document per receipt record in the PoC.

### Expected flow

```text
Scan receipt
    ↓
Take photo / Choose file
    ↓
Preview
    ↓
Use photo / Retake
    ↓
Process
    ↓
Review
```

---

## 7.3 Document Upload

### Supported PoC inputs

- JPEG/JPG.
- PNG.
- HEIC/HEIF where supported by the browser/server processing path.
- PDF.

### Rules

- One receipt/document per upload.
- Reject unsupported or corrupt files with a clear message.
- Reject password-protected PDFs that cannot be processed.
- Server-side validation must not trust only the filename/extension.
- Configure reasonable file-size and PDF-page limits during implementation.
- Large camera photos may be resized/compressed for OCR if text readability is preserved.
- Preserve the original uploaded source even if an OCR-friendly derivative is generated.

---

## 7.4 Image / Document Quality Handling

### Purpose

Avoid processing clearly unusable inputs and reduce meaningless OCR results.

### PoC behavior

- Detect severe blur/unreadable resolution where practical.
- Encourage the user to capture the entire receipt.
- Reject clearly corrupt/unreadable inputs.
- Ask for a retake when the document is obviously unusable.
- When image quality is imperfect but usable, continue to review and surface a warning rather than building a complex computer-vision quality classifier.

Example message:

> This receipt is too blurry to read reliably. Please retake the photo and keep the full receipt in frame.

---

## 7.5 QR Decoding

### Purpose

Extract supplementary fiscal data independently from OCR when a readable QR code is available.

### Requirements

- Attempt QR decoding when present.
- QR absence or decoding failure must not block OCR.
- Preserve QR-derived information separately from Azure extraction.
- Cross-check overlapping values such as total/date/fiscal identifiers where possible.
- Differences produce warnings only.
- QR data must not silently overwrite a user-confirmed value.
- Do not perform external Tax Administration verification in the PoC.
- Treat QR content as untrusted data.

---

## 7.6 Azure Document Intelligence Extraction

### Purpose

Extract text and structured candidate values from receipt photos, images and PDFs.

### Requirements

- Azure Document Intelligence is the sole OCR/document extraction platform for the initial PoC.
- Azure credentials remain on the backend.
- Azure-specific response fields are isolated inside the provider adapter.
- Provider output is mapped into the canonical receipt model.
- Retain useful raw extraction/metadata for debugging and future improvements.
- Handle provider errors gracefully.
- Do not expose Azure terminology to end users.
- Exact Azure model, confidence policy, Croatia-specific parsing, fallback behavior, and possible multi-model logic are deferred to the dedicated OCR implementation task.
- LLM fallback is not part of the initial PoC.

---

## 7.7 Canonical Mapping

### Purpose

Convert provider-specific extraction into stable application data.

### Operations

- Map Azure output into canonical fields.
- Normalize dates into a consistent application format when safely possible.
- Normalize amounts into decimal-safe values.
- Normalize currency when confidently determined.
- Preserve missing fields as empty/null.
- Preserve extraction confidence/provenance as metadata where useful.
- Do not invent OIBs, VAT values, currency, JIR/ZKI, or receipt numbers.

---

## 7.8 Validation & Warnings

### Purpose

Detect obvious inconsistencies and draw the user's attention to fields that deserve review.

### Candidate PoC checks

- Missing critical fields.
- Invalid/unparseable date.
- Invalid/unparseable monetary value.
- VAT arithmetic inconsistency when sufficient information is available.
- QR total vs current total mismatch.
- QR date/time vs current date/time mismatch.
- Basic image/document quality warnings.
- Other simple deterministic checks discovered during implementation.

### Rules

- Warnings are informational/actionable.
- Warnings do not block confirmation.
- Warnings should be associated with the affected field where practical.
- Warnings should be recalculated after relevant user edits.
- No buyer-OIB-to-company validation.
- No company verification.
- No duplicate-receipt detection.
- No LLM validation in the PoC.

---

## 7.9 Review Form

### Purpose

Turn machine extraction into human-confirmed structured data.

### Requirements

- Show the source receipt alongside or immediately accessible from the form.
- Pre-populate available canonical fields.
- Make all displayed extracted fields editable.
- Keep header/tax/fiscal fields in the same review experience.
- Show warnings close to relevant fields when practical.
- Make missing/low-confidence information visually noticeable when metadata is available.
- Recalculate warnings after edits without rerunning OCR.
- Allow confirmation with unresolved warnings.
- Do not require verification of every optional line item.
- Do not mark a receipt `confirmed` until the user explicitly confirms the review.

---

## 7.10 Persistence

For each receipt preserve at minimum:

- Original uploaded source file reference.
- Source metadata such as filename/content type.
- Canonical machine-extracted values before user correction.
- Current/final canonical values.
- QR extraction result when available.
- Useful OCR/extraction metadata/raw result for debugging.
- Current warnings.
- Receipt status.
- User ownership.
- Creation/update/confirmation/deletion timestamps.

This provides enough provenance to learn from corrections later without implementing full event sourcing or enterprise audit history.

---

## 7.11 History

### Requirements

- Authenticated users see only their own non-deleted receipts.
- Mobile-friendly list/table.
- Show:
  - Issue date.
  - Seller.
  - Document number.
  - Total.
  - Currency.
  - Status.
- Open receipt detail.
- View original source.
- Soft delete.
- Sort newest first.
- Basic status filtering is useful but advanced search/filtering is not an MVP blocker.

---

## 7.12 Export

### Export scope

Default export includes the authenticated user's **confirmed, non-deleted** receipts.

### CSV

- One row per receipt.
- Stable, documented column names.
- Flatten primary receipt fields.
- VAT breakdown may be flattened or serialized consistently.
- Line items do not need to be included in v1 CSV.
- UTF-8 output.
- Correct CSV escaping.
- Protect spreadsheet consumers from formula-injection behavior in untrusted text fields.

### JSON

- Use canonical field names.
- Preserve nested VAT breakdown.
- Preserve optional items if available.
- Do not expose Azure-specific property names.
- Keep money represented consistently and exactly.
- Include a simple schema/export version.

---

## 7.13 Internationalization

### Supported UI languages

- Croatian (`hr`).
- English (`en`).

### Requirements

- Browser language may set the initial default.
- User can manually switch languages.
- User-facing copy is externalized for translation.
- OCR document scope is primarily Croatian receipts, with English-language receipts also supported for the PoC.

---

# 8. Technology Stack

The stack prioritizes fast PoC delivery, shared TypeScript types, and low infrastructure overhead.

## Frontend

| Technology              |                  Baseline | Purpose                           |
| ----------------------- | ------------------------: | --------------------------------- |
| React                   |                    19.2.x | Mobile-first UI                   |
| TypeScript              |                       7.x | Typed frontend/shared domain code |
| Vite                    |                     8.1.x | Build/dev tooling                 |
| React Router            | Current compatible stable | Routing                           |
| React Hook Form         | Current compatible stable | Review/edit forms                 |
| Zod                     | Current compatible stable | Runtime/schema validation         |
| i18next + react-i18next | Current compatible stable | Croatian/English UI               |

### Styling

Use lightweight CSS/Tailwind or a modest component library. Avoid building a large design system for the PoC. Prioritize touch targets, readability, accessibility and mobile ergonomics.

## Backend

| Technology |                  Baseline | Purpose            |
| ---------- | ------------------------: | ------------------ |
| Node.js    |                    24 LTS | Runtime            |
| TypeScript |                       7.x | API/domain code    |
| Express    |                       5.x | REST API           |
| Zod        | Current compatible stable | Request validation |

## Data / Platform Services

### Recommended PoC choice: Supabase or equivalent managed service

Use a simple managed platform for:

- PostgreSQL.
- Email/password authentication.
- Private object/file storage.

Supabase is a practical recommendation, not a permanent architectural commitment.

## OCR / Document Processing

- **Azure Document Intelligence v4 / current GA API**.
- Use a currently supported JavaScript SDK or REST API.
- Integration remains behind `DocumentExtractionProvider`.

## QR

- Use a reliable browser/server-compatible QR decoding library such as ZXing.
- Exact package is an implementation decision.

## Testing

- Vitest for unit tests.
- React Testing Library for important component behavior.
- Playwright for a small number of critical end-to-end flows.

## Explicitly excluded dependencies

- LLM SDKs.
- PaddleOCR.
- Tesseract.
- Custom ML training infrastructure.

---

# 9. Security & Configuration

## 9.1 Authentication / Authorization

- Email/password authentication.
- Every receipt belongs to the authenticated user.
- The backend derives user identity from the authenticated session/token.
- Never trust a client-supplied `userId`.
- Users must not be able to access another user's receipt or source file.

## 9.2 Secrets and configuration

Typical backend configuration:

```env
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
AZURE_DOCUMENT_INTELLIGENCE_KEY=
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
STORAGE_BUCKET=
```

Exact names depend on implementation.

### Rules

- Never expose Azure API credentials in frontend code.
- Never commit production secrets.
- Provide `.env.example` with variable names but no real values.
- Use deployment-provider secret management/environment variables.

## 9.3 File security

- Store source receipts in private/non-public object storage.
- Authorize source-file access on the backend or with short-lived signed URLs.
- Validate file content/type server-side.
- Enforce reasonable upload/resource limits.
- Treat uploaded filenames, OCR text, QR payloads and metadata as untrusted input.
- Do not automatically fetch arbitrary URLs extracted from QR codes.

## 9.4 Privacy

Receipt images may contain tax, transaction, company, employee or other personal/business information.

The PoC must:

- Use HTTPS.
- Restrict data to the owning user.
- Avoid logging full receipt contents or signed URLs unnecessarily.
- Keep Azure credentials server-side.
- Support application-level soft deletion.

The PoC does **not** claim regulatory archive certification or production-grade retention compliance.

## 9.5 Security explicitly out of scope

- SSO/SAML.
- Mandatory MFA.
- Enterprise RBAC.
- Company-level permissions.
- Fraud detection.
- Regulatory archive certification.
- Complex audit/event-sourcing architecture.

---

# 10. API Specification

The API specification defines the required product operations. Exact asynchronous mechanics, retry policy, idempotency strategy and concurrency implementation are left to technical implementation planning.

All protected endpoints require authentication.

Base path:

```text
/api
```

## 10.1 Create/process receipt

### `POST /api/receipts`

Uploads one receipt image/PDF and starts extraction.

**Request:** `multipart/form-data`

```text
file: <image-or-pdf>
```

**Example response:**

```json
{
  "id": "rec_123",
  "status": "processing",
  "createdAt": "2026-08-08T12:00:00Z"
}
```

The implementation may return a completed `review` state quickly, but the frontend must support a normal `processing` state.

## 10.2 List receipts

### `GET /api/receipts`

Returns the authenticated user's non-deleted receipts.

Suggested filters:

```text
?page=1
&limit=20
&status=processing|review|confirmed|failed
```

Default sort: newest first.

## 10.3 Get receipt

### `GET /api/receipts/:id`

Returns the current receipt record, including:

- Status.
- Canonical values.
- Warnings.
- Relevant extraction metadata for review.
- Source-document access information.

For `processing`, it may return only processing status and available metadata.

## 10.4 Update review data

### `PATCH /api/receipts/:id`

Updates editable canonical values.

Example:

```json
{
  "documentNumber": "123/1/3",
  "total": "100.50",
  "currency": "EUR"
}
```

Relevant warnings are recalculated after the update.

## 10.5 Confirm receipt

### `POST /api/receipts/:id/confirm`

Marks the reviewed record as confirmed.

Example response:

```json
{
  "id": "rec_123",
  "status": "confirmed",
  "confirmedAt": "2026-08-08T12:04:00Z"
}
```

Confirmation remains allowed with warnings.

## 10.6 Retry failed processing

### `POST /api/receipts/:id/retry`

Attempts extraction again using the already stored source when the previous failure is retryable.

## 10.7 Delete receipt

### `DELETE /api/receipts/:id`

Soft-deletes the record.

Suggested response:

```text
204 No Content
```

## 10.8 Source document

### `GET /api/receipts/:id/source`

Returns or redirects to authorized access to the original source document after ownership/deletion checks.

## 10.9 Export

### `GET /api/receipts/export?format=csv`

or

### `GET /api/receipts/export?format=json`

Default scope: confirmed, non-deleted receipts owned by the authenticated user.

---

# 11. Success Criteria

## 11.1 MVP success definition

The PoC is successful if a user can:

1. Register/login.
2. Capture or upload a representative receipt.
3. Receive useful structured data from Azure Document Intelligence.
4. Review the source and pre-populated fields.
5. Correct mistakes.
6. See non-blocking warnings where appropriate.
7. Confirm the final record.
8. Find it later in history.
9. View the original document.
10. Export confirmed data as CSV or JSON.

## 11.2 Functional acceptance

- ✅ User can register, log in and log out.
- ✅ Mobile user can capture a receipt or choose an existing file.
- ✅ Camera denial/unavailability still provides file upload.
- ✅ Supported images/PDFs can be uploaded.
- ✅ Clearly corrupt/unsupported files fail with an understandable message.
- ✅ Clearly unusable camera input can request a retake.
- ✅ Azure Document Intelligence processes representative documents.
- ✅ Extraction maps to the canonical schema.
- ✅ QR decoding is attempted when applicable and does not block OCR on failure.
- ✅ Review form is pre-populated.
- ✅ Displayed extracted values are editable.
- ✅ Warnings do not block confirmation.
- ✅ Relevant warnings change after relevant corrections.
- ✅ Original document is stored and viewable by its owner.
- ✅ Original machine extraction and final user-confirmed values are distinguishable.
- ✅ User can see their own receipt history.
- ✅ User cannot access another user's receipt.
- ✅ Soft-deleted receipts disappear from normal history/export.
- ✅ CSV export works.
- ✅ JSON export works.
- ✅ Croatian UI works.
- ✅ English UI works.

## 11.3 OCR / data quality evaluation

The PoC should **measure**, rather than prematurely guarantee, extraction quality.

For a controlled set of representative real receipts:

- Record exact normalized match rate for critical fields before user correction.
- Record the percentage of receipts requiring no critical-field correction.
- Record the number of critical-field edits per receipt.
- Record which fields are most commonly corrected.
- Include genuine phone photos, not only clean online/PDF samples.
- Include both Croatian and English-language receipt examples.

The product goal is that the final confirmed data matches the visible source receipt. The application must not claim that OCR or human review mathematically guarantees zero errors.

**Acceptance principle:** any human-readable test receipt should be correctable to match its visible source before confirmation.

No arbitrary OCR percentage threshold is fixed in this PRD; the PoC establishes the baseline used to decide whether additional business logic, Azure model strategies, or AI fallbacks are justified.

## 11.4 Performance targets

- Desired upload-to-review experience: approximately **2–5 seconds** under normal network/provider conditions.
- Treat 2–5 seconds as a UX target, not an SLA.
- Show visible processing feedback.
- Record median and slower-case processing latency during evaluation.
- Processing failure must produce an actionable retry/re-upload state rather than a frozen UI.

## 11.5 UX targets

- Primary flow usable one-handed on a modern smartphone.
- Minimal navigation between capture and review.
- User should not need to understand OCR/Azure terminology.
- Warnings use plain language.
- Source document and review form should be easy to compare.
- Optional line items must not turn routine review into a long reconciliation task.

---

# 12. Implementation Phases

## Phase 1 — Foundation & Domain Model

### Goal

Create the application skeleton, authentication, storage and canonical receipt model.

### Deliverables

- ✅ Repository/monorepo setup.
- ✅ React mobile-first application shell.
- ✅ Node/Express API.
- ✅ Managed PostgreSQL/storage setup.
- ✅ Email/password authentication.
- ✅ Receipt ownership using `user_id`.
- ✅ Canonical receipt types/schemas.
- ✅ Basic receipt states.
- ✅ Croatian/English i18n foundation.
- ✅ Basic source-file storage.

### Validation

- User can register/login.
- Authenticated user can create/read their own test receipt.
- Another user cannot access it.
- Croatian/English switch works.
- Source-file storage is private.

---

## Phase 2 — Capture, Upload & Azure Extraction

### Goal

Complete the core photo/file → Azure Document Intelligence → canonical data workflow.

### Deliverables

- ✅ Camera/file input.
- ✅ Camera-permission fallback to upload.
- ✅ Receipt preview/retake.
- ✅ Upload validation.
- ✅ Basic image-quality handling.
- ✅ Azure Document Intelligence provider abstraction.
- ✅ Azure provider implementation.
- ✅ Canonical mapper.
- ✅ QR decoding.
- ✅ Initial validation/warnings.
- ✅ Processing/review/failed states.
- ✅ Basic retry path.
- ✅ Preserve original source and useful extraction metadata.

### Validation

- Real receipt photo reaches review.
- PDF/image upload reaches review.
- Azure output maps into canonical fields rather than leaking Azure field names.
- QR absence/failure does not block OCR.
- Clearly unusable source produces actionable feedback.
- Temporary processing failure produces a usable retry/re-upload path.

### OCR implementation note

The exact Azure model, confidence handling, fallback strategy, field-specific parsing, and potential use of more than one Azure model are decided during the **OCR implementation task**, not by this PRD.

---

## Phase 3 — Human Review, History & Export

### Goal

Complete the value loop from extraction to confirmed reusable data.

### Deliverables

- ✅ Pre-populated review form.
- ✅ Editable canonical fields.
- ✅ Warning display/recalculation.
- ✅ Explicit confirmation.
- ✅ Save original extraction and final values separately.
- ✅ Receipt history.
- ✅ Receipt detail/source viewer.
- ✅ Soft delete.
- ✅ CSV export.
- ✅ Versioned JSON export.

### Validation

- User can correct intentionally wrong extracted data.
- Warning does not block confirmation.
- Correcting a mismatch updates/removes the relevant warning.
- Confirmed record persists and remains linked to the original source.
- History and exports contain canonical data.

---

## Phase 4 — PoC Evaluation & Polish

### Goal

Evaluate the full workflow with real receipts and prepare a credible PoC result.

### Deliverables

- ✅ Representative test set including real phone photos.
- ✅ Croatian receipts.
- ✅ English-language receipts.
- ✅ Several difficult cases: glare, moderate blur, imperfect framing, faded print, missing QR.
- ✅ Record critical-field extraction accuracy.
- ✅ Record user corrections.
- ✅ Measure processing latency.
- ✅ Mobile browser QA.
- ✅ Error-state polish.
- ✅ Basic security/ownership tests.
- ✅ README/setup documentation.
- ✅ Document known OCR weaknesses and follow-up opportunities.

### Validation

- Core capture → review → confirm → history → export flow works on a representative phone/browser.
- PoC quality/latency measurements are documented.
- Known limitations are explicit.
- Results are sufficient to decide whether to continue toward a production SaaS iteration.

### Overall planning range

Approximately **2–4 working weeks** for a focused PoC implementation and evaluation.

---

# 13. Future Considerations

## OCR intelligence

- Conditional use of multiple Azure prebuilt models.
- Field-specific confidence policies.
- Azure Query Fields or equivalent capabilities.
- Custom Azure model trained on accumulated corrected receipts.
- Multimodal LLM fallback for genuinely ambiguous exception cases.
- Reconsidering another OCR provider only if Azure later demonstrates material cost, quality or operational limitations.

## Data quality

- OIB checksum/format validation if useful.
- Company/buyer OIB matching after a company entity exists.
- Business-level duplicate detection using fiscal identifiers and receipt metadata.
- Stronger receipt-number parsing.
- Learning from correction patterns.

## Product model

- Company/tenant entity.
- Multiple employees per company.
- Shared company receipt visibility.
- Company administrators.
- Accountant users.
- Approval workflow.
- Cost centers/projects/business-purpose notes.

## Integrations

- Accounting software APIs.
- ERP systems.
- Export templates for Croatian accounting products.
- Automated accountant delivery.
- Email delivery.
- Webhooks.
- Fina/e-invoice integrations where useful.
- Stable external API and schema-versioning policy.

## User experience

- Offline capture and deferred upload.
- Native mobile packaging if PWA limitations become material.
- Batch upload.
- Multiple images for long receipts.
- Automatic perspective correction/document edge detection.
- Better enhancement for faded thermal receipts.
- Hard-delete/retention controls.

## Automation / AI

- Expense category suggestions.
- Suggested accounting/GL mapping.
- Merchant normalization.
- Fraud/anomaly detection.
- LLM-assisted exception handling.

## Geography

- Broader foreign-receipt support.
- More receipt languages.
- Country-specific tax schemas and validation.

---

# 14. Risks & Mitigations

| Risk                                                                    | Impact | Mitigation                                                                                                                                             |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Real phone photos perform worse than clean Studio/online tests          | High   | Test genuine mobile photos early; provide clear capture/retake guidance; preserve human review.                                                        |
| Azure extracts text but misses or misclassifies Croatia-specific fields | High   | Keep provider abstraction; preserve raw extraction; add deterministic mapping/parsing during the OCR implementation task; evaluate actual corrections. |
| OCR output is treated as automatically correct                          | High   | Never auto-confirm; require explicit human review; highlight warnings/missing values.                                                                  |
| Processing latency makes the mobile flow feel slow                      | Medium | Keep uploads sensible, show processing feedback, measure latency, optimize only after identifying the bottleneck.                                      |
| Source documents or structured receipt data are exposed                 | High   | Private storage, authenticated ownership checks, HTTPS, backend-only credentials, authorized source access.                                            |
| OCR/API usage creates unexpected cost                                   | Medium | Keep Azure calls server-side, impose reasonable PoC upload/rate limits, monitor usage.                                                                 |
| Canonical schema misses fields needed by future accounting integrations | Medium | Preserve original source and extraction metadata; keep schema extensible; add integration-specific mappings later.                                     |
| PoC expands into full accounting workflow too early                     | High   | Keep company/tenant/accountant/integration/LLM functionality explicitly out of scope.                                                                  |
| Users expect a legal archival/compliance product                        | Medium | State clearly that the PoC stores originals for review but is not a certified accounting archive.                                                      |

---

# 15. Appendix

## A. Canonical field inventory

| Field           | Type               | Importance             | Must exist on every receipt? | Notes                                          |
| --------------- | ------------------ | ---------------------- | ---------------------------- | ---------------------------------------------- |
| Seller name     | string             | Critical               | No                           | Missing generates review warning               |
| Seller address  | string             | Secondary              | No                           |                                                |
| Seller OIB      | string             | Secondary              | No                           | Extract only; no PoC verification workflow     |
| Buyer name      | string             | Secondary              | No                           |                                                |
| Buyer address   | string             | Secondary              | No                           |                                                |
| Buyer OIB       | string             | Secondary              | No                           | Extract only; no company matching/verification |
| Document number | string             | Critical               | No                           | One editable string                            |
| Issue date      | date string        | Critical               | No                           | Normalize consistently                         |
| Issue time      | time string        | Secondary              | No                           |                                                |
| Subtotal        | decimal-safe value | Secondary              | No                           |                                                |
| VAT breakdown   | array              | Important when present | No                           | Rate/base/amount                               |
| Total           | decimal-safe value | Critical               | No                           |                                                |
| Currency        | string             | Critical               | No                           | Leave unknown when not confidently determined  |
| Payment method  | string             | Secondary              | No                           |                                                |
| JIR             | string             | Secondary              | No                           | Extract when present                           |
| ZKI             | string             | Secondary              | No                           | Extract when present                           |
| Items           | array              | Optional               | No                           | Non-critical for PoC review/accuracy           |

No value is invented simply because it is common on Croatian receipts.

## B. Minimal conceptual database model

```text
users
  └── managed by authentication provider

receipts
  id
  user_id
  source_object_path
  source_original_filename
  source_content_type

  status

  canonical_data_json
  original_extraction_json
  extraction_metadata_json
  qr_extraction_json
  raw_provider_result_json
  warnings_json

  created_at
  updated_at
  confirmed_at
  deleted_at
```

For the PoC, PostgreSQL `jsonb` is suitable for flexible structured fields. Frequently queried fields such as seller, issue date, document number, total and currency may additionally be stored in dedicated columns if useful.

Money stored in dedicated columns should use PostgreSQL `numeric`/decimal-safe types rather than floating point.

## C. Architectural decisions captured from discovery

1. Azure Document Intelligence is the selected OCR/document-extraction platform.
2. Exact Azure model selection and fallback logic are intentionally deferred to the OCR implementation task.
3. No open-source OCR comparison is required for the PoC.
4. No LLM is required in the initial extraction path.
5. OCR is exposed through an internal provider abstraction.
6. The application owns a canonical receipt schema.
7. Company/tenant/accountant entities are deliberately omitted.
8. Buyer OIB is optional extracted data only; it is not matched or verified against a company in the PoC.
9. QR decoding is included, but external fiscal verification is not.
10. Validation produces warnings and does not block confirmation.
11. Business-level duplicate detection is excluded.
12. Line items are optional and are not a PoC accuracy/review requirement.
13. Original images/PDFs are retained with the record.
14. Machine extraction and user-confirmed values remain distinguishable.
15. UI supports Croatian and English.
16. Initial export formats are CSV and JSON.
17. The UX processing target is approximately 2–5 seconds under normal conditions, not a guaranteed SLA.

## D. Technology baseline — verified 8 August 2026

Use current secure patch releases compatible with these baselines:

- React 19.2.x.
- Vite 8.1.x.
- TypeScript 7.x.
- Node.js 24 LTS.
- Express 5.x.
- Azure Document Intelligence v4, API version `2024-11-30` or the current supported v4 GA equivalent at implementation time.
- PostgreSQL via Supabase or an equivalent managed service.

### Official references

- React versions: https://react.dev/versions
- Vite 8.1 announcement: https://main.vite.dev/blog/announcing-vite8-1
- TypeScript 7.0 announcement: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- Node.js release status: https://nodejs.org/en/about/previous-releases
- Express version support: https://expressjs.com/en/support/
- Azure Document Intelligence overview/version support: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview
- Azure receipt model: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt
- Azure prebuilt-model language support: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/prebuilt

## E. PRD assumptions

1. One authenticated user owns their own receipts; company-level sharing is intentionally not modeled.
2. The PoC primarily targets Croatian retail/business receipts.
3. English-language receipts are a secondary supported input.
4. One uploaded image/PDF represents one receipt/document.
5. The source document is retained for review/evidence, but the PoC does not claim certified archival compliance.
6. The downstream recipient of structured receipt data is unknown.
7. CSV/JSON are sufficient to prove data portability in the PoC.
8. “No incorrect records” is a product aspiration for final human-confirmed data, not a mathematically enforceable guarantee.
9. Azure Document Intelligence is fixed as the extraction platform, while model-specific implementation is intentionally left open.
10. The application should remain simple enough to be built and evaluated as a PoC before SaaS-scale concerns are introduced.

---

# PRD Completion Checklist

- ✅ All requested PRD sections are present.
- ✅ Product scope reflects the agreed PoC rather than a production SaaS architecture.
- ✅ Company/tenant/accountant complexity is excluded.
- ✅ Buyer-OIB matching/verification is excluded.
- ✅ Azure Document Intelligence is fixed as the OCR platform.
- ✅ Azure model/fallback/LLM implementation details are deferred.
- ✅ Canonical data model is provider-independent.
- ✅ Original receipt documents are retained.
- ✅ Optional line items are supported without becoming a review requirement.
- ✅ QR decoding and non-blocking warnings are included.
- ✅ Business-level duplicate detection is excluded.
- ✅ Croatian and English UI are included.
- ✅ Croatian and English-language receipt inputs are supported.
- ✅ CSV and JSON export are included.
- ✅ Authentication and user-owned history are included.
- ✅ Performance target is measurable but not presented as an SLA.
- ✅ OCR quality is measured during PoC evaluation without invented pass/fail percentages.
- ✅ Technology baselines have been revalidated against current official sources.
- ✅ Risks and future enhancements are explicit.
