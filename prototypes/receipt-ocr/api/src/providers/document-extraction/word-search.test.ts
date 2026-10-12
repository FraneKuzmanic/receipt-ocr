import { describe, expect, it } from "vitest";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import { findWords, printedForms } from "./word-search.js";

/** One page per list of words; each word is a 10x10 box, laid out left to right. */
function pages(...lists: string[][]): AnalyzeResultOutput {
  return {
    apiVersion: "2024-11-30",
    modelId: "prebuilt-read",
    stringIndexType: "utf16CodeUnit",
    content: lists.flat().join(" "),
    pages: lists.map((words, pageIndex) => ({
      pageNumber: pageIndex + 1,
      spans: [],
      words: words.map((content, index) => ({
        content,
        span: { offset: 0, length: content.length },
        confidence: 1,
        polygon: [index * 10, 0, index * 10 + 10, 0, index * 10 + 10, 10, index * 10, 10],
      })),
    })),
  };
}

describe("findWords", () => {
  it("finds a value printed across several words, ignoring case and diacritics", () => {
    const match = findWords(
      ["Prilaz Gjure Deželića 76"],
      pages(["Adresa", "PRILAZ", "GJURE", "DEZELICA", "76,", "Zagreb"]),
    );

    expect(match).toEqual({ pageNumber: 1, polygon: [10, 0, 50, 0, 50, 10, 10, 10] });
  });

  it("finds a value glued to its label", () => {
    const match = findWords(["b19e5e13-0388"], pages(["Total", "JIR:b19e5e13-0388"]));

    expect(match?.polygon).toEqual([10, 0, 20, 0, 20, 10, 10, 10]);
  });

  it("finds a value printed in brackets", () => {
    expect(findWords(["NOVCANICE"], pages(["UKUPNO", "KN", "(NOVCANICE)"]))).not.toBeNull();
  });

  it("finds a date and an amount in the forms a receipt prints them", () => {
    expect(
      findWords(printedForms("2026-06-01"), pages(["Datum", "1.06.2026", "14:30"]))?.polygon,
    ).toEqual([10, 0, 20, 0, 20, 10, 10, 10]);
    expect(findWords(printedForms("33.10"), pages(["UKUPNO", "33,10"]))).not.toBeNull();
    expect(findWords(printedForms("1234.56"), pages(["UKUPNO", "1.234,56"]))).not.toBeNull();
  });

  it("returns the first place a value is printed", () => {
    const match = findWords(["33,10"], pages(["33,10", "UKUPNO", "33,10"]));

    expect(match?.polygon[0]).toBe(0);
  });

  it("returns nothing for a value that is not on the page", () => {
    expect(findWords(["Ana Horvat"], pages(["Ana", "Kovač"]))).toBeNull();
  });

  it("never matches across a page break", () => {
    expect(findWords(["Ana Horvat"], pages(["Ana"], ["Horvat"]))).toBeNull();
  });

  it("skips a candidate with nothing to look for", () => {
    expect(findWords(["", " - "], pages(["Ana"]))).toBeNull();
  });
});

describe("printedForms", () => {
  it("adds the HR-prefixed form of an OIB", () => {
    expect(printedForms("73710835843")).toContain("HR73710835843");
  });
});
