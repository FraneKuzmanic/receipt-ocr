import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import type { CanonicalReceiptFields } from "@receipt/shared";
import { mapAnalyzeResult } from "../api/src/providers/document-extraction/azure-fields.js";
import { applyTextFallbacks } from "../api/src/providers/document-extraction/azure.js";
import { stripContentMarkers } from "../api/src/providers/document-extraction/content-markers.js";
import { hasUnreadVatSignal } from "../api/src/providers/document-extraction/tax-signals.js";
import { computeWarnings } from "../api/src/validation/warnings.js";

const FIXTURES_DIR = "api/src/providers/document-extraction/fixtures";
const EXPECTED_DIR = ".agents/fixtures/expected";
const CRITICAL_FIELDS = ["sellerName", "documentNumber", "issueDate", "total", "currency"] as const;
type CriticalField = (typeof CRITICAL_FIELDS)[number];

interface RecordedOperation {
  readonly analyzeResult?: AnalyzeResultOutput;
  readonly createdDateTime?: string;
  readonly lastUpdatedDateTime?: string;
}

interface ScoreRow {
  readonly name: string;
  readonly expected: CanonicalReceiptFields;
  readonly fields: CanonicalReceiptFields;
}

const scoredRows = await loadRows();
const critical = scoreCritical(scoredRows);
const latency = await scoreLatency();

console.log(
  JSON.stringify(
    {
      fixturesScored: scoredRows.length,
      critical,
      supplementalExactMatches: scoreSupplemental(scoredRows),
      mostCorrectedFields: mostCorrectedFields(critical.mismatches),
      recordedProviderLatencyMs: latency,
    },
    null,
    2,
  ),
);

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

    const mapped = mapAnalyzeResult(fixture.analyzeResult);
    const fields = { ...mapped.fields };
    applyTextFallbacks(
      fields,
      mapped.fieldMetadata,
      stripContentMarkers(fixture.analyzeResult.content),
    );
    // Replay the production warning pipeline too, rather than scoring a mapper-shaped copy.
    computeWarnings({
      fields,
      qr: null,
      unreadable: mapped.unreadableFields,
      vatTextPresent: hasUnreadVatSignal(fixture.analyzeResult.content),
    });
    scored.push({ name: basename(name, ".json"), expected, fields });
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
      if (equal(row.fields[field], expected)) fields[field].matched += 1;
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
      if (equal(row.fields[field as keyof CanonicalReceiptFields], expected)) result.matched += 1;
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

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
