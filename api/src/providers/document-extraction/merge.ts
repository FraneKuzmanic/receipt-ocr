import type { CanonicalReceiptFields } from "@receipt/shared";
import type { ExtractionFieldMetadata } from "./types.js";

/**
 * Canonical fields the receipt model reads better than the invoice model, measured field by field
 * over the sample corpus rather than assumed: it returns a transaction time where the invoice
 * model returns none, a tax recap carrying the taxable base the invoice model's table parsing
 * loses, and line items whose columns stay aligned to their own row instead of borrowing a
 * neighbouring row's quantity. Every other field keeps the invoice model first, which reads seller
 * identity, document number and PDF issue dates markedly better.
 *
 * Selection is deliberately a fixed per-field order and **not** a comparison of provider
 * confidence. Over the corpus the two models disagreed on 16 field readings; a comparable
 * confidence existed for only four of them, and in all four the more confident model was the wrong
 * one — the receipt model is confidently certain that a venue's trading name is the seller.
 */
export const SECONDARY_PREFERRED_FIELDS: readonly string[] = ["issueTime", "vatBreakdown", "items"];

export type FieldModel = "primary" | "secondary";

export interface ModelExtraction {
  readonly fields: CanonicalReceiptFields;
  readonly metadata: Record<string, ExtractionFieldMetadata>;
  readonly unreadableFields: readonly string[];
}

export interface MergedExtraction {
  readonly fields: CanonicalReceiptFields;
  readonly metadata: Record<string, ExtractionFieldMetadata>;
  readonly unreadableFields: string[];
  /** Which model each populated field came from, so regions project from the right response. */
  readonly fieldModels: Record<string, FieldModel>;
}

/**
 * Merges two model readings of one document. The second model is purely additive: it wins the
 * fields it is measurably better at, fills gaps the first left empty, and can never blank a value
 * the first model read.
 */
export function mergeExtractions(
  primary: ModelExtraction,
  secondary: ModelExtraction | null,
): MergedExtraction {
  const fields: Record<string, unknown> = {};
  const metadata: Record<string, ExtractionFieldMetadata> = {};
  const fieldModels: Record<string, FieldModel> = {};

  const candidates: Array<[FieldModel, ModelExtraction]> =
    secondary === null
      ? [["primary", primary]]
      : [
          ["primary", primary],
          ["secondary", secondary],
        ];

  const names = new Set(candidates.flatMap(([, model]) => Object.keys(model.fields)));

  for (const name of names) {
    const order = SECONDARY_PREFERRED_FIELDS.includes(name) ? candidates.toReversed() : candidates;

    for (const [model, extraction] of order) {
      const value = (extraction.fields as Record<string, unknown>)[name];
      if (value === undefined || value === null) continue;
      fields[name] = value;
      fieldModels[name] = model;
      const fieldMetadata = extraction.metadata[name];
      if (fieldMetadata !== undefined) metadata[name] = fieldMetadata;
      break;
    }
  }

  // A field is only unreadable if whichever model won still could not read it; a value recovered
  // from the other model is a value, not a failure.
  const unreadableFields = [
    ...new Set(candidates.flatMap(([, model]) => model.unreadableFields)),
  ].filter((name) => fields[name] === undefined);

  return {
    fields: fields as CanonicalReceiptFields,
    metadata,
    unreadableFields,
    fieldModels,
  };
}
