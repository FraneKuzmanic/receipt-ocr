/**
 * Scores every recorded Plan B run: production, the LLM on OCR text, the repair pass under each
 * of its three policies, and Content Understanding, against one ground truth (`truth.ts`) with
 * one comparator (`compare.ts`).
 *
 * A run that lacks a record fails the script: a harness that skips what it cannot measure
 * reports the health of the corpus it kept. Probe records are never read.
 *
 * `--verbose` lists every mismatch with each column's value, and the paths that differ between
 * runs. The numbers are also written to .bakeoff/plan-b/report.json.
 */
import type { CanonicalReceiptFields } from "@receipt/shared";
import { scoreReceipt, type CellResult, type Group, type ReceiptScore } from "./compare.ts";
import { cuDetails, cuFields, cuWords } from "./content-understanding.ts";
import { layoutGeometry, type LayoutPage, type LayoutWord } from "./ground.ts";
import { uploadInput } from "./inputs.ts";
import { normalize } from "./normalize.ts";
import { PLAN_B_ARMS, costTable, readRun, repExists, type SampleRun } from "./plan-b-records.ts";
import { productionWords } from "./production.ts";
import { POLICIES, applyRepair, isGrounded, type Policy, type Repaired } from "./repair.ts";
import { EXCLUDED, SAMPLES, UNSEEN, writeCache, type Sample } from "./samples.ts";
import { PRICE_NOTE } from "./spend.ts";
import { TABLES_VERIFIED, groundTruth } from "./truth.ts";

const verbose = process.argv.includes("--verbose");
const SMALL_IMAGE_WIDTH = 500;
/** A difference of this many values between arms is noise (iteration 25, payslip bake-off). */
const NOISE = 2;

const COLUMNS = ["production", "ocr", "repair:fill", "repair:weak", "repair:all", "cu"] as const;
type Column = (typeof COLUMNS)[number];

// ---------- load ----------

const reps: number[] = [];
for (let rep = 1; repExists("", rep); rep++) reps.push(rep);
if (!reps.length) {
  console.error(
    "\n  Nothing is recorded under .bakeoff/plan-b/ (expected production-r1, ocr-r1, repair-r1, cu-r1).\n",
  );
  process.exit(1);
}

const missing: string[] = [];
const recorded = new Map<string, SampleRun>();
for (const rep of reps) {
  for (const sample of SAMPLES) {
    const run = readRun("", rep, sample);
    for (const arm of PLAN_B_ARMS) if (!run[arm]) missing.push(`${arm}-r${rep}/${sample.name}`);
    recorded.set(`${rep}/${sample.name}`, run as SampleRun);
  }
}
if (missing.length) {
  console.error(
    `\n  Recorded runs are incomplete, so nothing is scored:\n    ${missing.join("\n    ")}\n`,
  );
  process.exit(1);
}

// ---------- one scored receipt ----------

type Wrong = "grounded" | "ungrounded" | "missing";

interface Scored {
  sample: Sample;
  fields: Record<string, unknown>;
  /** What the model copied, where a model produced the value. */
  printed: Record<string, unknown> | null;
  score: ReceiptScore;
  /** Every scalar that does not match, by what went wrong. */
  wrong: { path: string; kind: Wrong }[];
  repair?: Repaired;
}

interface Run {
  column: Column;
  rep: number;
  receipts: Scored[];
}

const truth = new Map(SAMPLES.map((s) => [s.name, groundTruth(s)]));
const isScalar = (cell: CellResult): boolean => cell.group !== "vat" && cell.group !== "items";

function scored(
  sample: Sample,
  fields: CanonicalReceiptFields,
  printed: Record<string, unknown> | null,
  geometry: { words: LayoutWord[]; pages: LayoutPage[] },
  repair?: Repaired,
): Scored {
  const score = scoreReceipt(truth.get(sample.name)!, fields as Record<string, unknown>);
  const wrong = score.cells
    .filter((cell) => isScalar(cell) && !cell.match)
    .map((cell) => ({
      path: cell.path,
      kind:
        cell.actual === null
          ? ("missing" as const)
          : isGrounded(printed?.[cell.path], cell.actual, geometry.words, geometry.pages)
            ? ("grounded" as const)
            : ("ungrounded" as const),
    }));
  return {
    sample,
    fields: fields as Record<string, unknown>,
    printed,
    score,
    wrong,
    ...(repair ? { repair } : {}),
  };
}

