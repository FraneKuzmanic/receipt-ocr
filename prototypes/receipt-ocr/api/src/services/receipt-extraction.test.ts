import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.js";
import {
  ExtractionError,
  type DocumentExtractionProvider,
} from "../providers/document-extraction/types.js";

const update = vi.fn();

vi.mock("../repositories/receipts.js", () => ({
  ReceiptRepository: class {
    update = update;
  },
}));

const { extractReceipt } = await import("./receipt-extraction.js");

const providerResult = {
  fields: {
    sellerName: "Seller",
    documentNumber: "381/1/3",
    issueDate: "2026-08-19",
    total: "100.50",
    currency: "EUR",
  },
  metadata: {
    provider: "azure-document-intelligence",
    modelId: "prebuilt-invoice",
    apiVersion: "2024-11-30",
    analyzedAt: "2026-08-19T10:00:00.000Z",
    latencyMs: 100,
    documentConfidence: 0.9,
    fields: {},
    unreadableFields: [],
  },
  qr: {
    raw: "https://porezna.gov.hr/rn?jir=18916f95-5787-4e7f-a190-3a091970cfa2&izn=100,50",
    jir: "18916f95-5787-4e7f-a190-3a091970cfa2",
    zki: null,
    issueDate: null,
    issueTime: null,
    total: "100.50",
  },
  raw: { status: "succeeded" },
};

function input(provider: DocumentExtractionProvider) {
  return {
    provider,
    client: {} as SupabaseClient<Database>,
    userId: "11111111-1111-4111-8111-111111111111",
    receiptId: "22222222-2222-4222-8222-222222222222",
    bytes: Buffer.from("receipt"),
    contentType: "image/jpeg" as const,
  };
}

beforeEach(() => {
  update.mockReset();
  update.mockResolvedValue({ id: "receipt" });
});

describe("receipt extraction service", () => {
  it("writes review with identical canonical and original machine values", async () => {
    await extractReceipt(input({ extract: async () => providerResult }));

    expect(update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: "review",
        canonicalData: providerResult.fields,
        originalExtraction: providerResult.fields,
        qrExtraction: providerResult.qr,
        warnings: [],
      }),
    );
  });

  it("persists null QR extraction when Azure found no QR code", async () => {
    await extractReceipt(input({ extract: async () => ({ ...providerResult, qr: null }) }));

    expect(update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ qrExtraction: null }),
    );
  });

  it("persists the VAT text signal and its non-blocking warning", async () => {
    await extractReceipt(
      input({
        extract: async () => ({
          ...providerResult,
          metadata: { ...providerResult.metadata, vatTextPresent: true },
        }),
      }),
    );

    expect(update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        extractionMetadata: expect.objectContaining({ vatTextPresent: true }),
        warnings: expect.arrayContaining([
          { code: "vat_present_but_unread", field: "vatBreakdown" },
        ]),
      }),
    );
  });

  it("records a non-retryable failure", async () => {
    await extractReceipt(
      input({
        extract: async () => {
          throw new ExtractionError("unreadable_document", false);
        },
      }),
    );

    expect(update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: "failed",
        extractionMetadata: { failure: { reason: "unreadable_document", retryable: false } },
      }),
    );
  });

  it("contains unexpected provider failures and treats a soft-deleted row as success", async () => {
    update.mockResolvedValue(null);
    await expect(
      extractReceipt(
        input({
          extract: async () => {
            throw new Error("network down");
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: "failed",
        extractionMetadata: { failure: { reason: "provider_unavailable", retryable: true } },
      }),
    );
  });
});
