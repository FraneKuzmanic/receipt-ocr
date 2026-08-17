import { z } from "zod";

/**
 * The warning taxonomy — codes only. The *rules* that decide when a warning applies are
 * Task 08's; this module exists so the model, the API and the UI can already agree on the
 * vocabulary.
 *
 * These seven are derived from the check list in ROADMAP Task 08, not invented. Adding an
 * eighth speculatively would be scaffolding for a rule nobody has written yet, and every
 * code costs two translations.
 */
export const WARNING_CODES = [
  "missing_critical_field",
  "unparseable_date",
  "unparseable_amount",
  "vat_arithmetic_mismatch",
  "qr_total_mismatch",
  "qr_datetime_mismatch",
  "document_quality",
] as const;

export const warningCodeSchema = z.enum(WARNING_CODES);
export type WarningCode = z.infer<typeof warningCodeSchema>;

/**
 * A warning carries a stable machine code and the field it concerns, never prose: the
 * client owns the human copy and translates the code, exactly as it does for error codes
 * (PRD §7.13). `field` is a dotted path such as `total` or `vatBreakdown.0.vatAmount`, so
 * the review form can attach the message to the right input (PRD §7.8).
 *
 * Warnings are informational. Nothing here may ever prevent confirmation (PRD §7.8).
 */
export const receiptWarningSchema = z
  .object({
    code: warningCodeSchema,
    field: z.string().nullable().optional(),
  })
  .strict();

export type ReceiptWarning = z.infer<typeof receiptWarningSchema>;
