import { setTimeout as delay } from "node:timers/promises";
import DocumentIntelligence, {
  isUnexpected,
  type AnalyzeResultOutput,
  type DocumentIntelligenceClient,
} from "@azure-rest/ai-document-intelligence";
import type { CanonicalReceiptFields } from "@receipt/shared";
import { config } from "../../config.js";
import {
  findDocumentNumber,
  findIssueDate,
  findIssueTime,
  findJir,
  findLabelledOib,
  findOib,
  findZki,
} from "./croatian.js";
import { mapAnalyzeResult } from "./azure-fields.js";
import { mergeExtractions, type ModelExtraction } from "./merge.js";
import { logger } from "../../logger.js";
import { stripContentMarkers, type StrippedContent } from "./content-markers.js";
import { hasUnreadVatSignal } from "./tax-signals.js";
import { findPaymentMethod } from "./payment-method.js";
import { parseFiscalQr, type FiscalQrData } from "./fiscal-qr.js";
import { mergeScalars } from "./scalar-merge.js";
import type { ScalarReader } from "./scalar-reader.js";
import {
  ExtractionError,
  type DocumentExtractionProvider,
  type ExtractionFieldMetadata,
  type ExtractionInput,
} from "./types.js";

export const AZURE_API_VERSION = "2024-11-30";

// Azure answers every status poll with a multi-second `retry-after` (7 counting down for the invoice
// model, 4 for the receipt model), and the SDK's poller obeys it over its own interval, so a result
// ready in 2–3 s was collected at ~7 s. Status polls are free GETs, well within S0's rate limit.
const POLL_INTERVAL_MS = 500;

// How long the secondary model may keep running once the primary has its result. The receipt model's
// analysis measured 1.8–4.0 s and normally finishes first, so this only bites a stalled call — which
// would otherwise hold every extraction until EXTRACTION_TIMEOUT_MS for an additive reading. Cutting
// too early silently loses the secondary's fields, so this errs long; the gap between the two calls'
// completions has not been measured.
export const SECONDARY_GRACE_MS = 10_000;

// How long the scalar reader may keep running once the two-model result is ready, and so the most
// it can add to an extraction. Measured from a home connection, 2 s kept 16 of 16 readings and the
// reader finished before the two models on 15; but one completion in 192 was held 84 s by the
// service, which is why there is a limit at all. 3 s is the top of the accepted latency budget.
export const READER_GRACE_MS = 3_000;

interface AzureSettings {
  readonly endpoint: string;
  readonly key: string;
  readonly modelId: string;
  readonly secondaryModelId: string;
  readonly locale: string;
  readonly timeoutMs: number;
}

interface AnalyzeOutcome {
  analyzeResult: AnalyzeResultOutput;
  raw: unknown;
  uploadMs?: number;
  analyzeMs?: number;
}

export interface AzureProviderOptions {
  readonly client?: DocumentIntelligenceClient;
  readonly settings?: Partial<AzureSettings>;
  readonly analyze?: (
    input: ExtractionInput,
    signal: AbortSignal,
    modelId: string,
  ) => Promise<AnalyzeOutcome>;
  /** The third, additive reading of the scalar fields; absent or null leaves two models. */
  readonly scalarReader?: ScalarReader | null;
}

