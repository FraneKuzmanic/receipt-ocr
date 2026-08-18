import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalReceiptSchema, receiptStatusSchema } from "./receipt.js";

const envelope = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  status: "review",
  warnings: [],
  createdAt: "2026-08-17T12:00:00Z",
  updatedAt: "2026-08-17T12:00:00Z",
};

const DATA_FIELDS = [
  "sellerName",
  "sellerAddress",
  "sellerOib",
  "buyerName",
  "buyerAddress",
  "buyerOib",
  "documentNumber",
  "issueDate",
  "issueTime",
  "subtotal",
  "vatBreakdown",
  "total",
  "currency",
  "paymentMethod",
  "jir",
  "zki",
  "items",
] as const;

describe("canonicalReceiptSchema", () => {
  it("accepts a receipt with every optional field null", () => {
    const allNull = Object.fromEntries(DATA_FIELDS.map((field) => [field, null]));
    const result = canonicalReceiptSchema.safeParse({ ...envelope, ...allNull });
    expect(result.success).toBe(true);
  });

  it("accepts a receipt with every optional field absent", () => {
    // A `processing` receipt legitimately has nothing but its envelope.
    const result = canonicalReceiptSchema.safeParse({ ...envelope, status: "processing" });
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated receipt", () => {
    const result = canonicalReceiptSchema.safeParse({
      ...envelope,
      sellerName: "Konzum plus d.o.o.",
      sellerOib: "62226620908",
      documentNumber: "381/1/3",
      issueDate: "2026-08-17",
      issueTime: "14:30",
      subtotal: "80.65",
      vatBreakdown: [{ rate: "25.00", taxableBase: "80.65", vatAmount: "20.16" }],
      total: "100.81",
      currency: "EUR",
      items: [{ description: "Kruh", quantity: "2", unitPrice: "1.50", total: "3.00" }],
      warnings: [{ code: "qr_total_mismatch", field: "total" }],
      confirmedAt: null,
      deletedAt: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const result = canonicalReceiptSchema.safeParse({ ...envelope, status: "pending" });
    expect(result.success).toBe(false);
  });

  it("rejects persisted identifiers that are not UUIDs", () => {
    expect(canonicalReceiptSchema.safeParse({ ...envelope, id: "rec_123" }).success).toBe(false);
    expect(canonicalReceiptSchema.safeParse({ ...envelope, userId: "user_1" }).success).toBe(false);
  });

  it.each(["processing", "review", "confirmed", "failed"])("accepts the %j status", (status) => {
    expect(receiptStatusSchema.safeParse(status).success).toBe(true);
  });

  it("rejects money that has not been normalized", () => {
    // "1.234,56" is what a Croatian receipt shows; parseAmount turns it into "1234.56".
    // The raw locale form must never reach the model.
    for (const total of ["1.234,56", "1,234.56", "100,50", "€100.50", "1e5"]) {
      expect(canonicalReceiptSchema.safeParse({ ...envelope, total }).success).toBe(false);
    }
  });

  it("rejects a date that is not ISO, and one that does not exist", () => {
    expect(canonicalReceiptSchema.safeParse({ ...envelope, issueDate: "17.08.2026" }).success).toBe(
      false,
    );
    expect(canonicalReceiptSchema.safeParse({ ...envelope, issueDate: "2026-02-31" }).success).toBe(
      false,
    );
    expect(canonicalReceiptSchema.safeParse({ ...envelope, issueDate: "2026-8-7" }).success).toBe(
      false,
    );
  });

  it("rejects a time that does not exist", () => {
    expect(canonicalReceiptSchema.safeParse({ ...envelope, issueTime: "24:00" }).success).toBe(
      false,
    );
  });

  it("rejects a currency that is not three characters", () => {
    expect(canonicalReceiptSchema.safeParse({ ...envelope, currency: "EURO" }).success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    const result = canonicalReceiptSchema.safeParse({ ...envelope, tenantId: "acme" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
  });

  it("rejects an unknown key inside a nested VAT row", () => {
    const result = canonicalReceiptSchema.safeParse({
      ...envelope,
      vatBreakdown: [{ rate: "25.00", azureConfidence: 0.9 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("provider independence", () => {
  it("mentions no Azure vocabulary anywhere in shared/src", () => {
    // PRD §6.2: Azure response objects must never become the application schema. Enforced
    // by a test rather than by inspection, because the canonical model is the one place a
    // provider field name would do lasting damage (ROADMAP §5 rule 7).
    const forbidden = /azure|prebuilt|documentintelligence|analyzeresult|boundingregion|polygon/i;
    const directory = fileURLToPath(new URL(".", import.meta.url));

    const offenders = readdirSync(directory)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => forbidden.test(readFileSync(new URL(name, import.meta.url), "utf8")))
      // This test names the vocabulary it bans, so it necessarily contains it.
      .filter((name) => name !== "receipt.test.ts");

    expect(offenders).toEqual([]);
  });
});
