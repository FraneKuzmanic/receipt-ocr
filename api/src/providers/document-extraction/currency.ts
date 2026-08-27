import { parseAmount } from "@receipt/shared";
import type { DocumentFieldOutput } from "@azure-rest/ai-document-intelligence";
import { stripContentMarkers } from "./content-markers.js";
import { findIssueDate, hasFiscalMarkings } from "./croatian.js";

const AMOUNT = "\\d+(?:[.,]\\d+)*";
const TOKEN = "(?:\\b(?:kn|hrk|eur|usd|gbp)\\b|€|\\$|£)";
const AMOUNT_THEN_TOKEN = new RegExp(`(${AMOUNT})\\s*(${TOKEN})`, "giu");
const TOKEN_THEN_AMOUNT = new RegExp(`(${TOKEN})\\s*(${AMOUNT})`, "giu");

export interface CurrencyResolution {
  readonly code: string;
  readonly source: "text" | "model" | "inferred";
}

export interface ResolveCurrencyInput {
  readonly content: string;
  readonly field: DocumentFieldOutput | undefined;
  readonly issueDate: string | null | undefined;
}

/** Croatia replaced the kuna with the euro on this date; a later kuna figure is informational. */
export const EURO_ADOPTION_DATE = "2023-01-01";

const PAYABLE_LABEL = /\b(?:za\s+platiti|za\s+pla[čc]anje|ukupno\s+eur)\b/iu;
const PAYABLE_EURO_AMOUNT = /(\d[\d.,]*)\s*(?:€|\bEUR\b)/iu;

/**
 * Finds the euro amount a dual-currency receipt actually asks for. After euro adoption Croatian
 * receipts still print a kuna equivalent, and the provider sometimes returns that line as the
 * invoice total — which silently corrupts both the total and the currency, since both derive
 * from the same field.
 */
export function findPayableEuroTotal(content: string): string | null {
  const text = stripContentMarkers(content).text;
  const label = PAYABLE_LABEL.exec(text);
  if (label === null) return null;

  const from = label.index + label[0].length;
  const amount = PAYABLE_EURO_AMOUNT.exec(text.slice(from, from + 40));
  return amount === null ? null : parseAmount(amount[1]);
}

export function resolveCurrency(input: ResolveCurrencyInput): CurrencyResolution | null {
  const content = stripContentMarkers(input.content).text;
  const textCurrency = explicitCurrency(content);
  if (textCurrency !== null) return { code: textCurrency, source: "text" };

  const currency = input.field?.valueCurrency;
  if (currency?.currencySymbol && currency.currencyCode) {
    return { code: currency.currencyCode, source: "model" };
  }

  const issueDate = input.issueDate ?? findIssueDate(content)?.value;
  if (issueDate !== undefined && hasFiscalMarkings(content)) {
    return { code: issueDate < EURO_ADOPTION_DATE ? "HRK" : "EUR", source: "inferred" };
  }

  return null;
}

function explicitCurrency(content: string): string | null {
  const codes = new Set<string>();
  for (const match of content.matchAll(AMOUNT_THEN_TOKEN)) {
    const token = match[2]!;
    const position = match.index! + match[0].lastIndexOf(token);
    if (!isExcludedToken(content, position, token.length)) codes.add(currencyCode(token));
  }
  for (const match of content.matchAll(TOKEN_THEN_AMOUNT)) {
    const token = match[1]!;
    if (!isExcludedToken(content, match.index!, token.length)) codes.add(currencyCode(token));
  }
  return codes.size === 1 ? [...codes][0]! : null;
}

function isExcludedToken(content: string, start: number, length: number): boolean {
  const after = content.slice(start + length);
  if (/^\s*[=:]/u.test(after)) return true;

  const before = content.slice(0, start);
  const open = before.lastIndexOf("(");
  const close = before.lastIndexOf(")");
  const closing = content.indexOf(")", start + length);
  return open > close && closing !== -1 && content.slice(open, closing + 1).includes("=");
}

function currencyCode(token: string): string {
  switch (token.toUpperCase()) {
    case "KN":
    case "HRK":
      return "HRK";
    case "€":
    case "EUR":
      return "EUR";
    case "$":
    case "USD":
      return "USD";
    default:
      return "GBP";
  }
}
