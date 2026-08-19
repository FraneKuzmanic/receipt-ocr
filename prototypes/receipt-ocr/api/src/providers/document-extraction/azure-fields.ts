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
import type { ExtractionFieldMetadata } from "./types.js";

type Fields = Record<string, DocumentFieldOutput>;

export interface MappedAnalyzeResult {
  readonly fields: CanonicalReceiptFields;
  readonly fieldMetadata: Record<string, ExtractionFieldMetadata>;
  readonly unreadableFields: string[];
  readonly documentConfidence: number | null;
}

const TEXT_FIELD_ALIASES = {
  sellerAddress: ["VendorAddress", "MerchantAddress"],
  sellerOib: ["VendorTaxId"],
  buyerName: ["CustomerName"],
  buyerAddress: ["CustomerAddress"],
  buyerOib: ["CustomerTaxId"],
  documentNumber: ["InvoiceId"],
  paymentMethod: ["PaymentTerm"],
} as const;

type TextField = keyof typeof TEXT_FIELD_ALIASES | "sellerName";

export function mapAnalyzeResult(analyzeResult: AnalyzeResultOutput): MappedAnalyzeResult {
  const document = analyzeResult.documents?.[0];
  const sourceFields = document?.fields ?? {};
  const fields: CanonicalReceiptFields = {};
  const fieldMetadata: Record<string, ExtractionFieldMetadata> = {};
  const unreadableFields: string[] = [];

  assignText(
    fields,
    fieldMetadata,
    "sellerName",
    first(sourceFields, ["VendorAddressRecipient", "VendorName", "MerchantName"]),
  );
  for (const canonical of Object.keys(TEXT_FIELD_ALIASES) as Array<
    keyof typeof TEXT_FIELD_ALIASES
  >) {
    assignText(
      fields,
      fieldMetadata,
      canonical,
      first(sourceFields, TEXT_FIELD_ALIASES[canonical]),
    );
  }
  assignAmount(
    fields,
    fieldMetadata,
    unreadableFields,
    "subtotal",
    first(sourceFields, ["SubTotal", "Subtotal"]),
  );
  assignAmount(
    fields,
    fieldMetadata,
    unreadableFields,
    "total",
    first(sourceFields, ["InvoiceTotal", "Total"]),
  );

  assignDate(
    fields,
    fieldMetadata,
    unreadableFields,
    "issueDate",
    first(sourceFields, ["InvoiceDate", "TransactionDate"]),
  );
  assignTime(
    fields,
    fieldMetadata,
    unreadableFields,
    "issueTime",
    first(sourceFields, ["TransactionTime"]),
  );

  const totalField = first(sourceFields, ["InvoiceTotal", "Total"]);
  const currency = totalField?.valueCurrency;
  if (currency?.currencySymbol && currency.currencyCode) {
    fields.currency = currency.currencyCode;
    fieldMetadata.currency = metadata(totalField);
  }

  const vatBreakdown = mapVatBreakdown(first(sourceFields, ["TaxDetails", "TotalTax"]));
  if (vatBreakdown !== null) {
    fields.vatBreakdown = vatBreakdown;
    fieldMetadata.vatBreakdown = metadata(first(sourceFields, ["TaxDetails", "TotalTax"]));
  }

  const items = mapItems(first(sourceFields, ["Items"]));
  if (items !== null) {
    fields.items = items;
    fieldMetadata.items = metadata(first(sourceFields, ["Items"]));
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
        rate: parseAmount(first(values, ["TaxRate", "Rate"])?.content),
        taxableBase: parseAmount(
          first(values, ["NetAmount", "TaxableAmount", "TaxableBase"])?.content,
        ),
        vatAmount: parseAmount(first(values, ["Amount", "TaxAmount"])?.content),
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
      description: first(values, ["Description"])?.content ?? null,
      quantity: parseAmount(first(values, ["Quantity"])?.content),
      unitPrice: parseAmount(first(values, ["UnitPrice", "Price"])?.content),
      total: parseAmount(first(values, ["Amount", "TotalPrice"])?.content),
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
