import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
  type AnalyzeOperationOutput,
  type AnalyzeResultOutput,
  type DocumentIntelligenceClient,
} from "@azure-rest/ai-document-intelligence";
import { config } from "../../config.js";
import {
  findDocumentNumber,
  findIssueDate,
  findIssueTime,
  findJir,
  findOib,
  findZki,
} from "./croatian.js";
import { mapAnalyzeResult } from "./azure-fields.js";
import { mergeExtractions, type ModelExtraction } from "./merge.js";
import { logger } from "../../logger.js";
import { stripContentMarkers, type StrippedContent } from "./content-markers.js";
import { hasUnreadVatSignal } from "./tax-signals.js";
import { parseFiscalQr, type FiscalQrData } from "./fiscal-qr.js";
import {
  ExtractionError,
  type DocumentExtractionProvider,
  type ExtractionFieldMetadata,
  type ExtractionInput,
} from "./types.js";

export const AZURE_API_VERSION = "2024-11-30";

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

      try {
        // The two models run concurrently, so the wall clock is the slower call rather than their
        // sum. The secondary is strictly additive: any failure leaves the primary result intact.
        const [response, secondaryResponse] = await Promise.all([
          analyze(input, controller.signal, settings.modelId),
          settings.secondaryModelId === ""
            ? Promise.resolve(null)
            : analyze(input, controller.signal, settings.secondaryModelId).catch(
                (error: unknown) => {
                  logger.warn(
                    { err: error, modelId: settings.secondaryModelId },
                    "secondary extraction model unavailable; continuing with the primary result",
                  );
                  return null;
                },
              ),
        ]);

        const primary = readModel(response.analyzeResult);
        const secondary =
          secondaryResponse === null ? null : readModel(secondaryResponse.analyzeResult);
        const merged = mergeExtractions(primary, secondary);

        return {
          fields: merged.fields,
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
            fields: merged.metadata,
            unreadableFields: merged.unreadableFields,
            fieldModels: merged.fieldModels,
            vatTextPresent: hasUnreadVatSignal(response.analyzeResult.content),
          },
          qr:
            extractFiscalQr(response.analyzeResult) ??
            (secondaryResponse === null ? null : extractFiscalQr(secondaryResponse.analyzeResult)),
          raw: {
            ...(response.raw as Record<string, unknown>),
            secondaryModelId: secondaryResponse === null ? null : settings.secondaryModelId,
            secondaryAnalyzeResult: secondaryResponse?.analyzeResult ?? null,
            fieldModels: merged.fieldModels,
          },
        };
      } catch (error) {
        if (error instanceof ExtractionError) throw error;
        if (controller.signal.aborted)
          throw new ExtractionError("provider_unavailable", true, error);
        throw new ExtractionError("provider_unavailable", true, error);
      } finally {
        clearTimeout(timeout);
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

async function analyzeWithAzure(
  client: DocumentIntelligenceClient,
  settings: AzureSettings,
  modelId: string,
  input: ExtractionInput,
  signal: AbortSignal,
): Promise<{
  analyzeResult: AnalyzeResultOutput;
  raw: unknown;
  uploadMs: number;
  analyzeMs: number;
}> {
  const uploadStartedAt = Date.now();
  const initial = await client.path("/documentModels/{modelId}:analyze", modelId).post({
    contentType: "application/json",
    body: { base64Source: input.bytes.toString("base64") },
    queryParameters: { locale: settings.locale, features: ["barcodes"] },
    abortSignal: signal,
  });
  const uploadMs = Date.now() - uploadStartedAt;
  if (isUnexpected(initial)) throw classifyAzureFailure(initial.status);

  const analyzeStartedAt = Date.now();
  const completed = await getLongRunningPoller(client, initial, {
    intervalInMs: 500,
  }).pollUntilDone({ abortSignal: signal });
  const operation = completed.body as AnalyzeOperationOutput;
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

function extractFiscalQr(analyzeResult: AnalyzeResultOutput): FiscalQrData | null {
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
    sellerOib: findOib(content.text),
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
