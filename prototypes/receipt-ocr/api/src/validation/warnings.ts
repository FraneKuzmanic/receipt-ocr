import {
  amountsEqual,
  vatRowConsistent,
  type CanonicalReceiptFields,
  type ReceiptWarning,
} from "@receipt/shared";
import { normalizeOib } from "../providers/document-extraction/croatian.js";
import { parseFiscalQr, type FiscalQrData } from "../providers/document-extraction/fiscal-qr.js";

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
    if (field === "total") {
      warnings.push({ code: "unparseable_amount", field });
    }
  }

  // Each row is checked against its own base and rate. The rows are never summed against the
  // total: a receipt need not satisfy that (`22559270` prints a recap 0.90 short of its total).
  for (const [index, row] of (input.fields.vatBreakdown ?? []).entries()) {
    if (vatRowConsistent(row) === false) {
      warnings.push({ code: "vat_arithmetic_mismatch", field: `vatBreakdown.${index}.vatAmount` });
    }
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

  // A JIR carries no checksum, so an OCR misread is invisible except against the QR code, whose
  // error correction makes it the reliable copy of the same identifier.
  if (
    input.qr?.jir != null &&
    !isMissing(input.fields.jir) &&
    input.qr.jir.toLowerCase() !== input.fields.jir!.trim().toLowerCase()
  ) {
    warnings.push({ code: "qr_jir_mismatch", field: "jir" });
  }

  // An OIB that fails its check digit is shown rather than dropped, so it must say so.
  for (const field of ["sellerOib", "buyerOib"] as const) {
    const value = input.fields[field];
    if (!isMissing(value) && normalizeOib(value) === null) {
      warnings.push({ code: "oib_checksum_invalid", field });
    }
  }

  // document_quality remains deliberately unproduced: Task 08 found no reliable server-side signal.
  // See .agents/history/08-qr-decoding-validation-warnings-engine.md for the recorded evidence.
  return warnings;
}

/**
 * The warnings for a receipt as it is stored, computed from its stored evidence. Used wherever a
 * stored receipt is read or edited, so the warnings a user sees always follow the current rules:
 * the copy persisted at extraction goes stale the moment a rule changes, and a receipt stored
 * before the per-row VAT check kept showing a mismatch that check no longer raises.
 */
export function computeStoredWarnings(
  fields: CanonicalReceiptFields,
  qrExtraction: unknown,
  extractionMetadata: unknown,
): ReceiptWarning[] {
  const metadata =
    extractionMetadata !== null &&
    typeof extractionMetadata === "object" &&
    !Array.isArray(extractionMetadata)
      ? (extractionMetadata as Record<string, unknown>)
      : {};
  const unreadable = metadata["unreadableFields"];
  return computeWarnings({
    fields,
    qr: storedQr(qrExtraction),
    unreadable: Array.isArray(unreadable)
      ? unreadable.filter((value): value is string => typeof value === "string")
      : [],
    vatTextPresent: metadata["vatTextPresent"] === true,
  });
}

/** The stored QR record is re-parsed from its raw payload rather than trusted as stored. */
export function storedQr(value: unknown): FiscalQrData | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)["raw"];
  return typeof raw === "string" ? parseFiscalQr(raw) : null;
}

function isMissing(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function fieldValue(fields: CanonicalReceiptFields, field: string): string | null | undefined {
  if (field === "issueDate" || field === "issueTime" || field === "total") {
    return fields[field];
  }
  return undefined;
}

/**
 * The canonical fields the receipt's own QR code agrees with. A value confirmed by an independent,
 * error-corrected copy is not doubtful, whatever confidence the model attached to reading it — the
 * review surface uses this to stop flagging such a field. Only fields the QR actually carries, and
 * only on agreement: a missing or differing QR value corroborates nothing.
 */
export function qrCorroboratedFields(
  fields: CanonicalReceiptFields,
  qr: FiscalQrData | null | undefined,
): string[] {
  if (qr === null || qr === undefined) return [];
  const corroborated: string[] = [];
  if (qr.issueDate !== null && qr.issueDate === fields.issueDate) corroborated.push("issueDate");
  if (qr.issueTime !== null && qr.issueTime === fields.issueTime?.slice(0, 5)) {
    corroborated.push("issueTime");
  }
  if (
    qr.total !== null &&
    !isMissing(fields.total) &&
    strictAmountsEqual(qr.total, fields.total!)
  ) {
    corroborated.push("total");
  }
  if (qr.jir !== null && qr.jir.toLowerCase() === fields.jir?.trim().toLowerCase()) {
    corroborated.push("jir");
  }
  return corroborated;
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

function strictAmountsEqual(a: string, b: string): boolean {
  try {
    return amountsEqual(a, b);
  } catch {
    return false;
  }
}

function safeAmountsEqual(a: string, b: string): boolean {
  try {
    return amountsEqual(a, b);
  } catch {
    return true;
  }
}
