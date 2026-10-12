/**
 * Scores the scalar probe: for each configuration (text source + deployment), the LLM's scalars
 * on their own, and production's scalars merged with them under `scalar-merge.ts`'s rule, with
 * and without the on-the-page test. One ground truth (`truth.ts`), one comparator (`compare.ts`).
 *
 * The decision bar is computed on the receipts whose scalar truth the product owner verified.
 * `amelie-receipt` is reported apart until its truth is. A missing record fails the script.
 *
 * `--verbose` lists what each merge changed and every scalar that does not match.
 */
import { LOW_CONFIDENCE_THRESHOLD } from "../../api/src/providers/document-extraction/types.js";
import { matches, scoreReceipt, type CellResult } from "./compare.ts";
import { layoutGeometry } from "./ground.ts";
import { normalize } from "./normalize.ts";
import { isGrounded, lockedFields, type ProductionReading } from "./repair.ts";
import { mergeScalars, type Merged } from "./scalar-merge.ts";
import {
  AMELIE,
  CONFIGS,
  PROBE_SAMPLES,
  SOURCES,
  configName,
  readLlm,
  readProduction,
  readText,
  type Config,
  type ProbeLlm,
} from "./scalar-probe-records.ts";
import { SAMPLES, UNSEEN, writeCache, type Sample } from "./samples.ts";
import { PRICE, modelUsd } from "./spend.ts";
import { groundTruth } from "./truth.ts";

const verbose = process.argv.includes("--verbose");
const VARIANTS = ["rule", "rule+grounded"] as const;
type Variant = (typeof VARIANTS)[number];

// ---------- load ----------

const reps: number[] = [];
for (let rep = 1; readLlm("", CONFIGS[0]!, rep, SAMPLES[0]!) !== null; rep++) reps.push(rep);
const missing: string[] = [];
for (const s of PROBE_SAMPLES) {
  if (!readProduction("", s)) missing.push(`production-r1/${s.name}`);
  for (const source of SOURCES) {
    if (!readText("", source, s)) missing.push(`text-${source}-r1/${s.name}`);
  }
  for (const c of CONFIGS) {
    for (const rep of reps) {
      if (!readLlm("", c, rep, s)) missing.push(`llm-${configName(c)}-r${rep}/${s.name}`);
    }
  }
}
if (!reps.length || missing.length) {
  console.error(
    `\n  Recorded runs under .bakeoff/scalar-probe/ are incomplete, so nothing is scored:\n    ${missing.join("\n    ") || "no run"}\n`,
  );
  process.exit(1);
}

// ---------- one scored receipt ----------

const truth = new Map(PROBE_SAMPLES.map((s) => [s.name, groundTruth(s)]));
const scalarCells = (s: Sample, fields: Record<string, unknown>): CellResult[] =>
  scoreReceipt(truth.get(s.name)!, fields).cells.filter(
    (cell) => cell.group !== "vat" && cell.group !== "items",
  );
const right = (cells: CellResult[]): number => cells.filter((cell) => cell.match).length;
const noCritical = (cells: CellResult[]): boolean =>
  cells.filter((cell) => cell.group === "critical").every((cell) => cell.match);

interface Scored {
  sample: Sample;
  production: CellResult[];
  alone: CellResult[];
  merged: Record<Variant, { cells: CellResult[]; merge: Merged }>;
  /** Production's low-confidence flags, as the review form would show them. */
  flagged: string[];
  llm: ProbeLlm;
  llmFields: Record<string, unknown>;
}

function score(c: Config, rep: number, s: Sample): Scored {
  const production = readProduction("", s)!;
  const llm = readLlm("", c, rep, s)!;
  const reading: ProductionReading = {
    fields: production.fields,
    sources: production.metadata.fields,
    qr: production.qr,
  };
  const normalized = normalize(llm.fields).fields as Record<string, unknown>;
  const { words, pages } = layoutGeometry(readText("", c.source, s)!.operation);
  const merge = (variant: Variant): { cells: CellResult[]; merge: Merged } => {
    const merged = mergeScalars(
      reading,
      { printed: llm.fields, fields: normalized },
      variant === "rule"
        ? undefined
        : (name) => isGrounded(llm.fields[name], normalized[name], words, pages),
    );
    return { cells: scalarCells(s, merged.fields as Record<string, unknown>), merge: merged };
  };
  const locked = lockedFields(reading);
  return {
    sample: s,
    production: scalarCells(s, production.fields as Record<string, unknown>),
    alone: scalarCells(s, normalized),
    merged: { rule: merge("rule"), "rule+grounded": merge("rule+grounded") },
    flagged: Object.entries(production.metadata.fields)
      .filter(
        ([name, meta]) =>
          meta.source === "model" &&
          typeof meta.confidence === "number" &&
          meta.confidence < LOW_CONFIDENCE_THRESHOLD &&
          !locked.has(name),
      )
      .map(([name]) => name),
    llm,
    llmFields: normalized,
  };
}

