import type { CroatianMatch } from "./croatian.js";
import { differsByOneCharacter } from "./vat-tables.js";

export type PaymentCategory = "cash" | "card" | "bank_transfer" | "cheque" | "other";

// The wording differs by till vendor; the category is fixed by fiscalization law, which requires a
// receipt to state one of: novčanice, kartica, transakcijski račun, (until 2026) ček, ostalo.
// The category is never stored — the receipt keeps the wording it printed. It is how extraction
// tells wording that names a payment method from wording that does not.
const VOCABULARY: Readonly<Record<PaymentCategory, readonly string[]>> = {
  cash: ["novcanice", "kovanice", "gotovina", "gotovinski", "cash"],
  card: [
    "kartica",
    "kartice",
    "karticno",
    "card",
    "visa",
    "mastercard",
    "maestro",
    "amex",
    "diners",
  ],
  bank_transfer: ["transakcijski", "virman", "prijenos", "transfer"],
  cheque: ["cek", "cheque"],
  other: ["ostalo"],
};

// A short word one character away from a method name is usually another word entirely.
const FUZZY_MIN_LENGTH = 7;

// The leading "N" is optional because a photo cropped at the receipt's left edge loses it:
// `lira_trogir` reaches OCR as "ačín plaćanja:".
const LABEL = /(?<!\p{L})(?:n?a[cč][ií]ni?\s+pla[cć]anja|na[cč]\.\s*pla[cć])(?!\p{L})[ \t.:]*/giu;

/**
 * Maps the printed payment wording to its category. Several distinct methods on one receipt are
 * `other`, as the fiscalization rulebook reports them; wording that names no known method is
 * `null`, never `other`.
 */
export function categorizePaymentMethod(text: string | null | undefined): PaymentCategory | null {
  const found = new Set<PaymentCategory>();
  for (const word of fold(text ?? "").split(/[^a-z]+/u)) {
    const category = categoryOf(word);
    if (category !== null) found.add(category);
  }
  if (found.size === 0) return null;
  return found.size === 1 ? [...found][0]! : "other";
}

/**
 * Reads the payment method printed after its "Način plaćanja" label — on the same line, or on the
 * next one when the line ends at the label. The match's value is the wording as printed, and it is
 * read only when it names a known method, so the line after a label cannot become a value merely
 * by following it.
 *
 * A tender line with no label ("GOTOVINA 2,00") is deliberately not read: without the label,
 * calling it the payment method would be a guess.
 */
export function findPaymentMethod(content: string): CroatianMatch | null {
  for (const label of content.matchAll(LABEL)) {
    const from = label.index + label[0].length;
    const printed = restOfLine(content, from) ?? restOfLine(content, nextLine(content, from));
    if (printed === null) continue;
    const value = content.slice(printed.start, printed.end);
    if (categorizePaymentMethod(value) !== null) return { value, ...printed };
  }
  return null;
}

function categoryOf(word: string): PaymentCategory | null {
  if (word === "") return null;
  for (const [category, terms] of Object.entries(VOCABULARY) as Array<
    [PaymentCategory, readonly string[]]
  >) {
    for (const term of terms) {
      if (word === term) return category;
      // One mis-decoded character is tolerated in a long word: `receipt123` prints "NOVČANICE"
      // and reaches OCR as "NONCANICE".
      if (
        term.length >= FUZZY_MIN_LENGTH &&
        word.length === term.length &&
        differsByOneCharacter(word, term)
      ) {
        return category;
      }
    }
  }
  return null;
}

function fold(text: string): string {
  return text.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase().replaceAll("đ", "d");
}

function restOfLine(content: string, from: number): { start: number; end: number } | null {
  if (from >= content.length) return null;
  const lineEnd = content.indexOf("\n", from);
  const line = content.slice(from, lineEnd === -1 ? content.length : lineEnd);
  const trimmed = line.trim();
  if (trimmed === "") return null;
  const start = from + line.indexOf(trimmed);
  return { start, end: start + trimmed.length };
}

function nextLine(content: string, from: number): number {
  const lineEnd = content.indexOf("\n", from);
  return lineEnd === -1 ? content.length : lineEnd + 1;
}
