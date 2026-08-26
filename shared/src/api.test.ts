import { describe, expect, it } from "vitest";
import {
  apiErrorResponseSchema,
  confirmReceiptResponseSchema,
  createReceiptResponseSchema,
  exportedReceiptSchema,
  jsonExportResponseSchema,
  receiptDetailResponseSchema,
  listReceiptsQuerySchema,
  listReceiptsResponseSchema,
  sourceDocumentResponseSchema,
  updateReceiptRequestSchema,
} from "./api.js";

const baseReceipt = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  userId: "123e4567-e89b-42d3-a456-426614174001",
  status: "confirmed",
  total: "100.50",
  warnings: [],
  createdAt: "2026-08-17T12:00:00Z",
  updatedAt: "2026-08-17T12:00:00Z",
  confirmedAt: "2026-08-17T12:04:00Z",
  deletedAt: null,
};

const sourceDocument = {
  url: "https://example.test/signed",
  contentType: "image/jpeg",
  originalFilename: "receipt.jpg",
  expiresAt: "2026-08-17T12:05:00Z",
};

describe("updateReceiptRequestSchema", () => {
  it("rejects a forged userId in the request body", () => {
    // PRD §9.1: the backend derives identity from the session and never from the body.
    // Because the PATCH DTO is derived from the tier-1 field schema, this is a schema
    // rejection rather than something a route has to remember to strip. Task 04's
    // definition of done depends on this holding.
    const result = updateReceiptRequestSchema.safeParse({ total: "10.00", userId: "attacker" });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
  });

  it.each(["id", "status", "warnings", "createdAt", "updatedAt", "confirmedAt", "deletedAt"])(
    "rejects the server-owned field %j",
    (field) => {
      const result = updateReceiptRequestSchema.safeParse({ total: "10.00", [field]: "x" });
      expect(result.success).toBe(false);
    },
  );

  it("accepts an empty patch", () => {
    expect(updateReceiptRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a single-field patch", () => {
    const result = updateReceiptRequestSchema.safeParse({ documentNumber: "381/1/3" });
    expect(result.success).toBe(true);
  });

  it("still validates the fields it does accept", () => {
    expect(updateReceiptRequestSchema.safeParse({ total: "1.234,56" }).success).toBe(false);
    expect(updateReceiptRequestSchema.safeParse({ issueDate: "17.08.2026" }).success).toBe(false);
    expect(updateReceiptRequestSchema.safeParse({ total: "1234.56" }).success).toBe(true);
  });
});

describe("listReceiptsQuerySchema", () => {
  it("applies defaults when nothing is supplied", () => {
    const result = listReceiptsQuerySchema.parse({});
    expect(result).toEqual({ page: 1, limit: 20 });
  });

  it("coerces query strings to numbers", () => {
    const result = listReceiptsQuerySchema.parse({ page: "2", limit: "50" });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(50);
  });

  it.each([{ limit: 0 }, { limit: 101 }, { page: 0 }, { status: "pending" }])(
    "rejects %j",
    (query) => {
      expect(listReceiptsQuerySchema.safeParse(query).success).toBe(false);
    },
  );

  it("accepts a known status filter", () => {
    expect(listReceiptsQuerySchema.safeParse({ status: "confirmed" }).success).toBe(true);
  });
});

describe("response DTOs", () => {
  it("createReceiptResponseSchema accepts exactly the PRD §10.1 body", () => {
    const body = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      status: "processing",
      createdAt: "2026-08-17T12:00:00Z",
    };
    expect(createReceiptResponseSchema.safeParse(body).success).toBe(true);
    // The owner id must never reach this response. Since the response DTOs became forward
    // compatible it is dropped rather than rejected, which keeps the same guarantee — the client
    // cannot read a field the DTO does not promise — without an added field breaking older tabs.
    expect(createReceiptResponseSchema.parse({ ...body, userId: "user_1" })).not.toHaveProperty(
      "userId",
    );
  });

  it("confirmReceiptResponseSchema accepts the PRD §10.5 body", () => {
    const body = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      status: "confirmed",
      confirmedAt: "2026-08-17T12:04:00Z",
    };
    expect(confirmReceiptResponseSchema.safeParse(body).success).toBe(true);
  });

  it("requires a low-confidence projection and edited-field list for review responses", () => {
    const body = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      userId: "123e4567-e89b-42d3-a456-426614174001",
      status: "review",
      warnings: [],
      createdAt: "2026-08-17T12:00:00Z",
      updatedAt: "2026-08-17T12:00:00Z",
      lowConfidenceFields: [],
      editedFields: [],
    };

    expect(receiptDetailResponseSchema.safeParse(body).success).toBe(true);
    expect(
      receiptDetailResponseSchema.safeParse({ ...body, lowConfidenceFields: undefined }).success,
    ).toBe(false);
    expect(
      receiptDetailResponseSchema.safeParse({ ...body, editedFields: undefined }).success,
    ).toBe(false);
    // Deliberately no longer a rejection: an unknown key is dropped, not fatal. See the
    // "response DTOs tolerate a newer API" block below for why that changed.
    expect(receiptDetailResponseSchema.parse({ ...body, extra: true })).not.toHaveProperty("extra");
  });

  it("exports receipts without owner or soft-delete fields", () => {
    const { userId: _userId, deletedAt: _deletedAt, ...exported } = baseReceipt;
    const result = exportedReceiptSchema.safeParse({ ...exported, userId: baseReceipt.userId });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    expect(exportedReceiptSchema.safeParse(exported).success).toBe(true);
  });

  it("pins the JSON export schema version", () => {
    const { userId: _userId, deletedAt: _deletedAt, ...exported } = baseReceipt;

    expect(
      jsonExportResponseSchema.safeParse({ schemaVersion: 2, receipts: [exported] }).success,
    ).toBe(false);
    expect(
      jsonExportResponseSchema.safeParse({ schemaVersion: 1, receipts: [exported] }).success,
    ).toBe(true);
  });

  it("accepts an exported receipt with optional fields absent", () => {
    const result = exportedReceiptSchema.safeParse({
      id: baseReceipt.id,
      status: "confirmed",
      warnings: [],
      createdAt: baseReceipt.createdAt,
      updatedAt: baseReceipt.updatedAt,
    });

    expect(result.success).toBe(true);
  });

  it("preserves trailing-zero money through the JSON export DTO", () => {
    const { userId: _userId, deletedAt: _deletedAt, ...exported } = baseReceipt;

    const result = jsonExportResponseSchema.parse({ schemaVersion: 1, receipts: [exported] });

    expect(result.receipts[0]?.total).toBe("100.50");
  });
});

