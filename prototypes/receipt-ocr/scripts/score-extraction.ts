import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import type { CanonicalReceiptFields, ReceiptWarning } from "@receipt/shared";
import { mapAnalyzeResult } from "../api/src/providers/document-extraction/azure-fields.js";
import { mergeExtractions } from "../api/src/providers/document-extraction/merge.js";
import {
  applyQrJir,
  applyTextFallbacks,
  extractFiscalQr,
} from "../api/src/providers/document-extraction/azure.js";
import { categorizePaymentMethod } from "../api/src/providers/document-extraction/payment-method.js";
import { stripContentMarkers } from "../api/src/providers/document-extraction/content-markers.js";
import { hasUnreadVatSignal } from "../api/src/providers/document-extraction/tax-signals.js";
import { lowConfidenceFields } from "../api/src/routes/receipts.js";
import { computeWarnings, qrCorroboratedFields } from "../api/src/validation/warnings.js";
import { matches } from "./bakeoff/compare.js";

const FIXTURES_DIR = "api/src/providers/document-extraction/fixtures";
const SECONDARY_FIXTURES_DIR = "api/src/providers/document-extraction/fixtures/secondary";
const EXPECTED_DIR = ".agents/fixtures/expected";
const EXPECTED_WARNINGS = ".agents/fixtures/expected-warnings.json";
const CRITICAL_FIELDS = ["sellerName", "documentNumber", "issueDate", "total", "currency"] as const;
type CriticalField = (typeof CRITICAL_FIELDS)[number];
// Free text a reviewer would accept in any casing, spacing or punctuation. Everything else is
// compared exactly.
const LENIENT_FIELDS = new Set(["sellerAddress", "buyerName", "buyerAddress"]);
// Thermal receipts photographed small are where OCR is weakest, so they are also reported alone.
const SMALL_IMAGE_WIDTH = 500;

interface RecordedOperation {
  readonly analyzeResult?: AnalyzeResultOutput;
  readonly createdDateTime?: string;
  readonly lastUpdatedDateTime?: string;
}

interface ScoreRow {
  readonly name: string;
  readonly expected: CanonicalReceiptFields;
  readonly fields: CanonicalReceiptFields;
  readonly warnings: readonly ReceiptWarning[];
  /** Fields the review form would paint amber as a low-confidence reading. */
  readonly flagged: readonly string[];
  readonly smallImage: boolean;
}

const expectedWarnings = await loadExpectedWarnings();
const scoredRows = await loadRows();
const smallRows = scoredRows.filter((row) => row.smallImage);

console.log(
  JSON.stringify(
    {
      fixturesScored: scoredRows.length,
      all: report(scoredRows),
      smallImages: { receipts: smallRows.map((row) => row.name), ...report(smallRows) },
      recordedProviderLatencyMs: await scoreLatency(),
    },
    null,
    2,
  ),
);

function report(rows: readonly ScoreRow[]) {
  const critical = scoreCritical(rows);
  return {
    critical,
    supplementalMatches: scoreSupplemental(rows),
    mostCorrectedFields: mostCorrectedFields(critical.mismatches),
    warnings: scoreWarnings(rows),
    lowConfidenceFlags: scoreFlags(rows),
  };
}

