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

  it("saves a three-decimal quantity unchanged rather than as thousands", () => {
    const item = { description: "Sprej", quantity: "3.000", unitPrice: "8.70", total: "26.10" };
    const values = toFormValues({ items: [item] });
    expect(toPatch(values).items).toEqual([item]);

    values.items[0]!.quantity = "2,500";
    values.items[0]!.unitPrice = "1,250";
    expect(toPatch(values).items?.[0]).toMatchObject({ quantity: "2.500", unitPrice: "1250" });
  });

  it("shows a value stored with line breaks as one spaced line", () => {
    // Stored before extraction joined wrapped lines; an <input> would delete the breaks outright.
    const values = toFormValues({
      sellerAddress: "Kneza Trpimira 197, Trogir\nObrt Lira vl. Lidija Radevenjić",
      items: [
        {
          description: "Sait vodobrusni papir\n'100-2000",
          quantity: null,
          unitPrice: null,
          total: null,
        },
      ],
    });

    expect(values.sellerAddress).toBe("Kneza Trpimira 197, Trogir Obrt Lira vl. Lidija Radevenjić");
    expect(values.items[0]?.description).toBe("Sait vodobrusni papir '100-2000");
  });
});
