import {
  addAmounts,
  amountsEqual,
  type CanonicalReceiptFields,
  type ReceiptWarning,
} from "@receipt/shared";
import type { FiscalQrData } from "../providers/document-extraction/fiscal-qr.js";

export interface WarningInput {
  readonly fields: CanonicalReceiptFields;
  readonly qr?: FiscalQrData | null;
  /** Canonical field names whose source text was present but could not be normalized. */
  readonly unreadable?: readonly string[];
  /** The extraction provider found a VAT recap in source text that did not map to a VAT row. */
  readonly vatTextPresent?: boolean;
}

export const CRITICAL_FIELDS = [
  "sellerName",
  "documentNumber",
  "issueDate",
  "total",
  "currency",
] as const;

export function computeWarnings(input: WarningInput): ReceiptWarning[] {
  const warnings: ReceiptWarning[] = [];

  for (const field of CRITICAL_FIELDS) {
    if (isMissing(input.fields[field])) warnings.push({ code: "missing_critical_field", field });
  }

  for (const field of input.unreadable ?? []) {
    if (!isMissing(fieldValue(input.fields, field))) continue;
    if (field === "issueDate" || field === "issueTime") {
      warnings.push({ code: "unparseable_date", field });
    }
    if (field === "total" || field === "subtotal") {
      warnings.push({ code: "unparseable_amount", field });
    }
  }

  if (hasVatMismatch(input.fields)) {
    warnings.push({ code: "vat_arithmetic_mismatch", field: "vatBreakdown" });
  }

  if (input.vatTextPresent === true && (input.fields.vatBreakdown?.length ?? 0) === 0) {
    warnings.push({ code: "vat_present_but_unread", field: "vatBreakdown" });
  }

  if (
    input.qr?.total !== null &&
    input.qr?.total !== undefined &&
    input.fields.total !== null &&
    input.fields.total !== undefined &&
    !safeAmountsEqual(input.qr.total, input.fields.total)
  ) {
    warnings.push({ code: "qr_total_mismatch", field: "total" });
  }

  if (hasQrDatetimeMismatch(input.fields, input.qr)) {
    warnings.push({ code: "qr_datetime_mismatch", field: "issueDate" });
  }

  // document_quality remains deliberately unproduced: Task 08 found no reliable server-side signal.
  // See .agents/history/08-qr-decoding-validation-warnings-engine.md for the recorded evidence.
  return warnings;
}

function isMissing(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function fieldValue(fields: CanonicalReceiptFields, field: string): string | null | undefined {
  if (field === "issueDate" || field === "issueTime" || field === "total" || field === "subtotal") {
    return fields[field];
  }
  return undefined;
}

function hasVatMismatch(fields: CanonicalReceiptFields): boolean {
  if (fields.total === null || fields.total === undefined) return false;
  const breakdown = fields.vatBreakdown;
  if (breakdown === null || breakdown === undefined || breakdown.length === 0) return false;
  if (breakdown.some((entry) => entry.taxableBase == null || entry.vatAmount == null)) return false;

  try {
    let sum = "0";
    for (const entry of breakdown) {
      sum = addAmounts(sum, entry.taxableBase!);
      sum = addAmounts(sum, entry.vatAmount!);
    }
    return !amountsEqual(sum, fields.total);
  } catch {
    return false;
  }
}

function hasQrDatetimeMismatch(
  fields: CanonicalReceiptFields,
  qr: FiscalQrData | null | undefined,
): boolean {
  if (qr === null || qr === undefined) return false;

  const dateMismatch =
    qr.issueDate !== null &&
    fields.issueDate !== null &&
    fields.issueDate !== undefined &&
    qr.issueDate !== fields.issueDate;
  const timeMismatch =
    qr.issueTime !== null &&
    fields.issueTime !== null &&
    fields.issueTime !== undefined &&
    qr.issueTime !== fields.issueTime.slice(0, 5);

  return dateMismatch || timeMismatch;
}

function safeAmountsEqual(a: string, b: string): boolean {
  try {
    return amountsEqual(a, b);
  } catch {
    return true;
  }
}
