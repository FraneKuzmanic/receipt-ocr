import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type {
  AnalyzeResultOutput,
  DocumentTableOutput,
} from "@azure-rest/ai-document-intelligence";
import { findVatTable, mapVatTable, mapVatText } from "./vat-tables.js";

async function fixture(name: string): Promise<AnalyzeResultOutput> {
  const raw = JSON.parse(
    await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as { analyzeResult?: AnalyzeResultOutput };
  if (raw.analyzeResult === undefined) throw new Error(`Fixture ${name} has no analyze result.`);
  return raw.analyzeResult;
}

async function mappedVat(name: string) {
  const table = findVatTable(await fixture(name));
  return table === null ? null : mapVatTable(table);
}

describe("VAT recap tables", () => {
  it.each([
    ["racun-mobilna-trgovina", [{ rate: "25.00", taxableBase: "82.95", vatAmount: "20.74" }]],
    ["31231822", [{ rate: "25.00", taxableBase: "10.40", vatAmount: "2.60" }]],
    ["26515835", [{ rate: "05.00", taxableBase: "01.90", vatAmount: "00.09" }]],
  ] as const)("maps %s with its summary and unrelated rows removed", async (name, expected) => {
    await expect(mappedVat(name)).resolves.toEqual(expected);
  });

  it.each(["screenshot-20190705-1907152", "primjer-pdf-racuna", "racuntaksi1"])(
    "rejects %s when its first row is not a VAT header",
    async (name) => {
      expect(findVatTable(await fixture(name))).toBeNull();
    },
  );

  it("drops a table whose VAT columns contain no readable amount", () => {
    const table = {
      rowCount: 2,
      columnCount: 3,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Stopa" },
        { rowIndex: 0, columnIndex: 1, content: "Osnovica" },
        { rowIndex: 0, columnIndex: 2, content: "Iznos poreza" },
        { rowIndex: 1, columnIndex: 0, content: "nepoznato" },
        { rowIndex: 1, columnIndex: 1, content: "račun" },
        { rowIndex: 1, columnIndex: 2, content: "tekst" },
      ],
    } as DocumentTableOutput;

    expect(mapVatTable(table)).toEqual([]);
  });
});

describe("VAT recap tables tolerate real OCR output (iteration 21)", () => {
  it.each([
    // A single header cell carrying "Stopa% Osnovica" must still yield a taxable base.
    ["receiptWithTaxMistake", [{ rate: "25.00", taxableBase: "10.40", vatAmount: "2.60" }]],
    // Headers sit at columns 0/1/3 while the values sit at 2 and 3/4, and "PDV" heads the amount.
    [
      "22559270",
      [
        { rate: "25", taxableBase: "60.08", vatAmount: "15.02" },
        { rate: "25", taxableBase: "88.80", vatAmount: "22.20" },
        { rate: "13", taxableBase: "292.04", vatAmount: "37.96" },
      ],
    ],
    // "osnavica" is an OCR misread of the header, and the rate cell carries a tax-group code.
    ["ina-racun-sladoled", [{ rate: "25.00", taxableBase: "14.51", vatAmount: "3.63" }]],
  ])("maps %s", async (name, expected) => {
    await expect(mappedVat(name)).resolves.toEqual(expected);
  });

  it("drops the recap's own total row wherever its label sits", async () => {
    // "UKUPNO POREZ 3,63 €" previously became a second VAT row repeating the same amount.
    await expect(mappedVat("ina-racun-sladoled")).resolves.toHaveLength(1);
  });

  it("reads a recap that never became a table", async () => {
    // Wrapped rows leave Azure emitting no table at all, so the labels arrive as loose lines.
    const content = (await fixture("gradanin-gotovina-pos")).content ?? "";
    expect(findVatTable(await fixture("gradanin-gotovina-pos"))).toBeNull();
    expect(mapVatText(content)).toEqual([
      { rate: "25.00", taxableBase: "300.00", vatAmount: "75.00" },
    ]);
  });

  it("invents no VAT for a receipt outside the VAT system", async () => {
    expect(mapVatText((await fixture("racuntaksi1")).content ?? "")).toEqual([]);
  });
});
