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
import type { ExtractionFieldMetadata } from "./types.js";

type Fields = Record<string, DocumentFieldOutput>;

export interface MappedAnalyzeResult {
  readonly fields: CanonicalReceiptFields;
  readonly fieldMetadata: Record<string, ExtractionFieldMetadata>;
  readonly unreadableFields: string[];
  readonly documentConfidence: number | null;
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
  const currency = totalField?.valueCurrency;
  if (currency?.currencySymbol && currency.currencyCode) {
    fields.currency = currency.currencyCode;
    fieldMetadata.currency = metadata(totalField);
  }

  const vatField = first(sourceFields, FIELD_ALIASES.vatBreakdown);
  const vatBreakdown = mapVatBreakdown(vatField);
  if (vatBreakdown !== null) {
    fields.vatBreakdown = vatBreakdown;
    fieldMetadata.vatBreakdown = metadata(vatField);
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
        rate: parseAmount(first(values, VAT_CELL_ALIASES.rate)?.content),
        taxableBase: parseAmount(first(values, VAT_CELL_ALIASES.taxableBase)?.content),
        vatAmount: parseAmount(first(values, VAT_CELL_ALIASES.vatAmount)?.content),
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
      quantity: parseAmount(first(values, ITEM_CELL_ALIASES.quantity)?.content),
      unitPrice: parseAmount(first(values, ITEM_CELL_ALIASES.unitPrice)?.content),
      total: parseAmount(first(values, ITEM_CELL_ALIASES.total)?.content),
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
