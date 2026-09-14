import { compareAmounts, parseAmount, parseQuantity } from "@receipt/shared";

const TRAILING_TAX_CLASS = /\s+[A-Za-zČĆŽŠĐčćžšđ]$/u;
const TRAILING_ANNOTATION = /[*#]+$/;
// Croatian recaps prefix the rate with a tax-group code: "D1 25,00 %", which OCR also reads as
// "01 25.00 %". Concatenated, that becomes the nonsense rate 0125.00.
const LEADING_GROUP_CODE = /^[A-Za-zČĆŽŠĐčćžšđ0-9]{1,3}[\s.]+(?=\d)/u;

/** Normalizes receipt-specific OCR noise before the canonical money parser validates it. */
export function parseReceiptAmount(raw: string | null | undefined): string | null {
  return raw === null || raw === undefined ? null : parseAmount(stripReceiptNoise(raw));
}

/** A line-item quantity, where `3,000` means three rather than three thousand. */
export function parseReceiptQuantity(raw: string | null | undefined): string | null {
  return raw === null || raw === undefined ? null : parseQuantity(stripReceiptNoise(raw));
}

function stripReceiptNoise(raw: string): string {
  return (
    raw
      .trim()
      // A label's colon rides along on a recap cell the receipt model returns as "25%:".
      .replace(/[%:]+$/, "")
      .replace(TRAILING_TAX_CLASS, "")
      .replace(TRAILING_ANNOTATION, "")
      .trim()
  );
}

/**
 * Reads a VAT rate, discarding a leading tax-group code. A value outside 0–100 is not a rate the
 * receipt showed, so it is reported as unreadable rather than stored — the review form can then
 * flag an empty rate instead of presenting "0125.00" as if it were read (PRD §7.7).
 */
export function parseVatRate(raw: string | null | undefined): string | null {
  // A rate ends at its percent sign; whatever follows is surrounding text the model captured with
  // it, such as the bracket closing "porez( 25%)".
  const rate = raw?.split("%")[0];
  const direct = parseReceiptAmount(rate);
  if (isRate(direct)) return direct;

  const stripped = parseReceiptAmount((rate ?? "").replace(LEADING_GROUP_CODE, ""));
  return isRate(stripped) ? stripped : null;
}

function isRate(value: string | null): value is string {
  return value !== null && compareAmounts(value, "0") >= 0 && compareAmounts(value, "100") <= 0;
}
