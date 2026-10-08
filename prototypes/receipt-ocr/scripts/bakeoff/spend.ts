/**
 * What the paid runs cost, worked out from what is recorded under .bakeoff/, and the guard
 * that stops a run before it would pass the agreed cap.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Usage } from "./model-input.ts";
import { CACHE_DIR } from "./samples.ts";

// USD, list prices: gpt-4.1 on Azure per 1M tokens, and DI prebuilt-layout per page.
export const PRICE = { input: 2.0, cachedInput: 0.5, output: 8.0, layoutPage: 0.01 };
export const PRICE_NOTE =
  "List prices, not checked against the invoice: gpt-4.1 $2.00 / $0.50 cached / $8.00 per 1M tokens; prebuilt-layout $0.01 per page.";

/** A call nothing has been recorded for yet is assumed to cost this much. */
const UNSEEN_CALL_USD = 0.015;

export function modelUsd(usage: Usage, billed = true): number {
  const cached = billed ? (usage.prompt_tokens_details?.cached_tokens ?? 0) : 0;
  return (
    ((usage.prompt_tokens - cached) * PRICE.input +
      cached * PRICE.cachedInput +
      usage.completion_tokens * PRICE.output) /
    1e6
  );
}

interface Recorded {
  total: number;
  /** Model cost of every recorded call, by arm ("boxes" for the box run). */
  byArm: Map<string, number[]>;
}

/** Every record under .bakeoff/, whatever its tag: probes and failed sittings were paid for too. */
export function recordedSpend(): Recorded {
  const recorded: Recorded = { total: 0, byArm: new Map() };
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".json")) {
        const record = JSON.parse(readFileSync(path, "utf8")) as {
          arm?: string;
          usage?: Usage;
          modelId?: string;
          operation?: { analyzeResult?: { pages?: unknown[] } };
        };
        if (record.modelId === "prebuilt-layout") {
          recorded.total +=
            (record.operation?.analyzeResult?.pages?.length ?? 1) * PRICE.layoutPage;
        } else if (record.usage) {
          const usd = modelUsd(record.usage);
          recorded.total += usd;
          const arm = record.arm ?? "boxes";
          recorded.byArm.set(arm, [...(recorded.byArm.get(arm) ?? []), usd]);
        }
      }
    }
  };
  if (existsSync(CACHE_DIR)) walk(CACHE_DIR);
  return recorded;
}

/**
 * Prints the recorded spend and the estimate for what is about to run, and exits if the two
 * together would pass the cap. `calls` names the arm of every model call still to be made.
 */
export function guardSpend(label: string, calls: string[], layoutPages: number, cap: number): void {
  const recorded = recordedSpend();
  const mean = (arm: string): number => {
    const seen = recorded.byArm.get(arm);
    return seen?.length ? seen.reduce((a, b) => a + b, 0) / seen.length : UNSEEN_CALL_USD;
  };
  const estimate = calls.reduce((sum, arm) => sum + mean(arm), 0) + layoutPages * PRICE.layoutPage;
  console.log(
    `  ${label}: ${calls.length} model calls, ${layoutPages} layout pages, estimated $${estimate.toFixed(2)}; ` +
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
