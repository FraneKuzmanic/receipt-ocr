import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import { mapAnalyzeResult } from "./azure-fields.js";

async function fixture(name: string): Promise<AnalyzeResultOutput> {
  const raw = JSON.parse(
    await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as {
    analyzeResult?: AnalyzeResultOutput;
  };
  if (!raw.analyzeResult) throw new Error(`Fixture ${name} has no analyze result.`);
  return raw.analyzeResult;
}

describe("Azure field mapper", () => {
  it("maps table VAT without inventing buyer or fiscal identifiers", async () => {
    const tableVat = mapAnalyzeResult(await fixture("31231822"));
    const missingFiscal = mapAnalyzeResult(await fixture("images"));

    expect(tableVat.fields.vatBreakdown).toEqual([
      { rate: "25.00", taxableBase: "10.40", vatAmount: "2.60" },
    ]);
    expect(tableVat.vatSource).toBe("table");
    expect(tableVat.fields.buyerName).toBeUndefined();
    expect(missingFiscal.fields.sellerOib).toBeUndefined();
  });

  it("maps recorded currency, VAT and noisy item totals through the canonical mapper", async () => {
    const inferred = mapAnalyzeResult(await fixture("racun-mobilna-trgovina"));
    const noisyItem = mapAnalyzeResult(await fixture("31231822"));
    const labelLessVat = mapAnalyzeResult(await fixture("26515835"));
    const structuredVat = mapAnalyzeResult(await fixture("images"));
    const exemptVat = mapAnalyzeResult(await fixture("racuntaksi1"));

    expect(inferred.fields.currency).toBe("HRK");
    // An inferred currency has no confidence of its own; inventing a low one flagged it amber.
    expect(inferred.fieldMetadata.currency).toEqual({ confidence: null, source: "inferred" });
    expect(inferred.fields.vatBreakdown).toEqual([
      { rate: "25.00", taxableBase: "82.95", vatAmount: "20.74" },
    ]);
    expect(noisyItem.fields.items?.[0]?.total).toBe("13.00");
    expect(labelLessVat.fields.vatBreakdown).toEqual([
      { rate: "05.00", taxableBase: "01.90", vatAmount: "00.09" },
    ]);
    expect(structuredVat.vatSource).toBe("model");
    expect(structuredVat.fields.vatBreakdown).toBeDefined();
    expect(exemptVat.fields.vatBreakdown).toBeUndefined();
  });

  it("records source values that could not be normalized without persisting them", async () => {
    const raw = JSON.parse(
      await readFile(new URL("./fixtures/mapper-edge-cases.json", import.meta.url), "utf8"),
    ) as { invoice: AnalyzeResultOutput };
    const document = raw.invoice.documents?.[0];
    if (document === undefined) throw new Error("Fixture has no document.");
    const unreadableDate = mapAnalyzeResult({
      ...raw.invoice,
      documents: [
        {
          ...document,
          fields: { InvoiceDate: { type: "string", content: "31/03/2025," } },
        },
      ],
    });

    expect(unreadableDate.unreadableFields).toEqual(["issueDate"]);
    expect(unreadableDate.fields.issueDate).toBeUndefined();
    expect(mapAnalyzeResult(raw.invoice).unreadableFields).toEqual([]);
  });

  it("uses receipt text for exact decimal values and never the provider floats", async () => {
    const raw = JSON.parse(
      await readFile(new URL("./fixtures/mapper-edge-cases.json", import.meta.url), "utf8"),
    ) as {
      invoice: AnalyzeResultOutput;
    };
    const mapped = mapAnalyzeResult(raw.invoice);

    expect(mapped.fields.total).toBe("8.08");
    expect(mapped.fields.items?.[0]?.quantity).toBe("2.30");
    expect(mapped.fields.currency).toBe("EUR");
  });

  it("maps invoice and receipt vocabularies to the same canonical critical fields", async () => {
    const raw = JSON.parse(
      await readFile(new URL("./fixtures/mapper-edge-cases.json", import.meta.url), "utf8"),
    ) as {
      invoice: AnalyzeResultOutput;
      receipt: AnalyzeResultOutput;
    };

    const invoice = mapAnalyzeResult(raw.invoice).fields;
    const receipt = mapAnalyzeResult(raw.receipt).fields;
    expect(invoice).toMatchObject({
      sellerName: "Example Seller",
      issueDate: "2026-08-17",
      total: "8.08",
    });
    expect(receipt).toMatchObject({
      sellerName: "Example Seller",
      issueDate: "2026-08-17",
      total: "8.08",
    });
  });
});

describe("dual-currency, tax id and totals lines (iteration 21)", () => {
  it("takes the euro amount a post-adoption receipt asks for, not its kuna equivalent", async () => {
    // The provider returned "UKUPNO HRK 136,68 kn"; the receipt asks for "ZA PLATITI 18,14 €".
    const mapped = mapAnalyzeResult(await fixture("ina-racun-sladoled"));

    expect(mapped.fields.total).toBe("18.14");
    expect(mapped.fields.currency).toBe("EUR");
  });

  it("leaves a genuine kuna receipt alone", async () => {
    const mapped = mapAnalyzeResult(await fixture("22559270"));

    expect(mapped.fields.total).toBe("517.00");
    expect(mapped.fields.currency).toBe("HRK");
  });

  it("reads the OIB rather than the VAT number printed above it", async () => {
    // VendorTaxId is "HR27759560625"; the OIB one line below is 27759560625.
    expect(mapAnalyzeResult(await fixture("ina-racun-sladoled")).fields.sellerOib).toBe(
      "27759560625",
    );
  });

  it("does not map a totals block as purchased items", async () => {
    // "Osnovica bez PDV" and "Ukupno porez( 25%)" arrived as Items on a receipt with no lines.
    expect(mapAnalyzeResult(await fixture("inareceipt")).fields.items ?? null).toBeNull();
  });

  it("keeps real line items", async () => {
    const mapped = mapAnalyzeResult(await fixture("receiptEuroMistake"));

    expect(mapped.fields.items).toHaveLength(6);
    expect(mapped.fields.items?.[0]?.description).toBe("PIVO PAB 2L");
  });
});

describe("payment method, non-VAT rows and tax ids (iteration 26)", () => {
  it("stores the payment method as printed", async () => {
    expect(mapAnalyzeResult(await fixture("22559270")).fields.paymentMethod).toBe("Novčanice");
    // OCR read the printed NOVČANICE as "NONCANICE".
    expect(mapAnalyzeResult(await fixture("receipt123")).fields.paymentMethod).toBe("NONCANICE");
    expect(mapAnalyzeResult(await fixture("racuntaksi1")).fields.paymentMethod).toBe("Gotovina");
  });

  it("does not store wording that names no payment method", async () => {
    // The provider returned the amount in words, "tridesettri € i 10 c", as the payment term.
    const mapped = mapAnalyzeResult(await fixture("lira_trogir"));

    expect(mapped.fields.paymentMethod).toBeUndefined();
    expect(mapped.fieldMetadata.paymentMethod).toBeUndefined();
  });

  it("no longer maps a subtotal", async () => {
    expect(mapAnalyzeResult(await fixture("gradanin-gotovina-pos")).fields).not.toHaveProperty(
      "subtotal",
    );
  });

  it("drops a consumption-tax row from the VAT breakdown", async () => {
    // The recap prints "PDV 25,00 18,97 4,74" and, below it, "PNP 3,00 2,81 0,08".
    expect(mapAnalyzeResult(await fixture("secondary/receipt123")).fields.vatBreakdown).toEqual([
      { rate: "25.00", taxableBase: "18.97", vatAmount: "4.74" },
    ]);
  });

  it("drops a tax row none of whose cells could be read", async () => {
    // Not in the VAT system; the model returned "999.98 HRK" as a tax row with no amounts.
    expect(
      mapAnalyzeResult(await fixture("secondary/racuntaksi1")).fields.vatBreakdown,
    ).toBeUndefined();
  });

  it("keeps every real VAT row", async () => {
    expect(mapAnalyzeResult(await fixture("secondary/22559270")).fields.vatBreakdown).toEqual([
      { rate: "25", taxableBase: "60.08", vatAmount: "15.02" },
      { rate: "25", taxableBase: "88.80", vatAmount: "22.20" },
      { rate: "13", taxableBase: "292.04", vatAmount: "37.96" },
    ]);
  });

  it("infers the currency from a valid OIB the model read when the printed label is cropped", async () => {
    // The photo crops "OIB" to "IB" and no currency token survives beside an amount.
    const mapped = mapAnalyzeResult(await fixture("lira_trogir"));

    expect(mapped.fields.currency).toBe("EUR");
    expect(mapped.fieldMetadata.currency).toEqual({ confidence: null, source: "inferred" });
  });

  it("does not infer a currency for a receipt with no Croatian marking", async () => {
    expect(mapAnalyzeResult(await fixture("images")).fields.currency).toBe("USD");
  });

  it("does not let text-sourced currency borrow the total's confidence", async () => {
    expect(mapAnalyzeResult(await fixture("26515835")).fieldMetadata.currency).toEqual({
      confidence: null,
      source: "text",
    });
  });
});

describe("item quantities", () => {
  it("reads a quantity printed to three decimals as a decimal, with either separator", async () => {
    // lira_trogir prints "3,000" and screenshot prints "1.000"; both were read as thousands.
    const lira = mapAnalyzeResult(await fixture("secondary/lira_trogir"));
    expect(lira.fields.items?.map((item) => item.quantity)).toEqual([
      "3.000",
      "2.000",
      "2.000",
      "1.000",
    ]);

    const screenshot = mapAnalyzeResult(await fixture("screenshot-20190705-1907152"));
    expect(screenshot.fields.items?.map((item) => item.quantity)).toContain("1.000");
  });

  it("leaves two-decimal and whole quantities as they were", async () => {
    const mapped = mapAnalyzeResult(await fixture("receiptEuroMistake"));
    expect(mapped.fields.items?.[0]?.quantity).toBe("1.00");
  });
});

describe("text wrapped across printed lines", () => {
  it("joins a wrapped value with a space instead of keeping the line break", async () => {
    // A single-line input deletes a line break, which glued these into "rgovinaLira Trogir" and
    // "papir100-2000" on the review form.
    const lira = mapAnalyzeResult(await fixture("secondary/lira_trogir"));
    expect(lira.fields.sellerName).toBe("rgovina Lira Trogir");
    expect(lira.fields.items?.map((item) => item.description)).toEqual([
      "NEXT sprej boja 2u1",
      "Sait vodobrusni papir 100-2000",
      "3M vodobrusni papir P2500 erfect-it",
      "SCH x-way traka srebrna",
    ]);

    const address = mapAnalyzeResult(await fixture("images")).fields.sellerAddress;
    expect(address).toBe("5269 Prospect San Jose CA 95129");
  });
});
