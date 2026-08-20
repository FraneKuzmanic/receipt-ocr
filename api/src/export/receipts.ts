import {
  EXPORT_SCHEMA_VERSION,
  exportedReceiptSchema,
  jsonExportResponseSchema,
  type CanonicalReceipt,
  type ExportedReceipt,
  type JsonExportResponse,
} from "@receipt/shared";

const UTF8_BOM = "\uFEFF";
const CSV_LINE_BREAK = "\r\n";

export const CSV_COLUMNS = [
  "id",
  "status",
  "sellerName",
  "sellerAddress",
  "sellerOib",
  "buyerName",
  "buyerAddress",
  "buyerOib",
  "documentNumber",
  "issueDate",
  "issueTime",
  "subtotal",
  "total",
  "currency",
  "vatBreakdown",
  "paymentMethod",
  "jir",
  "zki",
  "confirmedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof CanonicalReceipt)[];

type CsvColumn = (typeof CSV_COLUMNS)[number];

const TEXT_COLUMNS = new Set<CsvColumn>([
  "sellerName",
  "sellerAddress",
  "sellerOib",
  "buyerName",
  "buyerAddress",
  "buyerOib",
  "documentNumber",
  "currency",
  "vatBreakdown",
  "paymentMethod",
  "jir",
  "zki",
]);

const FORMULA_STARTS = new Set(["=", "+", "-", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠"]);

export function toJsonExport(receipts: CanonicalReceipt[]): JsonExportResponse {
  return jsonExportResponseSchema.parse({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    receipts: receipts.map(toExportedReceipt),
  });
}

export function toCsv(receipts: CanonicalReceipt[]): string {
  const rows = [
    CSV_COLUMNS.join(","),
    ...receipts.map((receipt) =>
      CSV_COLUMNS.map((column) => {
        const raw = csvValue(receipt, column);
        const safe = TEXT_COLUMNS.has(column) ? neutralizeFormula(raw) : raw;
        return escapeCsvField(safe);
      }).join(","),
    ),
  ];

  return `${UTF8_BOM}${rows.join(CSV_LINE_BREAK)}`;
}

function toExportedReceipt(receipt: CanonicalReceipt): ExportedReceipt {
  const copy: Record<string, unknown> = { ...receipt };
  delete copy["userId"];
  delete copy["deletedAt"];
  return exportedReceiptSchema.parse(copy);
}

function csvValue(receipt: CanonicalReceipt, column: CsvColumn): string {
  if (column === "vatBreakdown") {
    return receipt.vatBreakdown === undefined || receipt.vatBreakdown === null
      ? ""
      : JSON.stringify(receipt.vatBreakdown);
  }

  const value = receipt[column];
  return typeof value === "string" ? value : "";
}

function neutralizeFormula(value: string): string {
  const first = value.at(0);
  return first !== undefined && FORMULA_STARTS.has(first) ? `'${value}` : value;
}

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