function scoreColumn(column: Column, sample: Sample, run: SampleRun): Scored {
  const production = productionWords(run.production);
  if (column === "production") return scored(sample, run.production.fields, null, production);
  if (column === "ocr") {
    return scored(
      sample,
      normalize(run.ocr.fields).fields,
      run.ocr.fields,
      layoutGeometry(run.layout.operation),
    );
  }
  if (column === "cu") {
    const printed = cuFields(run.cu.operation);
    return scored(sample, normalize(printed).fields, printed, cuWords(run.cu.operation));
  }
  const repair = applyRepair(
    column.split(":")[1] as Policy,
    {
      fields: run.production.fields,
      sources: run.production.metadata.fields,
      qr: run.production.qr,
    },
    { printed: run.repair.fields, fields: normalize(run.repair.fields).fields },
    production.words,
    production.pages,
  );
  return scored(sample, repair.fields, run.repair.fields, production, repair);
}

const runs: Run[] = COLUMNS.flatMap((column) =>
  reps.map((rep) => ({
    column,
    rep,
    receipts: SAMPLES.map((sample) =>
      scoreColumn(column, sample, recorded.get(`${rep}/${sample.name}`)!),
    ),
  })),
);
const runsOf = (column: Column): Run[] => runs.filter((run) => run.column === column);
const runOf = (column: Column, rep: number): Run =>
  runs.find((run) => run.column === column && run.rep === rep)!;

// ---------- aggregation ----------

const widths = new Map<string, number>();
for (const sample of SAMPLES) widths.set(sample.name, (await uploadInput(sample)).width);
const isSmall = (s: Sample): boolean =>
  s.sourceKind === "image" && widths.get(s.name)! < SMALL_IMAGE_WIDTH;
const count = (inGroup: (s: Sample) => boolean): number => SAMPLES.filter(inGroup).length;

const SOURCE_GROUPS: [string, (s: Sample) => boolean][] = [
  [`all ${SAMPLES.length} receipts`, () => true],
  [`${count((s) => s.sourceKind === "pdf")} PDFs`, (s) => s.sourceKind === "pdf"],
  [`${count((s) => s.sourceKind === "image")} images`, (s) => s.sourceKind === "image"],
  [`${count(isSmall)} small images (under ${SMALL_IMAGE_WIDTH} px wide)`, isSmall],
  ["the receipt production was not tuned on", (s) => s.name === UNSEEN],
];

type Tally = [hit: number, total: number];
const METRICS = [
  "scalars",
  "critical",
  "fiscal",
  "party",
  "other",
  "VAT cells",
  "item cells",
  "VAT row count exact",
  "item row count exact",
  "no critical correction",
] as const;
type Metric = (typeof METRICS)[number];
const UNVERIFIED: readonly Metric[] = [
  "VAT cells",
  "item cells",
  "VAT row count exact",
  "item row count exact",
];

function tally(receipts: Scored[]): Record<Metric, Tally> {
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
    scalars: group("critical", "fiscal", "party", "other"),
    critical: group("critical"),
    fiscal: group("fiscal"),
    party: group("party"),
    other: group("other"),
    "VAT cells": group("vat"),
    "item cells": group("items"),
    "VAT row count exact": rows("vatBreakdown"),
    "item row count exact": rows("items"),
    "no critical correction": [critical.filter(Boolean).length, critical.length],
  };
}

const span = (values: number[]): string => {
  const [low, high] = [Math.min(...values), Math.max(...values)];
  return low === high ? String(low) : `${low}–${high}`;
};

/** "12–14/16" over a column's runs; "–" when the group has nothing to judge. */
function range(column: Column, inGroup: (s: Sample) => boolean, metric: Metric): string {
  const tallies = runsOf(column).map(
    (run) => tally(run.receipts.filter((r) => inGroup(r.sample)))[metric],
  );
  const total = tallies[0]![1];
  return total === 0 ? "–" : `${span(tallies.map(([hit]) => hit))}/${total}`;
}

const lines: string[] = [];
const out = (line = ""): void => void lines.push(line);
const row = (cells: string[]): void => out(`| ${cells.join(" | ")} |`);
const header = (first: string, columns: readonly string[] = COLUMNS): void => {
  row([first, ...columns.map((column) => `\`${column}\``)]);
  row(["---", ...columns.map(() => "---")]);
};

