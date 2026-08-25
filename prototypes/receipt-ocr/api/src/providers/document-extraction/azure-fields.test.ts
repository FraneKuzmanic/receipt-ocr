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
    expect(inferred.fieldMetadata.currency).toMatchObject({ source: "inferred" });
    expect(inferred.fieldMetadata.currency?.confidence).toBeLessThan(0.7);
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
    expect(mapped.fields.subtotal).toBe("1234.56");
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
