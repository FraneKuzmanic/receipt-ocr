/**
 * Scores every recorded input-mode run, and the production engine as the reference line,
 * against one ground truth with one comparator.
 *
 * Ground truth is `.agents/fixtures/expected/<sample>.json` plus the additive keys in
 * `ground-truth/<sample>.json`. A run that exists but lacks a receipt fails the script: a
 * harness that skips what it cannot measure reports the health of the corpus it kept.
 *
 * `--verbose` lists every mismatch with each arm's value, and the paths that differ between runs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import { mapAnalyzeResult } from "../../api/src/providers/document-extraction/azure-fields.js";
import { applyTextFallbacks } from "../../api/src/providers/document-extraction/azure.js";
import { stripContentMarkers } from "../../api/src/providers/document-extraction/content-markers.js";
import { mergeExtractions } from "../../api/src/providers/document-extraction/merge.js";
import { scoreReceipt, type CellResult, type Group, type ReceiptScore } from "./compare.ts";
import { ARMS, armsFor, shrunkByService, type Arm, type InputModeRecord } from "./model-input.ts";
import { normalize } from "./normalize.ts";
import {
  CACHE_DIR,
  EXCLUDED,
  EXPECTED_DIR,
  FIXTURES_DIR,
  GROUND_TRUTH_DIR,
  SAMPLES,
  SECONDARY_FIXTURES_DIR,
  readCache,
  writeCache,
  type Sample,
} from "./samples.ts";

const verbose = process.argv.includes("--verbose");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

// ---------- ground truth ----------

let unverified = 0;

function groundTruth(s: Sample): Record<string, unknown> {
  const expected = readJson<Record<string, unknown>>(join(EXPECTED_DIR, `${s.name}.json`));
  const path = join(GROUND_TRUTH_DIR, `${s.name}.json`);
  if (!existsSync(path)) throw new Error(`no extended ground truth for '${s.name}': ${path}`);
  const { verifiedBy, notes: _notes, ...additions } = readJson<Record<string, unknown>>(path);
  if (!verifiedBy) unverified++;
  for (const key of Object.keys(additions)) {
    if (key in expected && JSON.stringify(expected[key]) !== JSON.stringify(additions[key])) {
      throw new Error(`'${s.name}': '${key}' is in both ground-truth files with different values`);
    }
  }
  return { ...expected, ...additions };
}

// ---------- the production engine, replayed as scripts/score-extraction.ts replays it ----------

function readModel(analyzeResult: AnalyzeResultOutput) {
  const mapped = mapAnalyzeResult(analyzeResult);
  const fields = { ...mapped.fields };
  const metadata = { ...mapped.fieldMetadata };
  applyTextFallbacks(fields, metadata, stripContentMarkers(analyzeResult.content));
  return { fields, metadata, unreadableFields: mapped.unreadableFields };
}

function productionFields(s: Sample): Record<string, unknown> {
  const primary = readJson<{ analyzeResult?: AnalyzeResultOutput }>(
    join(FIXTURES_DIR, `${s.name}.json`),
  ).analyzeResult;
  if (!primary) throw new Error(`'${s.name}': recorded fixture has no analyzeResult`);
  const secondaryPath = join(SECONDARY_FIXTURES_DIR, `${s.name}.json`);
  const secondary = existsSync(secondaryPath)
    ? readJson<{ analyzeResult?: AnalyzeResultOutput }>(secondaryPath).analyzeResult
    : undefined;
  return mergeExtractions(readModel(primary), secondary ? readModel(secondary) : null).fields;
}

// ---------- one scored run ----------

interface ScoredReceipt {
  sample: Sample;
  score: ReceiptScore;
  fields: Record<string, unknown>;
  raw: Record<string, unknown> | null;
  unreadable: number;
  inferred: number;
}

interface Run {
  arm: Arm | "di";
  rep: number;
  receipts: ScoredReceipt[];
}

const truth = new Map(SAMPLES.map((s) => [s.name, groundTruth(s)]));

const runs: Run[] = [
  {
    arm: "di",
    rep: 1,
    receipts: SAMPLES.map((sample) => {
      const fields = productionFields(sample);
      return {
        sample,
        fields,
        raw: null,
        score: scoreReceipt(truth.get(sample.name)!, fields),
        unreadable: 0,
        inferred: 0,
      };
    }),
  },
];

const missing: string[] = [];
for (const arm of ARMS) {
  for (let rep = 1; existsSync(join(CACHE_DIR, "input-modes", `${arm}-r${rep}`)); rep++) {
    const receipts: ScoredReceipt[] = [];
    for (const sample of SAMPLES.filter((s) => armsFor(s).includes(arm))) {
      const record = readCache<InputModeRecord>(`input-modes/${arm}-r${rep}`, sample.name);
      if (!record) {
        missing.push(`${arm}-r${rep}/${sample.name}`);
        continue;
      }
      const { fields, unreadable, inferred } = normalize(record.fields);
      receipts.push({
        sample,
        fields,
        raw: record.fields,
        score: scoreReceipt(truth.get(sample.name)!, fields),
        unreadable: unreadable.length,
        inferred: inferred.length,
      });
    }
    runs.push({ arm, rep, receipts });
  }
}
if (missing.length) {
  console.error(
    `\n  Recorded runs are incomplete, so nothing is scored:\n    ${missing.join("\n    ")}\n`,
  );
  process.exit(1);
}

// ---------- aggregation ----------

const shrunk = await shrunkByService();
const SOURCE_GROUPS: [string, (s: Sample) => boolean][] = [
  ["all 14 receipts", () => true],
  ["2 PDFs", (s) => s.sourceKind === "pdf"],
  ["12 images", (s) => s.sourceKind === "image"],
  [`${shrunk.size} images the service shrinks (short side > 768 px)`, (s) => shrunk.has(s.name)],
  [
    `${12 - shrunk.size} images it does not`,
    (s) => s.sourceKind === "image" && !shrunk.has(s.name),
  ],
];

type Tally = [hit: number, total: number];
const METRICS = [
  "scalars",
  "critical",
  "fiscal",
  "other",
  "VAT cells",
  "item cells",
  "VAT row count exact",
  "item row count exact",
  "no critical correction",
] as const;
type Metric = (typeof METRICS)[number];

function tally(receipts: ScoredReceipt[]): Record<Metric, Tally> {
  const cells = receipts.flatMap((r) => r.score.cells);
  const group = (...groups: Group[]): Tally => {
    const inGroup = cells.filter((cell) => groups.includes(cell.group));
    return [inGroup.filter((cell) => cell.match).length, inGroup.length];
  };
  const rows = (table: "vatBreakdown" | "items"): Tally => {
    const judged = receipts.map((r) => r.score.rowCountExact[table]).filter((v) => v !== undefined);
    return [judged.filter(Boolean).length, judged.length];
  };
  const critical = receipts.map((r) => r.score.noCriticalCorrection).filter((v) => v !== null);
  return {
    scalars: group("critical", "fiscal", "other"),
    critical: group("critical"),
    fiscal: group("fiscal"),
    other: group("other"),
    "VAT cells": group("vat"),
    "item cells": group("items"),
    "VAT row count exact": rows("vatBreakdown"),
    "item row count exact": rows("items"),
    "no critical correction": [critical.filter(Boolean).length, critical.length],
  };
}

const armNames = ["di", ...ARMS] as const;
const runsOf = (arm: string): Run[] => runs.filter((run) => run.arm === arm);

/** "12–14/16" over an arm's runs; "not run" when it has none; "–" when the group is empty. */
function range(arm: string, inGroup: (s: Sample) => boolean, metric: Metric): string {
  const armRuns = runsOf(arm);
  if (!armRuns.length) return "not run";
  const tallies = armRuns.map(
    (run) => tally(run.receipts.filter((r) => inGroup(r.sample)))[metric],
  );
  const total = tallies[0]![1];
  if (total === 0) return "–";
  const hits = tallies.map(([hit]) => hit);
  const [low, high] = [Math.min(...hits), Math.max(...hits)];
  return `${low === high ? low : `${low}–${high}`}/${total}`;
}

