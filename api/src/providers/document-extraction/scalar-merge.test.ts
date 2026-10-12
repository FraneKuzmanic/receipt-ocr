import { describe, expect, it } from "vitest";
import {
  mergeScalars,
  sameValue,
  type OfferedScalars,
  type TwoModelReading,
} from "./scalar-merge.js";

const production = (overrides: Partial<TwoModelReading> = {}): TwoModelReading => ({
  fields: {
    sellerName: "Kavana Wagner",
    documentNumber: "38302/013/10",
    issueDate: "2022-06-26",
    issueTime: "09:58",
    total: "517.00",
    jir: "c8403f99",
    buyerName: "Kavana Wagner",
    items: [{ description: "Kava", quantity: "1", unitPrice: "10.00", total: "10.00" }],
    vatBreakdown: [{ rate: "25.00", taxableBase: "8.00", vatAmount: "2.00" }],
  },
  metadata: {
    jir: { confidence: null, source: "qr" },
    total: { confidence: 0.9, source: "model" },
    buyerName: { confidence: 0.8, source: "model" },
  },
  fieldModels: { sellerName: "primary", buyerName: "primary", items: "secondary" },
  qr: {
    raw: "",
    jir: "c8403f99",
    zki: null,
    issueDate: "2022-06-26",
    issueTime: null,
    total: null,
  },
  ...overrides,
});

const reading = (
  printed: Record<string, string | null>,
  fields: Record<string, string | null> = printed,
): OfferedScalars => ({ printed, fields });

describe("mergeScalars", () => {
  it("never changes a field the QR code supplied or agrees with", () => {
    const out = mergeScalars(production(), reading({ jir: "ffffffff", issueDate: "2022-06-27" }));

    expect(out.fields.jir).toBe("c8403f99");
    expect(out.fields.issueDate).toBe("2022-06-26");
    expect(out.agreed).toEqual([]);
    expect(out.disagreed).toEqual([]);
  });

  it("leaves a QR-locked field out of the agreement list too", () => {
    const out = mergeScalars(production(), reading({ jir: "c8403f99", issueDate: "2022-06-26" }));

    expect(out.agreed).toEqual([]);
  });

  it("takes the buyer block from the reader, including empty", () => {
    const cleared = mergeScalars(production(), reading({ buyerName: null }));
    expect(cleared.fields.buyerName).toBeNull();
    expect(cleared.metadata["buyerName"]).toBeUndefined();
    expect(cleared.fieldModels["buyerName"]).toBe("reader");

    const replaced = mergeScalars(
      production(),
      reading({ buyerName: "Ana Horvat", buyerOib: "1" }),
    );
    expect(replaced.fields.buyerName).toBe("Ana Horvat");
    expect(replaced.fields.buyerOib).toBe("1");
    expect(replaced.metadata["buyerName"]).toEqual({ confidence: null, source: "reader" });
    expect(replaced.fieldModels["buyerOib"]).toBe("reader");
  });

  it("records nothing as cleared when neither reading has a buyer", () => {
    const base = production({
      fields: { sellerName: "Kavana Wagner" },
      metadata: {},
      fieldModels: {},
      qr: null,
    });
    const out = mergeScalars(base, reading({ buyerName: null }));

    expect(out.fields.buyerName).toBeUndefined();
    expect(out.fieldModels["buyerName"]).toBeUndefined();
  });

  it("takes payment method and issue time from the reader when it has one", () => {
    const out = mergeScalars(
      production(),
      reading({ issueTime: "09:59", paymentMethod: "Novčanice" }),
    );

    expect(out.fields.issueTime).toBe("09:59");
    expect(out.fields.paymentMethod).toBe("Novčanice");
    expect(out.metadata["paymentMethod"]).toEqual({ confidence: null, source: "reader" });
    expect(mergeScalars(production(), reading({ issueTime: null })).fields.issueTime).toBe("09:58");
  });

  it("keeps the two-model value of every other scalar and lists a difference", () => {
    const out = mergeScalars(
      production(),
      reading({ sellerName: "Milenij hoteli d.o.o.", documentNumber: "38302/013/10", zki: "abc" }),
    );

    expect(out.fields.sellerName).toBe("Kavana Wagner");
    expect(out.fields.zki).toBe("abc");
    expect(out.fieldModels["zki"]).toBe("reader");
    expect(out.fieldModels["sellerName"]).toBe("primary");
    expect(out.disagreed).toEqual(["sellerName"]);
    expect(out.agreed).toEqual(["documentNumber"]);
  });

  it("does not call a difference of case, spacing or punctuation a disagreement", () => {
    const base = production({
      fields: { sellerName: "Milenij hoteli d. o.o.", total: "517.00" },
      metadata: {},
      qr: null,
    });
    const out = mergeScalars(base, reading({ sellerName: "MILENIJ HOTELI d.o.o.", total: "517" }));

    expect(out.disagreed).toEqual([]);
    expect(out.agreed).toEqual(["sellerName", "total"]);
    expect(out.fields.sellerName).toBe("Milenij hoteli d. o.o.");
  });

  it("never blanks a value outside the buyer block", () => {
    const out = mergeScalars(
      production(),
      reading({ sellerName: null, total: null, issueTime: null }),
    );

    expect(out.fields.sellerName).toBe("Kavana Wagner");
    expect(out.fields.total).toBe("517.00");
    expect(out.fields.issueTime).toBe("09:58");
  });

  it("treats a value the parser inferred or could not read as no reading", () => {
    const base = production({ fields: { buyerOib: "12345678903" }, metadata: {}, qr: null });

    const inferred = mergeScalars(base, reading({ currency: null }, { currency: "EUR" }));
    expect(inferred.fields.currency).toBeUndefined();

    // A printed value with no canonical form neither fills the field nor clears it.
    const unreadable = mergeScalars(base, reading({ buyerOib: "OIB kupca" }, { buyerOib: null }));
    expect(unreadable.fields.buyerOib).toBe("12345678903");
  });

  it("leaves line items and VAT rows as they were", () => {
    const base = production();
    const out = mergeScalars(base, reading({ items: null, vatBreakdown: null }));

    expect(out.fields.items).toBe(base.fields.items);
    expect(out.fields.vatBreakdown).toBe(base.fields.vatBreakdown);
  });

  it("does not mutate its inputs", () => {
    const base = production();
    const before = structuredClone(base);
    mergeScalars(base, reading({ buyerName: null, paymentMethod: "Kartica", zki: "abc" }));

    expect(base).toEqual(before);
  });
});

describe("sameValue", () => {
  it("compares a total as an amount", () => {
    expect(sameValue("total", "100.50", "100.5")).toBe(true);
    expect(sameValue("total", "100.50", "100.05")).toBe(false);
  });

  it("ignores the case of a JIR and nothing about a date", () => {
    expect(sameValue("jir", "B19E5E13", "b19e5e13")).toBe(true);
    expect(sameValue("issueDate", "2026-06-01", "2026-06-10")).toBe(false);
    expect(sameValue("currency", "EUR", "eur")).toBe(false);
  });

  it("treats two empty values as equal and one empty as different", () => {
    expect(sameValue("sellerName", null, "")).toBe(true);
    expect(sameValue("sellerName", "Ana", null)).toBe(false);
  });

  it("keeps diacritics", () => {
    expect(sameValue("sellerName", "Građanin", "Gradanin")).toBe(false);
  });
});