if (!TABLES_VERIFIED) {
  out(
    "**ITEMS AND VAT ROWS NOT VERIFIED.** Scalar ground truth is verified; table rows are not.\n",
  );
}
out(
  `${reps.length} run(s) of ${SAMPLES.length} receipts. Ranges are over a column's runs. ` +
    `The three \`repair\` columns are one set of recorded calls under three merge policies. ` +
    `Outside every arm, no source file: ${EXCLUDED.join(", ")}.`,
);

for (const [name, inGroup] of SOURCE_GROUPS) {
  out(`\n### ${name}\n`);
  header("");
  for (const metric of METRICS) {
    const label =
      UNVERIFIED.includes(metric) && !TABLES_VERIFIED ? `${metric} (unverified)` : metric;
    row([label, ...COLUMNS.map((column) => range(column, inGroup, metric))]);
  }
}

// Per field, the worst run of each column: the run a user would have had on a bad day.
out(`\n### Per field, each column's worst run\n`);
header("field");
const fieldOf = (cell: CellResult): string =>
  cell.path.includes(".") ? `${cell.path.split(".")[0]}.${cell.path.split(".")[2]}` : cell.path;
const fieldNames = [...new Set(runs[0]!.receipts.flatMap((r) => r.score.cells.map(fieldOf)))];
for (const field of fieldNames) {
  row([
    field,
    ...COLUMNS.map((column) => {
      const perRun = runsOf(column).map((run) => {
        const cells = run.receipts
          .flatMap((r) => r.score.cells)
          .filter((c) => fieldOf(c) === field);
        return [cells.filter((c) => c.match).length, cells.length] as Tally;
      });
      const worst = perRun.toSorted((a, b) => a[0] - b[0])[0]!;
      return worst[1] ? `${worst[0]}/${worst[1]}` : "–";
    }),
  ]);
}

// ---------- wrong values ----------

const wrongCount = (run: Run, kind: Wrong, inGroup: (s: Sample) => boolean): number =>
  run.receipts
    .filter((r) => inGroup(r.sample))
    .reduce((n, r) => n + r.wrong.filter((w) => w.kind === kind).length, 0);

out(`\n### Scalars that do not match, by what went wrong\n`);
out(
  "On the page: a value that is wrong and is found among that run's OCR words (a misattribution or " +
    "a formatting difference). Not on the page: wrong and found nowhere among them. Missing: " +
    "nothing returned where the receipt has a value.\n",
);
for (const [name, inGroup] of [SOURCE_GROUPS[0]!, SOURCE_GROUPS[3]!]) {
  out(`\n**${name}**\n`);
  header("");
  for (const [label, kind] of [
    ["wrong, on the page", "grounded"],
    ["wrong, not on the page", "ungrounded"],
    ["missing", "missing"],
  ] as const) {
    row([
      label,
      ...COLUMNS.map((column) => span(runsOf(column).map((run) => wrongCount(run, kind, inGroup)))),
    ]);
  }
}

// ---------- run-to-run ----------

const show = (value: unknown): string =>
  value === null || value === undefined ? "∅" : String(value);
const at = (fields: Record<string, unknown> | null, path: string): unknown => {
  const [head, index, cell] = path.split(".");
  if (!fields) return undefined;
  if (index === undefined) return fields[head!];
  return (fields[head!] as Record<string, unknown>[] | null)?.[Number(index)]?.[cell!];
};
const receiptOf = (run: Run, sample: Sample): Scored =>
  run.receipts.find((r) => r.sample === sample)!;

out(`\n### Scored values that differ between a column's runs\n`);
const unstable = new Map<Column, string[]>();
for (const column of COLUMNS) {
  const columnRuns = runsOf(column);
  const paths: string[] = [];
  for (const receipt of columnRuns[0]!.receipts) {
    for (const cell of receipt.score.cells) {
      const values = columnRuns.map((run) =>
        show(at(receiptOf(run, receipt.sample).fields, cell.path)),
      );
      if (new Set(values).size > 1) {
        paths.push(`${receipt.sample.name} ${cell.path}: ${values.join(" | ")}`);
      }
    }
  }
  unstable.set(column, paths);
  out(`- \`${column}\`: ${columnRuns.length < 2 ? "fewer than two runs" : paths.length}`);
}

// ---------- repair policies ----------

