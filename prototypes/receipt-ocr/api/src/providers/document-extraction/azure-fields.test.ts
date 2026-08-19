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
  it("maps recorded fixtures with missing VAT, buyer and fiscal identifiers without inventing fields", async () => {
    const missingVatBuyer = mapAnalyzeResult(await fixture("31231822"));
    const missingFiscal = mapAnalyzeResult(await fixture("images"));

    expect(missingVatBuyer.fields.vatBreakdown).toBeUndefined();
    expect(missingVatBuyer.fields.buyerName).toBeUndefined();
    expect(missingFiscal.fields.sellerOib).toBeUndefined();
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