export function createAzureProvider(
  options: AzureProviderOptions = {},
): DocumentExtractionProvider {
  const settings: AzureSettings = {
    endpoint: options.settings?.endpoint ?? config.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    key: options.settings?.key ?? config.AZURE_DOCUMENT_INTELLIGENCE_KEY,
    modelId: options.settings?.modelId ?? config.AZURE_DI_MODEL_ID,
    secondaryModelId: options.settings?.secondaryModelId ?? config.AZURE_DI_SECONDARY_MODEL_ID,
    locale: options.settings?.locale ?? config.AZURE_DI_LOCALE,
    timeoutMs: options.settings?.timeoutMs ?? config.EXTRACTION_TIMEOUT_MS,
  };
  const client =
    options.client ??
    DocumentIntelligence(
      settings.endpoint,
      { key: settings.key },
      { apiVersion: AZURE_API_VERSION },
    );
  const analyze =
    options.analyze ??
    ((input, signal, modelId) => analyzeWithAzure(client, settings, modelId, input, signal));

  return {
    async extract(input) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
      const secondaryController = new AbortController();
      const abortSecondary = () => secondaryController.abort();
      controller.signal.addEventListener("abort", abortSecondary, { once: true });
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const readerController = new AbortController();
      const abortReader = () => readerController.abort();
      controller.signal.addEventListener("abort", abortReader, { once: true });
      let readerGraceTimer: ReturnType<typeof setTimeout> | undefined;
      let readerAbandoned = false;

      try {
        // Started with the two models, so it normally adds nothing to the wall clock. Like the
        // secondary it is strictly additive: a failed, slow or malformed reading is logged and the
        // two-model result stands. The log line is the only sign of a dead reader, by design.
        const readerPending =
          options.scalarReader == null
            ? Promise.resolve(null)
            : options.scalarReader(input, readerController.signal).catch((error: unknown) => {
                // A reader cancelled because the extraction itself failed or timed out is not a
                // dead reader, and this line is how a dead one is noticed.
                if (controller.signal.aborted && !readerAbandoned) return null;
                logger.warn(
                  { err: error, abandoned: readerAbandoned },
                  "scalar reader unavailable; continuing with the two-model result",
                );
                return null;
              });
        // The two models run concurrently, so the wall clock is the slower call rather than their
        // sum. The secondary is strictly additive: any failure leaves the primary result intact.
        const secondaryPending =
          settings.secondaryModelId === ""
            ? Promise.resolve(null)
            : analyze(input, secondaryController.signal, settings.secondaryModelId).catch(
                (error: unknown) => {
                  logger.warn(
                    { err: error, modelId: settings.secondaryModelId },
                    "secondary extraction model unavailable; continuing with the primary result",
                  );
                  return null;
                },
              );
        const response = await analyze(input, controller.signal, settings.modelId);
        graceTimer = setTimeout(abortSecondary, SECONDARY_GRACE_MS);
        const secondaryResponse = await secondaryPending;

        const primary = readModel(response.analyzeResult);
        const secondary =
          secondaryResponse === null ? null : readModel(secondaryResponse.analyzeResult);
        const merged = mergeExtractions(primary, secondary);
        const qr =
          extractFiscalQr(response.analyzeResult) ??
          (secondaryResponse === null ? null : extractFiscalQr(secondaryResponse.analyzeResult));
        applyQrJir(merged.fields, merged.metadata, qr);

        readerGraceTimer = setTimeout(() => {
          readerAbandoned = true;
          abortReader();
        }, READER_GRACE_MS);
        const reading = await readerPending;
        const scalars = reading === null ? null : mergeScalars({ ...merged, qr }, reading);
        const fields = scalars?.fields ?? merged.fields;
        const fieldMetadata = scalars?.metadata ?? merged.metadata;
        const fieldModels = scalars?.fieldModels ?? merged.fieldModels;

        return {
          fields,
          metadata: {
            provider: "azure-document-intelligence",
            modelId: response.analyzeResult.modelId || settings.modelId,
            secondaryModelId:
              secondaryResponse === null
                ? null
                : secondaryResponse.analyzeResult.modelId || settings.secondaryModelId,
            apiVersion: response.analyzeResult.apiVersion || AZURE_API_VERSION,
            analyzedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            uploadMs: response.uploadMs,
            analyzeMs: response.analyzeMs,
            documentConfidence: primary.documentConfidence,
            fields: fieldMetadata,
            unreadableFields: merged.unreadableFields,
            fieldModels,
            reader:
              reading === null || scalars === null
                ? null
                : {
                    ocrModelId: reading.ocrModelId,
                    deployment: reading.deployment,
                    latencyMs: reading.latencyMs,
                    agreed: scalars.agreed,
                    disagreed: scalars.disagreed,
                  },
            vatTextPresent: hasUnreadVatSignal(response.analyzeResult.content),
          },
          qr,
          raw: {
            ...(response.raw as Record<string, unknown>),
            secondaryModelId: secondaryResponse === null ? null : settings.secondaryModelId,
            secondaryAnalyzeResult: secondaryResponse?.analyzeResult ?? null,
            readerAnalyzeResult: reading?.analyzeResult ?? null,
            readerAnswer: reading?.printed ?? null,
            fieldModels,
          },
        };
      } catch (error) {
        if (error instanceof ExtractionError) throw error;
        if (controller.signal.aborted)
          throw new ExtractionError("provider_unavailable", true, error);
        throw new ExtractionError("provider_unavailable", true, error);
      } finally {
        clearTimeout(timeout);
        clearTimeout(graceTimer);
        clearTimeout(readerGraceTimer);
        // Both calls have settled on the success path; on the failure path this cancels whichever
        // model is still in flight rather than leaving it to poll against a lost extraction.
        controller.abort();
      }
    },
  };
}

/** One model's reading of the document: mapped fields plus the deterministic text fallbacks. */
function readModel(
  analyzeResult: AnalyzeResultOutput,
): ModelExtraction & { documentConfidence: number | null } {
  const mapped = mapAnalyzeResult(analyzeResult);
  const fields = { ...mapped.fields };
  const metadata = { ...mapped.fieldMetadata };
  applyTextFallbacks(fields, metadata, stripContentMarkers(analyzeResult.content));
  return {
    fields,
    metadata,
    unreadableFields: mapped.unreadableFields,
    documentConfidence: mapped.documentConfidence,
  };
}

