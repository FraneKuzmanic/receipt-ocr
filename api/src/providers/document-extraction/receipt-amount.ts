import { parseAmount } from "@receipt/shared";

const TRAILING_TAX_CLASS = /\s+[A-Za-zČĆŽŠĐčćžšđ]$/u;
const TRAILING_ANNOTATION = /[*#]+$/;

/** Normalizes receipt-specific OCR noise before the canonical money parser validates it. */
export function parseReceiptAmount(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  const cleaned = raw
    .trim()
    .replace(/%+$/, "")
    .replace(TRAILING_TAX_CLASS, "")
    .replace(TRAILING_ANNOTATION, "")
    .trim();

  return parseAmount(cleaned);
}
