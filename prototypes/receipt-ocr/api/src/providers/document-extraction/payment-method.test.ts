import { describe, expect, it } from "vitest";
import { categorizePaymentMethod, findPaymentMethod } from "./payment-method.js";

describe("categorizePaymentMethod", () => {
  it.each([
    ["Gotovina", "cash"],
    ["NOVCANICE I KOVANICE", "cash"],
    ["Novčanice", "cash"],
    // `receipt123`: OCR misreads one character of the printed NOVČANICE.
    ["NONCANICE", "cash"],
    ["kartica-MasterCard", "card"],
    ["VISA", "card"],
    ["Transakcijski račun", "bank_transfer"],
    ["Ček", "cheque"],
    ["Ostalo", "other"],
  ] as const)("maps %j to %s", (text, category) => {
    expect(categorizePaymentMethod(text)).toBe(category);
  });

  it("reports several distinct methods as other", () => {
    expect(categorizePaymentMethod("Gotovina, kartica")).toBe("other");
  });

  it.each(["IC=CC", "tridesettri € i 10 c", "", null, undefined])(
    "leaves %j uncategorised rather than calling it other",
    (text) => {
      expect(categorizePaymentMethod(text)).toBeNull();
    },
  );

  it("does not stretch the one-character tolerance to short words", () => {
    // "cart" is one character from "card", and is not a payment method.
    expect(categorizePaymentMethod("cart")).toBeNull();
  });
});

describe("findPaymentMethod", () => {
  // Each string is the OCR text of a receipt in the corpus.
  it.each([
    ["Način plaćanja:\nGotovina", "cash", "Gotovina"],
    ["NAC.PLAC .: NOVCANICE I KOVANICE", "cash", "NOVCANICE I KOVANICE"],
    ["Način plaćanja : NONCANICE\nRačun broj : 49781/001/ 1", "cash", "NONCANICE"],
    // `lira_trogir`: the photo crops the label's first letter and OCR reads an accented "í".
    ["0018\načín plaćanja:\nNovčanice\nKI:", "cash", "Novčanice"],
    ["Nacin placanja: Gotovina\nUsluga: Prijevoz putnika", "cash", "Gotovina"],
    ["GOTOVINA\n517.00\nNAČIN PLAĆANJA\nNovčanice\nREKAPITULACIJA", "cash", "Novčanice"],
    ["Način plaćanja: Transakcijski račun", "bank_transfer", "Transakcijski račun"],
    ["Načini plaćanja: Bankovni prijenos", "bank_transfer", "Bankovni prijenos"],
    ["Nač. plać.: KARTICA", "card", "KARTICA"],
    ["Nac. plac.: KARTICA", "card", "KARTICA"],
  ] as const)("reads %j as a %s wording", (content, category, printed) => {
    const match = findPaymentMethod(content);

    expect(match?.value).toBe(printed);
    expect(categorizePaymentMethod(match?.value)).toBe(category);
    expect(content.slice(match!.start, match!.end)).toBe(printed);
  });

  it("does not read a tender line that carries no label", () => {
    expect(findPaymentMethod("UKUPNO EUR 1,99\nGOTOVINA 2,00\nZA VRATITI 0,01")).toBeNull();
    expect(findPaymentMethod("UKUPNO KN (NOVCANICE)\n202.00")).toBeNull();
  });

  it("returns nothing when the labelled value names no known method", () => {
    expect(findPaymentMethod("Način plaćanja: IC=CC")).toBeNull();
  });
});
