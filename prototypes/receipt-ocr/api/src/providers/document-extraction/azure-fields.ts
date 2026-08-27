import {
  parseAmount,
  parseIssueDate,
  parseIssueTime,
  type CanonicalReceiptFields,
  type ReceiptItem,
  type VatBreakdown,
} from "@receipt/shared";
import type {
  AnalyzeResultOutput,
  DocumentFieldOutput,
} from "@azure-rest/ai-document-intelligence";
import { FIELD_ALIASES, ITEM_CELL_ALIASES, VAT_CELL_ALIASES } from "./field-aliases.js";
import { EURO_ADOPTION_DATE, findPayableEuroTotal, resolveCurrency } from "./currency.js";
import { normalizeOib } from "./croatian.js";
import { parseReceiptAmount, parseVatRate } from "./receipt-amount.js";
import { findVatTable, mapVatTable, mapVatText } from "./vat-tables.js";
import { LOW_CONFIDENCE_THRESHOLD, type ExtractionFieldMetadata } from "./types.js";

type Fields = Record<string, DocumentFieldOutput>;

const TOTALS_DESCRIPTION =
  /^\s*(?:osnovica|ukupno|sveukupno|za\s+platiti|popust|porez|pdv|total|subtotal|vat)\b/iu;

export interface MappedAnalyzeResult {
  readonly fields: CanonicalReceiptFields;
  readonly fieldMetadata: Record<string, ExtractionFieldMetadata>;
  readonly unreadableFields: string[];
  readonly documentConfidence: number | null;
  readonly vatSource: "model" | "table" | "total" | null;
}

type TextField =
  | "sellerName"
  | "sellerAddress"
  | "sellerOib"
  | "buyerName"
  | "buyerAddress"
  | "buyerOib"
  | "documentNumber"
  | "paymentMethod";

export function mapAnalyzeResult(analyzeResult: AnalyzeResultOutput): MappedAnalyzeResult {
  const document = analyzeResult.documents?.[0];
  const sourceFields = document?.fields ?? {};
  const fields: CanonicalReceiptFields = {};
  const fieldMetadata: Record<string, ExtractionFieldMetadata> = {};
  const unreadableFields: string[] = [];

  assignText(fields, fieldMetadata, "sellerName", first(sourceFields, FIELD_ALIASES.sellerName));
  assignOib(fields, fieldMetadata, first(sourceFields, FIELD_ALIASES.sellerOib));
  for (const canonical of [
    "sellerAddress",
    "buyerName",
    "buyerAddress",
    "buyerOib",
    "documentNumber",
    "paymentMethod",
  ] as const) {
    assignText(fields, fieldMetadata, canonical, first(sourceFields, FIELD_ALIASES[canonical]));
  }
  assignAmount(
    fields,
    fieldMetadata,
    unreadableFields,
    "subtotal",
    first(sourceFields, FIELD_ALIASES.subtotal),
  );
  assignAmount(
    fields,
    fieldMetadata,
    unreadableFields,
    "total",
    first(sourceFields, FIELD_ALIASES.total),
  );

  assignDate(
    fields,
    fieldMetadata,
    unreadableFields,
    "issueDate",
    first(sourceFields, FIELD_ALIASES.issueDate),
  );
  assignTime(
    fields,
    fieldMetadata,
    unreadableFields,
    "issueTime",
    first(sourceFields, FIELD_ALIASES.issueTime),
  );

  const totalField = first(sourceFields, FIELD_ALIASES.currency);
  const currency = resolveCurrency({
    content: analyzeResult.content,
    field: totalField,
    issueDate: fields.issueDate,
  });
  if (currency !== null) {
    fields.currency = currency.code;
    fieldMetadata.currency = {
      confidence:
        currency.source === "inferred"
          ? LOW_CONFIDENCE_THRESHOLD - 0.2
          : (totalField?.confidence ?? null),
      source: currency.source,
    };
  }
  applyEuroDenomination(fields, fieldMetadata, analyzeResult.content ?? "");

  const taxDetails = sourceFields["TaxDetails"];
  const totalTax = sourceFields["TotalTax"];
  const modelVatBreakdown = mapVatBreakdown(taxDetails);
  const vatTable = findVatTable(analyzeResult);
  const tableVatBreakdown = vatTable === null ? [] : mapVatTable(vatTable);
  const textVatBreakdown =
    modelVatBreakdown === null && tableVatBreakdown.length === 0
      ? mapVatText(analyzeResult.content ?? "")
      : [];
  const vatBreakdown =
    modelVatBreakdown ??
    (tableVatBreakdown.length > 0 ? tableVatBreakdown : null) ??
    (textVatBreakdown.length > 0 ? textVatBreakdown : null) ??
    mapVatBreakdown(totalTax);
  const vatSource =
    modelVatBreakdown !== null
      ? "model"
      : tableVatBreakdown.length > 0
        ? "table"
        : textVatBreakdown.length > 0
          ? "table"
          : vatBreakdown !== null
            ? "total"
            : null;
  if (vatBreakdown !== null && vatBreakdown.length > 0) {
    fields.vatBreakdown = vatBreakdown;
    fieldMetadata.vatBreakdown = metadata(taxDetails ?? totalTax);
  }

  const itemsField = first(sourceFields, FIELD_ALIASES.items);
  const items = mapItems(itemsField);
  if (items !== null) {
    fields.items = items;
    fieldMetadata.items = metadata(itemsField);
  }

  return {
    fields,
    fieldMetadata,
    unreadableFields,
    documentConfidence: document?.confidence ?? null,
    vatSource,
  };
}

