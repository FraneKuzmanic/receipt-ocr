import { describe, expect, it } from "vitest";
import {
  findDocumentNumber,
  findIssueDate,
  findIssueTime,
  findJir,
  findOib,
  findZki,
} from "./croatian.js";

const receipt = `KONZUM plus d.o.o.\nOIB: 62226620908\nRačun br. 381/1/3\nDatum: 17.08.2026. Vrijeme: 14:32:05\nJIR: 8f2c1a9b-1234-5678-9abc-123456789def\nZKI: a1b2c3d4e5f60718293a4b5c6d7e8f90`;

describe("Croatian receipt text parsing", () => {
  it.each([
    ["OIB", findOib, "62226620908"],
    ["JIR", findJir, "8f2c1a9b-1234-5678-9abc-123456789def"],
    ["ZKI", findZki, "a1b2c3d4e5f60718293a4b5c6d7e8f90"],
    ["issue date", findIssueDate, "2026-08-17"],
    ["issue time", findIssueTime, "14:32:05"],
    ["document number", findDocumentNumber, "381/1/3"],
  ])("finds %s", (_name, finder, expected) => {
    expect(finder(receipt)).toBe(expected);
  });

  it("returns null for absent and malformed labels", () => {
    for (const finder of [
      findOib,
      findJir,
      findZki,
      findIssueDate,
      findIssueTime,
      findDocumentNumber,
    ]) {
      expect(finder("OIB: 123 JIR: ZKI: Datum: 32.13.2026. Vrijeme: 25:99")).toBeNull();
    }
  });

  it("accepts a bare hexadecimal JIR", () => {
    expect(findJir("JIR: a1b2c3d4e5f60718293a4b5c6d7e8f90")).toBe(
      "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    );
  });

  it("finds a document number after the full word 'broj', not just the 'br.' abbreviation", () => {
    // Regression: the alternation used to try "br\.?" before "broj", which matches just "br" of
    // "broj" (the dot is optional) and stops there, capturing "oj" instead of the real number.
    expect(findDocumentNumber("Račun broj: 381/1/3")).toBe("381/1/3");
    expect(findDocumentNumber("Račun broj:\n381/1/3")).toBe("381/1/3");
  });
});
