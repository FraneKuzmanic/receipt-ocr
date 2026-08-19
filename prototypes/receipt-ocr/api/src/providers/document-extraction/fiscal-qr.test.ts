import { describe, expect, it } from "vitest";
import { parseFiscalQr } from "./fiscal-qr.js";

describe("fiscal QR parsing", () => {
  it.each([
    [
      "https://porezna.gov.hr/rn?jir=18916f95-5787-4e7f-a190-3a091970cfa2&datv=20250331_2359&izn=132,72",
      {
        jir: "18916f95-5787-4e7f-a190-3a091970cfa2",
        zki: null,
        issueDate: "2025-03-31",
        issueTime: "23:59",
        total: "132.72",
      },
    ],
    [
      "https://porezna.gov.hr/rn?jir=1193a137-a1f5-4085-9e1b-3a0919701a4f&datv=20240123_1512&izn=199",
      {
        jir: "1193a137-a1f5-4085-9e1b-3a0919701a4f",
        zki: null,
        issueDate: "2024-01-23",
        issueTime: "15:12",
        total: null,
      },
    ],
    [
      "ac12e053-3300-496a-8ad4-1bd2c10b0ec6",
      {
        jir: "ac12e053-3300-496a-8ad4-1bd2c10b0ec6",
        zki: null,
        issueDate: null,
        issueTime: null,
        total: null,
      },
    ],
    [
      "https://porezna.gov.hr/rn?zki=0123456789abcdef0123456789abcdef",
      {
        jir: null,
        zki: "0123456789abcdef0123456789abcdef",
        issueDate: null,
        issueTime: null,
        total: null,
      },
    ],
    [
      "https://porezna.gov.hr/rn?JIR=18916f95-5787-4e7f-a190-3a091970cfa2&DATV=20250331_2359&IZN=132.72",
      {
        jir: "18916f95-5787-4e7f-a190-3a091970cfa2",
        zki: null,
        issueDate: "2025-03-31",
        issueTime: "23:59",
        total: "132.72",
      },
    ],
  ])("parses %s", (payload, expected) => {
    expect(parseFiscalQr(payload)).toMatchObject(expected);
  });

  it("preserves non-fiscal and malformed payloads without inventing fields", () => {
    for (const payload of [
      "https://example.com/promo",
      "not a qr",
      "",
      "x".repeat(600),
      "https://porezna.gov.hr/rn?jir=not-an-id&datv=20241332_2599&izn=12,34",
    ]) {
      const parsed = parseFiscalQr(payload);
      expect(parsed).toMatchObject({
        jir: null,
        zki: null,
        issueDate: null,
        issueTime: null,
      });
    }
  });

  it("preserves separator-less izn in raw data without comparing a guessed total", () => {
    const parsed = parseFiscalQr(
      "https://porezna.gov.hr/rn?jir=1193a137-a1f5-4085-9e1b-3a0919701a4f&datv=20240123_1512&izn=199",
    );

    expect(parsed.raw).toContain("izn=199");
    expect(parsed.total).toBeNull();
  });
});
