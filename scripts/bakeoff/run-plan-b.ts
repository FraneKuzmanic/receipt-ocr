/**
 * Plan B: the production engine, an LLM on OCR text, an LLM pass on production's output, and
 * Content Understanding, on the same receipts, each given the file the app would upload.
 *
 *   production  the product's own provider, called live
 *   ocr         DI layout markdown -> the completion model -> every field
 *   repair      production's OCR text and values -> the completion model -> the scalar fields
 *   cu          one Content Understanding analyzer built from the same field schema
 *
 * `production` runs first for each receipt, because `repair` is built on it. The other three
 * follow in an order that rotates, sequentially, so one sitting's service speed applies to all.
 * Records go to .bakeoff/plan-b/<arm>-r<rep>/ and are scored with score-plan-b.ts.
 * `--summary` prints tokens, latency and cost from what is recorded, without a call.
 */
import { ANALYZER_ID, analyze, ensureAnalyzer, ensureDefaults } from "./content-understanding.ts";
import { SCHEMA, SYSTEM } from "./field-schema.ts";
import { uploadInput } from "./inputs.ts";
import { analyzeLayout } from "./layout.ts";
import { complete } from "./model-input.ts";
import {
  PLAN_B_ARMS,
  PLAN_B_DIR,
  costTable,
  costs,
  kind,
  readRun,
  type CuRun,
  type OcrRun,
  type PlanBArm,
  type ProductionRun,
  type RepairRun,
} from "./plan-b-records.ts";
import { productionText, runProduction } from "./production.ts";
import { REPAIR_SCHEMA, REPAIR_SYSTEM, repairContent } from "./repair.ts";
import { SAMPLES, fmtMs, writeCache, type Sample } from "./samples.ts";
import { PRICE, PRICE_NOTE, guardSpend, recordedSpend, requireConfirmation } from "./spend.ts";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const reps = Number(arg("reps") ?? 3);
const only = arg("only")?.split(",");
const cap = Number(arg("cap") ?? 5);
const force = process.argv.includes("--force");
const prefix = arg("tag") ? `${arg("tag")}-` : "";
const arms = (arg("arms")?.split(",") ?? [...PLAN_B_ARMS]) as PlanBArm[];
const samples = SAMPLES.filter((s) => !only || only.includes(s.name));

const isRecorded = (arm: PlanBArm, rep: number, s: Sample): boolean =>
  readRun(prefix, rep, s)[arm] !== undefined;

async function runArm(arm: PlanBArm, rep: number, s: Sample): Promise<string> {
  const input = await uploadInput(s);
  const stamp = { sample: s.name, rep, downscaled: input.downscaled };

  if (arm === "production") {
    const record: ProductionRun = { ...(await runProduction(input)), ...stamp };
    writeCache(kind(prefix, "production", rep), s.name, record);
  } else if (arm === "ocr") {
    const layout = await analyzeLayout(input.bytes);
    writeCache(kind(prefix, "layout", rep), s.name, layout);
    const result = layout.operation.analyzeResult;
    const { json, usage, latencyMs } = await complete(
      SYSTEM,
      `<dokument>\n${result?.content ?? ""}\n</dokument>`,
      SCHEMA,
    );
    const record: OcrRun = {
      ...stamp,
      arm: "ocr",
      latencyMs,
      extraMs: layout.latencyMs,
      extraUsd: (result?.pages?.length ?? 1) * PRICE.layoutPage,
      usage,
      fields: json,
    };
    writeCache(kind(prefix, "ocr", rep), s.name, record);
  } else if (arm === "repair") {
    const production = readRun(prefix, rep, s).production;
    if (!production) throw new Error("skipped: this run has no production record to build on");
    const { json, usage, latencyMs } = await complete(
      REPAIR_SYSTEM,
      repairContent(productionText(production), production.fields),
      REPAIR_SCHEMA,
    );
    const record: RepairRun = {
      ...stamp,
      arm: "repair",
      latencyMs,
      productionLatencyMs: production.latencyMs,
      usage,
      fields: json,
    };
    writeCache(kind(prefix, "repair", rep), s.name, record);
  } else {
    const record: CuRun = { ...(await analyze(input.bytes, input.contentType)), ...stamp };
    writeCache(kind(prefix, "cu", rep), s.name, record);
  }

  const cost = costs(readRun(prefix, rep, s))[arm]!;
  return `${fmtMs(cost.latencyMs).padStart(6)}  $${cost.usdBilled.toFixed(4)}`;
}

function summary(): void {
  console.log(`\n${costTable(prefix, samples).join("\n")}\n`);
  console.log(
    `  Latency is end to end: 'ocr' includes its layout call, 'repair' the production call it\n` +
      `  follows, 'cu' any stalled submit. Cost is the whole arm's: 'repair' includes production.\n` +
      `  ${PRICE_NOTE}\n` +
      `  Recorded spend, every run and probe under .bakeoff/plan-b/: $${recordedSpend(PLAN_B_DIR).total.toFixed(2)} of a $${cap.toFixed(2)} cap\n`,
  );
}

if (process.argv.includes("--summary")) {
  summary();
} else {
  requireConfirmation();
  console.log(`\nPlan B: ${arms.join(", ")} x ${reps} run(s) x ${samples.length} samples\n`);
  if (arms.includes("cu")) {
    const registered = await ensureDefaults();
    console.log(`  Content Understanding defaults: ${registered.toSorted().join(", ")}`);
    const state = await ensureAnalyzer({
      recreate: process.argv.includes("--recreate-analyzer"),
    });
    console.log(`  analyzer '${ANALYZER_ID}' ${state}\n`);
  }

  for (let rep = 1; rep <= reps; rep++) {
    const todo = samples.flatMap((s) => arms.filter((arm) => force || !isRecorded(arm, rep, s)));
    // One layout page each: both PDFs in the corpus are single-page.
    guardSpend(
      `run ${rep}`,
      todo,
      todo.filter((arm) => arm === "ocr").length * PRICE.layoutPage,
      cap,
      PLAN_B_DIR,
    );

    for (const [index, s] of samples.entries()) {
      const rest = arms.filter((arm) => arm !== "production");
      const first = (index + rep) % (rest.length || 1);
      const order = [
        ...arms.filter((arm) => arm === "production"),
        ...rest.slice(first),
        ...rest.slice(0, first),
      ];
      for (const arm of order) {
        const tag = `  r${rep} ${s.name.padEnd(34)} ${arm.padEnd(10)}`;
        if (!force && isRecorded(arm, rep, s)) {
          console.log(`${tag} recorded`);
          continue;
        }
        try {
          console.log(`${tag} ${await runArm(arm, rep, s)}`);
        } catch (err) {
          console.log(`${tag} FAILED  ${(err as Error).message.slice(0, 180)}`);
        }
      }
    }
  }
  summary();
}
