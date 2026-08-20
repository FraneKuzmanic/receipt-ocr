import { canonicalReceiptFieldsSchema } from "@receipt/shared";
import { describe, expect, it } from "vitest";
import { toFormValues, toPatch } from "./reviewForm";

describe("review form normalization", () => {
  it("normalizes locale input and drops wholly empty rows", () => {
    const patch = toPatch({
      ...toFormValues({ total: "100.50" }),
      issueDate: "17.08.2026.",
      total: "1.234,56",
      currency: "eur",
      vatBreakdown: [
        { rate: "", taxableBase: "", vatAmount: "" },
        { rate: "25", taxableBase: "1,00", vatAmount: "0,25" },
      ],
    });

    expect(patch).toMatchObject({
      issueDate: "2026-08-17",
      total: "1234.56",
      currency: "EUR",
      vatBreakdown: [{ rate: "25", taxableBase: "1.00", vatAmount: "0.25" }],
    });
    expect(canonicalReceiptFieldsSchema.safeParse(patch).success).toBe(true);
  });

  it("keeps canonical trailing zeroes and turns empty strings into null", () => {
    const values = toFormValues({ total: "100.50", issueTime: "14:30" });
    expect(toPatch(values)).toMatchObject({ total: "100.50", issueTime: "14:30" });

    const empty = toPatch(toFormValues({}));
    expect(empty.sellerName).toBeNull();
    expect(empty.total).toBeNull();
    expect(empty.vatBreakdown).toBeNull();
    expect(empty.items).toBeNull();
  });
});
