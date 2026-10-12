/**
 * The one comparison rule, used for every arm and for the production reference alike.
 *
 * Scored per field instance, not per receipt: at 15 receipts a per-receipt rate moves seven
 * points on one bad photo. More lenient than scripts/score-extraction.ts (numeric equality;
 * names and addresses ignoring case, spacing and punctuation), so production's numbers here are
 * not the README's. Diacritics count: "Građanin" is not "Gradanin".
 */
import { amountsEqual, isAmount } from "@receipt/shared";
import { categorizePaymentMethod } from "../../api/src/providers/document-extraction/payment-method.js";

export const CRITICAL = ["sellerName", "documentNumber", "issueDate", "total", "currency"] as const;
export const FISCAL = ["sellerOib", "jir", "zki"] as const;
export const OTHER = ["issueTime", "paymentMethod"] as const;
// Its own group, so the three above keep the meaning they had in iteration 25's tables.
export const PARTY = ["sellerAddress", "buyerName", "buyerAddress", "buyerOib"] as const;
export const SCORED_SCALARS = [...CRITICAL, ...FISCAL, ...OTHER, ...PARTY] as const;
export const TABLE_CELLS = {
  vatBreakdown: ["rate", "taxableBase", "vatAmount"],
  items: ["description", "quantity", "unitPrice", "total"],
} as const;

export type Group = "critical" | "fiscal" | "other" | "party" | "vat" | "items";

const EXACT = new Set(["issueDate", "issueTime", "sellerOib", "buyerOib", "currency"]);
const AMOUNTS = new Set(["total", "rate", "taxableBase", "vatAmount", "quantity", "unitPrice"]);

/** Case-, spacing- and punctuation-insensitive, diacritics kept: "Ana Horvat, obrt" meets "ANA HORVAT OBRT". */
const textKey = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const present = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};

/** `path` is a canonical dotted path; its last segment names the field or cell. */
export function matches(path: string, expected: unknown, actual: unknown): boolean {
  const e = present(expected);
  const a = present(actual);
  if (e === null && a === null) return true;
  if (e === null || a === null) return false;

  const field = path.split(".").at(-1)!;
  if (AMOUNTS.has(field)) return isAmount(e) && isAmount(a) ? amountsEqual(e, a) : e === a;
  if (EXACT.has(field)) return e === a;
  if (field === "jir" || field === "zki") return e.toLowerCase() === a.toLowerCase();
  // Ground truth records which method was used; an arm returns the wording the receipt prints.
  if (field === "paymentMethod")
    return categorizePaymentMethod(a) === e || textKey(a) === textKey(e);
  return textKey(e) === textKey(a);
}

export interface CellResult {
  path: string;
  group: Group;
  expected: unknown;
  actual: unknown;
  match: boolean;
}

export interface ReceiptScore {
  cells: CellResult[];
  /** Per table that ground truth has: did the arm return the same number of rows? */
  rowCountExact: Partial<Record<"vatBreakdown" | "items", boolean>>;
  /** Null when ground truth holds no critical field for this receipt. */
  noCriticalCorrection: boolean | null;
}

const groupOf = (field: string): Group =>
  (CRITICAL as readonly string[]).includes(field)
    ? "critical"
    : (FISCAL as readonly string[]).includes(field)
      ? "fiscal"
      : (PARTY as readonly string[]).includes(field)
        ? "party"
        : "other";

/**
 * A key absent from ground truth is not scored. A key present with null is: the arm must
 * return nothing. Table rows are aligned by index; the cells of a row the arm did not return
 * are misses, and an extra row shows in the row count.
 */
export function scoreReceipt(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): ReceiptScore {
  const cells: CellResult[] = [];
  for (const field of SCORED_SCALARS) {
    if (!(field in expected)) continue;
    cells.push({
      path: field,
      group: groupOf(field),
      expected: expected[field] ?? null,
      actual: actual[field] ?? null,
      match: matches(field, expected[field], actual[field]),
    });
  }

  const rowCountExact: ReceiptScore["rowCountExact"] = {};
  for (const [table, names] of Object.entries(TABLE_CELLS) as [
    "vatBreakdown" | "items",
    readonly string[],
  ][]) {
    if (!(table in expected)) continue;
    const want = (expected[table] as Record<string, unknown>[] | null) ?? [];
    const got = (actual[table] as Record<string, unknown>[] | null | undefined) ?? [];
    rowCountExact[table] = want.length === got.length;
    want.forEach((row, index) => {
      for (const name of names) {
        // A cell ground truth leaves out was illegible to its author, so it cannot be judged.
        if (!(name in row)) continue;
        const path = `${table}.${index}.${name}`;
        cells.push({
          path,
          group: table === "items" ? "items" : "vat",
          expected: row[name] ?? null,
          actual: got[index]?.[name] ?? null,
          match: matches(path, row[name], got[index]?.[name]),
        });
      }
    });
  }

  const critical = cells.filter((cell) => cell.group === "critical");
  return {
    cells,
    rowCountExact,
    noCriticalCorrection: critical.length ? critical.every((cell) => cell.match) : null,
  };
}
