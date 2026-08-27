import { describe, expect, it } from "vitest";
import {
  findDocumentNumber,
  findIssueDate,
  findIssueTime,
  findJir,
  findOib,
  findZki,
  hasFiscalMarkings,
  normalizeOib,
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
  ])("finds %s", (name, finder, expected) => {
    const match = finder(receipt);
    expect(match?.value).toBe(expected);
    expect(receipt.slice(match?.start, match?.end)).toBe(
      name === "issue date" ? "17.08.2026." : match?.value,
    );
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
    expect(findJir("JIR: a1b2c3d4e5f60718293a4b5c6d7e8f90")?.value).toBe(
      "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    );
  });

  it("finds a document number after the full word 'broj', not just the 'br.' abbreviation", () => {
    expect(findDocumentNumber("Račun broj: 381/1/3")?.value).toBe("381/1/3");
    expect(findDocumentNumber("Račun broj:\n381/1/3")?.value).toBe("381/1/3");
  });
});

describe("issue time is read, not guessed (iteration 21)", () => {
  it("never reads a date as a time", () => {
    // "Datum i vrijeme: 17.08.2026. 10:30" previously stored 17:08:20 — parsed out of the date.
    expect(findIssueTime("Datum i vrijeme: 17.08.2026. 10:30")?.value).toBe("10:30");
    expect(findIssueTime("Vrijeme: 26.06.2022. 09:58:57")?.value).toBe("09:58:57");
    expect(findIssueTime("Datum: 17.08.2026.")).toBeNull();
  });

  it("prefers the time beside the date over a labelled duration", () => {
    // A taxi receipt labels its ride length "Vrijeme"; the issue time sits beside the date.
    const taxi = "Nadnevak: 31/03/2025, 23:59:47\nVrijeme: 00:16:19 (HH:MM:SS)";
    expect(findIssueTime(taxi)?.value).toBe("23:59:47");
  });

  it("ignores a duration when no date-adjacent time exists", () => {
    expect(findIssueTime("Vrijeme: 00:16:19 (HH:MM:SS)")).toBeNull();
  });

  it.each([
    ["21.02.2020,14:26:38", "14:26:38"],
    ["05.05.2023 20:40", "20:40"],
    ["16.07.2023. u 14:19:14", "14:19:14"],
  ])("reads the time written beside the date in %s", (content, expected) => {
    expect(findIssueTime(content)?.value).toBe(expected);
  });

  it("still reads a labelled time on its own line", () => {
    expect(findIssueTime("Datum: 25.9.2020\nVrijeme: 17:13")?.value).toBe("17:13");
  });
});

describe("fiscal identifiers survive thermal-print noise (iteration 21)", () => {
  it("rejoins a value wrapped onto the next line", () => {
    const wrapped =
      "ZKI: cf706ac762a61389c6c46af0ec9\n0c5c5\nJIR: 18916f95-5787-4e7f-a190-3a0\n91970cfa2\n";
    expect(findZki(wrapped)?.value).toBe("cf706ac762a61389c6c46af0ec90c5c5");
    expect(findJir(wrapped)?.value).toBe("18916f95-5787-4e7f-a190-3a091970cfa2");
  });

  it("reads past OCR noise between the label and the value", () => {
    const noisy =
      "ZKI: .\n98ac2207a287a2668511b8bf24670240\nJIR:\n4a32003f-8e49-4fe1-8df1-1dbd9f5a2405";
    expect(findZki(noisy)?.value).toBe("98ac2207a287a2668511b8bf24670240");
    expect(findJir(noisy)?.value).toBe("4a32003f-8e49-4fe1-8df1-1dbd9f5a2405");
  });

  it("does not reach across a blank line for an unrelated value", () => {
    expect(findZki("ZKI:\n\n\n043bb05ab8d54535eddca9eb43fc71f1")).toBeNull();
  });
});

describe("OIB validation (iteration 21)", () => {
  it("accepts the VAT-registration form and returns the bare OIB", () => {
    expect(normalizeOib("HR27759560625")).toBe("27759560625");
    expect(normalizeOib("27759560625")).toBe("27759560625");
  });

  it("rejects an OIB whose check digit does not verify", () => {
    // One digit of this receipt's OIB was mis-scanned; storing it would be storing a wrong company.
    expect(normalizeOib("27759550625")).toBeNull();
    expect(findOib("OIB: 27759550625")).toBeNull();
  });

  it("still finds a valid OIB later in the document", () => {
    expect(findOib("PDVbr: HR99999999999\nOIB: 27759560625")?.value).toBe("27759560625");
  });

  it("treats a shape-only OIB as Croatian fiscal evidence", () => {
    expect(hasFiscalMarkings("OIB: 12345678901")).toBe(true);
    expect(hasFiscalMarkings("Receipt total 10.00")).toBe(false);
  });
});
