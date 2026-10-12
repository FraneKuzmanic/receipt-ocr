/**
 * The scalar probe's merge: an LLM as a third reader of the 14 scalar fields, beside the two
 * prebuilt models, under one rule fixed before any paid call.
 *
 *   1. A field the QR code supplied or agrees with is production's.
 *   2. Buyer name, address and OIB are the LLM's, including empty.
 *   3. Payment method and issue time are the LLM's when it has one, else production's.
 *   4. Every other scalar is production's when it has one, else the LLM's.
 *   5. Under rule 4, where both have a value and they differ, production's is kept and the
 *      field is listed as a disagreement (what the review form would flag).
 *
 * Unlike `repair`, the model is not shown production's reading. Line items, VAT rows, positions
 * and confidences are always production's.
 */
import type { CanonicalReceiptFields } from "@receipt/shared";
import { matches } from "./compare.ts";
import { SCALAR_FIELDS } from "./field-schema.ts";
import { lockedFields, type LlmReading, type ProductionReading } from "./repair.ts";

export const BUYER: readonly string[] = ["buyerName", "buyerAddress", "buyerOib"];
export const LLM_FIRST: readonly string[] = ["paymentMethod", "issueTime"];

export interface Merged {
  fields: CanonicalReceiptFields;
  /** Fields production left empty and the LLM filled. */
  filled: string[];
  /** Fields where production's value was replaced by a different one (rules 2 and 3). */
  replaced: string[];
  /** Buyer fields production had a value for and the LLM returned empty. */
  cleared: string[];
  /** Rule 5: both read a value, they differ, production's was kept. */
  disagreed: string[];
  /** Fields the LLM returned a value for that `grounded` refused; treated as no reading. */
  rejectedUngrounded: string[];
}

const filled = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * `grounded`, when given, is asked whether the LLM's value for a field is on the page; a value
 * that is not counts as the LLM having read nothing there, and never as it having read "empty".
 */
export function mergeScalars(
  production: ProductionReading,
  llm: LlmReading,
  grounded?: (name: string) => boolean,
): Merged {
  const locked = lockedFields(production);
  const fields = { ...production.fields } as Record<string, unknown>;
  const result: Merged = {
    fields: fields as CanonicalReceiptFields,
    filled: [],
    replaced: [],
    cleared: [],
    disagreed: [],
    rejectedUngrounded: [],
  };

  for (const name of SCALAR_FIELDS) {
    if (locked.has(name)) continue;
    const current = fields[name];
    const printed = llm.printed[name];
    let offered = (llm.fields as Record<string, unknown>)[name];
    // A value the normaliser inferred, or could not read, is not the model's reading.
    if (!filled(printed)) offered = null;
    else if (filled(offered) && grounded && !grounded(name)) {
      result.rejectedUngrounded.push(name);
      offered = null;
    }
    const take = (): void => {
      if (offered === current) return;
      fields[name] = offered;
      (filled(current) ? result.replaced : result.filled).push(name);
    };

    if (BUYER.includes(name)) {
      if (filled(offered)) take();
      else if (!filled(printed) && filled(current)) {
        fields[name] = null;
        result.cleared.push(name);
      }
    } else if (LLM_FIRST.includes(name)) {
      if (filled(offered)) take();
    } else if (!filled(current)) {
      if (filled(offered)) take();
    } else if (filled(offered) && !matches(name, current, offered)) {
      result.disagreed.push(name);
    }
  }
  return result;
}
