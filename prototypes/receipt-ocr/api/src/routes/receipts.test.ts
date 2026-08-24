import { describe, expect, it } from "vitest";
import type { CanonicalReceiptFields } from "@receipt/shared";
import { editedFields } from "./receipts.js";

const original: CanonicalReceiptFields = {
  sellerName: "Original seller",
  documentNumber: "381/1/3",
  issueDate: "2026-08-17",
  total: "100.50",
  currency: "EUR",
};

describe("editedFields", () => {
  it("returns nothing when the current values still match the machine extraction", () => {
    expect(editedFields({ ...original }, original)).toEqual([]);
  });

  it("flags exactly the scalar fields the user changed", () => {
    expect(
      editedFields({ ...original, documentNumber: "381/1/4", total: "103.69" }, original),
    ).toEqual(["documentNumber", "total"]);
  });

  it("treats a cleared field and an originally-absent field as edits, not as equal nulls", () => {
    expect(editedFields({ ...original, sellerName: null }, original)).toEqual(["sellerName"]);
    expect(
      editedFields({ ...original, paymentMethod: "Cash" }, { ...original, paymentMethod: null }),
    ).toEqual(["paymentMethod"]);
  });

  it("returns nothing when there is no machine extraction to compare against", () => {
    // A receipt that has not finished extraction, or was created before extraction metadata was
    // retained, has no baseline to diff against — nothing should be marked "edited" in that case.
    expect(editedFields(original, null)).toEqual([]);
  });

  it("never inspects vatBreakdown or items — row indices can shift when a row is added or removed", () => {
    const withVat: CanonicalReceiptFields = {
      ...original,
      vatBreakdown: [{ rate: "25", taxableBase: "80.40", vatAmount: "20.10" }],
    };
    const changedVat: CanonicalReceiptFields = {
      ...original,
      vatBreakdown: [{ rate: "13", taxableBase: "80.40", vatAmount: "10.45" }],
    };
    expect(editedFields(changedVat, withVat)).toEqual([]);
  });
});
