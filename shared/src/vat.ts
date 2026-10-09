// Imported for its side effect first: money.ts sets `Big.strict`, which is what guarantees a JS
// number can never reach the arithmetic below.
import "./money.js";
import Big from "big.js";
import type { VatBreakdown } from "./receipt.js";

const TOLERANCE = "0.01";

/**
 * Whether one VAT row agrees with itself: base × rate must give the VAT amount to the cent.
 *
 * A row is checked against its own three cells and nothing else. The previous rule summed every
 * base and VAT amount and compared the result with the receipt total, which is not an identity a
 * receipt has to satisfy — `22559270` prints a recap 0.90 short of its own total, and any receipt
 * carrying a non-VAT charge fails it by construction.
 *
 * Returns `null` when a cell is missing or unreadable: not enough information is not a mismatch.
 */
export function vatRowConsistent(row: VatBreakdown): boolean | null {
  const { rate, taxableBase, vatAmount } = row;
  if (!rate || !taxableBase || !vatAmount) return null;
  try {
    const expected = new Big(taxableBase).times(rate).div("100");
    return expected.minus(vatAmount).abs().lte(TOLERANCE);
  } catch {
    return null;
  }
}