const VERIFIED = SAMPLES;
const runs = new Map<string, Scored[]>();
for (const c of CONFIGS) {
  for (const rep of reps) {
    runs.set(
      `${configName(c)}/${rep}`,
      PROBE_SAMPLES.map((s) => score(c, rep, s)),
    );
  }
}
const runOf = (c: Config, rep: number, samples: readonly Sample[] = VERIFIED): Scored[] =>
  runs.get(`${configName(c)}/${rep}`)!.filter((r) => samples.includes(r.sample));

// ---------- helpers ----------

const lines: string[] = [];
const out = (line = ""): void => void lines.push(line);
const row = (cells: (string | number)[]): void => out(`| ${cells.join(" | ")} |`);
const header = (cells: string[]): void => {
  row(cells);
  row(cells.map(() => "---"));
};
const span = (values: number[]): string => {
  const [low, high] = [Math.min(...values), Math.max(...values)];
  return low === high ? String(low) : `${low}–${high}`;
};
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const quantile = (xs: number[], q: number): number =>
  xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}`;
const p5090 = (xs: number[]): string => `${secs(quantile(xs, 0.5))} / ${secs(quantile(xs, 0.9))} s`;
const over = <T>(c: Config, pick: (run: Scored[]) => T, samples?: readonly Sample[]): T[] =>
  reps.map((rep) => pick(runOf(c, rep, samples)));
const cell = (cells: CellResult[], path: string): CellResult | undefined =>
  cells.find((x) => x.path === path);

/** Correct production scalars a merge made wrong. */
const broken = (r: Scored, variant: Variant): string[] =>
  r.production
    .filter((x) => x.match && !cell(r.merged[variant].cells, x.path)!.match)
    .map((x) => x.path);
const fixed = (r: Scored, variant: Variant): string[] =>
  r.production
    .filter((x) => !x.match && cell(r.merged[variant].cells, x.path)!.match)
    .map((x) => x.path);

/** Paths whose merged value differs between runs, on the verified receipts. */
function unstable(c: Config, variant: Variant): string[] {
  const paths: string[] = [];
  for (const s of VERIFIED) {
    const perRep = reps.map((rep) => runOf(c, rep).find((r) => r.sample === s)!);
    for (const x of perRep[0]!.production) {
      const values = perRep.map((r) => String(cell(r.merged[variant].cells, x.path)!.actual));
      if (new Set(values).size > 1) paths.push(`${s.name} ${x.path}: ${values.join(" | ")}`);
    }
  }
  return paths;
}

// ---------- accuracy ----------

const total = runOf(CONFIGS[0]!, 1).reduce((n, r) => n + r.production.length, 0);
const productionRun = runOf(CONFIGS[0]!, 1);
const productionRight = sum(productionRun.map((r) => right(r.production)));
const productionClean = productionRun.filter((r) => noCritical(r.production)).length;

out(
  `${reps.length} run(s) of the model calls on ${VERIFIED.length} receipts with verified scalars ` +
    `(${total} scored scalars); one production call per receipt, in run 1. Ranges are over the runs. ` +
    `Items and VAT rows are production's in every row.\n`,
);
out(`### Scalars right, of ${total}\n`);
header([
  "",
  "LLM alone",
  "merged, rule",
  "merged, rule + on-the-page test",
  `no critical correction, of ${VERIFIED.length} (rule)`,
  "correct production values broken (rule)",
  "values differing between runs (rule)",
]);
row(["`production`", "–", productionRight, productionRight, productionClean, "–", "–"]);
for (const c of CONFIGS) {
  row([
    `\`${configName(c)}\``,
    span(over(c, (run) => sum(run.map((r) => right(r.alone))))),
    span(over(c, (run) => sum(run.map((r) => right(r.merged.rule.cells))))),
    span(over(c, (run) => sum(run.map((r) => right(r.merged["rule+grounded"].cells))))),
    span(over(c, (run) => run.filter((r) => noCritical(r.merged.rule.cells)).length)),
    span(over(c, (run) => sum(run.map((r) => broken(r, "rule").length)))),
    unstable(c, "rule").length,
  ]);
}

