import { z } from "zod";
import {
  canonicalReceiptFieldsSchema,
  canonicalReceiptSchema,
  receiptStatusSchema,
} from "./receipt.js";
import { sourceContentTypeSchema } from "./upload.js";

/**
 * Response bodies are parsed leniently; request bodies are not.
 *
 * `.strict()` is load-bearing on the **request** side — `updateReceiptRequestSchema` derives from
 * the strict tier-1 field schema, which is what makes a forged `userId` a schema rejection rather
 * than something every route has to remember to ignore (PRD §9.1) — and inside the API, where it
 * catches database drift and stops provider vocabulary leaking out of a projection. None of that
 * changes.
 *
 * Applied to a **response** the browser reads, the same strictness is actively harmful. A tab left
 * open across a deploy is still running the previous bundle, so a field the API has since added is
 * an ordinary additive change; rejecting the whole body over one unknown key turns every deploy
 * into an outage for everyone mid-session.
 *
 * That is not hypothetical. Shipping `failureReason` on 2026-08-26 did exactly this: every open tab
 * rejected every receipt response, and because the rejection surfaced as the generic processing
 * error screen it looked like an extraction bug on receipts that had extracted perfectly. See
 * `.agents/history/19-stale-bundle-response-contract.md`.
 *
 * So every response body the client parses is `.strip()`: an unknown key is accepted and then
 * discarded, so a newer API cannot break an older bundle and cannot smuggle an undeclared field
 * into it either. `.loose()` would also accept the key but would carry it through, which is why
 * `.strip()` is the right one here. It relaxes only the level it is applied to, which is where
 * additive fields actually land.
 */
export const apiErrorResponseSchema = z
  .object({
    error: z.object({ code: z.string() }).strip(),
  })
  .strip();

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/** PRD §10.1 — `POST /api/receipts` */
export const createReceiptResponseSchema = canonicalReceiptSchema
  .pick({
    id: true,
    status: true,
    createdAt: true,
  })
  .strip();

export type CreateReceiptResponse = z.infer<typeof createReceiptResponseSchema>;

export const RECEIPT_FAILURE_REASONS = [
  "unreadable_document",
  "provider_rejected",
  "provider_unavailable",
] as const;
export const receiptFailureReasonSchema = z.enum(RECEIPT_FAILURE_REASONS);
export type ReceiptFailureReason = z.infer<typeof receiptFailureReasonSchema>;

/** The review surface exposes canonical low-confidence field names, never provider metadata. */
export const receiptDetailResponseSchema = canonicalReceiptSchema
  .extend({
    lowConfidenceFields: z.array(z.string()),
    failureReason: receiptFailureReasonSchema.nullable().optional(),
    /**
     * Scalar canonical fields whose current value differs from the original machine extraction —
     * the same provenance distinction PRD §6.4 requires be kept internally, surfaced so the review
     * UI can mark a source-image outline as "this was corrected" rather than implying it still
     * matches the receipt. Never includes `vatBreakdown`/`items`: row indices can shift when the
     * user adds or removes a row, which would make a per-index comparison misleading.
     */
    editedFields: z.array(z.string()),
  })
  .strip();

export type ReceiptDetailResponse = z.infer<typeof receiptDetailResponseSchema>;

/** PRD §10.8 — `GET /api/receipts/:id/source` */
export const sourceDocumentResponseSchema = z
  .object({
    url: z.url(),
    contentType: sourceContentTypeSchema,
    originalFilename: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .strip();

export type SourceDocumentResponse = z.infer<typeof sourceDocumentResponseSchema>;

/** Where on the source document a canonical value was read from. */
export const sourceRegionSchema = z
  .object({
    fields: z.array(z.string()).min(1),
    page: z.number().int().min(1),
    corners: z.array(z.object({ x: z.number(), y: z.number() }).strict()).length(4),
    origin: z.enum(["model", "text"]),
  })
  .strict();

export type SourceRegion = z.infer<typeof sourceRegionSchema>;

export const sourceRegionsResponseSchema = z
  .object({
    pages: z.array(
      z.object({ page: z.number().int().min(1), aspectRatio: z.number().positive() }).strict(),
    ),
    regions: z.array(sourceRegionSchema),
  })
  .strict();

export type SourceRegionsResponse = z.infer<typeof sourceRegionsResponseSchema>;

/**
 * PRD §10.2 — `GET /api/receipts`
 *
 * `page` and `limit` are counts arriving as query strings, which is the one place in this
 * codebase where coercing to a `number` is correct. Money never goes near it.
 */
export const listReceiptsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: receiptStatusSchema.optional(),
  })
  .strict();

export type ListReceiptsQuery = z.infer<typeof listReceiptsQuerySchema>;

export const listReceiptsResponseSchema = z
  .object({
    // The receipt itself is loosened too, not just the envelope: a new canonical field is exactly
    // the kind of additive change that lands here, and history is the screen a stale tab is most
    // likely to be sitting on.
    items: z.array(canonicalReceiptSchema.strip()),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  })
  .strip();

export type ListReceiptsResponse = z.infer<typeof listReceiptsResponseSchema>;

/**
 * PRD §10.4 — `PATCH /api/receipts/:id`
 *
 * Derived from the tier-1 field schema, so it accepts only what the user may edit. Zod's
 * `.strict()` survives `.partial()`, which is what makes a forged `userId` in the body a
 * schema rejection rather than something an ownership check has to remember to ignore
 * (PRD §9.1). Never redeclare this shape by hand.
 */
export const updateReceiptRequestSchema = canonicalReceiptFieldsSchema.partial();

export type UpdateReceiptRequest = z.infer<typeof updateReceiptRequestSchema>;

/** PRD §10.5 — `POST /api/receipts/:id/confirm` */
export const confirmReceiptResponseSchema = canonicalReceiptSchema
  .pick({
    id: true,
    status: true,
    confirmedAt: true,
  })
  .strip();

export type ConfirmReceiptResponse = z.infer<typeof confirmReceiptResponseSchema>;

/** PRD §10.9 — `GET /api/receipts/export` */
export const EXPORT_FORMATS = ["csv", "json"] as const;
export const exportFormatSchema = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const EXPORT_SCHEMA_VERSION = 1;

export const exportedReceiptSchema = canonicalReceiptSchema.omit({
  userId: true,
  deletedAt: true,
});

export type ExportedReceipt = z.infer<typeof exportedReceiptSchema>;

export const jsonExportResponseSchema = z
  .object({
    schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
    receipts: z.array(exportedReceiptSchema),
  })
  .strict();

export type JsonExportResponse = z.infer<typeof jsonExportResponseSchema>;
