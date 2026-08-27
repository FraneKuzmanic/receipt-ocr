import { describe, expect, it } from "vitest";
import { parseReceiptAmount, parseVatRate } from "./receipt-amount.js";

describe("receipt amount parsing", () => {
  it.each([
    ["25%", "25"],
    ["05.00%", "05.00"],
    ["13,00 H", "13.00"],
    ["1,99 kn", "1.99"],
    ["12,50*", "12.50"],
    ["100.50", "100.50"],
    ["Račun broj:", null],
    ["10752/310012/2", null],
    [null, null],
    [undefined, null],
    ["", null],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(parseReceiptAmount(raw)).toBe(expected);
  });
});

describe("VAT rate parsing (iteration 21)", () => {
  it("discards a leading tax-group code", () => {
    // "D1 25,00 %" reads as "01 25.00 %", which concatenated to the nonsense rate 0125.00.
    expect(parseVatRate("01 25.00 %")).toBe("25.00");
    expect(parseVatRate("D1 25,00 %")).toBe("25.00");
  });

  it("reads an ordinary rate unchanged", () => {
    expect(parseVatRate("25")).toBe("25");
    expect(parseVatRate("25,00%")).toBe("25.00");
    expect(parseVatRate("0.3")).toBe("0.3");
  });

  it("reports an impossible rate as unreadable rather than storing it", () => {
    expect(parseVatRate("0125.00")).toBeNull();
    expect(parseVatRate("-5")).toBeNull();
    expect(parseVatRate("nonsense")).toBeNull();
  });
});