out(`\n### The two receipts production was not tuned on (scalars right, of 14)\n`);
header([
  "",
  "Konzum: production",
  "Konzum: merged",
  "amelie (truth NOT verified): production",
  "amelie: merged",
  "amelie: LLM alone",
]);
for (const c of CONFIGS) {
  const one = (name: string, pick: (r: Scored) => CellResult[]): string =>
    span(over(c, (run) => right(pick(run[0]!)), [PROBE_SAMPLES.find((s) => s.name === name)!]));
  row([
    `\`${configName(c)}\``,
    one(UNSEEN, (r) => r.production),
    one(UNSEEN, (r) => r.merged.rule.cells),
    one(AMELIE.name, (r) => r.production),
    one(AMELIE.name, (r) => r.merged.rule.cells),
    one(AMELIE.name, (r) => r.alone),
  ]);
}

// ---------- what the merge did ----------

out(`\n### What the merge did, per run (rule, verified receipts)\n`);
header([
  "",
  "filled",
  "replaced",
  "buyer cleared",
  "wrong made right",
  "right made wrong",
  "disagreements kept as production's (flag)",
  "of those: production wrong",
  "of those: production right",
  "rejected by the on-the-page test",
]);
for (const c of CONFIGS) {
  const stat = (pick: (r: Scored) => number): string => span(over(c, (run) => sum(run.map(pick))));
  const disagreed = (r: Scored, wantMatch: boolean): number =>
    r.merged.rule.merge.disagreed.filter((path) => cell(r.production, path)?.match === wantMatch)
      .length;
  row([
    `\`${configName(c)}\``,
    stat((r) => r.merged.rule.merge.filled.length),
    stat((r) => r.merged.rule.merge.replaced.length),
    stat((r) => r.merged.rule.merge.cleared.length),
    stat((r) => fixed(r, "rule").length),
    stat((r) => broken(r, "rule").length),
    stat((r) => r.merged.rule.merge.disagreed.length),
    stat((r) => disagreed(r, false)),
    stat((r) => disagreed(r, true)),
    stat((r) => r.merged["rule+grounded"].merge.rejectedUngrounded.length),
  ]);
}

out(`\n### Production's low-confidence flags and the LLM (rule, verified receipts, per run)\n`);
header([
  "",
  "flags on a value still in the merged result",
  "of those: value correct",
  "correct and the LLM read the same (flag could be cleared)",
  "value wrong and the LLM read the same",
]);
for (const c of CONFIGS) {
  const flags = (r: Scored, pick: (path: string) => boolean): number =>
    r.flagged.filter((path) => {
      const merged = cell(r.merged.rule.cells, path);
      const before = cell(r.production, path);
      // A flag only survives where production's value does.
      return merged && before && merged.actual === before.actual && before.actual && pick(path);
    }).length;
  const agrees = (r: Scored, path: string): boolean => {
    const mine = cell(r.production, path)!;
    const theirs = cell(r.alone, path)!;
    return theirs.actual !== null && matches(path, mine.actual, theirs.actual);
  };
  const stat = (pick: (r: Scored) => number): string => span(over(c, (run) => sum(run.map(pick))));
  row([
    `\`${configName(c)}\``,
    stat((r) => flags(r, () => true)),
    stat((r) => flags(r, (path) => cell(r.production, path)!.match)),
    stat((r) => flags(r, (path) => cell(r.production, path)!.match && agrees(r, path))),
    stat((r) => flags(r, (path) => !cell(r.production, path)!.match && agrees(r, path))),
  ]);
}

// ---------- latency and cost ----------

out(`\n### Latency: the parallel run (run 1, all ${PROBE_SAMPLES.length} receipts)\n`);
const parallel = PROBE_SAMPLES.map((s) => ({
  production: readProduction("", s)!.doneMs,
  text: Object.fromEntries(SOURCES.map((source) => [source, readText("", source, s)!.doneMs])),
  llm: Object.fromEntries(CONFIGS.map((c) => [configName(c), readLlm("", c, 1, s)!.doneMs!])),
}));
out(`Production alone, p50 / p90: ${p5090(parallel.map((p) => p.production))}.`);
for (const source of SOURCES) {
  out(`\`${source}\` text ready, p50 / p90: ${p5090(parallel.map((p) => p.text[source]!))}.`);
}
out();
header([
  "",
  "LLM path done, p50 / p90",
  "receipt done (the later of the two), p50 / p90",
  "added to production, p50 / p90",
  "LLM path done within 0 s of production",
  "within 1 s",
  "within 2 s",
  "within 3 s",
  "model call alone, all runs, p50 / p90",
]);
const added = new Map<string, number[]>();
for (const c of CONFIGS) {
  const name = configName(c);
  const trail = parallel.map((p) => p.llm[name]! - p.production);
  added.set(
    name,
    trail.map((ms) => Math.max(0, ms)),
  );
  const within = (seconds: number): string =>
    `${trail.filter((ms) => ms <= seconds * 1000).length}/${trail.length}`;
  const calls = reps.flatMap((rep) => runOf(c, rep, PROBE_SAMPLES).map((r) => r.llm.latencyMs));
  row([
    `\`${name}\``,
    p5090(parallel.map((p) => p.llm[name]!)),
    p5090(parallel.map((p) => Math.max(p.llm[name]!, p.production))),
    p5090(added.get(name)!),
    within(0),
    within(1),
    within(2),
    within(3),
    p5090(calls),
  ]);
}