out(`\n### What each repair policy did (per run)\n`);
const policyColumns = POLICIES.map((policy) => `repair:${policy}` as Column);
header("", policyColumns);
const repairStat = (pick: (receipt: Scored, before: Scored) => number): string[] =>
  policyColumns.map((column) =>
    span(
      runsOf(column).map((run) =>
        run.receipts.reduce(
          (n, receipt) =>
            n + pick(receipt, receiptOf(runOf("production", run.rep), receipt.sample)),
          0,
        ),
      ),
    ),
  );
/** Of the fields a policy touched, how many went from wrong to right (+1) or right to wrong (-1). */
const effect = (receipt: Scored, before: Scored, want: 1 | 0 | -1): number =>
  [...receipt.repair!.filled, ...receipt.repair!.changed].filter((path) => {
    const was = before.score.cells.find((c) => c.path === path)?.match;
    const is = receipt.score.cells.find((c) => c.path === path)?.match;
    return Number(is ?? false) - Number(was ?? false) === want;
  }).length;
row(["empty fields filled", ...repairStat((r) => r.repair!.filled.length)]);
row(["values replaced", ...repairStat((r) => r.repair!.changed.length)]);
row(["of those: wrong made right", ...repairStat((r, before) => effect(r, before, 1))]);
row(["of those: right made wrong", ...repairStat((r, before) => effect(r, before, -1))]);
row(["of those: no difference to the score", ...repairStat((r, before) => effect(r, before, 0))]);
row([
  "model values not on the page, rejected",
  ...repairStat((r) => r.repair!.rejectedUngrounded.length),
]);

// ---------- Content Understanding detail ----------

out(`\n### Content Understanding: confidence and position (per run)\n`);
const cuStats = reps.map((rep) => {
  const stat = { lowRight: 0, lowWrong: 0, highRight: 0, highWrong: 0, sourced: 0, returned: 0 };
  for (const receipt of runOf("cu", rep).receipts) {
    const details = cuDetails(recorded.get(`${rep}/${receipt.sample.name}`)!.cu.operation);
    for (const detail of Object.values(details)) {
      stat.returned++;
      if (detail.sourced) stat.sourced++;
    }
    for (const cell of receipt.score.cells.filter(isScalar)) {
      const confidence = details[cell.path]?.confidence;
      if (confidence === null || confidence === undefined) continue;
      stat[`${confidence < 0.5 ? "low" : "high"}${cell.match ? "Right" : "Wrong"}`]++;
    }
  }
  return stat;
});
const cuRow = (label: string, pick: (stat: (typeof cuStats)[number]) => number): void =>
  out(`- ${label}: ${span(cuStats.map(pick))}`);
cuRow("scored scalars below confidence 0.5 that were right", (s) => s.lowRight);
cuRow("scored scalars below confidence 0.5 that were wrong", (s) => s.lowWrong);
cuRow("scored scalars at 0.5 or above that were right", (s) => s.highRight);
cuRow("scored scalars at 0.5 or above that were wrong", (s) => s.highWrong);
cuRow("returned scalars", (s) => s.returned);
cuRow("returned scalars with a position", (s) => s.sourced);

// ---------- the decision bar ----------

