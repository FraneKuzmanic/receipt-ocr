import type {
  AnalyzeResultOutput,
  DocumentTableCellOutput,
  DocumentTableOutput,
} from "@azure-rest/ai-document-intelligence";
import type { VatBreakdown } from "@receipt/shared";
import { parseReceiptAmount, parseVatRate } from "./receipt-amount.js";

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

const COLUMN_TERMS = {
  rate: ["stopa", "rate", "%"],
  taxableBase: ["osnovica", "base", "net"],
  // "pdv" earns its place here from a real receipt whose amount column is headed just "PDV".
  // A bare "porez" is deliberately absent: it heads the tax-*type* label column ("Vrsta poreza").
  vatAmount: ["iznos", "amount", "vat", "pdv"],
} as const satisfies Record<VatColumn, readonly string[]>;

const SUMMARY_ROW = /\b(?:ukupno|sveukupno|total)\b/iu;

type VatColumn = "rate" | "taxableBase" | "vatAmount";
type Row = Map<number, DocumentTableCellOutput>;

export interface MappedVatTableRow {
  readonly sourceRowIndex: number;
  readonly values: VatBreakdown;
  readonly cells: Partial<Record<VatColumn, DocumentTableCellOutput>>;
}

/**
 * Picks the recap table, which must name at least two of the three VAT roles. Counting loose
 * keywords instead selected a line-items table headed "… | PDV | JM | Količina | Cijena | Iznos",
 * whose per-line VAT rate then became a recap amount — a VAT row invented for a receipt that
 * charges none.
 */
