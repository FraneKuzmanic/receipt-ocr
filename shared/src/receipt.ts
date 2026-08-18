import { z } from "zod";
import { AMOUNT_PATTERN } from "./money.js";
import { receiptWarningSchema } from "./warnings.js";

export const RECEIPT_STATUSES = ["processing", "review", "confirmed", "failed"] as const;
export const receiptStatusSchema = z.enum(RECEIPT_STATUSES);
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

/** Money crosses this boundary already normalized; the raw locale form never reaches the model. */
const amountSchema = z.string().regex(AMOUNT_PATTERN);

const optionalText = z.string().nullable().optional();
const optionalAmount = amountSchema.nullable().optional();

export const vatBreakdownSchema = z
  .object({
    rate: optionalAmount,
    taxableBase: optionalAmount,
    vatAmount: optionalAmount,
  })
  .strict();

export type VatBreakdown = z.infer<typeof vatBreakdownSchema>;

export const receiptItemSchema = z
  .object({
    description: optionalText,
    quantity: optionalAmount,
    unitPrice: optionalAmount,
    total: optionalAmount,
  })
  .strict();

export type ReceiptItem = z.infer<typeof receiptItemSchema>;

/**
 * Tier 1 — everything the user may edit in the review form, straight from PRD §6.4.
 *
 * Every data field is optional and nullable: no field is expected on every receipt, and a
 * missing value stays missing rather than being defaulted to `""`, `0` or today's date
 * (PRD §6.4 schema rules, §7.7).
 */
export const canonicalReceiptFieldsSchema = z
  .object({
    sellerName: optionalText,
    sellerAddress: optionalText,
    sellerOib: optionalText,

    buyerName: optionalText,
    buyerAddress: optionalText,
    buyerOib: optionalText,

    documentNumber: optionalText,
    issueDate: z.iso.date().nullable().optional(),
    issueTime: z.iso.time().nullable().optional(),

    subtotal: optionalAmount,
    vatBreakdown: z.array(vatBreakdownSchema).nullable().optional(),
    total: optionalAmount,
    // ISO 4217 shape only. Deliberately not an enum of known currencies: PRD Appendix A
    // says to leave currency unknown when it cannot be confidently determined, and an enum
    // would force the mapper to invent or drop a value it actually read.
    currency: z.string().length(3).nullable().optional(),

    paymentMethod: optionalText,
    jir: optionalText,
    zki: optionalText,

    items: z.array(receiptItemSchema).nullable().optional(),
  })
  .strict();

export type CanonicalReceiptFields = z.infer<typeof canonicalReceiptFieldsSchema>;

/**
 * Tier 2 — tier 1 plus the envelope only the server may set.
 *
 * The split is the point. Because the PATCH body is derived from tier 1 alone, it is
 * structurally incapable of accepting `userId`, so "never trust a client-supplied userId"
 * (PRD §9.1) is a property of the type system rather than a rule someone has to remember.
 * Do not flatten these into one schema.
 *
 * Supabase persists both identifiers as UUIDs. The database and shared boundary enforce
 * the same shape so an invalid identifier cannot reach a repository query.
 */
export const canonicalReceiptSchema = canonicalReceiptFieldsSchema.extend({
  id: z.uuid(),
  userId: z.uuid(),
  status: receiptStatusSchema,
  warnings: z.array(receiptWarningSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().nullable().optional(),
  deletedAt: z.iso.datetime().nullable().optional(),
});

export type CanonicalReceipt = z.infer<typeof canonicalReceiptSchema>;
