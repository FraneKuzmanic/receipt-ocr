import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type {
  AnalyzeResultOutput,
  DocumentTableOutput,
} from "@azure-rest/ai-document-intelligence";
import { findVatTable, mapVatTable } from "./vat-tables.js";

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
