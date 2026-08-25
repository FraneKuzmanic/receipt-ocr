import { describe, expect, it } from "vitest";
import { parseReceiptAmount } from "./receipt-amount.js";

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
