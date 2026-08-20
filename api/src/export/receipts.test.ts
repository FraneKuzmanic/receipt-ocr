import { describe, expect, it } from "vitest";
import type { CanonicalReceipt } from "@receipt/shared";
import { CSV_COLUMNS, toCsv, toJsonExport } from "./receipts.js";

const receipt: CanonicalReceipt = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  status: "confirmed",
  sellerName: "Market Example",
  documentNumber: "381/1/2",
  issueDate: "2026-08-19",
  subtotal: "80.40",
  vatBreakdown: [{ rate: "25", taxableBase: "80.40", vatAmount: "20.10" }],
  total: "100.50",
  currency: "EUR",
  paymentMethod: "Card",
  items: [{ description: "Bread", quantity: "1", unitPrice: "2.00", total: "2.00" }],
  warnings: [],
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:05:00.000Z",
  confirmedAt: "2026-08-19T10:10:00.000Z",
  deletedAt: null,
};

describe("receipt export", () => {
  it("exports CSV with BOM, stable columns and CRLF rows", () => {
    const csv = toCsv([receipt]);

    expect(csv.at(0)).toBe("\uFEFF");
    expect(csv.slice(1).split("\r\n")[0]).toBe(CSV_COLUMNS.join(","));
    expect(csv.slice(1)).toContain("\r\n");
    expect(csv.slice(1)).not.toMatch(/[^\r]\n/);
  });

  it("escapes CSV fields and serializes VAT breakdown as compact JSON", () => {
    const csv = toCsv([
      {
        ...receipt,
        sellerName: 'A "quoted", seller',
        sellerAddress: "Line 1\nLine 2",
      },
    ]);

    expect(csv).toContain('"A ""quoted"", seller"');
    expect(csv).toContain('"Line 1\nLine 2"');
    expect(csv).toContain(
      '"[{""rate"":""25"",""taxableBase"":""80.40"",""vatAmount"":""20.10""}]"',
    );
  });

  it.each(["=cmd", "+plus", "-minus", "@at", "\ttab", "\rcarriage", "\nline", "＝wide"])(
    "neutralizes text value %j",
    (sellerName) => {
      const csv = toCsv([{ ...receipt, sellerName }]);

      expect(csv).toContain(`'${sellerName}`);
    },
  );

  it("does not neutralize numeric, date or timestamp columns", () => {
    const csv = toCsv([
      {
        ...receipt,
        sellerName: "=Seller",
        total: "-12.50",
      },
    ]);

    expect(csv).toContain("'=Seller");
    expect(csv).not.toContain("'-12.50");
    expect(csv).toContain(",-12.50,");
  });

  it("renders null and absent values as empty CSV fields", () => {
    const csv = toCsv([{ ...receipt, sellerName: null, vatBreakdown: null }]);

    expect(csv).toContain("\r\n00000000-0000-4000-8000-000000000001,confirmed,,");
    expect(csv).toContain(",100.50,EUR,,Card,");
  });

  it("wraps JSON export in schema version 1 and strips private owner/delete fields", () => {
    const exported = toJsonExport([receipt]);

    expect(exported.schemaVersion).toBe(1);
    expect(exported.receipts[0]).toMatchObject({
      id: receipt.id,
      total: "100.50",
      items: receipt.items,
    });
    expect(exported.receipts[0]).not.toHaveProperty("userId");
    expect(exported.receipts[0]).not.toHaveProperty("deletedAt");
  });
});