function first(fields: Fields, names: readonly string[]): DocumentFieldOutput | undefined {
  for (const name of names) {
    const field = fields[name];
    if (field !== undefined) return field;
  }
  return undefined;
}

function assignText(
  fields: CanonicalReceiptFields,
  metadataByField: Record<string, ExtractionFieldMetadata>,
  canonical: TextField,
  field: DocumentFieldOutput | undefined,
): void {
  if (!field?.content) return;
  // OCR opens a gap around the separators of a document number: "49781/001/ 1".
  fields[canonical] =
    canonical === "documentNumber"
      ? field.content.replaceAll(/\s*([-/])\s*/gu, "$1")
      : field.content;
  metadataByField[canonical] = metadata(field);
}

/**
 * A receipt issued after Croatia adopted the euro is denominated in euro, whatever kuna
 * equivalent it also prints. When the provider picked the kuna line, both the total and the
 * currency are wrong together, so both are restored from the amount the receipt asks for.
 */
function applyEuroDenomination(
  fields: CanonicalReceiptFields,
  metadataByField: Record<string, ExtractionFieldMetadata>,
  content: string,
): void {
  const issueDate = fields.issueDate;
  if (fields.currency !== "HRK" || issueDate == null || issueDate < EURO_ADOPTION_DATE) return;

  const payable = findPayableEuroTotal(content);
  if (payable === null) return;

  fields.total = payable;
  fields.currency = "EUR";
  metadataByField.total = { confidence: null, source: "text" };
  metadataByField.currency = { confidence: null, source: "text" };
}

/**
 * The provider returns whatever tax identifier it finds nearest the vendor, which on a receipt
 * printing both "PDVbr: HR…" and "OIB: …" is the VAT number one line above the OIB. Accepting it
 * only once it normalizes to a checksum-valid OIB lets the labelled text fallback win otherwise.
 */
function assignOib(
  fields: CanonicalReceiptFields,
  metadataByField: Record<string, ExtractionFieldMetadata>,
  field: DocumentFieldOutput | undefined,
): void {
  const oib = normalizeOib(field?.content);
  if (oib === null) return;
  fields.sellerOib = oib;
  metadataByField.sellerOib = metadata(field);
}

