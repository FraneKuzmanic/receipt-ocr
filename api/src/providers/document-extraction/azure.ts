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
import { ExtractionError, type DocumentExtractionProvider, type ExtractionInput } from "./types.js";

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
  ) => Promise<{ analyzeResult: AnalyzeResultOutput; raw: unknown }>;
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
        applyTextFallbacks(fields, metadata, response.analyzeResult.content);

        return {
          fields,
          metadata: {
            provider: "azure-document-intelligence",
            modelId: response.analyzeResult.modelId || settings.modelId,
            apiVersion: response.analyzeResult.apiVersion || AZURE_API_VERSION,
            analyzedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            documentConfidence: mapped.documentConfidence,
            fields: metadata,
          },
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
): Promise<{ analyzeResult: AnalyzeResultOutput; raw: unknown }> {
  const initial = await client.path("/documentModels/{modelId}:analyze", settings.modelId).post({
    contentType: "application/json",
    body: { base64Source: input.bytes.toString("base64") },
    queryParameters: { locale: settings.locale },
    abortSignal: signal,
  });
  if (isUnexpected(initial)) throw classifyAzureFailure(initial.status);

  const completed = await getLongRunningPoller(client, initial, {
    intervalInMs: 500,
  }).pollUntilDone({ abortSignal: signal });
  const operation = completed.body as AnalyzeOperationOutput;
  if (operation.status !== "succeeded" || operation.analyzeResult === undefined) {
    throw new ExtractionError("provider_rejected", false);
  }
  return { analyzeResult: operation.analyzeResult, raw: operation };
}

function applyTextFallbacks(
  fields: Record<string, unknown>,
  metadata: Record<string, { confidence: number | null; source: "model" | "text" }>,
  content: string,
): void {
  const fallbacks = {
    sellerOib: findOib(content),
    jir: findJir(content),
    zki: findZki(content),
    issueDate: findIssueDate(content),
    issueTime: findIssueTime(content),
    documentNumber: findDocumentNumber(content),
  };

  for (const [name, value] of Object.entries(fallbacks)) {
    if (value === null || fields[name] !== undefined) continue;
    fields[name] = value;
    metadata[name] = { confidence: null, source: "text" };
  }
}
