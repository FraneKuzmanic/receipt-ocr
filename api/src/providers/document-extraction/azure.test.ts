import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type {
  AnalyzeResultOutput,
  DocumentIntelligenceClient,
} from "@azure-rest/ai-document-intelligence";
import { logger } from "../../logger.js";
import { computeWarnings } from "../../validation/warnings.js";
import {
  applyQrJir,
  classifyAzureFailure,
  createAzureProvider,
  READER_GRACE_MS,
  SECONDARY_GRACE_MS,
} from "./azure.js";
import { SCALAR_FIELDS } from "./scalar-merge.js";
import {
  createScalarReader,
  normalizeScalars,
  type ScalarReader,
  type ScalarReading,
} from "./scalar-reader.js";
import { ExtractionError, type ProviderExtractionResult } from "./types.js";

/** A client whose submit is accepted and whose status polls return `statuses` in order. */
function fakeAzure(statuses: Array<"running" | "succeeded" | "failed">) {
  const post = vi.fn().mockResolvedValue({
    status: "202",
    headers: {
      "operation-location":
        "https://example.test/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/result-1?api-version=2024-11-30",
    },
    request: {
      url: "https://example.test/documentModels/prebuilt-invoice:analyze",
      method: "POST",
    },
  });
  let polls = 0;
  const get = vi.fn(async () => {
    const status = statuses[Math.min(polls++, statuses.length - 1)];
    return {
      status: "200",
      headers: {},
      body: status === "succeeded" ? { status, analyzeResult } : { status },
      request: {
        url: "https://example.test/documentModels/prebuilt-invoice/analyzeResults/result-1",
        method: "GET",
      },
    };
  });
  const path = vi.fn(() => ({ post, get }));
  return { post, get, path, client: { path } as unknown as DocumentIntelligenceClient };
}

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

