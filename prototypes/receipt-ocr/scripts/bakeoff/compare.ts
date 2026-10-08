/**
 * The one comparison rule, used for every arm and for the production reference alike.
 *
 * Scored per field instance, not per receipt: at 14 receipts a per-receipt rate moves seven
 * points on one bad photo. More lenient than scripts/score-extraction.ts (numeric equality,
 * folded text), so the reference line's numbers here are not the README's.
 */
import { amountsEqual, isAmount } from "@receipt/shared";

export const CRITICAL = ["sellerName", "documentNumber", "issueDate", "total", "currency"] as const;
export const FISCAL = ["sellerOib", "jir", "zki"] as const;
export const OTHER = ["issueTime", "subtotal", "paymentMethod"] as const;
export const SCORED_SCALARS = [...CRITICAL, ...FISCAL, ...OTHER] as const;
export const TABLE_CELLS = {
  vatBreakdown: ["rate", "taxableBase", "vatAmount"],
  items: ["description", "quantity", "unitPrice", "total"],
} as const;

export type Group = "critical" | "fiscal" | "other" | "vat" | "items";

const EXACT = new Set(["issueDate", "issueTime", "sellerOib", "buyerOib", "currency"]);
const AMOUNTS = new Set([
  "subtotal",
  "total",
  "rate",
  "taxableBase",
  "vatAmount",
  "quantity",
  "unitPrice",
]);

/** Diacritic-, case- and punctuation-insensitive: "Ana Horvat, obrt" meets "ANA HORVAT OBRT". */
const textKey = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

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
