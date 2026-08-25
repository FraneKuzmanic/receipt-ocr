import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import { resolveCurrency } from "./currency.js";

async function fixture(name: string): Promise<AnalyzeResultOutput> {
  const raw = JSON.parse(
    await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as { analyzeResult?: AnalyzeResultOutput };
  if (raw.analyzeResult === undefined) throw new Error(`Fixture ${name} has no analyze result.`);
  return raw.analyzeResult;
}

async function resolveFixture(name: string) {
  const result = await fixture(name);
  const fields = result.documents?.[0]?.fields ?? {};
  return resolveCurrency({
    content: result.content,
    field: fields["InvoiceTotal"] ?? fields["Total"],
    issueDate: fields["InvoiceDate"]?.valueDate ?? fields["TransactionDate"]?.valueDate,
  });
}

describe("currency resolution", () => {
  it.each([
    ["racun-mobilna-trgovina", { code: "HRK", source: "inferred" }],
    ["31231822", { code: "HRK", source: "text" }],
    ["26515835", { code: "EUR", source: "text" }],
    ["primjer-pdf-racuna", { code: "EUR", source: "text" }],
    ["racuntaksi1", { code: "EUR", source: "model" }],
    ["screenshot-20190705-1907152", { code: "HRK", source: "inferred" }],
    ["images", { code: "USD", source: "text" }],
  ] as const)("resolves %s from recorded evidence", async (name, expected) => {
    await expect(resolveFixture(name)).resolves.toEqual(expected);
  });

  it("ignores labels and currency conversions", () => {
    expect(
      resolveCurrency({
        content: "OIB: 12345678901\nDatum: 21.02.2020\nEURO:\n13,94 (1 Eur= 7,43567)",
        field: undefined,
        issueDate: undefined,
      }),
    ).toEqual({ code: "HRK", source: "inferred" });
  });

  it("abstains without currency or Croatian fiscal evidence", () => {
    expect(
      resolveCurrency({ content: "Receipt total 10.00", field: undefined, issueDate: undefined }),
    ).toBeNull();
  });
});
