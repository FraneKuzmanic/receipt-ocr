/**
 * The `cu` arm: Azure AI Content Understanding, one custom analyzer built from the field schema
 * every other arm is given. Ported from payslip-ocr's harness; plain fetch, no SDK.
 *
 * Its values come back as printed, so they go through `normalize.ts` like the LLM arms'.
 */
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { RECEIPT_FIELDS, SHARED_RULES, type FieldDef } from "./field-schema.ts";
import type { LayoutPage, LayoutWord } from "./ground.ts";
import { requireEnv } from "./samples.ts";
import { PRICE } from "./spend.ts";

/** Underscores only: the service rejects a hyphen in an analyzer id. */
export const ANALYZER_ID = "receipt_planb_v2";
/** The service asks for an embedding deployment as well as the completion one. */
const EMBEDDING_MODEL = "text-embedding-3-large";
const POLL_INTERVAL_MS = 500;
const ANALYZE_DEADLINE_MS = 300_000;
// The service intermittently sits on a submit for ~30 s before answering 202 (payslip-ocr's
// bake-off); it clears on a retry, so a submit is abandoned after this long and sent again.
const SUBMIT_TIMEOUT_MS = 5000;
const SUBMIT_TRIES = 4;

interface Service {
  base: string;
  apiVersion: string;
  headers: Record<string, string>;
  completionModel: string;
}

// Read when called, not when imported: spend.ts imports this module for iteration 25's commands
// too, which run without these variables.
function service(): Service {
  return {
    base: `${requireEnv("AZURE_CONTENT_UNDERSTANDING_ENDPOINT").replace(/\/$/, "")}/contentunderstanding`,
    apiVersion: requireEnv("AZURE_CU_API_VERSION"),
    headers: { "Ocp-Apim-Subscription-Key": requireEnv("AZURE_CONTENT_UNDERSTANDING_KEY") },
    completionModel: requireEnv("AZURE_OPENAI_DEPLOYMENT"),
  };
}

/** Our FieldDef tree -> the service's field schema. The descriptions are every other arm's. */
export function toCuField(def: FieldDef): Record<string, unknown> {
  if (def.type === "array" && def.items) {
    return {
      type: "array",
      method: "extract",
      description: def.description,
      items: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(def.items).map(([name, cell]) => [
            name,
            { type: "string", method: "extract", description: cell.description },
          ]),
        ),
      },
    };
  }
  return { type: "string", method: "extract", description: def.description };
}

export function analyzerDefinition(completionModel: string) {
  return {
    baseAnalyzerId: "prebuilt-document",
    description: `Hrvatski fiskalni račun.\n\n${SHARED_RULES}`,
    // Named here as well as in the resource's defaults: the build resolves it from the definition.
    models: { completion: completionModel },
    config: {
      returnDetails: true,
      estimateFieldSourceAndConfidence: true,
      enableLayout: true,
      enableOcr: true,
      enableFormula: false,
    },
    fieldSchema: {
      name: "HrReceipt",
      description: "Polja hrvatskog fiskalnog računa",
      fields: Object.fromEntries(
        Object.entries(RECEIPT_FIELDS).map(([name, def]) => [name, toCuField(def)]),
      ),
    },
  };
}

async function pollOperation(
  url: string,
  headers: Record<string, string>,
  label: string,
): Promise<CuOperation> {
  const deadline = Date.now() + ANALYZE_DEADLINE_MS;
  for (;;) {
    await delay(POLL_INTERVAL_MS);
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`${label} poll: HTTP ${response.status}`);
    const body = (await response.json()) as CuOperation;
    const status = String(body.status ?? "").toLowerCase();
    if (status === "succeeded") return body;
    if (status === "failed" || status === "canceled") {
      throw new Error(`${label} ${status}: ${JSON.stringify(body.error ?? {}).slice(0, 300)}`);
    }
    if (Date.now() > deadline) throw new Error(`${label} timed out`);
  }
}

/**
 * The resource's model registrations, completed when one is missing and merged with what is
 * there, so a registration another project relies on is never dropped.
 */
