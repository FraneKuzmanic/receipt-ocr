import { describe, expect, it } from "vitest";
import {
  confirmReceiptResponseSchema,
  createReceiptResponseSchema,
  exportedReceiptSchema,
  jsonExportResponseSchema,
  receiptDetailResponseSchema,
  listReceiptsQuerySchema,
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
    expect(createReceiptResponseSchema.safeParse({ ...body, userId: "user_1" }).success).toBe(
      false,
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

  it("requires a strict low-confidence projection for review responses", () => {
    const body = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      userId: "123e4567-e89b-42d3-a456-426614174001",
      status: "review",
      warnings: [],
      createdAt: "2026-08-17T12:00:00Z",
      updatedAt: "2026-08-17T12:00:00Z",
      lowConfidenceFields: [],
    };

    expect(receiptDetailResponseSchema.safeParse(body).success).toBe(true);
    expect(
      receiptDetailResponseSchema.safeParse({ ...body, lowConfidenceFields: undefined }).success,
    ).toBe(false);
    expect(receiptDetailResponseSchema.safeParse({ ...body, extra: true }).success).toBe(false);
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
