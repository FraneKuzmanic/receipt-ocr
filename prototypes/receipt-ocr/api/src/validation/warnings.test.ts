import {
  receiptWarningSchema,
  type CanonicalReceiptFields,
  type ReceiptWarning,
} from "@receipt/shared";
import { describe, expect, it } from "vitest";
import type { FiscalQrData } from "../providers/document-extraction/fiscal-qr.js";
import { computeWarnings, qrCorroboratedFields } from "./warnings.js";

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
  it("checks each row against its own base and rate, and names the row", () => {
    const vatBreakdown = [
      { rate: "5", taxableBase: "1.90", vatAmount: "0.09" },
      { rate: "25", taxableBase: "100.00", vatAmount: "20.00" },
    ];

    expect(computeWarnings({ fields: { ...completeFields, vatBreakdown } })).toEqual([
      { code: "vat_arithmetic_mismatch", field: "vatBreakdown.1.vatAmount" },
    ]);
  });

  it("never compares the rows with the receipt total", () => {
    // `22559270`: three consistent rows that the receipt itself prints 0.90 short of its total.
    const vatBreakdown = [
      { rate: "25", taxableBase: "60.08", vatAmount: "15.02" },
      { rate: "25", taxableBase: "88.80", vatAmount: "22.20" },
      { rate: "13", taxableBase: "292.04", vatAmount: "37.96" },
    ];

    expect(
      computeWarnings({ fields: { ...completeFields, total: "517.00", vatBreakdown } }),
    ).toEqual([]);
  });

  it("skips a row it does not have enough information to judge", () => {
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

describe("OIB check-digit warnings", () => {
  it("warns on a seller or buyer OIB that fails its check digit, and only then", () => {
    expect(
      computeWarnings({
        fields: { ...completeFields, sellerOib: "12345678902", buyerOib: "12345678901" },
      }),
    ).toEqual([
      { code: "oib_checksum_invalid", field: "sellerOib" },
      { code: "oib_checksum_invalid", field: "buyerOib" },
    ]);
    expect(
      computeWarnings({ fields: { ...completeFields, sellerOib: "27759560625", buyerOib: "" } }),
    ).toEqual([]);
    // The VAT-registration form of a valid OIB is the same identifier, as the mapper reads it.
    expect(computeWarnings({ fields: { ...completeFields, sellerOib: "HR27759560625" } })).toEqual(
      [],
    );
  });
});

describe("qrCorroboratedFields", () => {
  it("lists exactly the fields the QR code carries and agrees with", () => {
    const fields = { ...completeFields, jir: "18916F95-5787-4E7F-A190-3A091970CFA2" };

    expect(qrCorroboratedFields(fields, fiscalQr())).toEqual([
      "issueDate",
      "issueTime",
      "total",
      "jir",
    ]);
    expect(qrCorroboratedFields({ ...fields, total: "132.70" }, fiscalQr())).not.toContain("total");
    expect(qrCorroboratedFields(fields, fiscalQr({ total: null, issueTime: null }))).toEqual([
      "issueDate",
      "jir",
    ]);
    expect(qrCorroboratedFields(fields, null)).toEqual([]);
  });
});

describe("unread VAT warnings", () => {
  it("warns exactly once only when source text has a recap and no VAT row was mapped", () => {
    const unread = computeWarnings({ fields: completeFields, vatTextPresent: true });
    const mapped = computeWarnings({
      fields: {
        ...completeFields,
        vatBreakdown: [{ rate: "25", taxableBase: "10.40", vatAmount: "2.60" }],
      },
      vatTextPresent: true,
    });

    expect(warningsByCode(unread, "vat_present_but_unread")).toEqual([
      { code: "vat_present_but_unread", field: "vatBreakdown" },
    ]);
    expect(warningsByCode(mapped, "vat_present_but_unread")).toEqual([]);
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

describe("QR JIR warnings", () => {
  it("flags an OCR-misread JIR and clears it when the value is corrected", () => {
    // receipt123: OCR read "61985013-…-380919701be5" where the QR code holds "b19e5e13-…-3a0919701be5".
    const qr = fiscalQr({ jir: "b19e5e13-0388-4284-9be9-3a0919701be5" });
    const misread = computeWarnings({
      fields: { ...completeFields, jir: "61985013-0388-4284-9De9-380919701be5" },
      qr,
    });
    const corrected = computeWarnings({
      fields: { ...completeFields, jir: "B19E5E13-0388-4284-9BE9-3A0919701BE5" },
      qr,
    });

    expect(warningsByCode(misread, "qr_jir_mismatch")).toEqual([
      { code: "qr_jir_mismatch", field: "jir" },
    ]);
    expect(warningsByCode(corrected, "qr_jir_mismatch")).toEqual([]);
  });

  it("stays silent when either side has no JIR to compare", () => {
    const fields = { ...completeFields, jir: "61985013-0388-4284-9De9-380919701be5" };
    expect(computeWarnings({ fields, qr: fiscalQr({ jir: null }) })).toEqual([]);
    expect(computeWarnings({ fields: completeFields, qr: fiscalQr() })).toEqual([]);
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
