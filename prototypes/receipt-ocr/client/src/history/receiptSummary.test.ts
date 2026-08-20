import { describe, expect, it } from "vitest";
import { formatReceiptTotal, receiptRoute } from "./receiptSummary";

const id = "00000000-0000-4000-8000-000000000001";

describe("receipt history summaries", () => {
  it("formats valid totals without losing precision", () => {
    expect(formatReceiptTotal("132.72", "EUR", "hr")).toContain("132,72");
    expect(formatReceiptTotal("132.72", null, "hr")).toContain("132,72");
    expect(formatReceiptTotal("100.50", null, "en")).toContain("100.50");
  });

  it("degrades malformed currency codes instead of throwing", () => {
    expect(() => formatReceiptTotal("132.72", "1EU", "hr")).not.toThrow();
    expect(formatReceiptTotal("132.72", "1EU", "hr")).toContain("132,72");
    expect(formatReceiptTotal("132.72", "1EU", "hr")).toContain("1EU");
  });

  it("returns null when no total exists", () => {
    expect(formatReceiptTotal(null, "EUR", "hr")).toBeNull();
  });

  it.each([
    ["processing", `/receipts/${id}/processing`],
    ["failed", `/receipts/${id}/processing`],
    ["review", `/receipts/${id}/review`],
    ["confirmed", `/receipts/${id}/review`],
  ] as const)("routes %s receipts correctly", (status, expected) => {
    expect(receiptRoute({ id, status })).toBe(expected);
  });
});