const lines: string[] = [];
const out = (line = ""): void => void lines.push(line);
const row = (cells: string[]): void => out(`| ${cells.join(" | ")} |`);

if (unverified) out(`**GROUND TRUTH NOT VERIFIED** (${unverified} of ${SAMPLES.length} files)\n`);
out(
  `Runs recorded: ${armNames.map((arm) => `${arm} ${runsOf(arm).length}`).join(", ")}. ` +
    `Ranges are over an arm's runs. \`files\` ran for the 2 PDFs only. ` +
    `Outside every arm, no source file: ${EXCLUDED.join(", ")}.`,
);

for (const [name, inGroup] of SOURCE_GROUPS) {
  out(`\n### ${name}\n`);
  row(["", ...armNames.map((arm) => `\`${arm}\``)]);
  row(["---", ...armNames.map(() => "---")]);
  for (const metric of METRICS) {
    row([metric, ...armNames.map((arm) => range(arm, inGroup, metric))]);
  }
}

// Per field, the worst run of each arm: the run a user would have had on a bad day.
out(`\n### Per field, each arm's worst run\n`);
row(["field", ...armNames.map((arm) => `\`${arm}\``)]);
row(["---", ...armNames.map(() => "---")]);
const fieldOf = (cell: CellResult): string =>
  cell.path.includes(".") ? `${cell.path.split(".")[0]}.${cell.path.split(".")[2]}` : cell.path;