async function loadRows(): Promise<ScoreRow[]> {
  const names = (await readdir(EXPECTED_DIR)).filter((name) => name.endsWith(".json")).toSorted();
  const fixtureNames = new Set(await readdir(FIXTURES_DIR));
  const scored: ScoreRow[] = [];

  for (const name of names) {
    if (!fixtureNames.has(name)) continue;
    const expected = JSON.parse(
      await readFile(join(EXPECTED_DIR, name), "utf8"),
    ) as CanonicalReceiptFields;
    const fixture = JSON.parse(
      await readFile(join(FIXTURES_DIR, name), "utf8"),
    ) as RecordedOperation;
    if (fixture.analyzeResult === undefined) continue;

    // Replay both models through the production merge, so the score measures what the API
    // actually produces rather than the primary model in isolation.
    const primary = readModel(fixture.analyzeResult);
    const secondaryFixture = await loadSecondary(name);
    const merged = mergeExtractions(
      primary,
      secondaryFixture === null ? null : readModel(secondaryFixture),
    );
    const fields = merged.fields;
    const qr =
      extractFiscalQr(fixture.analyzeResult) ??
      (secondaryFixture === null ? null : extractFiscalQr(secondaryFixture));
    applyQrJir(fields, merged.metadata, qr);
    // Replay the production warning pipeline too, rather than scoring a mapper-shaped copy.
    const warnings = computeWarnings({
      fields,
      qr,
      unreadable: merged.unreadableFields,
      vatTextPresent: hasUnreadVatSignal(fixture.analyzeResult.content),
    });
    const page = fixture.analyzeResult.pages?.[0];
    scored.push({
      name: basename(name, ".json"),
      expected,
      fields,
      warnings,
      flagged: lowConfidenceFields({ fields: merged.metadata }, qrCorroboratedFields(fields, qr)),
      smallImage:
        page?.unit === "pixel" && page.width !== undefined && page.width < SMALL_IMAGE_WIDTH,
    });
  }
  return scored;
}

function scoreCritical(scored: readonly ScoreRow[]) {
  const fields = Object.fromEntries(
    CRITICAL_FIELDS.map((field) => [field, { matched: 0, total: 0, rate: null as number | null }]),
  ) as Record<CriticalField, { matched: number; total: number; rate: number | null }>;
  const mismatches: Partial<Record<CriticalField, number>> = {};
  let noCorrection = 0;

  for (const row of scored) {
    let hasExpectedCritical = false;
    let allMatched = true;
    for (const field of CRITICAL_FIELDS) {
      const expected = row.expected[field];
      if (expected === undefined) continue;
      hasExpectedCritical = true;
      fields[field].total += 1;
      if (equal(field, row.fields[field], expected)) fields[field].matched += 1;
      else {
        allMatched = false;
        mismatches[field] = (mismatches[field] ?? 0) + 1;
      }
    }
    if (hasExpectedCritical && allMatched) noCorrection += 1;
  }

  for (const field of CRITICAL_FIELDS) {
    fields[field].rate =
      fields[field].total === 0 ? null : fields[field].matched / fields[field].total;
  }
  const receiptsWithCriticalGroundTruth = scored.filter((row) =>
    CRITICAL_FIELDS.some((field) => row.expected[field] !== undefined),
  ).length;
  return {
    fields,
    receiptsWithCriticalGroundTruth,
    noCriticalCorrectionRequired: noCorrection,
    noCriticalCorrectionRate:
      receiptsWithCriticalGroundTruth === 0 ? null : noCorrection / receiptsWithCriticalGroundTruth,
    mismatches,
  };
}

function mostCorrectedFields(mismatches: Partial<Record<CriticalField, number>>) {
  return Object.entries(mismatches)
    .map(([field, count]) => ({ field, count }))
    .toSorted((left, right) => right.count - left.count || left.field.localeCompare(right.field));
}

function scoreSupplemental(scored: readonly ScoreRow[]) {
  const fields = new Map<string, { matched: number; total: number }>();
  for (const row of scored) {
    for (const [field, expected] of Object.entries(row.expected)) {
      if (CRITICAL_FIELDS.includes(field as CriticalField)) continue;
      const result = fields.get(field) ?? { matched: 0, total: 0 };
      result.total += 1;
      if (equal(field, row.fields[field as keyof CanonicalReceiptFields], expected)) {
        result.matched += 1;
      }
      fields.set(field, result);
    }
  }
  return Object.fromEntries(
    [...fields.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([field, result]) => [
        field,
        { ...result, rate: result.total === 0 ? null : result.matched / result.total },
      ]),
  );
}

/**
 * A warning is only useful if it means something is wrong, so the codes each receipt produces are
 * compared with the ones it should produce. A receipt with no entry in the expectations file is
 * expected to produce none.
 */