async function recorded(name: string): Promise<AnalyzeResultOutput> {
  const raw = JSON.parse(
    await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as { analyzeResult: AnalyzeResultOutput };
  return raw.analyzeResult;
}

/** Runs the real provider over a receipt's two recorded responses, with no network. */
async function extractRecorded(name: string) {
  const [primary, secondary] = await Promise.all([recorded(name), recorded(`secondary/${name}`)]);
  const provider = createAzureProvider({
    settings: { modelId: "prebuilt-invoice", secondaryModelId: "prebuilt-receipt" },
    analyze: async (_input, _signal, modelId) => {
      const result = modelId === "prebuilt-receipt" ? secondary : primary;
      return { analyzeResult: result, raw: { status: "succeeded", analyzeResult: result } };
    },
  });
  return provider.extract({ bytes: Buffer.from("receipt"), contentType: "image/jpeg" });
}

describe("the QR code supplies the JIR (iteration 26)", () => {
  it("replaces an OCR-misread JIR with the one in the receipt's QR code", async () => {
    // OCR read "61985013-…-380919701be5"; a JIR has no check digit, so nothing else can tell.
    const result = await extractRecorded("receipt123");

    expect(result.fields.jir).toBe("b19e5e13-0388-4284-9be9-3a0919701be5");
    expect(result.metadata.fields.jir).toEqual({ confidence: null, source: "qr" });
    expect(
      computeWarnings({ fields: result.fields, qr: result.qr }).map((warning) => warning.code),
    ).not.toContain("qr_jir_mismatch");
  });

  it("takes nothing but the JIR from the QR code", () => {
    const fields = { total: "10.00", issueDate: "2026-01-01" };
    const metadata = {};
    applyQrJir(fields, metadata, {
      raw: "x",
      jir: "b19e5e13-0388-4284-9be9-3a0919701be5",
      zki: null,
      issueDate: "2025-07-30",
      issueTime: "14:17",
      total: "23.80",
    });

    expect(fields).toEqual({
      total: "10.00",
      issueDate: "2026-01-01",
      jir: "b19e5e13-0388-4284-9be9-3a0919701be5",
    });
  });

  it("leaves the fields alone when there is no QR code or it carries no JIR", () => {
    const fields = { jir: "printed" };
    applyQrJir(fields, {}, null);
    applyQrJir(
      fields,
      {},
      { raw: "x", jir: null, zki: null, issueDate: null, issueTime: null, total: null },
    );

    expect(fields.jir).toBe("printed");
  });
});

describe("text fallbacks through the whole provider (iteration 26)", () => {
  it("reads the labelled payment method where the model returned the amount in words", async () => {
    const result = await extractRecorded("lira_trogir");

    expect(result.fields.paymentMethod).toBe("Novčanice");
    expect(result.metadata.fields.paymentMethod).toEqual({ confidence: null, source: "text" });
    expect(result.fields.currency).toBe("EUR");
  });

  it("shows an OIB that fails its check digit when no valid one exists", async () => {
    const result = await extractRecorded("primjer-pdf-racuna");

    expect(result.fields.sellerOib).toBe("12345678902");
    expect(result.metadata.fields.sellerOib).toEqual({ confidence: null, source: "text" });
    expect(computeWarnings({ fields: result.fields, qr: result.qr })).toContainEqual({
      code: "oib_checksum_invalid",
      field: "sellerOib",
    });
  });

  it("still prefers a valid OIB over the VAT number and over a misread labelled one", async () => {
    expect((await extractRecorded("ina-racun-sladoled")).fields.sellerOib).toBe("27759560625");
  });

  it("raises no VAT warning on the receipts that used to fail the sum-against-total rule", async () => {
    for (const name of ["receipt123", "22559270"]) {
      const result = await extractRecorded(name);
      const codes = computeWarnings({ fields: result.fields, qr: result.qr }).map(
        (warning) => warning.code,
      );
      expect(codes).not.toContain("vat_arithmetic_mismatch");
    }
    expect((await extractRecorded("receipt123")).fields.vatBreakdown).toHaveLength(1);
  });
});

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

  it("keeps the primary reading when the second model fails", async () => {
    const provider = createAzureProvider({
      settings: { modelId: "prebuilt-invoice", secondaryModelId: "prebuilt-receipt" },
      analyze: async (_input, _signal, modelId) => {
        if (modelId === "prebuilt-receipt") throw new ExtractionError("provider_unavailable", true);
        return { analyzeResult, raw: { status: "succeeded", analyzeResult } };
      },
    });

    const result = await provider.extract({
      bytes: Buffer.from("receipt"),
      contentType: "image/jpeg",
    });

    expect(result.fields.total).toBe("8.08");
    expect(result.metadata.secondaryModelId).toBeNull();
  });

  it("takes the second model's reading for the fields it reads better", async () => {
    const receiptResult: AnalyzeResultOutput = {
      ...analyzeResult,
      modelId: "prebuilt-receipt",
      documents: [
        {
          docType: "receipt.retailMeal",
          spans: [],
          confidence: 0.98,
          fields: {
            TransactionTime: { type: "time", content: "12:17", confidence: 0.98 },
            TaxDetails: {
              type: "array",
              confidence: 0.97,
              valueArray: [
                {
                  type: "object",
                  valueObject: {
                    Rate: { type: "string", content: "25%:", confidence: 0.96 },
                    NetAmount: { type: "number", content: "26,48", confidence: 0.97 },
                    Amount: { type: "number", content: "6,62", confidence: 0.97 },
                  },
                },
              ],
            },
          },
        },
      ],
    };

    const provider = createAzureProvider({
      settings: { modelId: "prebuilt-invoice", secondaryModelId: "prebuilt-receipt" },
      analyze: async (_input, _signal, modelId) => {
        const chosen = modelId === "prebuilt-receipt" ? receiptResult : analyzeResult;
        return { analyzeResult: chosen, raw: { status: "succeeded", analyzeResult: chosen } };
      },
    });

    const result = await provider.extract({
      bytes: Buffer.from("receipt"),
      contentType: "image/jpeg",
    });

    // The invoice model still owns identity; the receipt model supplies the VAT recap.
    expect(result.fields.documentNumber).toBe("model-number");
    expect(result.fields.vatBreakdown).toEqual([
      { rate: "25", taxableBase: "26.48", vatAmount: "6.62" },
    ]);
    expect(result.metadata.fieldModels?.vatBreakdown).toBe("secondary");
    expect(result.metadata.secondaryModelId).toBe("prebuilt-receipt");
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

  it("uploads raw bytes and polls the result itself with the request's abort signal", async () => {
    const azure = fakeAzure(["running", "succeeded"]);
    const provider = createAzureProvider({
      client: azure.client,
      settings: { secondaryModelId: "" },
    });
    const bytes = Buffer.from("receipt");
    const result = await provider.extract({ bytes, contentType: "image/jpeg" });

    const requestOptions = azure.post.mock.calls[0]![0] as {
      abortSignal: AbortSignal;
      body: unknown;
      contentType: string;
      queryParameters: { features: string[] };
    };
    expect(requestOptions.body).toBe(bytes);
    expect(requestOptions.contentType).toBe("application/octet-stream");
    expect(requestOptions.queryParameters.features).toEqual(["barcodes"]);
    // A running status is polled again rather than treated as a result, on the operation Azure named.
    expect(azure.get).toHaveBeenCalledTimes(2);
    expect(azure.path).toHaveBeenCalledWith(
      "/documentModels/{modelId}/analyzeResults/{resultId}",
      "prebuilt-invoice",
      "result-1",
    );
    for (const [options] of azure.get.mock.calls as unknown as Array<
      [{ abortSignal: AbortSignal }]
    >) {
      expect(options.abortSignal).toBe(requestOptions.abortSignal);
    }
    expect(result.fields.total).toBe("8.08");
  });

  it("aborts a poll that outlives the configured timeout as a retryable failure", async () => {
    // An operation that never finishes: only the timeout's abort signal can end the polling loop.
    const azure = fakeAzure(["running"]);
    const provider = createAzureProvider({ client: azure.client, settings: { timeoutMs: 20 } });

    await expect(
      provider.extract({ bytes: Buffer.from("receipt"), contentType: "image/jpeg" }),
    ).rejects.toMatchObject({ retryable: true, reason: "provider_unavailable" });
  });

  it("keeps a failed operation retryable, as the SDK poller did", async () => {
    const azure = fakeAzure(["running", "failed"]);
    const provider = createAzureProvider({
      client: azure.client,
      settings: { secondaryModelId: "" },
    });

    await expect(
      provider.extract({ bytes: Buffer.from("receipt"), contentType: "image/jpeg" }),
    ).rejects.toMatchObject({ retryable: true, reason: "provider_unavailable" });
  });

  it("stops waiting for a stalled second model shortly after the primary result", async () => {
    vi.useFakeTimers();
    try {
      let secondarySignal: AbortSignal | undefined;
      const provider = createAzureProvider({
        settings: { modelId: "prebuilt-invoice", secondaryModelId: "prebuilt-receipt" },
        analyze: (_input, signal, modelId) => {
          if (modelId === "prebuilt-invoice") {
            return Promise.resolve({ analyzeResult, raw: { status: "succeeded", analyzeResult } });
          }
          secondarySignal = signal;
          return new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(new Error("aborted"))),
          );
        },
      });

      const pending = provider.extract({
        bytes: Buffer.from("receipt"),
        contentType: "image/jpeg",
      });
      await vi.advanceTimersByTimeAsync(SECONDARY_GRACE_MS - 1);
      expect(secondarySignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const result = await pending;
      expect(secondarySignal?.aborted).toBe(true);
      expect(result.fields.total).toBe("8.08");
      expect(result.metadata.secondaryModelId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

/** What a reader must leave untouched when it fails: values, their provenance, their owners. */
const comparable = (result: ProviderExtractionResult) => ({
  fields: result.fields,
  metadata: result.metadata.fields,
  fieldModels: result.metadata.fieldModels,
});

describe("the scalar reader is additive, never load-bearing (iteration 29)", () => {
  const input = { bytes: Buffer.from("receipt"), contentType: "image/jpeg" as const };
  const readResult: AnalyzeResultOutput = {
    apiVersion: "2024-11-30",
    modelId: "prebuilt-read",
    stringIndexType: "utf16CodeUnit",
    content: "GOTOVINA 8,08",
    pages: [],
  };

  /** A reading of `printed`, the rest null, as the reader returns it. */
  const readingOf = (printed: Record<string, string | null>): ScalarReading => {
    const all = { ...Object.fromEntries(SCALAR_FIELDS.map((name) => [name, null])), ...printed };
    return {
      printed: all,
      fields: normalizeScalars(all),
      ocrModelId: "prebuilt-read",
      deployment: "test-deployment",
      latencyMs: 1200,
      analyzeResult: readResult,
    };
  };

  /** The two models with a buyer the invoice model invented, as on `26515835`. */
  const provider = (scalarReader?: ScalarReader | null) =>
    createAzureProvider({
      settings: { modelId: "prebuilt-invoice", secondaryModelId: "" },
      analyze: async () => {
        const result: AnalyzeResultOutput = {
          ...analyzeResult,
          documents: [
            {
              ...analyzeResult.documents![0]!,
              fields: {
                ...analyzeResult.documents![0]!.fields,
                CustomerName: { type: "string", content: "Blagajna 2", confidence: 0.6 },
              },
            },
          ],
        };
        return { analyzeResult: result, raw: { status: "succeeded", analyzeResult: result } };
      },
      ...(scalarReader === undefined ? {} : { scalarReader }),
    });

  it("merges a reading into the two-model result and stores what it read", async () => {
    const reading = readingOf({
      paymentMethod: "GOTOVINA",
      documentNumber: "381/1/3",
      total: "9,08",
    });
    const result = await provider(async () => reading).extract(input);

    // Filled, cleared, and kept although the reader differs.
    expect(result.fields.paymentMethod).toBe("GOTOVINA");
    expect(result.fields.buyerName).toBeNull();
    expect(result.fields.total).toBe("8.08");
    expect(result.metadata.fields["paymentMethod"]).toEqual({ confidence: null, source: "reader" });
    expect(result.metadata.fieldModels).toMatchObject({
      paymentMethod: "reader",
      buyerName: "reader",
      total: "primary",
    });
    expect(result.metadata.reader).toEqual({
      ocrModelId: "prebuilt-read",
      deployment: "test-deployment",
      latencyMs: 1200,
      agreed: [],
      disagreed: ["documentNumber", "total"],
    });
    const raw = result.raw as Record<string, unknown>;
    expect(raw["readerAnswer"]).toBe(reading.printed);
    expect(raw["readerAnalyzeResult"]).toBe(readResult);
    expect(raw["fieldModels"]).toBe(result.metadata.fieldModels);
  });

  it("leaves line items and VAT rows to the two models", async () => {
    const without = await provider().extract(input);
    const withReader = await provider(async () => readingOf({ paymentMethod: "GOTOVINA" })).extract(
      input,
    );

    expect(withReader.fields.items).toEqual(without.fields.items);
    expect(withReader.fields.vatBreakdown).toEqual(without.fields.vatBreakdown);
  });

  it("keeps the two-model result when no reader is configured", async () => {
    const result = await provider(null).extract(input);

    expect(result.fields.buyerName).toBe("Blagajna 2");
    expect(result.metadata.reader).toBeNull();
    expect((result.raw as Record<string, unknown>)["readerAnswer"]).toBeNull();
    expect(comparable(result)).toEqual(comparable(await provider().extract(input)));
  });

  it("keeps the two-model result when the reader fails", async () => {
    const expected = comparable(await provider().extract(input));
    const result = await provider(async () => {
      throw new Error("scalar reader: HTTP 429");
    }).extract(input);

    expect(comparable(result)).toEqual(expected);
    expect(result.metadata.reader).toBeNull();
    expect((result.raw as Record<string, unknown>)["readerAnswer"]).toBeNull();
  });

  it("keeps the two-model result when the reader's answer is malformed", async () => {
    const expected = comparable(await provider().extract(input));
    const reader = createScalarReader({
      settings: { endpoint: "x", key: "x", deployment: "x", apiVersion: "x" },
      ocr: async () => readResult,
      complete: async () => ({ sellerName: 12 }),
    });
    const result = await provider(reader).extract(input);

    expect(comparable(result)).toEqual(expected);
    expect(result.metadata.reader).toBeNull();
  });

  it("abandons a reader that is still running a few seconds after the two-model result", async () => {
    vi.useFakeTimers();
    try {
      let readerSignal: AbortSignal | undefined;
      const pending = provider((_input, signal) => {
        readerSignal = signal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }).extract(input);

      await vi.advanceTimersByTimeAsync(READER_GRACE_MS - 1);
      expect(readerSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const result = await pending;
      expect(readerSignal?.aborted).toBe(true);
      expect(result.fields.buyerName).toBe("Blagajna 2");
      expect(result.metadata.reader).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stores the QR code's JIR whatever the reader offers", async () => {
    const [primary, secondary] = await Promise.all([
      recorded("receipt123"),
      recorded("secondary/receipt123"),
    ]);
    const result = await createAzureProvider({
      settings: { modelId: "prebuilt-invoice", secondaryModelId: "prebuilt-receipt" },
      analyze: async (_input, _signal, modelId) => {
        const chosen = modelId === "prebuilt-receipt" ? secondary : primary;
        return { analyzeResult: chosen, raw: { status: "succeeded", analyzeResult: chosen } };
      },
      scalarReader: async () => readingOf({ jir: "61985013-0388-4284-9be9-380919701be5" }),
    }).extract(input);

    expect(result.fields.jir).toBe("b19e5e13-0388-4284-9be9-3a0919701be5");
    expect(result.metadata.fields["jir"]).toEqual({ confidence: null, source: "qr" });
    expect(result.metadata.reader?.disagreed).not.toContain("jir");
  });

  it("does not report a dead reader when the extraction itself fails", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      const failing = createAzureProvider({
        settings: { modelId: "prebuilt-invoice", secondaryModelId: "" },
        analyze: async () => {
          throw new Error("primary failed");
        },
        scalarReader: (_input, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      });

      await expect(failing.extract(input)).rejects.toBeInstanceOf(ExtractionError);
      await Promise.resolve();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
