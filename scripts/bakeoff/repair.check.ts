import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayoutPage, LayoutWord } from "./ground.ts";
import {
  REPAIR_SCHEMA,
  applyRepair,
  lockedFields,
  repairContent,
  type LlmReading,
  type ProductionReading,
} from "./repair.ts";

const pages: LayoutPage[] = [{ pageNumber: 1, width: 100, height: 100 }];
const page = (text: string): LayoutWord[] =>
  text
    .split(/\s+/)
    .map((content, i) => ({ content, polygon: [0, i, 10, i, 10, i + 1, 0, i + 1], pageNumber: 1 }));

const words = page(
  "Kavana Wagner Milenij hoteli d.o.o. M. Tita 109 Opatija Račun 38302/013/101 26.06.2022. 09:58 UKUPNO 517,00 Novčanice JIR c8403f99",
);

const production = (overrides: Partial<ProductionReading> = {}): ProductionReading => ({
  fields: {
    sellerName: "Kavana Wagner",
    documentNumber: "38302/013/10",
    issueDate: "2022-06-26",
    total: "517.00",
    jir: "c8403f99",
    vatBreakdown: [{ rate: "25", taxableBase: "60.08", vatAmount: "15.02" }],
    items: [{ description: "Kava", quantity: "1", unitPrice: "10.00", total: "10.00" }],
  },
  sources: { jir: { source: "qr" }, total: { source: "model" } },
  qr: {
    raw: "",
    jir: "c8403f99",
    zki: null,
    issueDate: "2022-06-26",
    issueTime: null,
    total: null,
  },
  ...overrides,
});

const llm = (printed: Record<string, string | null>, fields = printed): LlmReading => ({
  printed,
  fields,
});

test("fill adds what production left empty and touches nothing it read", () => {
  const out = applyRepair(
    "fill",
    production(),
    llm({ sellerName: "Milenij hoteli d.o.o.", paymentMethod: "Novčanice" }),
    words,
    pages,
  );
  assert.equal(out.fields.sellerName, "Kavana Wagner");
  assert.equal(out.fields.paymentMethod, "Novčanice");
  assert.deepEqual(out.filled, ["paymentMethod"]);
  assert.deepEqual(out.changed, []);
});

test("weak replaces a seller name and not a total", () => {
  const out = applyRepair(
    "weak",
    production(),
    llm({ sellerName: "Milenij hoteli d.o.o.", total: "109" }),
    words,
    pages,
  );
  assert.equal(out.fields.sellerName, "Milenij hoteli d.o.o.");
  assert.equal(out.fields.total, "517.00");
  assert.deepEqual(out.changed, ["sellerName"]);
});

test("all replaces a document number, but nothing the QR code supplied or agrees with", () => {
  const reading = production();
  assert.deepEqual([...lockedFields(reading)].toSorted(), ["issueDate", "jir"]);
  const out = applyRepair(
    "all",
    reading,
    llm(
      { documentNumber: "38302/013/101", issueDate: "09:58", jir: "Wagner" },
      { documentNumber: "38302/013/101", issueDate: "2022-06-27", jir: "Wagner" },
    ),
    words,
    pages,
  );
  assert.equal(out.fields.documentNumber, "38302/013/101");
  assert.equal(out.fields.issueDate, "2022-06-26");
  assert.equal(out.fields.jir, "c8403f99");
  assert.deepEqual(out.changed, ["documentNumber"]);
});

test("a value that is not on the page is rejected and listed", () => {
  const out = applyRepair(
    "all",
    production(),
    llm({ sellerName: "Hoteli Opatija d.d.", documentNumber: "381/3/2017" }),
    words,
    pages,
  );
  assert.equal(out.fields.sellerName, "Kavana Wagner");
  assert.equal(out.fields.documentNumber, "38302/013/10");
  assert.deepEqual(out.rejectedUngrounded, ["sellerName", "documentNumber"]);
});

test("a canonical value is found in the form the receipt prints it", () => {
  const out = applyRepair(
    "all",
    production({ fields: {}, sources: {}, qr: null }),
    llm(
      { issueDate: "26. lipnja", total: "EUR 517" },
      { issueDate: "2022-06-26", total: "517.00" },
    ),
    words,
    pages,
  );
  assert.deepEqual(out.filled, ["issueDate", "total"]);
});

test("a null from the model never blanks a value", () => {
  for (const policy of ["fill", "weak", "all"] as const) {
    const out = applyRepair(
      policy,
      production(),
      llm({ sellerName: null, total: null }),
      words,
      pages,
    );
    assert.equal(out.fields.sellerName, "Kavana Wagner");
    assert.equal(out.fields.total, "517.00");
  }
});

test("tables are production's, whatever the model returns", () => {
  const reading = production();
  const out = applyRepair(
    "all",
    reading,
    { printed: { items: [] }, fields: { items: null, vatBreakdown: null } },
    words,
    pages,
  );
  assert.deepEqual(out.fields.items, reading.fields.items);
  assert.deepEqual(out.fields.vatBreakdown, reading.fields.vatBreakdown);
});

test("the request asks for the 14 scalars and shows production's reading of them", () => {
  assert.equal(REPAIR_SCHEMA.required.length, 14);
  assert.ok(!("items" in REPAIR_SCHEMA.properties));
  const content = repairContent("UKUPNO 517,00", production().fields);
  assert.match(content, /<dokument>\nUKUPNO 517,00\n<\/dokument>/);
  assert.match(content, /"sellerName": "Kavana Wagner"/);
  assert.match(content, /"paymentMethod": null/);
  assert.ok(!content.includes('Kava"'));
});

test("a value glued to its label by OCR is still found, and one the normaliser inferred is not the model's", () => {
  const glued = page("ZKI:8481a9c8 JIR:58d14366");
  const empty = production({ fields: {}, sources: {}, qr: null });
  const out = applyRepair("fill", empty, llm({ jir: "58d14366", zki: "8481a9c8" }), glued, pages);
  assert.deepEqual(out.filled, ["jir", "zki"]);
  const inferred = applyRepair(
    "fill",
    empty,
    llm({ currency: null }, { currency: "EUR" }),
    glued,
    pages,
  );
  assert.deepEqual([inferred.filled, inferred.rejectedUngrounded], [[], []]);
});

test("a value equal to production's is not counted, on the page or not", () => {
  const out = applyRepair(
    "all",
    production(),
    llm({ sellerName: "Kavana Wagner", total: "517.00" }),
    page("nothing"),
    pages,
  );
  assert.deepEqual([out.changed, out.rejectedUngrounded], [[], []]);
});
