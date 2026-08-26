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
  readonly locale: string;
  readonly timeoutMs: number;
}

export interface AzureProviderOptions {
  readonly client?: DocumentIntelligenceClient;
  readonly settings?: Partial<AzureSettings>;
  readonly analyze?: (
    input: ExtractionInput,
    signal: AbortSignal,
  ) => Promise<{
    analyzeResult: AnalyzeResultOutput;
    raw: unknown;
    uploadMs?: number;
    analyzeMs?: number;
  }>;
}

export function createAzureProvider(
  options: AzureProviderOptions = {},
): DocumentExtractionProvider {
  const settings: AzureSettings = {
    endpoint: options.settings?.endpoint ?? config.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    key: options.settings?.key ?? config.AZURE_DOCUMENT_INTELLIGENCE_KEY,
    modelId: options.settings?.modelId ?? config.AZURE_DI_MODEL_ID,
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
    options.analyze ?? ((input, signal) => analyzeWithAzure(client, settings, input, signal));

  return {
    async extract(input) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);

      try {
        const response = await analyze(input, controller.signal);
        const mapped = mapAnalyzeResult(response.analyzeResult);
        const fields = { ...mapped.fields };
        const metadata = { ...mapped.fieldMetadata };
        applyTextFallbacks(fields, metadata, stripContentMarkers(response.analyzeResult.content));

        return {
          fields,
          metadata: {
            provider: "azure-document-intelligence",
            modelId: response.analyzeResult.modelId || settings.modelId,
            apiVersion: response.analyzeResult.apiVersion || AZURE_API_VERSION,
            analyzedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            uploadMs: response.uploadMs,
            analyzeMs: response.analyzeMs,
            documentConfidence: mapped.documentConfidence,
            fields: metadata,
            unreadableFields: mapped.unreadableFields,
            vatTextPresent: hasUnreadVatSignal(response.analyzeResult.content),
          },
          qr: extractFiscalQr(response.analyzeResult),
          raw: response.raw,
        };
      } catch (error) {
        if (error instanceof ExtractionError) throw error;
        if (controller.signal.aborted)
          throw new ExtractionError("provider_unavailable", true, error);
        throw new ExtractionError("provider_unavailable", true, error);
      } finally {
        clearTimeout(timeout);
      }
    },
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
  input: ExtractionInput,
  signal: AbortSignal,
): Promise<{
  analyzeResult: AnalyzeResultOutput;
  raw: unknown;
  uploadMs: number;
  analyzeMs: number;
}> {
  const uploadStartedAt = Date.now();
  const initial = await client.path("/documentModels/{modelId}:analyze", settings.modelId).post({
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
