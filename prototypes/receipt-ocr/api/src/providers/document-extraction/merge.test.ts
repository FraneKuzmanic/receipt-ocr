import { describe, expect, it } from "vitest";
import { mergeExtractions, type ModelExtraction } from "./merge.js";

function model(fields: Record<string, unknown>, unreadableFields: string[] = []): ModelExtraction {
  return {
    fields: fields as ModelExtraction["fields"],
    metadata: Object.fromEntries(
      Object.keys(fields).map((name) => [name, { confidence: 0.5, source: "model" as const }]),
    ),
    unreadableFields,
  };
}

describe("mergeExtractions", () => {
  it("keeps the primary model's reading for the fields it reads better", () => {
    const merged = mergeExtractions(
      model({ sellerName: "INA - INDUSTRIJA NAFTE, d.d.", documentNumber: "160142-S006-1" }),
      model({ sellerName: "CINIA", documentNumber: "a" }),
    );

    expect(merged.fields.sellerName).toBe("INA - INDUSTRIJA NAFTE, d.d.");
    expect(merged.fields.documentNumber).toBe("160142-S006-1");
    expect(merged.fieldModels.sellerName).toBe("primary");
  });

  it("prefers the secondary model for time, VAT and items", () => {
    const merged = mergeExtractions(
      model({
        issueTime: "10:30:00",
        vatBreakdown: [{ rate: "25.00", taxableBase: null, vatAmount: null }],
        items: [{ description: "merged row", quantity: null, unitPrice: null, total: null }],
      }),
      model({
        issueTime: "10:30",
        vatBreakdown: [{ rate: "25.00", taxableBase: "300.00", vatAmount: "75.00" }],
        items: [
          { description: "first", quantity: "1", unitPrice: "1.00", total: "1.00" },
          { description: "second", quantity: "1", unitPrice: "2.00", total: "2.00" },
        ],
      }),
    );

    expect(merged.fields.issueTime).toBe("10:30");
    expect(merged.fields.vatBreakdown).toEqual([
      { rate: "25.00", taxableBase: "300.00", vatAmount: "75.00" },
    ]);
    expect(merged.fields.items).toHaveLength(2);
    expect(merged.fieldModels.vatBreakdown).toBe("secondary");
  });

  it("fills a gap the primary model left empty without ever blanking one it read", () => {
    const merged = mergeExtractions(
      model({ total: "33.10" }),
      model({ total: "99.99", sellerAddress: "Kneza Trpimira 197, Trogir" }),
    );

    expect(merged.fields.total).toBe("33.10");
    expect(merged.fields.sellerAddress).toBe("Kneza Trpimira 197, Trogir");
    expect(merged.fieldModels.sellerAddress).toBe("secondary");
  });

  it("does not let a secondary null erase a preferred field the primary read", () => {
    const merged = mergeExtractions(
      model({ issueTime: "23:59:47" }),
      model({ issueTime: null as unknown as string }),
    );

    expect(merged.fields.issueTime).toBe("23:59:47");
    expect(merged.fieldModels.issueTime).toBe("primary");
  });

  it("clears an unreadable marker when the other model read the value", () => {
    const merged = mergeExtractions(model({}, ["total"]), model({ total: "18.14" }));

    expect(merged.fields.total).toBe("18.14");
    expect(merged.unreadableFields).toEqual([]);
  });

  it("keeps an unreadable marker no model could resolve", () => {
    const merged = mergeExtractions(model({}, ["total"]), model({}, ["total"]));

    expect(merged.unreadableFields).toEqual(["total"]);
  });

  it("returns the primary reading unchanged when the second model is unavailable", () => {
    const merged = mergeExtractions(
      model({ sellerName: "REBECA d.o.o.", issueTime: "17:13" }),
      null,
    );

    expect(merged.fields).toEqual({ sellerName: "REBECA d.o.o.", issueTime: "17:13" });
    expect(merged.fieldModels).toEqual({ sellerName: "primary", issueTime: "primary" });
  });
});
