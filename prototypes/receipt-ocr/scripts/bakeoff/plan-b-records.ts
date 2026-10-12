/**
 * What Plan B's runner writes and its scorer reads: where each arm's record lives, its shape,
 * and the latency and cost of what is recorded.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cuUsd, type CuRecord } from "./content-understanding.ts";
import type { LayoutRecord } from "./layout.ts";
import type { Usage } from "./model-input.ts";
import { productionPages, type ProductionRecord } from "./production.ts";
import { CACHE_DIR, readCache, type Sample } from "./samples.ts";
import { PRICE, modelUsd } from "./spend.ts";

export const PLAN_B_DIR = join(CACHE_DIR, "plan-b");
export const PLAN_B_ARMS = ["production", "ocr", "repair", "cu"] as const;
export type PlanBArm = (typeof PLAN_B_ARMS)[number];

interface Stamp {
  sample: string;
  rep: number;
  /** Whether the file sent was the app's re-encoded JPEG rather than the source. */
  downscaled: boolean;
}

export type ProductionRun = ProductionRecord & Stamp;
export type CuRun = CuRecord & Stamp;
export interface OcrRun extends Stamp {
  arm: "ocr";
  /** The model call; the layout call is in the layout record of the same run. */
  latencyMs: number;
  extraMs: number;
  extraUsd: number;
  usage: Usage;
  fields: Record<string, unknown>;
}
export interface RepairRun extends Stamp {
  arm: "repair";
  /** The model call. */
  latencyMs: number;
  /** The production call it was built on. */
  productionLatencyMs: number;
  usage: Usage;
  fields: Record<string, unknown>;
}

export interface SampleRun {
  production: ProductionRun;
  layout: LayoutRecord;
  ocr: OcrRun;
  repair: RepairRun;
  cu: CuRun;
}

export const kind = (prefix: string, part: PlanBArm | "layout", rep: number): string =>
  `plan-b/${prefix}${part}-r${rep}`;

export const repExists = (prefix: string, rep: number): boolean =>
  PLAN_B_ARMS.some((arm) => existsSync(join(CACHE_DIR, kind(prefix, arm, rep))));

export function readRun(prefix: string, rep: number, sample: Sample): Partial<SampleRun> {
  const read = <T>(part: PlanBArm | "layout"): T | undefined =>
    readCache<T>(kind(prefix, part, rep), sample.name) ?? undefined;
  const run: Partial<SampleRun> = {};
  const production = read<ProductionRun>("production");
  const layout = read<LayoutRecord>("layout");
  const ocr = read<OcrRun>("ocr");
  const repair = read<RepairRun>("repair");
  const cu = read<CuRun>("cu");
  if (production) run.production = production;
  // The `ocr` arm is recorded only when both its layout and its model call are.
  if (layout && ocr) Object.assign(run, { layout, ocr });
  if (repair) run.repair = repair;
  if (cu) run.cu = cu;
  return run;
}

export interface ArmCost {
  /** End to end: what a user would wait for this arm's result. */
  latencyMs: number;
  usdBilled: number;
  usdUncached: number;
  usage?: Usage;
}

/** Each recorded arm's end-to-end latency and its whole cost for one receipt. */
export function costs(run: Partial<SampleRun>): Partial<Record<PlanBArm, ArmCost>> {
  const out: Partial<Record<PlanBArm, ArmCost>> = {};
  const productionUsd = run.production ? productionPages(run.production) * PRICE.diPage : 0;
  if (run.production) {
    out.production = {
      latencyMs: run.production.latencyMs,
      usdBilled: productionUsd,
      usdUncached: productionUsd,
    };
  }
  if (run.ocr) {
    out.ocr = {
      latencyMs: run.ocr.latencyMs + run.ocr.extraMs,
      usdBilled: modelUsd(run.ocr.usage) + run.ocr.extraUsd,
      usdUncached: modelUsd(run.ocr.usage, false) + run.ocr.extraUsd,
      usage: run.ocr.usage,
    };
  }
  // The pass runs after production and cannot start before it ends, so it costs both.
  if (run.repair) {
    out.repair = {
      latencyMs: run.repair.latencyMs + run.repair.productionLatencyMs,
      usdBilled: modelUsd(run.repair.usage) + productionUsd,
      usdUncached: modelUsd(run.repair.usage, false) + productionUsd,
      usage: run.repair.usage,
    };
  }
  if (run.cu) {
    out.cu = {
      latencyMs: run.cu.latencyMs,
      usdBilled: cuUsd(run.cu.operation.usage),
      usdUncached: cuUsd(run.cu.operation.usage, false),
    };
  }
  return out;
}

const quantile = (xs: number[], q: number): number =>
  xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** One markdown table: per arm, what is recorded under `prefix` for these samples. */
export function costTable(prefix: string, samples: readonly Sample[]): string[] {
  const perArm = new Map<PlanBArm, ArmCost[]>(PLAN_B_ARMS.map((arm) => [arm, []]));
  for (let rep = 1; repExists(prefix, rep); rep++) {
    for (const sample of samples) {
      for (const [arm, cost] of Object.entries(costs(readRun(prefix, rep, sample)))) {
        perArm.get(arm as PlanBArm)!.push(cost);
      }
    }
  }
  const lines = [
    "| arm | n | input tokens, median (cached, mean) | output tokens, median | latency p50 / p90 | $ a receipt, billed | $ without caching |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [arm, rows] of perArm) {
    const usages = rows.flatMap((r) => (r.usage ? [r.usage] : []));
    const tokens = usages.length
      ? [
          `${Math.round(
            quantile(
              usages.map((u) => u.prompt_tokens),
              0.5,
            ),
          )} (${Math.round(mean(usages.map((u) => u.prompt_tokens_details?.cached_tokens ?? 0)))})`,
          String(
            Math.round(
              quantile(
                usages.map((u) => u.completion_tokens),
                0.5,
              ),
            ),
          ),
        ]
      : ["–", "–"];
    const ms = rows.map((r) => r.latencyMs);
    lines.push(
      `| \`${arm}\` | ${rows.length} | ${tokens.join(" | ")} | ` +
        (rows.length
          ? `${seconds(quantile(ms, 0.5))} / ${seconds(quantile(ms, 0.9))} | ` +
            `${mean(rows.map((r) => r.usdBilled)).toFixed(4)} | ${mean(rows.map((r) => r.usdUncached)).toFixed(4)} |`
          : "– | – | – |"),
    );
  }
  return lines;
}
