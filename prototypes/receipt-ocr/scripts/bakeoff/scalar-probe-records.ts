/**
 * What the scalar probe's runner writes and its scorer reads.
 *
 * A configuration is a text source and a completion deployment. Run 1 is the parallel run: for
 * each receipt, production and both text sources start together, and each model call starts when
 * its text arrives, so every record of run 1 carries the time it finished after that common
 * start. Runs 2 and up repeat the model calls alone, on run 1's text.
 */
import { join } from "node:path";
import type { LayoutRecord, TextModel } from "./layout.ts";
import type { Usage } from "./model-input.ts";
import type { ProductionRecord } from "./production.ts";
import { CACHE_DIR, SAMPLES, readCache, type Sample } from "./samples.ts";

export const PROBE_DIR = join(CACHE_DIR, "scalar-probe");

export const SOURCES = ["layout", "read"] as const;
export type Source = (typeof SOURCES)[number];
export const TEXT_MODEL: Record<Source, TextModel> = {
  layout: "prebuilt-layout",
  read: "prebuilt-read",
};
export const DEPLOYMENTS = ["gpt-4.1", "gpt-4.1-mini"] as const;
export type Deployment = (typeof DEPLOYMENTS)[number];

export interface Config {
  source: Source;
  deployment: Deployment;
}
export const CONFIGS: readonly Config[] = SOURCES.flatMap((source) =>
  DEPLOYMENTS.map((deployment) => ({ source, deployment })),
);
export const configName = (c: Config): string => `${c.source}+${c.deployment}`;

/** A second receipt production was not tuned on. Its truth is scored apart until verified. */
export const AMELIE: Sample = {
  name: "amelie-receipt",
  sourceFile: "amelie-receipt.jpg",
  contentType: "image/jpeg",
  sourceKind: "image",
};
export const PROBE_SAMPLES: readonly Sample[] = [...SAMPLES, AMELIE];

export type ProbeProduction = ProductionRecord & { sample: string; doneMs: number };
export type ProbeText = LayoutRecord & { sample: string; doneMs: number };
export interface ProbeLlm {
  arm: "scalar";
  sample: string;
  rep: number;
  source: Source;
  deployment: Deployment;
  /** The model call alone. */
  latencyMs: number;
  /** Run 1 only: when the call finished, counted from the receipt's common start. */
  doneMs?: number;
  usage: Usage;
  fields: Record<string, unknown>;
}

export const productionKind = (prefix: string): string => `scalar-probe/${prefix}production-r1`;
export const textKind = (prefix: string, source: Source): string =>
  `scalar-probe/${prefix}text-${source}-r1`;
export const llmKind = (prefix: string, c: Config, rep: number): string =>
  `scalar-probe/${prefix}llm-${c.source}-${c.deployment}-r${rep}`;

export const readProduction = (prefix: string, s: Sample): ProbeProduction | null =>
  readCache<ProbeProduction>(productionKind(prefix), s.name);
export const readText = (prefix: string, source: Source, s: Sample): ProbeText | null =>
  readCache<ProbeText>(textKind(prefix, source), s.name);
export const readLlm = (prefix: string, c: Config, rep: number, s: Sample): ProbeLlm | null =>
  readCache<ProbeLlm>(llmKind(prefix, c, rep), s.name);