export async function ensureDefaults(): Promise<string[]> {
  const { base, apiVersion, headers, completionModel } = service();
  const url = `${base}/defaults?api-version=${apiVersion}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET defaults: HTTP ${response.status}`);
  const current =
    ((await response.json()) as { modelDeployments?: Record<string, string> }).modelDeployments ??
    {};
  const missing = [completionModel, EMBEDDING_MODEL].filter((model) => !(model in current));
  if (missing.length === 0) return Object.keys(current);

  const modelDeployments = { ...current, ...Object.fromEntries(missing.map((m) => [m, m])) };
  const patch = await fetch(url, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/merge-patch+json" },
    body: JSON.stringify({ modelDeployments }),
  });
  if (!patch.ok) throw new Error(`PATCH defaults: HTTP ${patch.status}`);
  return Object.keys(modelDeployments);
}

/**
 * Builds the analyzer when it does not exist. One that exists and differs from the code throws
 * unless `recreate`: every record made with a stale analyzer would be scored as this one's.
 */
export async function ensureAnalyzer(options: { recreate?: boolean } = {}): Promise<string> {
  const { base, apiVersion, headers, completionModel } = service();
  const url = `${base}/analyzers/${ANALYZER_ID}?api-version=${apiVersion}`;
  const expected = analyzerDefinition(completionModel);

  const existing = await fetch(url, { headers });
  if (existing.ok) {
    const deployed = (await existing.json()) as {
      description?: string;
      config?: Record<string, unknown>;
      fieldSchema?: { fields?: Record<string, unknown> };
    };
    // The service echoes defaults the code does not set, so only the keys set here are compared.
    const same =
      deployed.description === expected.description &&
      Object.entries(expected.config).every(([name, value]) =>
        isDeepStrictEqual(deployed.config?.[name], value),
      ) &&
      isDeepStrictEqual(deployed.fieldSchema?.fields, expected.fieldSchema.fields);
    if (same) return "reused";
    if (!options.recreate) {
      throw new Error(
        `analyzer '${ANALYZER_ID}' exists and differs from the code; --recreate-analyzer rebuilds it and makes every cu record stale`,
      );
    }
    const deleted = await fetch(url, { method: "DELETE", headers });
    if (!deleted.ok) throw new Error(`DELETE analyzer: HTTP ${deleted.status}`);
  } else if (existing.status !== 404) {
    throw new Error(`GET analyzer: HTTP ${existing.status}`);
  }

  const created = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(expected),
  });
  if (!created.ok) {
    throw new Error(
      `PUT analyzer: HTTP ${created.status}: ${(await created.text()).slice(0, 400)}`,
    );
  }
  const operation = created.headers.get("operation-location");
  if (operation) await pollOperation(operation, headers, "analyzer build");
  return "built";
}

interface CuValue {
  type?: string;
  valueString?: string;
  confidence?: number;
  source?: string;
  valueArray?: { valueObject?: Record<string, CuValue> }[];
}

export interface CuUsage {
  documentPagesStandard?: number;
  contextualizationTokens?: number;
  tokens?: Record<string, number>;
}

export interface CuOperation {
  status?: string;
  error?: unknown;
  result?: {
    contents?: {
      fields?: Record<string, CuValue>;
      pages?: {
        pageNumber: number;
        width: number;
        height: number;
        words?: { content: string; source?: string }[];
      }[];
    }[];
  };
  usage?: CuUsage;
}

export interface CuRecord {
  arm: "cu";
  analyzerId: string;
  apiVersion: string;
  /** Submit through result, stalled submits included. */
  latencyMs: number;
  /** An abandoned submit may still have been analysed and billed. */
  submitAttempts: number;
  operation: CuOperation;
}

