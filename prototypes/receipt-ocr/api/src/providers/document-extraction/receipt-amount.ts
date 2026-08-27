import { compareAmounts, parseAmount } from "@receipt/shared";

const TRAILING_TAX_CLASS = /\s+[A-Za-zČĆŽŠĐčćžšđ]$/u;
const TRAILING_ANNOTATION = /[*#]+$/;
// Croatian recaps prefix the rate with a tax-group code: "D1 25,00 %", which OCR also reads as
// "01 25.00 %". Concatenated, that becomes the nonsense rate 0125.00.
const LEADING_GROUP_CODE = /^[A-Za-zČĆŽŠĐčćžšđ0-9]{1,3}[\s.]+(?=\d)/u;

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

/**
 * Reads a VAT rate, discarding a leading tax-group code. A value outside 0–100 is not a rate the
 * receipt showed, so it is reported as unreadable rather than stored — the review form can then
 * flag an empty rate instead of presenting "0125.00" as if it were read (PRD §7.7).
 */
export function parseVatRate(raw: string | null | undefined): string | null {
  const direct = parseReceiptAmount(raw);
  if (isRate(direct)) return direct;

  const stripped = parseReceiptAmount((raw ?? "").replace(LEADING_GROUP_CODE, ""));
  return isRate(stripped) ? stripped : null;
}

function isRate(value: string | null): value is string {
  return value !== null && compareAmounts(value, "0") >= 0 && compareAmounts(value, "100") <= 0;
}
