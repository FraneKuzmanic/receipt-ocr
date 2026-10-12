/**
 * What the paid runs cost, worked out from what is recorded under .bakeoff/, and the guard
 * that stops a run before it would pass the agreed cap.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cuUsd, type CuUsage } from "./content-understanding.ts";
import type { Usage } from "./model-input.ts";
import { CACHE_DIR } from "./samples.ts";

// USD, list prices: gpt-4.1 on Azure per 1M tokens; Document Intelligence per page; Content
// Understanding per page and per 1M contextualization tokens.
export const PRICE = {
  input: 2.0,
  cachedInput: 0.5,
  output: 8.0,
  layoutPage: 0.01,
  readPage: 0.0015,
  diPage: 0.01,
  cuPage: 0.005,
  cuContextualization: 1.0,
};
export const PRICE_NOTE =
  "List prices, not checked against the invoice: gpt-4.1 $2.00 / $0.50 cached / $8.00 per 1M tokens; " +
  "prebuilt-layout, prebuilt-invoice and prebuilt-receipt taken at $0.01 per page each; " +
  "Content Understanding $0.005 per page and $1.00 per 1M contextualization tokens.";

/** Per 1M tokens, for a deployment other than gpt-4.1. */
const MODEL_PRICE: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
};

/** A call nothing has been recorded for yet is assumed to cost this much. */
const UNSEEN_CALL_USD: Record<string, number> = { production: 0.02, cu: 0.035 };
const UNSEEN_MODEL_CALL_USD = 0.015;

export function modelUsd(usage: Usage, billed = true, deployment?: string): number {
  const price = MODEL_PRICE[deployment ?? ""] ?? PRICE;
  const cached = billed ? (usage.prompt_tokens_details?.cached_tokens ?? 0) : 0;
  return (
    ((usage.prompt_tokens - cached) * price.input +
      cached * price.cachedInput +
      usage.completion_tokens * price.output) /
    1e6
  );
}

interface Recorded {
  total: number;
  /** Cost of every recorded call, by arm ("boxes" for the box run), layout calls apart. */
  byArm: Map<string, number[]>;
}

/**
 * Every record under `dir`, whatever its tag: probes and failed sittings were paid for too.
 * Each experiment has its own cap, so each passes its own directory.
 */
export function recordedSpend(dir = CACHE_DIR): Recorded {
  const recorded: Recorded = { total: 0, byArm: new Map() };
  const add = (arm: string, usd: number): void => {
    recorded.total += usd;
    recorded.byArm.set(arm, [...(recorded.byArm.get(arm) ?? []), usd]);
  };
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".json")) {
        const record = JSON.parse(readFileSync(path, "utf8")) as {
          arm?: string;
          usage?: Usage;
          modelId?: string;
          deployment?: string;
          operation?: { analyzeResult?: { pages?: unknown[] }; usage?: CuUsage };
          raw?: { analyzeResult?: { pages?: unknown[] } };
          metadata?: { secondaryModelId?: string | null };
          submitAttempts?: number;
        };
        if (record.modelId === "prebuilt-layout" || record.modelId === "prebuilt-read") {
          recorded.total +=
            (record.operation?.analyzeResult?.pages?.length ?? 1) *
            (record.modelId === "prebuilt-read" ? PRICE.readPage : PRICE.layoutPage);
        } else if (record.arm === "production") {
          // Every page, once per prebuilt model that read it.
          const models = record.metadata?.secondaryModelId ? 2 : 1;
          add(
            "production",
            (record.raw?.analyzeResult?.pages?.length ?? 1) * models * PRICE.diPage,
          );
        } else if (record.arm === "cu") {
          // A submit abandoned as stalled may still have been analysed, so it is counted as one.
          add("cu", cuUsd(record.operation?.usage) * (record.submitAttempts ?? 1));
        } else if (record.usage) {
          add(record.arm ?? "boxes", modelUsd(record.usage, true, record.deployment));
        }
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return recorded;
}

/**
 * Prints the recorded spend and the estimate for what is about to run, and exits if the two
 * together would pass the cap. `calls` names the arm of every call still to be made, and
 * `extraUsd` is what they cost beyond that (the `ocr` arm's layout pages).
 */
export function guardSpend(
  label: string,
  calls: string[],
  extraUsd: number,
  cap: number,
  dir = CACHE_DIR,
): void {
  const recorded = recordedSpend(dir);
  const mean = (arm: string): number => {
    const seen = recorded.byArm.get(arm);
    return seen?.length
      ? seen.reduce((a, b) => a + b, 0) / seen.length
      : (UNSEEN_CALL_USD[arm] ?? UNSEEN_MODEL_CALL_USD);
  };
  const estimate = calls.reduce((sum, arm) => sum + mean(arm), 0) + extraUsd;
  console.log(
    `  ${label}: ${calls.length} calls, estimated $${estimate.toFixed(2)}; ` +
      `recorded so far $${recorded.total.toFixed(2)}; cap $${cap.toFixed(2)}`,
  );
  if (recorded.total + estimate > cap) {
    console.error(`\n  This would pass the $${cap.toFixed(2)} cap. Stopping before any call.\n`);
    process.exit(1);
  }
}

export function requireConfirmation(): void {
  if (process.argv.includes("--confirm-spend")) return;
  console.error("\n  This makes paid Azure calls. Re-run with --confirm-spend to proceed.\n");
  process.exit(1);
}
