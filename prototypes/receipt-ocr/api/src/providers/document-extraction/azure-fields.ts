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
import { stripContentMarkers } from "./content-markers.js";
import { EURO_ADOPTION_DATE, findPayableEuroTotal, resolveCurrency } from "./currency.js";
import { normalizeOib } from "./croatian.js";
import { categorizePaymentMethod } from "./payment-method.js";
import { parseReceiptAmount, parseReceiptQuantity, parseVatRate } from "./receipt-amount.js";
import { findVatTable, mapVatTable, mapVatText } from "./vat-tables.js";
import type { ExtractionFieldMetadata } from "./types.js";

type Fields = Record<string, DocumentFieldOutput>;

const TOTALS_DESCRIPTION =
  /^\s*(?:osnovica|ukupno|sveukupno|za\s+platiti|popust|porez|pdv|total|subtotal|vat)\b/iu;
// Consumption tax (porez na potrošnju) is printed in the same recap as VAT and is not VAT.
const CONSUMPTION_TAX = /^\s*(?:pnp|porez\s+na\s+potro[sš]nju)\b/iu;

export interface MappedAnalyzeResult {
  readonly fields: CanonicalReceiptFields;
  readonly fieldMetadata: Record<string, ExtractionFieldMetadata>;
  readonly unreadableFields: string[];
  readonly documentConfidence: number | null;
  readonly vatSource: "model" | "table" | "total" | null;
}

type TextField =
  "sellerName" | "sellerAddress" | "sellerOib" | "buyerName" | "buyerAddress" | "documentNumber";

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
    "documentNumber",
  ] as const) {
    assignText(fields, fieldMetadata, canonical, first(sourceFields, FIELD_ALIASES[canonical]));
  }
  // The buyer's OIB is shown as read even when its check digit fails (the warning says so); an
  // "HR" prefix is dropped only when what remains is a valid OIB.
  const buyerTaxId = first(sourceFields, FIELD_ALIASES.buyerOib);
  if (buyerTaxId?.content) {
    fields.buyerOib = normalizeOib(buyerTaxId.content) ?? singleLine(buyerTaxId.content);
    fieldMetadata.buyerOib = metadata(buyerTaxId);
  }
  // Stored as printed, but only when the wording names a payment method. Anything else is left
  // for the labelled text fallback: on `lira_trogir` the provider returns the amount in words here.
  const paymentTerm = first(sourceFields, FIELD_ALIASES.paymentMethod);
  if (paymentTerm?.content && categorizePaymentMethod(paymentTerm.content) !== null) {
    fields.paymentMethod = singleLine(paymentTerm.content);
    fieldMetadata.paymentMethod = metadata(paymentTerm);
  }
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
    // A checksum-valid OIB the model read marks the receipt Croatian even when the printed "OIB"
    // label did not survive OCR: `lira_trogir` is cropped to "IB".
    croatianTaxId:
      normalizeOib(first(sourceFields, FIELD_ALIASES.sellerOib)?.content) !== null ||
      normalizeOib(buyerTaxId?.content) !== null,
  });
  if (currency !== null) {
    fields.currency = currency.code;
    // Only a currency the model itself reported carries the model's confidence. One read from the
    // receipt's text or inferred from its date has no confidence of its own, and borrowing the
    // total's (or inventing a low one) flagged correct values as doubtful.
    fieldMetadata.currency = {
      confidence: currency.source === "model" ? (totalField?.confidence ?? null) : null,
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
  const content = singleLine(field.content);
  // OCR opens a gap around the separators of a document number: "49781/001/ 1".
  fields[canonical] =
    canonical === "documentNumber" ? content.replaceAll(/\s*([-/])\s*/gu, "$1") : content;
  metadataByField[canonical] = metadata(field);
}

/**
 * OCR returns a value wrapped across the lines it was printed on. A canonical text value is one
 * line: a single-line input silently deletes the breaks, gluing "Trogir\nObrt" into "TrogirObrt".
 */
function singleLine(text: string): string {
  return text.replaceAll(/\s*\n\s*/gu, " ");
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

  const payable = findPayableEuroTotal(stripContentMarkers(content).text);
  if (payable === null) return;

  fields.total = payable.value;
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
  canonical: "total",
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
  // The printed text wins over the provider's normalized `valueTime`, which pads a receipt that
  // shows "12:17" to "12:17:00". Padding a second the receipt never printed invents data.
  const value = parseIssueTime(field?.content) ?? parseIssueTime(field?.valueTime);
  if (value === null) {
    recordUnreadable(unreadableFields, canonical, field);
    return;
  }
  fields[canonical] = value;
  metadataByField[canonical] = metadata(field);
}

function mapVatBreakdown(field: DocumentFieldOutput | undefined): VatBreakdown[] | null {
  if (field?.valueArray) {
    const rows = vatEntries(field).map(readVatEntry);
    return rows.length > 0 ? rows : null;
  }
  const vatAmount = parseAmount(field?.content);
  return vatAmount === null ? null : [{ rate: null, taxableBase: null, vatAmount }];
}

/**
 * The tax-recap entries that are VAT rows, in order. Two kinds are dropped: a consumption-tax row
 * (`receipt123` prints "PNP 3,00 2,81 0,08" under its VAT row), and an entry none of whose cells
 * could be read (`racuntaksi1`, not in the VAT system, returns its kuna total as a tax row).
 *
 * Source highlighting indexes rows through this same list, so an outline cannot land on a row the
 * mapper dropped.
 */
export function vatEntries(field: DocumentFieldOutput | undefined): DocumentFieldOutput[] {
  return (field?.valueArray ?? []).filter((entry) => {
    if (CONSUMPTION_TAX.test(entry.valueObject?.["Description"]?.content ?? "")) return false;
    const row = readVatEntry(entry);
    return row.rate !== null || row.taxableBase !== null || row.vatAmount !== null;
  });
}

function readVatEntry(entry: DocumentFieldOutput) {
  const values = entry.valueObject ?? {};
  return {
    rate: parseVatRate(first(values, VAT_CELL_ALIASES.rate)?.content),
    taxableBase: parseReceiptAmount(first(values, VAT_CELL_ALIASES.taxableBase)?.content),
    vatAmount: parseReceiptAmount(first(values, VAT_CELL_ALIASES.vatAmount)?.content),
  };
}

function mapItems(field: DocumentFieldOutput | undefined): ReceiptItem[] | null {
  if (!field?.valueArray) return null;
  const items = field.valueArray
    .map((entry) => {
      const values = entry.valueObject ?? {};
      const description = first(values, ITEM_CELL_ALIASES.description)?.content;
      return {
        description: description === undefined ? null : singleLine(description),
        quantity: parseReceiptQuantity(first(values, ITEM_CELL_ALIASES.quantity)?.content),
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
