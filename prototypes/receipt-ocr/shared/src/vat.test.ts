import { describe, expect, it } from "vitest";
import { vatRowConsistent } from "./vat.js";

describe("vatRowConsistent", () => {
  // Every row here is printed on a receipt in the corpus.
  it.each([
    ["25", "60.08", "15.02"],
    ["13", "292.04", "37.96"],
    ["5", "1.90", "0.09"],
    ["25", "82.95", "20.74"],
    ["25", "14.51", "3.63"],
    ["0", "100.00", "0.00"],
  ])("accepts the printed row %s%% of %s = %s", (rate, taxableBase, vatAmount) => {
    expect(vatRowConsistent({ rate, taxableBase, vatAmount })).toBe(true);
  });

  it("rejects a VAT amount that does not follow from its base and rate", () => {
    expect(vatRowConsistent({ rate: "25", taxableBase: "100.00", vatAmount: "20.00" })).toBe(false);
  });

  it("cannot judge a row with a missing cell", () => {
    expect(vatRowConsistent({ rate: "25", taxableBase: null, vatAmount: "20.00" })).toBeNull();
    expect(vatRowConsistent({ rate: "25", vatAmount: "20.00" })).toBeNull();
    expect(vatRowConsistent({})).toBeNull();
  });

  it("returns null rather than throwing on a malformed value", () => {
    expect(vatRowConsistent({ rate: "25%", taxableBase: "100,00", vatAmount: "x" })).toBeNull();
  });
});
