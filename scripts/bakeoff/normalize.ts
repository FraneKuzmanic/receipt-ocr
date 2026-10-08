/**
 * The model copies each value as the receipt prints it ("17.08.2026.", "1.234,56"). This turns
 * that into canonical values with the parsers production uses, so an arm is scored on what it
 * read and not on how it wrote it.
 *
 * A printed value a parser cannot read stays null and is listed as unreadable. Nothing is
 * computed or defaulted, except the currency of a dated Croatian receipt, which is listed apart.
 */
import {
  parseAmount,
  parseIssueDate,
  parseIssueTime,
  type CanonicalReceiptFields,
} from "@receipt/shared";
import { normalizeOib } from "../../api/src/providers/document-extraction/croatian.js";
import { EURO_ADOPTION_DATE } from "../../api/src/providers/document-extraction/currency.js";
import {
  parseReceiptAmount,
  parseReceiptQuantity,
  parseVatRate,
} from "../../api/src/providers/document-extraction/receipt-amount.js";

type Parser = (raw: string) => string | null;

/** Wrapped lines become one line, as extraction stores them. */
const oneLine: Parser = (raw) =>
  raw
    .split(/\s*\n\s*/)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() || null;
const compact: Parser = (raw) => raw.replace(/\s/g, "") || null;

function currencyCode(raw: string): string | null {
  const token = raw.trim().toUpperCase();
  if (token === "€" || token === "EUR" || token === "EURO") return "EUR";
  if (token === "KN" || token === "HRK") return "HRK";
  if (token === "$" || token === "USD") return "USD";
  return null;
}

// The model is told to copy what is printed, and sometimes copies what is printed around a
// value too: "OIB: 62357811032", "1,00 kom", "2,79 D1", "0,95 EUR/kg". That is a reading of the
// right value, so each parser below falls back to the value inside the text it was given.

/** An OIB with its label still attached. The check digit is verified either way. */
const oib: Parser = (raw) => normalizeOib(raw) ?? normalizeOib(/\d{11}/.exec(raw)?.[0]);

/** A number followed by its unit or tax-group code. */
const leadingNumber = (raw: string): string | undefined => /^\s*-?\d[\d.,]*/.exec(raw)?.[0];
const amount: Parser = (raw) => parseReceiptAmount(raw) ?? parseReceiptAmount(leadingNumber(raw));
const quantity: Parser = (raw) =>
  parseReceiptQuantity(raw) ?? parseReceiptQuantity(leadingNumber(raw));

/**
 * The production parser reads dates day first, as Croatian receipts print them. A date whose
 * middle number cannot be a month ("02/24/17") can only be month first.
 */
const date: Parser = (raw) => {
  const dayFirst = parseIssueDate(raw);
  if (dayFirst !== null) return dayFirst;
  const parts = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(raw.trim());
  if (!parts) return null;
  const [, month, day, year] = parts;
  if (Number(month) > 12 || Number(day) <= 12 || Number(day) > 31) return null;
  return `${year!.length === 2 ? `20${year}` : year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
};

const SCALARS: Record<string, Parser> = {
  sellerName: oneLine,
  sellerAddress: oneLine,
  sellerOib: oib,
  buyerName: oneLine,
  buyerAddress: oneLine,
  buyerOib: oib,
  documentNumber: oneLine,
  issueDate: date,
  issueTime: parseIssueTime,
  subtotal: parseAmount,
  total: parseAmount,
  currency: currencyCode,
  paymentMethod: oneLine,
  jir: compact,
  zki: compact,
};

const TABLES: Record<"vatBreakdown" | "items", Record<string, Parser>> = {
  vatBreakdown: {
    rate: parseVatRate,
    taxableBase: amount,
    vatAmount: amount,
  },
  items: {
    description: oneLine,
    quantity,
    unitPrice: amount,
    total: amount,
  },
};

export interface Normalized {
  fields: CanonicalReceiptFields;
  /** Paths the model returned a value for that no parser could read. */
  unreadable: string[];
  /** Paths filled by inference rather than from a printed value. */
  inferred: string[];
}

const printed = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

export function normalize(raw: Record<string, unknown>): Normalized {
  const fields: Record<string, unknown> = {};
  const unreadable: string[] = [];
  const inferred: string[] = [];

  const read = (path: string, value: unknown, parse: Parser): string | null => {
    const text = printed(value);
    if (text === null) return null;
    const parsed = parse(text);
    if (parsed === null) unreadable.push(path);
    return parsed;
  };

  for (const [name, parse] of Object.entries(SCALARS)) fields[name] = read(name, raw[name], parse);

  for (const [table, cells] of Object.entries(TABLES)) {
    const rows = Array.isArray(raw[table]) ? (raw[table] as Record<string, unknown>[]) : [];
    const kept: Record<string, string | null>[] = [];
    for (const row of rows) {
      const index = kept.length;
      const unreadableBefore = unreadable.length;
      const mapped = Object.fromEntries(
        Object.entries(cells).map(([cell, parse]) => [
          cell,
          read(`${table}.${index}.${cell}`, row?.[cell], parse),
        ]),
      );
      // A row with nothing readable in it is not a row; its unreadable cells go with it.
      if (Object.values(mapped).every((value) => value === null)) {
        unreadable.length = unreadableBefore;
        continue;
      }
      kept.push(mapped);
    }
    fields[table] = kept.length ? kept : null;
  }

  // Production's last resort: a Croatian receipt that prints no currency took euros from 2023.
  const croatian = fields["sellerOib"] !== null || fields["jir"] !== null || fields["zki"] !== null;
  const issueDate = fields["issueDate"] as string | null;
  if (fields["currency"] === null && printed(raw["currency"]) === null && croatian && issueDate) {
    fields["currency"] = issueDate >= EURO_ADOPTION_DATE ? "EUR" : "HRK";
    inferred.push("currency");
  }

  return { fields: fields as CanonicalReceiptFields, unreadable, inferred };
}