export async function analyze(bytes: Buffer, contentType: string): Promise<CuRecord> {
  const { base, apiVersion, headers } = service();
  const started = Date.now();
  // `:analyze` takes a URL only; a local file that must not be published goes to `:analyzeBinary`.
  const url = `${base}/analyzers/${ANALYZER_ID}:analyzeBinary?api-version=${apiVersion}`;
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "TimeoutError")) throw error;
      if (attempt === SUBMIT_TRIES) {
        throw new Error(`submit stalled on all ${SUBMIT_TRIES} tries`, { cause: error });
      }
      continue;
    }
    if (!response.ok) {
      throw new Error(`analyze HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const operationUrl = response.headers.get("operation-location");
    if (!operationUrl) throw new Error("analyze: no operation-location");
    const operation = await pollOperation(operationUrl, headers, "analyze");
    return {
      arm: "cu",
      analyzerId: ANALYZER_ID,
      apiVersion,
      latencyMs: Date.now() - started,
      submitAttempts: attempt,
      operation,
    };
  }
}

const SEGMENT = /^D\((\d+),([^()]*)\)$/;

/** The first `D(page,x1,y1,…,x4,y4)` segment of a source, or null. */
function firstSegment(source: string | undefined): { page: number; numbers: number[] } | null {
  const match = SEGMENT.exec((source ?? "").split(";")[0]!.trim());
  if (match === null) return null;
  const numbers = (match[2] ?? "").split(",").map(Number);
  if (numbers.length !== 8 || !numbers.every(Number.isFinite)) return null;
  return { page: Number(match[1]), numbers };
}

/**
 * Rows top to bottom by their first sourced cell. The service returns a table's rows in an
 * order that varies between runs of one document, and asking for printed order does not stop it.
 * A row with no source keeps its place in the list.
 */
function inPrintedOrder<Row extends { valueObject?: Record<string, CuValue> }>(rows: Row[]): Row[] {
  const place = (row: Row): [number, number] | null => {
    for (const cell of Object.values(row.valueObject ?? {})) {
      const segment = firstSegment(cell.source);
      if (segment) return [segment.page, Math.min(...[1, 3, 5, 7].map((i) => segment.numbers[i]!))];
    }
    return null;
  };
  const entries = rows.map((row, index) => ({ row, index, place: place(row) }));
  const placed = entries
    .filter((entry) => entry.place !== null)
    .toSorted(
      (a, b) => a.place![0] - b.place![0] || a.place![1] - b.place![1] || a.index - b.index,
    );
  let next = 0;
  return entries.map((entry) => (entry.place === null ? entry.row : placed[next++]!.row));
}

const contentOf = (operation: CuOperation) => operation.result?.contents?.[0];

/** The analyzer's fields in the printed-value shape `normalize` takes. */
export function cuFields(operation: CuOperation): Record<string, unknown> {
  const returned = contentOf(operation)?.fields ?? {};
  return Object.fromEntries(
    Object.entries(RECEIPT_FIELDS).map(([name, def]) => {
      const value = returned[name];
      if (def.type !== "array") return [name, value?.valueString ?? null];
      return [
        name,
        inPrintedOrder(value?.valueArray ?? []).map((row) =>
          Object.fromEntries(
            Object.keys(def.items ?? {}).map((cell) => [
              cell,
              row.valueObject?.[cell]?.valueString ?? null,
            ]),
          ),
        ),
      ];
    }),
  );
}

/** Per scalar field with a value: the confidence and whether a position came with it. */
export function cuDetails(
  operation: CuOperation,
): Record<string, { confidence: number | null; sourced: boolean }> {
  const returned = contentOf(operation)?.fields ?? {};
  return Object.fromEntries(
    Object.entries(returned)
      .filter(([, value]) => value.type !== "array" && value.valueString != null)
      .map(([name, value]) => [
        name,
        { confidence: value.confidence ?? null, sourced: firstSegment(value.source) !== null },
      ]),
  );
}

/** The service's own OCR words, in the shape `ground.ts` searches. */
export function cuWords(operation: CuOperation): { words: LayoutWord[]; pages: LayoutPage[] } {
  const source = contentOf(operation)?.pages ?? [];
  const words: LayoutWord[] = [];
  for (const page of source) {
    for (const word of page.words ?? []) {
      const segment = firstSegment(word.source);
      if (segment) {
        words.push({
          content: word.content,
          polygon: segment.numbers,
          pageNumber: page.pageNumber,
        });
      }
    }
  }
  return {
    words,
    pages: source.map((p) => ({ pageNumber: p.pageNumber, width: p.width, height: p.height })),
  };
}

/**
 * One analysis at list prices: $5 per 1,000 pages, $1 per 1M contextualization tokens, and the
 * completion model's tokens. Cached tokens are reported inside the input count.
 */
export function cuUsd(usage: CuUsage | undefined, billed = true): number {
  let input = 0;
  let cached = 0;
  let output = 0;
  for (const [name, count] of Object.entries(usage?.tokens ?? {})) {
    if (name.endsWith("-cached-input")) cached += count;
    else if (name.endsWith("-input")) input += count;
    else if (name.endsWith("-output")) output += count;
  }
  if (!billed) cached = 0;
  return (
    (usage?.documentPagesStandard ?? 0) * PRICE.cuPage +
    ((usage?.contextualizationTokens ?? 0) * PRICE.cuContextualization +
      Math.max(0, input - cached) * PRICE.input +
      cached * PRICE.cachedInput +
      output * PRICE.output) /
      1e6
  );
}