function assignAmount(
  fields: CanonicalReceiptFields,
  metadataByField: Record<string, ExtractionFieldMetadata>,
  unreadableFields: string[],
  canonical: "subtotal" | "total",
  field: DocumentFieldOutput | undefined,
): void {
  const amount = parseAmount(field?.content);
  if (amount === null) {
    recordUnreadable(unreadableFields, canonical, field);
    return;
  }
  fields[canonical] = amount;
  metadataByField[canonical] = metadata(field);
}

function assignDate(
  fields: CanonicalReceiptFields,
  metadataByField: Record<string, ExtractionFieldMetadata>,
  unreadableFields: string[],
  canonical: "issueDate",
  field: DocumentFieldOutput | undefined,
): void {
  const value = parseIssueDate(field?.valueDate ?? field?.content);
  if (value === null) {
    recordUnreadable(unreadableFields, canonical, field);
    return;
  }
  fields[canonical] = value;
  metadataByField[canonical] = metadata(field);
}

function assignTime(
  fields: CanonicalReceiptFields,
  metadataByField: Record<string, ExtractionFieldMetadata>,
  unreadableFields: string[],
  canonical: "issueTime",
  field: DocumentFieldOutput | undefined,
): void {
  const value = parseIssueTime(field?.valueTime ?? field?.content);
  if (value === null) {
    recordUnreadable(unreadableFields, canonical, field);
    return;
  }
  fields[canonical] = value;
  metadataByField[canonical] = metadata(field);
}

function mapVatBreakdown(field: DocumentFieldOutput | undefined): VatBreakdown[] | null {
  if (field?.valueArray) {
    return field.valueArray.map((entry) => {
      const values = entry.valueObject ?? {};
      return {
        rate: parseVatRate(first(values, VAT_CELL_ALIASES.rate)?.content),
        taxableBase: parseReceiptAmount(first(values, VAT_CELL_ALIASES.taxableBase)?.content),
        vatAmount: parseReceiptAmount(first(values, VAT_CELL_ALIASES.vatAmount)?.content),
      };
    });
  }
  const vatAmount = parseAmount(field?.content);
  return vatAmount === null ? null : [{ rate: null, taxableBase: null, vatAmount }];
}

function mapItems(field: DocumentFieldOutput | undefined): ReceiptItem[] | null {
  if (!field?.valueArray) return null;
  const items = field.valueArray
    .map((entry) => {
      const values = entry.valueObject ?? {};
      return {
        description: first(values, ITEM_CELL_ALIASES.description)?.content ?? null,
        quantity: parseReceiptAmount(first(values, ITEM_CELL_ALIASES.quantity)?.content),
        unitPrice: parseReceiptAmount(first(values, ITEM_CELL_ALIASES.unitPrice)?.content),
        total: parseReceiptAmount(first(values, ITEM_CELL_ALIASES.total)?.content),
      };
    })
    .filter((item) => !isTotalsLine(item));
  return items.length > 0 ? items : null;
}

/**
 * A receipt with no itemised lines can hand Azure its totals block instead, which arrives as
 * products called "Osnovica bez PDV" and "Ukupno porez( 25%)". A real purchased line carries a
 * quantity or a unit price; a totals line carries neither and names itself.
 */
function isTotalsLine(item: ReceiptItem): boolean {
  if (item.quantity !== null || item.unitPrice !== null) return false;
  return TOTALS_DESCRIPTION.test(item.description ?? "");
}

function metadata(field: DocumentFieldOutput | undefined): ExtractionFieldMetadata {
  return { confidence: field?.confidence ?? null, source: "model" };
}

function recordUnreadable(
  unreadableFields: string[],
  canonical: string,
  field: DocumentFieldOutput | undefined,
): void {
  if (typeof field?.content === "string" && field.content.trim() !== "") {
    unreadableFields.push(canonical);
  }
}