export function classifyAzureFailure(status: string | number): ExtractionError {
  const statusCode = Number(status);
  if (statusCode === 400) return new ExtractionError("unreadable_document", false);
  if (statusCode === 401 || statusCode === 404)
    return new ExtractionError("provider_rejected", false);
  return new ExtractionError("provider_unavailable", true);
}

/** `features` defaults to the barcode add-on the two prebuilt models use to return the QR code. */
export async function analyzeWithAzure(
  client: DocumentIntelligenceClient,
  settings: Pick<AzureSettings, "locale">,
  modelId: string,
  input: ExtractionInput,
  signal: AbortSignal,
  features: Array<"barcodes"> = ["barcodes"],
): Promise<{
  analyzeResult: AnalyzeResultOutput;
  raw: unknown;
  uploadMs: number;
  analyzeMs: number;
}> {
  const uploadStartedAt = Date.now();
  // Raw bytes rather than a base64 JSON body, which is a third larger — and both models upload the
  // same document at once.
  const initial = await client.path("/documentModels/{modelId}:analyze", modelId).post({
    contentType: "application/octet-stream",
    body: input.bytes,
    queryParameters: { locale: settings.locale, ...(features.length > 0 ? { features } : {}) },
    abortSignal: signal,
  });
  const uploadMs = Date.now() - uploadStartedAt;
  if (isUnexpected(initial)) throw classifyAzureFailure(initial.status);

  const resultId = new URL(initial.headers["operation-location"]).pathname.split("/").at(-1);
  if (!resultId) throw new ExtractionError("provider_unavailable", true);

  const analyzeStartedAt = Date.now();
  for (;;) {
    await delay(POLL_INTERVAL_MS, undefined, { signal });
    const poll = await client
      .path("/documentModels/{modelId}/analyzeResults/{resultId}", modelId, resultId)
      .get({ abortSignal: signal });
    if (isUnexpected(poll)) throw classifyAzureFailure(poll.status);

    const operation = poll.body;
    if (operation.status === "notStarted" || operation.status === "running") continue;
    // Azure reports transient service faults as a failed operation, so it stays retryable, as it was
    // when the SDK poller threw on it.
    if (operation.status === "failed") {
      throw new ExtractionError("provider_unavailable", true, operation.error);
    }
    if (operation.status !== "succeeded" || operation.analyzeResult === undefined) {
      throw new ExtractionError("provider_rejected", false);
    }
    return {
      analyzeResult: operation.analyzeResult,
      raw: operation,
      uploadMs,
      analyzeMs: Date.now() - analyzeStartedAt,
    };
  }
}

/**
 * The QR code is the reliable copy of the JIR: it carries error correction, while the printed
 * identifier has no check digit, so an OCR substitution yields a plausible wrong value nothing can
 * detect (`receipt123` read `61985013-…` where its QR holds `b19e5e13-…`). Only the JIR is taken;
 * the QR never fills the total, date or time, which it only corroborates. This runs at extraction
 * only — a later user edit is never overwritten and still raises `qr_jir_mismatch`.
 */
export function applyQrJir(
  fields: CanonicalReceiptFields,
  metadata: Record<string, ExtractionFieldMetadata>,
  qr: FiscalQrData | null,
): void {
  if (qr === null || qr.jir === null) return;
  fields.jir = qr.jir;
  metadata.jir = { confidence: null, source: "qr" };
}

export function extractFiscalQr(analyzeResult: AnalyzeResultOutput): FiscalQrData | null {
  let firstQr: FiscalQrData | null = null;

  for (const page of analyzeResult.pages ?? []) {
    for (const barcode of page.barcodes ?? []) {
      if (barcode.kind !== "QRCode") continue;
      const qr = parseFiscalQr(barcode.value);
      if (firstQr === null) firstQr = qr;
      if (qr.jir !== null || qr.zki !== null || qr.issueDate !== null || qr.total !== null)
        return qr;
    }
  }

  return firstQr;
}

export function applyTextFallbacks(
  fields: Record<string, unknown>,
  metadata: Record<string, ExtractionFieldMetadata>,
  content: StrippedContent,
): void {
  const fallbacks = {
    // A valid OIB always wins; the printed one that fails its check digit is the last resort.
    sellerOib: findOib(content.text) ?? findLabelledOib(content.text),
    paymentMethod: findPaymentMethod(content.text),
    jir: findJir(content.text),
    zki: findZki(content.text),
    issueDate: findIssueDate(content.text),
    issueTime: findIssueTime(content.text),
    documentNumber: findDocumentNumber(content.text),
  };

  for (const [name, value] of Object.entries(fallbacks)) {
    if (value === null || fields[name] !== undefined) continue;
    fields[name] = value.value;
    metadata[name] = { confidence: null, source: "text" };
  }
}
