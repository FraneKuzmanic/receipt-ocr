/**
 * The OCR step of the `ocr` arm: Azure Document Intelligence `prebuilt-layout`, returning
 * markdown for the model to read and word polygons for the box test to judge against.
 *
 * Its time is part of that arm's result, so it is called the way production calls Azure: raw
 * bytes, then a poll every 500 ms. The SDK's own poller waits out Azure's multi-second
 * `retry-after` instead, which would be measured as OCR time.
 */
import { setTimeout as delay } from "node:timers/promises";
import DocumentIntelligence, { isUnexpected } from "@azure-rest/ai-document-intelligence";
import { requireEnv } from "./samples.ts";

const API_VERSION = "2024-11-30";
export type TextModel = "prebuilt-layout" | "prebuilt-read";
const POLL_INTERVAL_MS = 500;

export interface LayoutOperation {
  analyzeResult?: {
    content?: string;
    pages?: {
      pageNumber: number;
      width: number;
      height: number;
      words?: { content: string; polygon: number[] }[];
    }[];
  };
}

export interface LayoutRecord {
  latencyMs: number;
  uploadMs: number;
  analyzeMs: number;
  apiVersion: string;
  modelId: string;
  operation: LayoutOperation;
}

/** `prebuilt-read` returns plain text: only the layout model can be asked for markdown. */
export async function analyzeLayout(
  bytes: Buffer,
  modelId: TextModel = "prebuilt-layout",
): Promise<LayoutRecord> {
  const client = DocumentIntelligence(
    requireEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"),
    { key: requireEnv("AZURE_DOCUMENT_INTELLIGENCE_KEY") },
    { apiVersion: API_VERSION },
  );
  const started = Date.now();
  const initial = await client.path("/documentModels/{modelId}:analyze", modelId).post({
    contentType: "application/octet-stream",
    body: bytes,
    queryParameters: {
      ...(modelId === "prebuilt-layout" ? { outputContentFormat: "markdown" as const } : {}),
      locale: "hr-HR",
    },
  });
  const uploadMs = Date.now() - started;
  if (isUnexpected(initial)) throw new Error(`layout submit: HTTP ${initial.status}`);

  const resultId = new URL(initial.headers["operation-location"]).pathname.split("/").at(-1);
  if (!resultId) throw new Error("layout submit: no operation id");

  for (;;) {
    await delay(POLL_INTERVAL_MS);
    const poll = await client
      .path("/documentModels/{modelId}/analyzeResults/{resultId}", modelId, resultId)
      .get();
    if (isUnexpected(poll)) throw new Error(`layout poll: HTTP ${poll.status}`);
    const operation = poll.body;
    if (operation.status === "notStarted" || operation.status === "running") continue;
    if (operation.status !== "succeeded") throw new Error(`layout ${operation.status}`);
    const latencyMs = Date.now() - started;
    return {
      latencyMs,
      uploadMs,
      analyzeMs: latencyMs - uploadMs,
      apiVersion: API_VERSION,
      modelId,
      operation: operation as LayoutOperation,
    };
  }
}