function scoreWarnings(scored: readonly ScoreRow[]) {
  const perReceipt: Record<string, { unexpected: string[]; missing: string[] }> = {};
  let unexpectedTotal = 0;
  let missingTotal = 0;

  for (const row of scored) {
    const produced = row.warnings.map((warning) => `${warning.code}:${warning.field ?? ""}`);
    const expected = expectedWarnings[row.name] ?? [];
    const unexpected = produced.filter((warning) => !expected.includes(warning));
    const missing = expected.filter((warning) => !produced.includes(warning));
    unexpectedTotal += unexpected.length;
    missingTotal += missing.length;
    if (unexpected.length > 0 || missing.length > 0) perReceipt[row.name] = { unexpected, missing };
  }
  return { unexpected: unexpectedTotal, missing: missingTotal, perReceipt };
}

/**
 * How often the amber "may need extra checking" flag lands on a value that was in fact right. Only
 * flags on fields with ground truth can be judged; the rest are counted apart.
 */
function scoreFlags(scored: readonly ScoreRow[]) {
  let flagsTotal = 0;
  let flagsOnCorrectValues = 0;
  let flagsWithoutGroundTruth = 0;
  const onCorrectValues: string[] = [];

  for (const row of scored) {
    for (const field of row.flagged) {
      const expected = (row.expected as Record<string, unknown>)[field];
      if (expected === undefined) {
        flagsWithoutGroundTruth += 1;
        continue;
      }
      flagsTotal += 1;
      if (equal(field, (row.fields as Record<string, unknown>)[field], expected)) {
        flagsOnCorrectValues += 1;
        onCorrectValues.push(`${row.name}:${field}`);
      }
    }
  }
  return { flagsOnCorrectValues, flagsTotal, flagsWithoutGroundTruth, onCorrectValues };
}

function readModel(analyzeResult: AnalyzeResultOutput) {
  const mapped = mapAnalyzeResult(analyzeResult);
  const fields = { ...mapped.fields };
  const metadata = { ...mapped.fieldMetadata };
  applyTextFallbacks(fields, metadata, stripContentMarkers(analyzeResult.content));
  return { fields, metadata, unreadableFields: mapped.unreadableFields };
}

async function loadSecondary(name: string): Promise<AnalyzeResultOutput | null> {
  try {
    const fixture = JSON.parse(
      await readFile(join(SECONDARY_FIXTURES_DIR, name), "utf8"),
    ) as RecordedOperation;
    return fixture.analyzeResult ?? null;
  } catch {
    return null;
  }
}

async function loadExpectedWarnings(): Promise<Record<string, string[]>> {
  const file = JSON.parse(await readFile(EXPECTED_WARNINGS, "utf8")) as {
    receipts?: Record<string, string[]>;
  };
  return file.receipts ?? {};
}

async function scoreLatency() {
  const samples: number[] = [];
  for (const name of await readdir(FIXTURES_DIR)) {
    if (!name.endsWith(".json")) continue;
    const fixture = JSON.parse(
      await readFile(join(FIXTURES_DIR, name), "utf8"),
    ) as RecordedOperation;
    if (fixture.createdDateTime === undefined || fixture.lastUpdatedDateTime === undefined)
      continue;
    const milliseconds =
      Date.parse(fixture.lastUpdatedDateTime) - Date.parse(fixture.createdDateTime);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) samples.push(milliseconds);
  }
  samples.sort((left, right) => left - right);
  return {
    samples: samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
  };
}

function percentile(samples: readonly number[], ratio: number): number | null {
  if (samples.length === 0) return null;
  return samples[Math.ceil(samples.length * ratio) - 1] ?? null;
}

function equal(field: string, left: unknown, right: unknown): boolean {
  // An absent optional field and an explicit null both mean "the receipt did not show this", so
  // ground truth recording `"vatBreakdown": null` must not read as a miss against a mapper that
  // simply left the key off.
  if (left == null && right == null) return true;
  if (LENIENT_FIELDS.has(field)) return matches(field, right, left);
  // Ground truth records which method was used; the receipt stores the wording it printed.
  if (field === "paymentMethod" && typeof left === "string") {
    return categorizePaymentMethod(left) === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
