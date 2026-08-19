import { describe, expect, it, vi } from "vitest";
import type {
  AnalyzeResultOutput,
  DocumentIntelligenceClient,
} from "@azure-rest/ai-document-intelligence";
import { getLongRunningPoller } from "@azure-rest/ai-document-intelligence";
import { classifyAzureFailure, createAzureProvider } from "./azure.js";
import { ExtractionError } from "./types.js";

vi.mock("@azure-rest/ai-document-intelligence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@azure-rest/ai-document-intelligence")>();
  return { ...actual, getLongRunningPoller: vi.fn() };
});

const analyzeResult: AnalyzeResultOutput = {
  apiVersion: "2024-11-30",
  modelId: "prebuilt-invoice",
  stringIndexType: "utf16CodeUnit",
  content: "OIB: 62226620908\nRačun br. 381/1/3\nDatum: 17.08.2026. Vrijeme: 14:32:05",
  pages: [],
  documents: [
    {
      docType: "invoice",
      spans: [],
      confidence: 0.9,
      fields: {
        InvoiceTotal: {
          type: "currency",
          content: "8,08 EUR",
          valueCurrency: { amount: 8.08, currencyCode: "EUR", currencySymbol: "EUR" },
          confidence: 0.8,
        },
        InvoiceId: { type: "string", content: "model-number", confidence: 0.8 },
      },
    },
  ],
};

describe("Azure extraction provider", () => {
  it.each([
    [400, false, "unreadable_document"],
    [429, true, "provider_unavailable"],
    [503, true, "provider_unavailable"],
  ])("classifies HTTP %i", (status, retryable, reason) => {
    expect(classifyAzureFailure(status)).toMatchObject({ retryable, reason });
  });

  it("returns canonical fields and only uses deterministic text for model gaps", async () => {
    const provider = createAzureProvider({
      settings: { timeoutMs: 1_000 },
      analyze: async () => ({ analyzeResult, raw: { status: "succeeded", analyzeResult } }),
    });

    const result = await provider.extract({
      bytes: Buffer.from("receipt"),
      contentType: "image/jpeg",
    });
    expect(result.fields).toMatchObject({
      total: "8.08",
      documentNumber: "model-number",
      sellerOib: "62226620908",
      issueDate: "2026-08-17",
    });
    expect(result.metadata.fields.documentNumber).toEqual({ confidence: 0.8, source: "model" });
    expect(result.metadata.fields.sellerOib).toEqual({ confidence: null, source: "text" });
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.qr).toBeNull();
  });

  it("preserves provider failures", async () => {
    const provider = createAzureProvider({
      analyze: async () => {
        throw new ExtractionError("unreadable_document", false);
      },
    });

    await expect(
      provider.extract({ bytes: Buffer.alloc(0), contentType: "image/jpeg" }),
    ).rejects.toMatchObject({
      retryable: false,
      reason: "unreadable_document",
    });
  });

  it("passes the same abort signal used for the request into the long-running poll", async () => {
    const post = vi.fn().mockResolvedValue({
      status: "202",
      headers: {},
      request: {
        url: "https://example.test/documentModels/prebuilt-invoice:analyze",
        method: "POST",
      },
    });
    const fakeClient = { path: () => ({ post }) } as unknown as DocumentIntelligenceClient;
    const pollUntilDone = vi
      .fn()
      .mockResolvedValue({ body: { status: "succeeded", analyzeResult } });
    vi.mocked(getLongRunningPoller).mockReturnValue({ pollUntilDone } as never);

    const provider = createAzureProvider({ client: fakeClient });
    await provider.extract({ bytes: Buffer.from("receipt"), contentType: "image/jpeg" });

    const requestOptions = post.mock.calls[0]![0] as {
      abortSignal: AbortSignal;
      queryParameters: { features: string[] };
    };
    const requestSignal = requestOptions.abortSignal;
    expect(requestOptions.queryParameters.features).toEqual(["barcodes"]);
    expect(pollUntilDone).toHaveBeenCalledWith({ abortSignal: requestSignal });
  });

  it("aborts a poll that outlives the configured timeout as a retryable failure", async () => {
    const post = vi.fn().mockResolvedValue({
      status: "202",
      headers: {},
      request: {
        url: "https://example.test/documentModels/prebuilt-invoice:analyze",
        method: "POST",
      },
    });
    const fakeClient = { path: () => ({ post }) } as unknown as DocumentIntelligenceClient;
    // A real, un-mocked SDK poll rejects once its abortSignal fires; this mirrors that so the
    // regression this guards against — the signal never reaching pollUntilDone — actually hangs.
    const pollUntilDone = vi.fn(
      (options?: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    vi.mocked(getLongRunningPoller).mockReturnValue({ pollUntilDone } as never);

    const provider = createAzureProvider({ client: fakeClient, settings: { timeoutMs: 20 } });

    await expect(
      provider.extract({ bytes: Buffer.from("receipt"), contentType: "image/jpeg" }),
    ).rejects.toMatchObject({ retryable: true, reason: "provider_unavailable" });
  });

  it("extracts fiscal QR data and strips inline barcode markers before text fallbacks", async () => {
    const provider = createAzureProvider({
      analyze: async () => ({
        analyzeResult: {
          ...analyzeResult,
          content: "Račun br. 381/1/3\n:barcode:\nJIR: 18916f95-5787-4e7f-a190-3a091970cfa2",
          documents: [{ ...analyzeResult.documents![0]!, fields: {} }],
          pages: [
            {
              pageNumber: 1,
              spans: [],
              barcodes: [
                {
                  kind: "QRCode",
                  value:
                    "https://porezna.gov.hr/rn?jir=18916f95-5787-4e7f-a190-3a091970cfa2&datv=20250331_2359&izn=132,72",
                  span: { offset: 0, length: 1 },
                  confidence: 1,
                },
              ],
            },
          ],
        },
        raw: { status: "succeeded" },
      }),
    });

    const result = await provider.extract({
      bytes: Buffer.from("receipt"),
      contentType: "image/jpeg",
    });

    expect(result.qr).toMatchObject({ total: "132.72", issueTime: "23:59" });
    expect(result.fields.documentNumber).toBe("381/1/3");
    expect(result.fields.jir).toBe("18916f95-5787-4e7f-a190-3a091970cfa2");
  });
});
