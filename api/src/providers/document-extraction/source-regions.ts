import type {
  AnalyzeResultOutput,
  DocumentFieldOutput,
  DocumentTableCellOutput,
} from "@azure-rest/ai-document-intelligence";
import {
  sourceRegionsResponseSchema,
  type SourceRegion,
  type SourceRegionsResponse,
} from "@receipt/shared";
import { mapAnalyzeResult } from "./azure-fields.js";
import { stripContentMarkers } from "./content-markers.js";
import {
  findDocumentNumber,
  findIssueDate,
  findIssueTime,
  findJir,
  findOib,
  findZki,
} from "./croatian.js";
import { FIELD_ALIASES, ITEM_CELL_ALIASES, VAT_CELL_ALIASES } from "./field-aliases.js";
import { findVatTable, mapVatTableRows } from "./vat-tables.js";

type Fields = Record<string, DocumentFieldOutput>;

const SCALAR_FIELDS = [
  "sellerName",
  "sellerAddress",
  "sellerOib",
  "buyerName",
  "buyerAddress",
  "buyerOib",
  "documentNumber",
  "paymentMethod",
  "subtotal",
  "total",
  "currency",
  "issueDate",
  "issueTime",
] as const;

export function mapSourceRegions(analyzeResult: AnalyzeResultOutput): SourceRegionsResponse {
  const mapped = mapAnalyzeResult(analyzeResult);
  const dimensions = pageDimensions(analyzeResult);
  const pages = [...dimensions.values()].map(({ page, width, height }) => ({
    page,
    aspectRatio: width / height,
  }));
  const regions: SourceRegion[] = [];
  const sourceFields = analyzeResult.documents?.[0]?.fields ?? {};
  const populated = new Set([...Object.keys(mapped.fields), ...mapped.unreadableFields]);

  for (const field of SCALAR_FIELDS) {
    if (!populated.has(field)) continue;
    addFieldRegion(regions, first(sourceFields, FIELD_ALIASES[field]), field, dimensions);
  }

  addVatRegions(
    regions,
    analyzeResult,
    first(sourceFields, FIELD_ALIASES.vatBreakdown),
    mapped,
    dimensions,
  );
  addItemRegions(
    regions,
    first(sourceFields, FIELD_ALIASES.items),
    mapped.fields.items,
    dimensions,
  );

  const content = stripContentMarkers(analyzeResult.content);
  for (const [field, match] of Object.entries({
    sellerOib: findOib(content.text),
    jir: findJir(content.text),
    zki: findZki(content.text),
    issueDate: findIssueDate(content.text),
    issueTime: findIssueTime(content.text),
    documentNumber: findDocumentNumber(content.text),
  })) {
    if (match === null || mapped.fields[field as keyof typeof mapped.fields] !== undefined)
      continue;
    addTextRegion(
      regions,
      analyzeResult,
      field,
      content.toSourceOffset(match.start),
      content.toSourceOffset(match.end),
      dimensions,
    );
  }

  return sourceRegionsResponseSchema.parse({ pages, regions: deduplicate(regions) });
}

function first(fields: Fields, names: readonly string[]): DocumentFieldOutput | undefined {
  for (const name of names) {
    const field = fields[name];
    if (field !== undefined) return field;
  }
  return undefined;
}

function pageDimensions(analyzeResult: AnalyzeResultOutput) {
  return new Map(
    (analyzeResult.pages ?? [])
      .filter(
        (page) =>
          page.width !== undefined &&
          page.width > 0 &&
          page.height !== undefined &&
          page.height > 0,
      )
      .map((page) => [
        page.pageNumber,
        { page: page.pageNumber, width: page.width!, height: page.height! },
      ]),
  );
}

function addFieldRegion(
  regions: SourceRegion[],
  field: DocumentFieldOutput | DocumentTableCellOutput | undefined,
  path: string,
  dimensions: ReturnType<typeof pageDimensions>,
): void {
  const region = field?.boundingRegions?.[0];
  if (region === undefined) return;
  addCorners(regions, path, region.pageNumber, region.polygon, "model", dimensions);
}