interface Verdict {
  column: Column;
  criteria: { pass: boolean; detail: string }[];
  /** Criterion 1 passed by no more than the noise margin. */
  withinNoise: boolean;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
const all = (run: Run): Record<Metric, Tally> => tally(run.receipts);
const verdicts: Verdict[] = COLUMNS.filter((column) => column !== "production").map((column) => {
  const perRep = reps.map((rep) => {
    const arm = all(runOf(column, rep));
    const base = all(runOf("production", rep));
    return {
      receipts: arm["no critical correction"][0] - base["no critical correction"][0],
      scalars: arm.scalars[0] - base.scalars[0],
      items: arm["item cells"][0] - base["item cells"][0],
      vat: arm["VAT cells"][0] - base["VAT cells"][0],
    };
  });
  const spread = (pick: (rep: (typeof perRep)[number]) => number): string => {
    const values = perRep.map(pick);
    const [low, high] = [Math.min(...values), Math.max(...values)];
    return low === high ? signed(low) : `${signed(low)} to ${signed(high)}`;
  };
  const better = perRep.every((d) => d.receipts > 0 || (d.receipts === 0 && d.scalars > 0));
  const ungroundedSmall = runsOf(column).reduce(
    (n, run) => n + wrongCount(run, "ungrounded", isSmall),
    0,
  );
  const differing = unstable.get(column)!.length;
  return {
    column,
    withinNoise: better && perRep.some((d) => d.receipts === 0 && d.scalars <= NOISE),
    criteria: [
      {
        pass: better,
        detail: `${spread((d) => d.receipts)} receipts, ${spread((d) => d.scalars)} scalars`,
      },
      {
        pass: perRep.every((d) => d.items >= 0 && d.vat >= 0),
        detail: `${spread((d) => d.items)} item cells, ${spread((d) => d.vat)} VAT cells`,
      },
      { pass: ungroundedSmall === 0, detail: `${ungroundedSmall} over ${reps.length} run(s)` },
      { pass: differing <= 2, detail: String(differing) },
    ],
  };
});

out(`\n### Decision bar, against \`production\` in the same run\n`);
row([
  "",
  "1. more receipts with no critical correction, or as many and more scalars, in every run",
  "2. loses no item or VAT cell",
  "3. small photos: no wrong value that is not on the page",
  "4. at most 2 values differ between runs",
  "worth adopting",
]);
row(["---", "---", "---", "---", "---", "---"]);
for (const verdict of verdicts) {
  const passed = verdict.criteria.every((criterion) => criterion.pass);
  row([
    `\`${verdict.column}\``,
    ...verdict.criteria.map((c) => `${c.pass ? "pass" : "FAIL"} (${c.detail})`),
    passed ? (verdict.withinNoise ? "yes, but within noise on 1" : "yes") : "no",
  ]);
}
out(
  `\nA difference of ${NOISE} values or fewer between arms is noise and reads as no difference. ` +
    `\`production\` itself differs between its runs on ${unstable.get("production")!.length} scored value(s).`,
);

// ---------- latency and cost ----------

out(`\n### Latency and cost\n`);
for (const line of costTable("", SAMPLES)) out(line);
out(
  `\nLatency is end to end: \`ocr\` includes its layout call, \`repair\` the production call it follows, ` +
    `\`cu\` any stalled submit. Cost is the whole arm's: \`repair\` includes production. ${PRICE_NOTE}`,
);

// ---------- verbose ----------

if (verbose) {
  for (const [column, paths] of unstable) {
    if (paths.length) out(`\n\`${column}\` differs on:\n${paths.map((p) => `- ${p}`).join("\n")}`);
  }
  out(`\n### Mismatches, receipt by receipt\n`);
  out(
    "Each column shows its runs in order as normalised value [printed value]; ✓ is a match; " +
      "⚠ marks a value that is not on the page.\n",
  );
  for (const sample of SAMPLES) {
    for (const path of runs[0]!.receipts
      .find((r) => r.sample === sample)!
      .score.cells.map((c) => c.path)) {
      const perColumn = COLUMNS.map((column) => ({
        column,
        cells: runsOf(column).map((run) => {
          const receipt = receiptOf(run, sample);
          const cell = receipt.score.cells.find((c) => c.path === path)!;
          if (cell.match) return "✓";
          const printed = at(receipt.printed, path);
          const flag =
            receipt.wrong.find((w) => w.path === path)?.kind === "ungrounded" ? " ⚠" : "";
          return `${show(cell.actual)}${printed != null && printed !== cell.actual ? ` [${show(printed)}]` : ""}${flag}`;
        }),
      }));
      if (perColumn.every(({ cells }) => cells.every((c) => c === "✓"))) continue;
      out(`- **${sample.name}** \`${path}\` expected ${show(at(truth.get(sample.name)!, path))}`);
      for (const { column, cells } of perColumn) {
        if (cells.some((c) => c !== "✓")) out(`  - \`${column}\`: ${cells.join(" | ")}`);
      }
    }
  }
}

console.log(lines.join("\n"));

// The same numbers as data, for the write-up.
writeCache("plan-b", "report", {
  tablesVerified: TABLES_VERIFIED,
  runs: runs.map((run) => ({
    column: run.column,
    rep: run.rep,
    groups: Object.fromEntries(
      SOURCE_GROUPS.map(([name, inGroup]) => [
        name,
        tally(run.receipts.filter((r) => inGroup(r.sample))),
      ]),
    ),
    wrong: Object.fromEntries(
      (["grounded", "ungrounded", "missing"] as const).map((kind) => [
        kind,
        { all: wrongCount(run, kind, () => true), small: wrongCount(run, kind, isSmall) },
      ]),
    ),
  })),
  unstable: Object.fromEntries(unstable),
  verdicts,
});
