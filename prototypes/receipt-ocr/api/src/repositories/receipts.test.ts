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

type QueryResult = {
  data: ReceiptRow | ReceiptRow[] | null;
  error: unknown;
  count?: number | null;
};

class QueryDouble {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  #nextResultIndex = 0;

  constructor(readonly result: QueryResult | QueryResult[]) {}

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
    return Promise.resolve(this.nextResult());
  }

  maybeSingle(): Promise<QueryResult> {
    this.calls.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(this.nextResult());
  }

  order(...args: unknown[]): this {
    return this.record("order", args);
  }

  range(...args: unknown[]): this {
    return this.record("range", args);
  }

  // oxlint-disable-next-line unicorn/no-thenable -- Supabase query builders are thenable.
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.nextResult()).then(onfulfilled, onrejected);
  }

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  private nextResult(): QueryResult {
    if (!Array.isArray(this.result)) return this.result;
    const result = this.result[this.#nextResultIndex] ?? this.result.at(-1);
    this.#nextResultIndex += 1;
    if (result === undefined) throw new Error("QueryDouble needs at least one result.");
    return result;
  }
}

function repositoryWith(result: QueryResult | QueryResult[]): {
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

  it("lists a page for the current user with inclusive paging bounds", async () => {
    const rows = [receiptRow()];
    const { repository, query } = repositoryWith({ data: rows, error: null, count: 42 });

    await expect(repository.listPage({ page: 2, limit: 20 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: RECEIPT_ID })],
      total: 42,
    });
    expect(query.calls).toContainEqual({
      method: "order",
      args: ["created_at", { ascending: false }],
    });
    expect(query.calls).toContainEqual({ method: "range", args: [20, 39] });
    expect(query.calls).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
    expect(query.calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("applies a status filter only when supplied", async () => {
    const withStatus = repositoryWith({ data: [], error: null });
    await withStatus.repository.listPage({ page: 1, limit: 20, status: "confirmed" });
    expect(withStatus.query.calls).toContainEqual({
      method: "eq",
      args: ["status", "confirmed"],
    });

    const withoutStatus = repositoryWith({ data: [], error: null });
    await withoutStatus.repository.listPage({ page: 1, limit: 20 });
    expect(withoutStatus.query.calls).not.toContainEqual({
      method: "eq",
      args: ["status", "confirmed"],
    });
  });

  it("lists confirmed receipts for export with owner, status and soft-delete filters", async () => {
    const row = receiptRow({ status: "confirmed" });
    const { repository, query } = repositoryWith({ data: [row], error: null });

    await expect(repository.listConfirmedForExport()).resolves.toEqual([
      expect.objectContaining({ id: RECEIPT_ID, status: "confirmed", total: "100.50" }),
    ]);

    expect(query.calls).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
    expect(query.calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
    expect(query.calls).toContainEqual({ method: "eq", args: ["status", "confirmed"] });
    expect(query.calls).toContainEqual({
      method: "order",
      args: ["created_at", { ascending: false }],
    });
    expect(query.calls).toContainEqual({ method: "order", args: ["id", { ascending: false }] });
  });

  it("pages export queries until the first short page", async () => {
    const fullPage = Array.from({ length: 500 }, (_, index) =>
      receiptRow({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
        status: "confirmed",
      }),
    );
    const shortPage = [
      receiptRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "confirmed" }),
    ];
    const { repository, query } = repositoryWith([
      { data: fullPage, error: null },
      { data: shortPage, error: null },
    ]);

    await expect(repository.listConfirmedForExport()).resolves.toHaveLength(501);

    expect(query.calls.filter((call) => call.method === "range")).toEqual([
      { method: "range", args: [0, 499] },
      { method: "range", args: [500, 999] },
    ]);
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
