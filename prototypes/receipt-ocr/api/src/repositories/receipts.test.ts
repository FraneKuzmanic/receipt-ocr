import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.js";
import { ReceiptRepository, ReceiptRepositoryError, mapReceiptRow } from "./receipts.js";

type ReceiptRow = Database["public"]["Tables"]["receipts"]["Row"];

const USER_ID = "11111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function receiptRow(overrides: Partial<ReceiptRow> = {}): ReceiptRow {
  return {
    id: RECEIPT_ID,
    user_id: USER_ID,
    source_object_path: `${USER_ID}/${RECEIPT_ID}/source`,
    source_original_filename: "receipt.jpg",
    source_content_type: "image/jpeg",
    status: "review",
    canonical_data: { sellerName: "Seller", total: "100.50", currency: "EUR" },
    original_extraction: null,
    extraction_metadata: null,
    qr_extraction: null,
    raw_provider_result: null,
    warnings: [],
    seller_name: "Seller",
    issue_date: null,
    document_number: null,
    total: 100.5,
    currency: "EUR",
    created_at: "2026-08-17 14:00:00+02",
    updated_at: "2026-08-17 14:30:00+02",
    confirmed_at: null,
    deleted_at: null,
    ...overrides,
  };
}

type QueryResult = { data: ReceiptRow | ReceiptRow[] | null; error: unknown };

class QueryDouble {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  constructor(readonly result: QueryResult) {}

  from(...args: unknown[]): this {
    return this.record("from", args);
  }

  insert(...args: unknown[]): this {
    return this.record("insert", args);
  }

  update(...args: unknown[]): this {
    return this.record("update", args);
  }

  select(...args: unknown[]): this {
    return this.record("select", args);
  }

  eq(...args: unknown[]): this {
    return this.record("eq", args);
  }

  is(...args: unknown[]): this {
    return this.record("is", args);
  }

  single(): Promise<QueryResult> {
    this.calls.push({ method: "single", args: [] });
    return Promise.resolve(this.result);
  }

  maybeSingle(): Promise<QueryResult> {
    this.calls.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(this.result);
  }

  order(...args: unknown[]): Promise<QueryResult> {
    this.calls.push({ method: "order", args });
    return Promise.resolve(this.result);
  }

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }
}

function repositoryWith(result: QueryResult): {
  repository: ReceiptRepository;
  query: QueryDouble;
} {
  const query = new QueryDouble(result);
  const client = { from: query.from.bind(query) } as unknown as SupabaseClient<Database>;
  return { repository: new ReceiptRepository(client, USER_ID), query };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("mapReceiptRow", () => {
  it("maps snake_case rows, normalizes timestamps, and ignores the numeric projection", () => {
    const receipt = mapReceiptRow(receiptRow());

    expect(receipt).toMatchObject({
      id: RECEIPT_ID,
      userId: USER_ID,
      sellerName: "Seller",
      total: "100.50",
      createdAt: "2026-08-17T12:00:00.000Z",
      updatedAt: "2026-08-17T12:30:00.000Z",
    });
  });

  it("rejects invalid canonical JSON at the repository boundary", () => {
    expect(() => mapReceiptRow(receiptRow({ canonical_data: { total: 100.5 } }))).toThrowError(
      expect.objectContaining({ code: "invalid_data" }),
    );
  });

  it("rejects invalid warnings at the repository boundary", () => {
    expect(() => mapReceiptRow(receiptRow({ warnings: {} }))).toThrowError(
      expect.objectContaining({ code: "invalid_data" }),
    );
  });
});

describe("ReceiptRepository", () => {
  it("creates only persisted non-generated fields for the scoped user", async () => {
    const row = receiptRow({ status: "processing", canonical_data: {} });
    const { repository, query } = repositoryWith({ data: row, error: null });

    await repository.create({
      id: RECEIPT_ID,
      sourceObjectPath: row.source_object_path,
      sourceOriginalFilename: row.source_original_filename,
      sourceContentType: row.source_content_type,
    });

    const insert = query.calls.find((call) => call.method === "insert")?.args[0];
    expect(insert).toMatchObject({ id: RECEIPT_ID, user_id: USER_ID, status: "processing" });
    expect(insert).not.toHaveProperty("total");
    expect(insert).not.toHaveProperty("seller_name");
  });

  it("returns null for an absent or soft-deleted receipt", async () => {
    const { repository, query } = repositoryWith({ data: null, error: null });

    await expect(repository.findById(RECEIPT_ID)).resolves.toBeNull();
    expect(query.calls).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
    expect(query.calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("lists only current user rows newest first", async () => {
    const rows = [receiptRow()];
    const { repository, query } = repositoryWith({ data: rows, error: null });

    await expect(repository.listCurrent()).resolves.toHaveLength(1);
    expect(query.calls).toContainEqual({
      method: "order",
      args: ["created_at", { ascending: false }],
    });
    expect(query.calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("soft deletes with mutation timestamps and owner filters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T15:00:00Z"));
    const deleted = receiptRow({
      updated_at: "2026-08-17T15:00:00Z",
      deleted_at: "2026-08-17T15:00:00Z",
    });
    const { repository, query } = repositoryWith({ data: deleted, error: null });

    const result = await repository.softDelete(RECEIPT_ID);
    const update = query.calls.find((call) => call.method === "update")?.args[0];

    expect(result?.deletedAt).toBe("2026-08-17T15:00:00.000Z");
    expect(update).toMatchObject({
      deleted_at: "2026-08-17T15:00:00.000Z",
      updated_at: "2026-08-17T15:00:00.000Z",
    });
    expect(query.calls).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
  });

  it("wraps provider errors in a stable internal category", async () => {
    const { repository } = repositoryWith({
      data: null,
      error: { message: "provider detail must not escape" },
    });

    const error = await repository.findById(RECEIPT_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReceiptRepositoryError);
    expect(error).toMatchObject({ code: "query_failed", message: "query_failed" });
    expect(String(error)).not.toContain("provider detail");
  });
});
