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
import { resolveCurrency } from "./currency.js";
import { parseReceiptAmount } from "./receipt-amount.js";
import { findVatTable, mapVatTable } from "./vat-tables.js";
import { LOW_CONFIDENCE_THRESHOLD, type ExtractionFieldMetadata } from "./types.js";

type Fields = Record<string, DocumentFieldOutput>;

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
  for (const canonical of [
    "sellerAddress",
    "sellerOib",
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

  const taxDetails = sourceFields["TaxDetails"];
  const totalTax = sourceFields["TotalTax"];
  const modelVatBreakdown = mapVatBreakdown(taxDetails);
  const vatTable = findVatTable(analyzeResult);
  const tableVatBreakdown = vatTable === null ? [] : mapVatTable(vatTable);
  const vatBreakdown =
    modelVatBreakdown ??
    (tableVatBreakdown.length > 0 ? tableVatBreakdown : null) ??
    mapVatBreakdown(totalTax);
  const vatSource =
    modelVatBreakdown !== null
      ? "model"
      : tableVatBreakdown.length > 0
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
  fields[canonical] = field.content;
  metadataByField[canonical] = metadata(field);
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
        rate: parseReceiptAmount(first(values, VAT_CELL_ALIASES.rate)?.content),
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
  return field.valueArray.map((entry) => {
    const values = entry.valueObject ?? {};
    return {
      description: first(values, ITEM_CELL_ALIASES.description)?.content ?? null,
      quantity: parseReceiptAmount(first(values, ITEM_CELL_ALIASES.quantity)?.content),
      unitPrice: parseReceiptAmount(first(values, ITEM_CELL_ALIASES.unitPrice)?.content),
      total: parseReceiptAmount(first(values, ITEM_CELL_ALIASES.total)?.content),
    };
  });
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
