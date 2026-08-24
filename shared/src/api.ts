import { z } from "zod";
import {
  canonicalReceiptFieldsSchema,
  canonicalReceiptSchema,
  receiptStatusSchema,
} from "./receipt.js";
import { sourceContentTypeSchema } from "./upload.js";

/**
 * The API's universal failure body, mirroring `api/src/middleware/error-handler.ts`.
 * Failures carry a stable machine `code`, never prose, so the client can translate them
 * (PRD §7.13).
 */
export const apiErrorResponseSchema = z
  .object({
    error: z.object({ code: z.string() }).strict(),
  })
  .strict();

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/** PRD §10.1 — `POST /api/receipts` */
export const createReceiptResponseSchema = canonicalReceiptSchema.pick({
  id: true,
  status: true,
  createdAt: true,
});

export type CreateReceiptResponse = z.infer<typeof createReceiptResponseSchema>;

/** The review surface exposes canonical low-confidence field names, never provider metadata. */
export const receiptDetailResponseSchema = canonicalReceiptSchema.extend({
  lowConfidenceFields: z.array(z.string()),
  /**
   * Scalar canonical fields whose current value differs from the original machine extraction —
   * the same provenance distinction PRD §6.4 requires be kept internally, surfaced so the review
   * UI can mark a source-image outline as "this was corrected" rather than implying it still
   * matches the receipt. Never includes `vatBreakdown`/`items`: row indices can shift when the
   * user adds or removes a row, which would make a per-index comparison misleading.
   */
  editedFields: z.array(z.string()),
});

export type ReceiptDetailResponse = z.infer<typeof receiptDetailResponseSchema>;

/** PRD §10.8 — `GET /api/receipts/:id/source` */
export const sourceDocumentResponseSchema = z
  .object({
    url: z.url(),
    contentType: sourceContentTypeSchema,
    originalFilename: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

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
    items: z.array(canonicalReceiptSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  })
  .strict();

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
export const confirmReceiptResponseSchema = canonicalReceiptSchema.pick({
  id: true,
  status: true,
  confirmedAt: true,
});

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