export function findVatTable(analyzeResult: AnalyzeResultOutput): DocumentTableOutput | null {
  for (const table of analyzeResult.tables ?? []) {
    const header = table.cells?.filter((cell) => cell.rowIndex === 0) ?? [];
    const roles = (Object.keys(COLUMN_TERMS) as VatColumn[]).filter((role) =>
      header.some((cell) =>
        COLUMN_TERMS[role].some((term) => mentions(normalize(cell.content), term)),
      ),
    );
    if (roles.length >= 2) return table;
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
  const boundaries = [...header.keys()].toSorted((left, right) => left - right);
  const mapped: MappedVatTableRow[] = [];

  for (const [sourceRowIndex, row] of rows) {
    if (sourceRowIndex === 0 || isSummaryRow(row)) continue;

    const cells: Partial<Record<VatColumn, DocumentTableCellOutput>> = {};
    for (const column of Object.keys(columns) as VatColumn[]) {
      const index = columns[column];
      if (index !== undefined) {
        const cell = cellFor(row, index, boundaries, claimedIndexes(columns, column));
        if (cell !== undefined) cells[column] = cell;
      }
    }

    const values = {
      rate: parseVatRate(cells.rate?.content),
      taxableBase: parseReceiptAmount(cells.taxableBase?.content),
      vatAmount: parseReceiptAmount(cells.vatAmount?.content),
    };
    if (values.rate === null && values.taxableBase === null && values.vatAmount === null) continue;
    mapped.push({ sourceRowIndex, values, cells });
  }

  return mapped;
}

/**
 * Reads a VAT recap that never became a table. When a recap's rows wrap across two printed lines
 * Azure emits no table for it at all, and the labels and their values arrive as a flat run of
 * lines. Deliberately conservative: it needs at least two named roles and a matching run of
 * amounts directly beneath them, and it only runs when no table and no model VAT were found.
 */
export function mapVatText(content: string): VatBreakdown[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  for (let index = 0; index < lines.length; index += 1) {
    const order: VatColumn[] = [];
    const seen = new Set<VatColumn>();
    let cursor = index;

    while (cursor < lines.length) {
      const role = headerRole(lines[cursor]!);
      if (role === null) break;
      if (role !== "label") {
        if (seen.has(role)) break;
        seen.add(role);
        order.push(role);
      }
      cursor += 1;
    }

    if (order.length < 2) continue;
    const values = readAmounts(lines, cursor, order);
    if (values !== null) return [values];
  }

  return [];
}

function headerRole(line: string): VatColumn | "label" | null {
  if (line.length > 24 || /\d/.test(line)) return null;
  const content = normalize(line);
  if (!TABLE_KEYWORDS.some((keyword) => keyword !== "%" && mentions(content, keyword))) return null;
  for (const role of Object.keys(COLUMN_TERMS) as VatColumn[]) {
    if (COLUMN_TERMS[role].some((term) => mentions(content, term))) return role;
  }
  return "label";
}

function readAmounts(
  lines: readonly string[],
  from: number,
  order: readonly VatColumn[],
): VatBreakdown | null {
  let cursor = from;
  // The tax type ("PDV", "D1") sits between the labels and their amounts on some layouts.
  while (cursor < lines.length && parseReceiptAmount(lines[cursor]) === null) {
    if (cursor - from >= 2) return null;
    cursor += 1;
  }

  const values: VatBreakdown = { rate: null, taxableBase: null, vatAmount: null };
  for (const role of order) {
    const line = lines[cursor];
    const value = role === "rate" ? parseVatRate(line) : parseReceiptAmount(line);
    if (value === null) return null;
    values[role] = value;
    cursor += 1;
  }
  return values;
}

function tableRows(table: DocumentTableOutput): Map<number, Row> {
  const rows = new Map<number, Row>();
  for (const cell of table.cells ?? []) {
    if (cell.rowIndex === undefined || cell.columnIndex === undefined) continue;
    const row = rows.get(cell.rowIndex) ?? new Map<number, DocumentTableCellOutput>();
    row.set(cell.columnIndex, cell);
    rows.set(cell.rowIndex, row);
  }
  return rows;
}

/**
 * Assigns each VAT role a starting column. One header cell may carry two labels — OCR merges
 * "Stopa%" and "Osnovica" into a single cell on real receipts — so a cell naming several roles
 * hands the later ones to the columns that follow it, which is where their values actually sit.
 */
function mapColumns(header: Row): Partial<Record<VatColumn, number>> {
  const columns: Partial<Record<VatColumn, number>> = {};
  const claimed = new Set<number>();

  for (const [index, cell] of [...header].toSorted(([left], [right]) => left - right)) {
    const content = normalize(cell.content);
    let offset = 0;
    for (const role of Object.keys(COLUMN_TERMS) as VatColumn[]) {
      if (columns[role] !== undefined) continue;
      if (!COLUMN_TERMS[role].some((term) => mentions(content, term))) continue;
      const target = index + offset;
      if (offset > 0 && (header.has(target) || claimed.has(target))) break;
      columns[role] = target;
      claimed.add(target);
      offset += 1;
    }
  }

  return columns;
}

/**
 * Finds the cell holding a role's value. A header label and its column of numbers routinely
 * drift apart by a column in OCR output, so the value is accepted anywhere between this role's
 * own header position and the next header — the span the label visually covers — while never
 * crossing into a column another role already claimed.
 */
function cellFor(
  row: Row,
  index: number,
  boundaries: readonly number[],
  claimed: ReadonlySet<number>,
): DocumentTableCellOutput | undefined {
  const own = row.get(index);
  if (parseReceiptAmount(own?.content) !== null) return own;

  const next = boundaries.find((boundary) => boundary > index);
  const limit = next ?? Math.max(...row.keys(), index) + 1;
  for (let candidate = index + 1; candidate < limit; candidate += 1) {
    if (claimed.has(candidate)) continue;
    const cell = row.get(candidate);
    if (parseReceiptAmount(cell?.content) !== null) return cell;
  }
  return own;
}

function claimedIndexes(
  columns: Partial<Record<VatColumn, number>>,
  except: VatColumn,
): ReadonlySet<number> {
  const claimed = new Set<number>();
  for (const [role, index] of Object.entries(columns)) {
    if (role !== except && index !== undefined) claimed.add(index);
  }
  return claimed;
}

/** A recap's own total line is not a VAT rate, wherever in the row its label happens to land. */
function isSummaryRow(row: Row): boolean {
  return [...row.values()].some((cell) => SUMMARY_ROW.test(cell.content?.trim() ?? ""));
}

function normalize(content: string | undefined): string {
  return (content ?? "").toLocaleLowerCase();
}

/** Tolerates one mis-decoded character, so an OCR "osnavica" still names the taxable base. */
function mentions(content: string, term: string): boolean {
  if (content.includes(term)) return true;
  if (term.length < 5) return false;
  for (let index = 0; index + term.length <= content.length; index += 1) {
    if (differsByOneCharacter(content.slice(index, index + term.length), term)) return true;
  }
  return false;
}

function differsByOneCharacter(candidate: string, term: string): boolean {
  let differences = 0;
  for (let index = 0; index < term.length; index += 1) {
    if (candidate[index] !== term[index] && (differences += 1) > 1) return false;
  }
  return differences === 1;
}
