import { amountsEqual, isAmount, type CanonicalReceiptFields } from "@receipt/shared";
import { qrCorroboratedFields } from "../../validation/warnings.js";
import type { FiscalQrData } from "./fiscal-qr.js";
import type { ExtractionFieldMetadata } from "./types.js";

/** The fields the scalar reader is asked for, in the order its schema lists them. */
export const SCALAR_FIELDS: readonly string[] = [
  "sellerName",
  "sellerAddress",
  "sellerOib",
  "buyerName",
  "buyerAddress",
  "buyerOib",
  "documentNumber",
  "issueDate",
  "issueTime",
  "total",
  "currency",
  "paymentMethod",
  "jir",
  "zki",
];

// The two prebuilt models invent a buyer on a retail receipt (`26515835`) and return the seller's
// tax id as the buyer's (`lira_trogir`). The reader was right on every buyer block of the corpus,
// so here, and only here, its empty reading clears a value.
const BUYER_FIELDS: readonly string[] = ["buyerName", "buyerAddress", "buyerOib"];

// An unlabelled tender line (`GOTOVINA 2,00`) is a payment method the text rules deliberately do
// not read, and the prebuilt models pad a time with seconds the receipt did not print.
const READER_FIRST_FIELDS: readonly string[] = ["paymentMethod", "issueTime"];

/**
 * The disagreements a reviewer is shown as an amber field. Only the critical fields that hold one
 * exact value: over the 16 recorded receipts the one disagreement on them was a wrong two-model
 * value (the Konzum kuna total). `sellerName` is deliberately absent: its disagreements were two or
 * three a run and one of them on a wrong value, because the readers differ on how much of the
 * header is the name, not on what is printed. A flag that fires on correct values teaches a
 * reviewer to ignore it. Sixteen receipts is a small sample either way.
 */
export const FLAGGED_DISAGREEMENT_FIELDS: readonly string[] = [
  "documentNumber",
  "issueDate",
  "total",
  "currency",
];

export type ScalarFieldModel = "primary" | "secondary" | "reader";

export interface TwoModelReading {
  readonly fields: CanonicalReceiptFields;
  readonly metadata: Record<string, ExtractionFieldMetadata>;
  readonly fieldModels: Record<string, ScalarFieldModel>;
  readonly qr: FiscalQrData | null;
}

export interface OfferedScalars {
  /** Each value as the reader copied it. */
  readonly printed: Record<string, string | null>;
  /** The same values in canonical form; null where a parser could not read one. */
  readonly fields: Record<string, string | null>;
}

export interface ScalarMerge {
  readonly fields: CanonicalReceiptFields;
  readonly metadata: Record<string, ExtractionFieldMetadata>;
  readonly fieldModels: Record<string, ScalarFieldModel>;
  /** Scalars both readings hold with the same value. */
  readonly agreed: string[];
  /** Both hold a value, they differ, and the two-model value was kept. */
  readonly disagreed: string[];
}

const filled = (value: unknown): value is string => typeof value === "string" && value !== "";

const EXACT = new Set(["issueDate", "issueTime", "sellerOib", "buyerOib", "currency"]);

/** Case-, spacing- and punctuation-insensitive, diacritics kept. */
const textKey = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Whether two readings of one scalar are the same value. A name or an address differing only in
 * case, spacing or punctuation (`d. o.o.` against `d.o.o.`) is one reading, not a disagreement.
 */
export function sameValue(field: string, left: unknown, right: unknown): boolean {
  const a = filled(left) ? left.trim() : "";
  const b = filled(right) ? right.trim() : "";
  if (a === "" || b === "") return a === b;
  if (field === "total") return isAmount(a) && isAmount(b) ? amountsEqual(a, b) : a === b;
  if (EXACT.has(field)) return a === b;
  if (field === "jir" || field === "zki") return a.toLowerCase() === b.toLowerCase();
  return textKey(a) === textKey(b);
}

/**
 * Merges the scalar reader's reading into the two-model result, by a rule fixed before it was
 * measured and not by any confidence:
 *
 *   1. A field the QR code supplied or agrees with is the two-model value.
 *   2. Buyer name, address and OIB are the reader's, including empty.
 *   3. Payment method and issue time are the reader's when it has one.
 *   4. Every other scalar is the two-model value when there is one, else the reader's.
 *   5. Under rule 4, where both hold a value and they differ, the two-model value is kept.
 *
 * Over the 15 receipts with verified scalars this took 183 right of 209 to 198 and changed no
 * correct value. Line items and VAT rows are never the reader's.
 */
export function mergeScalars(production: TwoModelReading, reading: OfferedScalars): ScalarMerge {
  const fields = { ...production.fields } as Record<string, unknown>;
  const metadata = { ...production.metadata };
  const fieldModels = { ...production.fieldModels };
  const agreed: string[] = [];
  const disagreed: string[] = [];

  const locked = new Set([
    ...Object.entries(production.metadata)
      .filter(([, meta]) => meta.source === "qr")
      .map(([name]) => name),
    ...qrCorroboratedFields(production.fields, production.qr),
  ]);

  for (const name of SCALAR_FIELDS) {
    if (locked.has(name)) continue;
    const current = fields[name];
    const printed = reading.printed[name];
    // A value the parser could not read has a printed form and no canonical one: it is not a
    // reading, so it neither fills a field nor counts as the reader having found nothing there.
    const offered = filled(printed) ? reading.fields[name] : null;

    if (filled(current) && filled(offered) && sameValue(name, current, offered)) agreed.push(name);

    const take = (): void => {
      if (offered === current) return;
      fields[name] = offered;
      metadata[name] = { confidence: null, source: "reader" };
      fieldModels[name] = "reader";
    };

    if (BUYER_FIELDS.includes(name)) {
      if (filled(offered)) take();
      else if (!filled(printed) && filled(current)) {
        fields[name] = null;
        delete metadata[name];
        fieldModels[name] = "reader";
      }
    } else if (READER_FIRST_FIELDS.includes(name)) {
      if (filled(offered)) take();
    } else if (!filled(current)) {
      if (filled(offered)) take();
    } else if (filled(offered) && !sameValue(name, current, offered)) {
      disagreed.push(name);
    }
  }

  return { fields: fields as CanonicalReceiptFields, metadata, fieldModels, agreed, disagreed };
}
