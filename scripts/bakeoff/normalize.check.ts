import assert from "node:assert/strict";
import { test } from "node:test";
import { matches } from "./compare.ts";
import { normalize } from "./normalize.ts";

// 69435151530 carries a valid MOD 11,10 check digit; 12345678902 does not.
const VALID_OIB = "69435151530";

test("printed scalars become canonical values", () => {
  const { fields, unreadable, inferred } = normalize({
    sellerName: "AMPER,\nobrt za elektroinstalacijske radove",
    sellerOib: `HR${VALID_OIB}`,
    issueDate: "17.08.2026.",
    issueTime: "10:30",
    total: "1.234,56",
    currency: "€",
    jir: "b19e5e13-0a1b-4c2d-8e3f 3a0919701be5",
    paymentMethod: null,
  });
  assert.equal(fields.sellerName, "AMPER, obrt za elektroinstalacijske radove");
  assert.equal(fields.sellerOib, VALID_OIB);
  assert.equal(fields.issueDate, "2026-08-17");
  assert.equal(fields.issueTime, "10:30");
  assert.equal(fields.total, "1234.56");
  assert.equal(fields.currency, "EUR");
  assert.equal(fields.jir, "b19e5e13-0a1b-4c2d-8e3f3a0919701be5");
  assert.equal(fields.paymentMethod, null);
  assert.deepEqual(unreadable, []);
  assert.deepEqual(inferred, []);
});

test("a value no parser can read stays null and is listed", () => {
  const { fields, unreadable } = normalize({
    sellerOib: "12345678902",
    issueDate: "jučer",
    total: "sto eura",
  });
  assert.equal(fields.sellerOib, null);
  assert.equal(fields.issueDate, null);
  assert.equal(fields.total, null);
  assert.deepEqual(unreadable, ["sellerOib", "issueDate", "total"]);
});

test("table cells are parsed and an empty row is dropped", () => {
  const { fields } = normalize({
    vatBreakdown: [{ rate: "25%", taxableBase: "300,00", vatAmount: "75,00" }],
    items: [
      { description: "Kava", quantity: "3,000", unitPrice: "1,50", total: "4,50" },
      { description: null, quantity: null, unitPrice: null, total: null },
    ],
  });
  assert.equal(fields.vatBreakdown?.length, 1);
  assert.ok(matches("vatBreakdown.0.rate", "25.00", fields.vatBreakdown?.[0]?.rate));
  assert.equal(fields.vatBreakdown?.[0]?.taxableBase, "300.00");
  assert.equal(fields.items?.length, 1);
  assert.equal(fields.items?.[0]?.quantity, "3.000");
});

test("no rows means null, not an empty list", () => {
  assert.equal(normalize({ items: [] }).fields.items, null);
  assert.equal(normalize({}).fields.vatBreakdown, null);
});

test("kn is HRK", () => {
  assert.equal(normalize({ currency: "kn" }).fields.currency, "HRK");
});

test("currency is inferred only for a dated Croatian receipt that prints none", () => {
  const euro = normalize({ sellerOib: VALID_OIB, issueDate: "05.01.2023." });
  assert.equal(euro.fields.currency, "EUR");
  assert.deepEqual(euro.inferred, ["currency"]);

  assert.equal(normalize({ zki: "ab12", issueDate: "31.12.2022." }).fields.currency, "HRK");
  assert.equal(normalize({ issueDate: "05.01.2023." }).fields.currency, null);
  assert.equal(normalize({ sellerOib: VALID_OIB }).fields.currency, null);

  // A printed currency that cannot be read is unreadable, not a licence to infer.
  const odd = normalize({ sellerOib: VALID_OIB, issueDate: "05.01.2023.", currency: "bodovi" });
  assert.equal(odd.fields.currency, null);
  assert.deepEqual(odd.unreadable, ["currency"]);
});

test("a value copied with what is printed around it is still read", () => {
  const { fields, unreadable } = normalize({
    sellerOib: `OIB: ${VALID_OIB}`,
    issueDate: "02/24/17",
    currency: "$",
    items: [
      { description: "Kelj", quantity: "1,00 kg", unitPrice: "0,95 EUR/kg", total: "2,79 D1" },
    ],
  });
  assert.equal(fields.sellerOib, VALID_OIB);
  assert.equal(fields.issueDate, "2017-02-24");
  assert.equal(fields.currency, "USD");
  assert.deepEqual(fields.items?.[0], {
    description: "Kelj",
    quantity: "1.00",
    unitPrice: "0.95",
    total: "2.79",
  });
  assert.deepEqual(unreadable, []);
});

test("a labelled OIB still has to pass its check digit, and an ambiguous date stays day first", () => {
  assert.equal(normalize({ sellerOib: "OIB: 12345678902" }).fields.sellerOib, null);
  assert.equal(normalize({ issueDate: "02/03/2017" }).fields.issueDate, "2017-03-02");
});