out(`\n### Cost a receipt, on top of production's $${(2 * PRICE.diPage).toFixed(4)}\n`);
header([
  "",
  "text page",
  "model call, billed",
  "model call, without caching",
  "input / output tokens, median",
]);
for (const c of CONFIGS) {
  const calls = reps.flatMap((rep) => runOf(c, rep, PROBE_SAMPLES).map((r) => r.llm));
  const mean = (billed: boolean): string =>
    (sum(calls.map((call) => modelUsd(call.usage, billed, c.deployment))) / calls.length).toFixed(
      4,
    );
  row([
    `\`${configName(c)}\``,
    `$${(c.source === "read" ? PRICE.readPage : PRICE.layoutPage).toFixed(4)}`,
    `$${mean(true)}`,
    `$${mean(false)}`,
    `${quantile(
      calls.map((call) => call.usage.prompt_tokens),
      0.5,
    )} / ${quantile(
      calls.map((call) => call.usage.completion_tokens),
      0.5,
    )}`,
  ]);
}

// ---------- the decision bar ----------

out(`\n### Decision bar (verified receipts; every run against production)\n`);
header([
  "",
  "1. no more receipts need a critical correction",
  "2. no correct production scalar broken",
  "3. more scalars right",
  "4. at most 2 values differ between runs",
  "5. adds at most 3 s at p90",
  "passes",
]);
const verdicts: Record<string, unknown>[] = [];
for (const c of CONFIGS) {
  for (const variant of VARIANTS) {
    const clean = over(c, (run) => run.filter((r) => noCritical(r.merged[variant].cells)).length);
    const brokenCount = over(c, (run) => sum(run.map((r) => broken(r, variant).length)));
    const scalars = over(c, (run) => sum(run.map((r) => right(r.merged[variant].cells))));
    const differing = unstable(c, variant).length;
    const p90 = quantile(added.get(configName(c))!, 0.9);
    const criteria: [boolean, string][] = [
      [clean.every((n) => n >= productionClean), `${span(clean)} against ${productionClean}`],
      [brokenCount.every((n) => n === 0), span(brokenCount)],
      [scalars.every((n) => n > productionRight), `${span(scalars)} against ${productionRight}`],
      [differing <= 2, String(differing)],
      [p90 <= 3000, `${secs(p90)} s`],
    ];
    const passes = criteria.every(([pass]) => pass);
    verdicts.push({ config: configName(c), variant, criteria, passes });
    row([
      `\`${configName(c)}\`, ${variant}`,
      ...criteria.map(([pass, detail]) => `${pass ? "pass" : "FAIL"} (${detail})`),
      passes ? "**yes**" : "no",
    ]);
  }
}

const show = (value: unknown): string =>
  value === null || value === undefined ? "∅" : String(value);

// ---------- verbose ----------

if (verbose) {
  for (const c of CONFIGS) {
    out(`\n### \`${configName(c)}\`: what differs from truth or from production\n`);
    for (const path of unstable(c, "rule")) out(`- differs between runs: ${path}`);
    for (const s of PROBE_SAMPLES) {
      const perRep = reps.map((rep) => runOf(c, rep, PROBE_SAMPLES).find((r) => r.sample === s)!);
      for (const x of perRep[0]!.production) {
        const merged = perRep.map((r) => cell(r.merged.rule.cells, x.path)!);
        const alone = perRep.map((r) => cell(r.alone, x.path)!);
        if (x.match && merged.every((m) => m.match) && alone.every((a) => a.match)) continue;
        const mark = (m: CellResult): string => (m.match ? "✓" : show(m.actual));
        const notes = perRep
          .map((r) => {
            const m = r.merged.rule.merge;
            return m.disagreed.includes(x.path)
              ? "flag"
              : m.cleared.includes(x.path)
                ? "cleared"
                : m.replaced.includes(x.path)
                  ? "replaced"
                  : m.filled.includes(x.path)
                    ? "filled"
                    : "–";
          })
          .join(" | ");
        out(
          `- **${s.name}** \`${x.path}\` expected ${show(x.expected)}; production ${mark(x)}; ` +
            `LLM ${alone.map(mark).join(" | ")}; merged ${merged.map(mark).join(" | ")} (${notes})`,
        );
      }
    }
  }
}

console.log(lines.join("\n"));
writeCache("scalar-probe", "report", { reps, productionRight, productionClean, total, verdicts });
