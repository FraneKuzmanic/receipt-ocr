import type {
  AnalyzeResultOutput,
  DocumentTableCellOutput,
  DocumentTableOutput,
} from "@azure-rest/ai-document-intelligence";
import type { VatBreakdown } from "@receipt/shared";
import { parseReceiptAmount } from "./receipt-amount.js";

const TABLE_KEYWORDS = [
  "porez",
  "stopa",
  "osnovica",
  "iznos",
  "pdv",
  "tax",
  "rate",
  "base",
  "net",
  "vat",
  "%",
] as const;

type VatColumn = "rate" | "taxableBase" | "vatAmount";

export interface MappedVatTableRow {
  readonly sourceRowIndex: number;
  readonly values: VatBreakdown;
  readonly cells: Partial<Record<VatColumn, DocumentTableCellOutput>>;
}

export function findVatTable(analyzeResult: AnalyzeResultOutput): DocumentTableOutput | null {
  for (const table of analyzeResult.tables ?? []) {
    const header = table.cells?.filter((cell) => cell.rowIndex === 0) ?? [];
    const matches = new Set(
      header.flatMap((cell) => {
        const content = cell.content?.toLocaleLowerCase() ?? "";
        return TABLE_KEYWORDS.filter((keyword) => content.includes(keyword));
      }),
    );
    if (matches.size >= 2) return table;
  }
  return null;
}

export function mapVatTable(table: DocumentTableOutput): VatBreakdown[] {
  return mapVatTableRows(table).map(({ values }) => values);
}

export function mapVatTableRows(table: DocumentTableOutput): MappedVatTableRow[] {
  const rows = tableRows(table);
  const header = rows.get(0) ?? new Map<number, DocumentTableCellOutput>();
  const columns = mapColumns(header);
  const labelColumn = firstUnclaimedColumn(header, new Set(Object.values(columns)));
  const mapped: MappedVatTableRow[] = [];

  for (const [sourceRowIndex, row] of rows) {
    if (sourceRowIndex === 0 || isSummaryRow(row, labelColumn)) continue;
    const cells: Partial<Record<VatColumn, DocumentTableCellOutput>> = {};
    for (const column of Object.keys(columns) as VatColumn[]) {
      const index = columns[column];
      if (index !== undefined) cells[column] = row.get(index);
    }
    const values = {
      rate: parseReceiptAmount(cells.rate?.content),
      taxableBase: parseReceiptAmount(cells.taxableBase?.content),
      vatAmount: parseReceiptAmount(cells.vatAmount?.content),
    };
    if (values.rate === null && values.taxableBase === null && values.vatAmount === null) continue;
    mapped.push({ sourceRowIndex, values, cells });
  }

  return mapped;
}

function tableRows(table: DocumentTableOutput): Map<number, Map<number, DocumentTableCellOutput>> {
  const rows = new Map<number, Map<number, DocumentTableCellOutput>>();
  for (const cell of table.cells ?? []) {
    if (cell.rowIndex === undefined || cell.columnIndex === undefined) continue;
    const row = rows.get(cell.rowIndex) ?? new Map<number, DocumentTableCellOutput>();
    row.set(cell.columnIndex, cell);
    rows.set(cell.rowIndex, row);
  }
  return rows;
}

function mapColumns(
  header: Map<number, DocumentTableCellOutput>,
): Partial<Record<VatColumn, number>> {
  const claimed = new Set<number>();
  return {
    rate: claimColumn(header, claimed, ["stopa", "rate", "%"]),
    taxableBase: claimColumn(header, claimed, ["osnovica", "base", "net"]),
    vatAmount: claimColumn(header, claimed, ["iznos", "amount", "vat", "tax"]),
  };
}

function claimColumn(
  header: Map<number, DocumentTableCellOutput>,
  claimed: Set<number>,
  terms: readonly string[],
): number | undefined {
  for (const [index, cell] of header) {
    const content = cell.content?.toLocaleLowerCase() ?? "";
    if (!claimed.has(index) && terms.some((term) => content.includes(term))) {
      claimed.add(index);
      return index;
    }
  }
  return undefined;
}

function firstUnclaimedColumn(
  header: Map<number, DocumentTableCellOutput>,
  claimed: Set<number | undefined>,
): number | undefined {
  return [...header.keys()].find((index) => !claimed.has(index));
}

function isSummaryRow(
  row: Map<number, DocumentTableCellOutput>,
  labelColumn: number | undefined,
): boolean {
  const cell = labelColumn === undefined ? row.values().next().value : row.get(labelColumn);
  return /^(?:ukupno|sveukupno|total)\b/iu.test(cell?.content?.trim() ?? "");
}