/**
 * A browser tab left open across a deploy runs the previous bundle against the new API, so a field
 * the API has since added must be ignored rather than rejected. When these schemas were `.strict()`
 * that was not true: shipping `failureReason` on 2026-08-26 made every open tab reject every
 * receipt response, which surfaced as the generic processing-error screen on receipts that had
 * extracted perfectly, and cost a client demo.
 *
 * The paired assertion below is the half that must never be relaxed with it — request bodies stay
 * strict, because that is what makes a forged `userId` a schema rejection (PRD §9.1).
 */
describe("response DTOs tolerate a newer API", () => {
  const detail = { ...baseReceipt, lowConfidenceFields: [], editedFields: [] };

  it.each([
    ["createReceiptResponseSchema", createReceiptResponseSchema, baseReceipt],
    ["confirmReceiptResponseSchema", confirmReceiptResponseSchema, baseReceipt],
    ["receiptDetailResponseSchema", receiptDetailResponseSchema, detail],
    ["sourceDocumentResponseSchema", sourceDocumentResponseSchema, sourceDocument],
    ["apiErrorResponseSchema", apiErrorResponseSchema, { error: { code: "not_found" } }],
  ])("%s accepts an unknown field added by a newer API", (_name, schema, body) => {
    const result = schema.safeParse({ ...body, aFieldThisBundleHasNeverHeardOf: null });

    expect(result.success).toBe(true);
    // Accepted, then discarded: `.strip()` rather than `.loose()`, so an undeclared field can
    // never reach a caller that has no idea what it means.
    expect(result.data).not.toHaveProperty("aFieldThisBundleHasNeverHeardOf");
  });

  it("listReceiptsResponseSchema tolerates a new field on the envelope and on a receipt", () => {
    const result = listReceiptsResponseSchema.safeParse({
      items: [{ ...baseReceipt, someNewCanonicalField: "x" }],
      page: 1,
      limit: 20,
      total: 1,
      someNewEnvelopeField: true,
    });

    expect(result.success).toBe(true);
  });

  it("still rejects an unknown field in a request body", () => {
    expect(
      updateReceiptRequestSchema.safeParse({ total: "10.00", userId: "attacker" }).success,
    ).toBe(false);
    expect(listReceiptsQuerySchema.safeParse({ page: "1", unexpected: "x" }).success).toBe(false);
  });
});
