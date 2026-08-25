import { afterEach, describe, expect, it, vi } from "vitest";
import { exportFilename, receiptExportFilename, saveBlob } from "./download";

const receipt = {
  id: "3f1c2d4e-0000-4000-8000-000000000001",
  documentNumber: "381/1/2",
  issueDate: "2026-08-19",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("download helpers", () => {
  it("builds stable export filenames", () => {
    const now = new Date("2026-08-20T14:30:00.000Z");

    expect(exportFilename("csv", now)).toBe("receipts-2026-08-20.csv");
    expect(exportFilename("json", now)).toBe("receipts-2026-08-20.json");
  });

  it("names a single receipt by its document number and issue date", () => {
    expect(receiptExportFilename(receipt, "csv")).toBe("receipt-381-1-2-2026-08-19.csv");
    expect(receiptExportFilename(receipt, "json")).toBe("receipt-381-1-2-2026-08-19.json");
  });

  it("keeps a single receipt's filename safe and non-empty whatever OCR read", () => {
    // The document number is untrusted OCR text: it reaches this helper as-is.
    expect(receiptExportFilename({ ...receipt, documentNumber: "R/2026 čšž" }, "csv")).toBe(
      "receipt-R-2026-čšž-2026-08-19.csv",
    );
    expect(receiptExportFilename({ ...receipt, documentNumber: "///" }, "csv")).toBe(
      "receipt-3f1c2d4e-2026-08-19.csv",
    );
    expect(receiptExportFilename({ ...receipt, documentNumber: null }, "csv")).toBe(
      "receipt-3f1c2d4e-2026-08-19.csv",
    );
    expect(
      receiptExportFilename({ ...receipt, documentNumber: null, issueDate: null }, "json"),
    ).toBe("receipt-3f1c2d4e.json");
  });

  it("saves a blob through an object URL and revokes it", () => {
    const createObjectURL = vi.fn(() => "blob:receipt-export");
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const blob = new Blob(["id,total"], { type: "text/csv" });
    saveBlob(blob, "receipts-2026-08-20.csv");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt-export");
    expect(document.querySelector("a")).toBeNull();
  });
});
