import {
  receiptWarningSchema,
  type CanonicalReceiptFields,
  type ReceiptWarning,
} from "@receipt/shared";
import { describe, expect, it } from "vitest";
import type { FiscalQrData } from "../providers/document-extraction/fiscal-qr.js";
import { computeWarnings } from "./warnings.js";

const completeFields: CanonicalReceiptFields = {
  sellerName: "Seller",
  documentNumber: "381/1/3",
  issueDate: "2025-03-31",
  issueTime: "15:12:38",
  total: "132.72",
  currency: "EUR",
};

function fiscalQr(overrides: Partial<FiscalQrData> = {}): FiscalQrData {
  return {
    raw: "https://porezna.gov.hr/rn?jir=18916f95-5787-4e7f-a190-3a091970cfa2",
    jir: "18916f95-5787-4e7f-a190-3a091970cfa2",
    zki: null,
    issueDate: "2025-03-31",
    issueTime: "15:12",
    total: "132.72",
    ...overrides,
  };
}

function warningsByCode(
  warnings: ReceiptWarning[],
  code: ReceiptWarning["code"],
): ReceiptWarning[] {
  return warnings.filter((warning) => warning.code === code);
}

describe("missing critical field warnings", () => {
  it("emits one warning for every absent critical field", () => {
    const warnings = computeWarnings({ fields: {} });

    expect(warningsByCode(warnings, "missing_critical_field")).toEqual([
      { code: "missing_critical_field", field: "sellerName" },
      { code: "missing_critical_field", field: "documentNumber" },
      { code: "missing_critical_field", field: "issueDate" },
      { code: "missing_critical_field", field: "total" },
      { code: "missing_critical_field", field: "currency" },
    ]);
    expect(computeWarnings({ fields: { ...completeFields, sellerName: "   " } })).toContainEqual({
      code: "missing_critical_field",
      field: "sellerName",
    });
    expect(computeWarnings({ fields: completeFields })).toEqual([]);
  });
});

describe("unparseable date and amount warnings", () => {
  it("distinguishes unreadable source content from absent values, and clears once corrected", () => {
    const unreadableDate = { ...completeFields, issueDate: undefined };
    const unreadableTotal = { ...completeFields, total: undefined };

    expect(computeWarnings({ fields: unreadableDate, unreadable: ["issueDate"] })).toContainEqual({
      code: "unparseable_date",
      field: "issueDate",
    });
    expect(computeWarnings({ fields: unreadableTotal, unreadable: ["total"] })).toContainEqual({
      code: "unparseable_amount",
      field: "total",
    });
    expect(
      warningsByCode(
        computeWarnings({ fields: completeFields, unreadable: ["issueDate"] }),
        "unparseable_date",
      ),
    ).toEqual([]);
    expect(
      warningsByCode(
        computeWarnings({ fields: completeFields, unreadable: ["total"] }),
        "unparseable_amount",
      ),
    ).toEqual([]);
    expect(computeWarnings({ fields: completeFields, unreadable: [] })).toEqual([]);
  });
});

describe("VAT arithmetic warnings", () => {
  it("checks complete VAT data exactly and skips incomplete data", () => {
    const vatBreakdown = [{ rate: "5", taxableBase: "1.90", vatAmount: "0.09" }];

    expect(computeWarnings({ fields: { ...completeFields, total: "1.99", vatBreakdown } })).toEqual(
      [],
    );
    expect(
      computeWarnings({ fields: { ...completeFields, total: "2.50", vatBreakdown } }),
    ).toContainEqual({
      code: "vat_arithmetic_mismatch",
      field: "vatBreakdown",
    });
    expect(
      computeWarnings({
        fields: {
          ...completeFields,
          vatBreakdown: [{ rate: "5", taxableBase: null, vatAmount: "0.09" }],
        },
      }),
    ).toEqual([]);
    expect(computeWarnings({ fields: completeFields })).toEqual([]);
  });
});

describe("QR total warnings", () => {
  it("emits exactly one mismatch and clears it when the value is corrected", () => {
    const mismatch = computeWarnings({
      fields: { ...completeFields, total: "130.00" },
      qr: fiscalQr(),
    });
    const corrected = computeWarnings({ fields: completeFields, qr: fiscalQr() });

    expect(warningsByCode(mismatch, "qr_total_mismatch")).toEqual([
      { code: "qr_total_mismatch", field: "total" },
    ]);
    expect(warningsByCode(corrected, "qr_total_mismatch")).toEqual([]);
    expect(
      warningsByCode(
        computeWarnings({ fields: completeFields, qr: fiscalQr({ total: null }) }),
        "qr_total_mismatch",
      ),
    ).toEqual([]);
  });
});

describe("QR datetime warnings", () => {
  it("compares dates and minute precision without inventing seconds", () => {
    expect(computeWarnings({ fields: completeFields, qr: fiscalQr() })).toEqual([]);
    expect(
      warningsByCode(
        computeWarnings({ fields: completeFields, qr: fiscalQr({ issueDate: "2025-04-01" }) }),
        "qr_datetime_mismatch",
      ),
    ).toHaveLength(1);
    expect(
      warningsByCode(
        computeWarnings({ fields: { ...completeFields, issueTime: "15:13" }, qr: fiscalQr() }),
        "qr_datetime_mismatch",
      ),
    ).toHaveLength(1);
  });
});

describe("warning structure", () => {
  it("returns only warnings accepted by the shared repository boundary", () => {
    const warnings = computeWarnings({ fields: {}, unreadable: ["issueDate", "total"] });

    for (const warning of warnings) expect(receiptWarningSchema.parse(warning)).toEqual(warning);
  });
});