function addVatRegions(
  regions: SourceRegion[],
  analyzeResult: AnalyzeResultOutput,
  field: DocumentFieldOutput | undefined,
  mapped: ReturnType<typeof mapAnalyzeResult>,
  dimensions: ReturnType<typeof pageDimensions>,
): void {
  const values = mapped.fields.vatBreakdown;
  if (values === undefined || values === null) return;
  if (mapped.vatSource === "table") {
    const table = findVatTable(analyzeResult);
    if (table === null) return;
    for (const [index, row] of mapVatTableRows(table).entries()) {
      for (const name of ["rate", "taxableBase", "vatAmount"] as const) {
        if (row.values[name] === null) continue;
        addFieldRegion(regions, row.cells[name], `vatBreakdown.${index}.${name}`, dimensions);
      }
    }
    return;
  }
  if (!field?.valueArray) {
    if (values[0]?.vatAmount !== null && values[0]?.vatAmount !== undefined) {
      addFieldRegion(regions, field, "vatBreakdown.0.vatAmount", dimensions);
    }
    return;
  }

  for (const [index, entry] of field.valueArray.entries()) {
    const value = values[index];
    const cells = entry.valueObject ?? {};
    for (const name of Object.keys(VAT_CELL_ALIASES) as Array<keyof typeof VAT_CELL_ALIASES>) {
      if (value?.[name] === null || value?.[name] === undefined) continue;
      addFieldRegion(
        regions,
        first(cells, VAT_CELL_ALIASES[name]),
        `vatBreakdown.${index}.${name}`,
        dimensions,
      );
    }
  }
}

function addItemRegions(
  regions: SourceRegion[],
  field: DocumentFieldOutput | undefined,
  values: ReturnType<typeof mapAnalyzeResult>["fields"]["items"],
  dimensions: ReturnType<typeof pageDimensions>,
): void {
  if (!field?.valueArray || values === undefined || values === null) return;
  for (const [index, entry] of field.valueArray.entries()) {
    const value = values[index];
    const cells = entry.valueObject ?? {};
    for (const name of Object.keys(ITEM_CELL_ALIASES) as Array<keyof typeof ITEM_CELL_ALIASES>) {
      if (value?.[name] === null || value?.[name] === undefined) continue;
      addFieldRegion(
        regions,
        first(cells, ITEM_CELL_ALIASES[name]),
        `items.${index}.${name}`,
        dimensions,
      );
    }
  }
}

function addTextRegion(
  regions: SourceRegion[],
  analyzeResult: AnalyzeResultOutput,
  path: string,
  start: number,
  end: number,
  dimensions: ReturnType<typeof pageDimensions>,
): void {
  for (const page of analyzeResult.pages ?? []) {
    const words = (page.words ?? []).filter((word) => {
      const span = word.span;
      return span.offset < end && span.offset + span.length > start;
    });
    if (words.length === 0) continue;
    const points = words.flatMap((word) => word.polygon ?? []);
    if (points.length < 8) continue;
    const corners = envelope(points);
    addCorners(regions, path, page.pageNumber, corners, "text", dimensions);
    return;
  }
}

function envelope(points: readonly number[]): number[] {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  return [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
    Math.min(...xs),
    Math.max(...ys),
  ];
}

function addCorners(
  regions: SourceRegion[],
  path: string,
  page: number,
  points: readonly number[] | undefined,
  origin: SourceRegion["origin"],
  dimensions: ReturnType<typeof pageDimensions>,
): void {
  const dimension = dimensions.get(page);
  if (dimension === undefined || points === undefined || points.length !== 8) return;
  regions.push({
    fields: [path],
    page,
    corners: [0, 2, 4, 6].map((index) => ({
      x: clamp(points[index]! / dimension.width),
      y: clamp(points[index + 1]! / dimension.height),
    })),
    origin,
  });
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function deduplicate(regions: SourceRegion[]): SourceRegion[] {
  const grouped = new Map<string, SourceRegion>();
  for (const region of regions) {
    const key = `${region.page}:${region.corners.flatMap(({ x, y }) => [x.toFixed(5), y.toFixed(5)]).join(",")}`;
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, region);
    else existing.fields.push(...region.fields.filter((field) => !existing.fields.includes(field)));
  }
  return [...grouped.values()];
}

export function storedAnalyzeResult(raw: unknown): AnalyzeResultOutput | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const result = (raw as Record<string, unknown>)["analyzeResult"];
  return result !== null && typeof result === "object" && !Array.isArray(result)
    ? (result as AnalyzeResultOutput)
    : null;
}