const fieldNames = [...new Set(runs[0]!.receipts.flatMap((r) => r.score.cells.map(fieldOf)))];
for (const field of fieldNames) {
  row([
    field,
    ...armNames.map((arm) => {
      const perRun = runsOf(arm).map((run) => {
        const cells = run.receipts
          .flatMap((r) => r.score.cells)
          .filter((c) => fieldOf(c) === field);
        return [cells.filter((c) => c.match).length, cells.length] as Tally;
      });
      if (!perRun.length) return "not run";
      const worst = perRun.toSorted((a, b) => a[0] - b[0])[0]!;
      return worst[1] ? `${worst[0]}/${worst[1]}` : "–";
    }),
  ]);
}

out(`\n### Values that could not be normalised, and inferred currencies (total over runs)\n`);
row(["", ...armNames.slice(1).map((arm) => `\`${arm}\``)]);
row(["---", ...ARMS.map(() => "---")]);
for (const key of ["unreadable", "inferred"] as const) {
  row([
    key,
    ...ARMS.map((arm) =>
      runsOf(arm).length
        ? String(
            runsOf(arm).reduce((n, run) => n + run.receipts.reduce((m, r) => m + r[key], 0), 0),
          )
        : "not run",
    ),
  ]);
}

// Run-to-run variance: scored paths whose normalised value is not the same in every run.
const show = (value: unknown): string =>
  value === null || value === undefined ? "∅" : String(value);
const at = (fields: Record<string, unknown> | null, path: string): unknown => {
  const [head, index, cell] = path.split(".");
  if (!fields) return undefined;
  if (index === undefined) return fields[head!];
  return (fields[head!] as Record<string, unknown>[] | null)?.[Number(index)]?.[cell!];
};
out(`\n### Scored values that differ between an arm's runs\n`);
const unstable = new Map<string, string[]>();
for (const arm of ARMS) {
  const armRuns = runsOf(arm);
  const paths: string[] = [];
  for (const receipt of armRuns[0]?.receipts ?? []) {
    for (const cell of receipt.score.cells) {
      const values = armRuns.map((run) =>
        show(at(run.receipts.find((r) => r.sample === receipt.sample)!.fields, cell.path)),
      );
      if (new Set(values).size > 1)
        paths.push(`${receipt.sample.name} ${cell.path}: ${values.join(" | ")}`);
    }
  }
  unstable.set(arm, paths);
  out(`- \`${arm}\`: ${armRuns.length < 2 ? "fewer than two runs" : paths.length}`);
}

if (verbose) {
  for (const [arm, paths] of unstable) {
    if (paths.length) out(`\n\`${arm}\` differs on:\n${paths.map((p) => `- ${p}`).join("\n")}`);
  }
  out(`\n### Mismatches, receipt by receipt\n`);
  out("Each arm shows its runs in order as normalised value [printed value]; ✓ is a match.\n");
  for (const sample of SAMPLES) {
    const paths = runs[0]!.receipts
      .find((r) => r.sample === sample)!
      .score.cells.map((c) => c.path);
    for (const path of paths) {
      const perArm = armNames.map((arm) => {
        const cells = runsOf(arm)
          .map((run) => run.receipts.find((r) => r.sample === sample))
          .filter((r) => r !== undefined)
          .map((r) => {
            const cell = r.score.cells.find((c) => c.path === path)!;
            if (cell.match) return "✓";
            const printed = at(r.raw, path);
            return `${show(cell.actual)}${printed != null && printed !== cell.actual ? ` [${show(printed)}]` : ""}`;
          });
        return { arm, cells };
      });
      if (perArm.every(({ cells }) => cells.every((c) => c === "✓"))) continue;
      out(`- **${sample.name}** \`${path}\` expected ${show(at(truth.get(sample.name)!, path))}`);
      for (const { arm, cells } of perArm) {
        if (cells.some((c) => c !== "✓")) out(`  - \`${arm}\`: ${cells.join(" | ")}`);
      }
    }
  }
}

console.log(lines.join("\n"));

// The same numbers as data, for the write-up.
writeCache("", "report", {
  groundTruthVerified: unverified === 0,
  runs: runs.map((run) => ({
    arm: run.arm,
    rep: run.rep,
    groups: Object.fromEntries(
      SOURCE_GROUPS.map(([name, inGroup]) => [
        name,
        tally(run.receipts.filter((r) => inGroup(r.sample))),
      ]),
    ),
  })),
  unstable: Object.fromEntries(unstable),
});
