import assert from "node:assert/strict";
import { test } from "node:test";
import type { LlmReading, ProductionReading } from "./repair.ts";
import { mergeScalars } from "./scalar-merge.ts";

const production = (overrides: Partial<ProductionReading> = {}): ProductionReading => ({
  fields: {
    sellerName: "Kavana Wagner",
    documentNumber: "38302/013/10",
    issueDate: "2022-06-26",
    issueTime: "09:58",
    total: "517.00",
    jir: "c8403f99",
    buyerName: "Kavana Wagner",
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

test("a QR-locked field is production's whatever the model returns", () => {
  const out = mergeScalars(production(), llm({ jir: "ffffffff", issueDate: "2022-06-27" }));
  assert.equal(out.fields.jir, "c8403f99");
  assert.equal(out.fields.issueDate, "2022-06-26");
  assert.deepEqual([out.replaced, out.disagreed], [[], []]);
});

test("the buyer block is the model's, including empty", () => {
  const cleared = mergeScalars(production(), llm({ buyerName: null }));
  assert.equal(cleared.fields.buyerName, null);
  assert.deepEqual(cleared.cleared, ["buyerName"]);

  const replaced = mergeScalars(production(), llm({ buyerName: "Ana Horvat", buyerOib: "1" }));
  assert.equal(replaced.fields.buyerName, "Ana Horvat");
  assert.deepEqual([replaced.replaced, replaced.filled], [["buyerName"], ["buyerOib"]]);
});

test("payment method and issue time are the model's when it has one, else production's", () => {
  const out = mergeScalars(production(), llm({ issueTime: "09:59", paymentMethod: "Novčanice" }));
  assert.equal(out.fields.issueTime, "09:59");
  assert.equal(out.fields.paymentMethod, "Novčanice");
  assert.deepEqual([out.replaced, out.filled], [["issueTime"], ["paymentMethod"]]);
  assert.equal(mergeScalars(production(), llm({ issueTime: null })).fields.issueTime, "09:58");
});

test("every other scalar is production's when it has one, and a difference is listed", () => {
  const out = mergeScalars(
    production(),
    llm({ sellerName: "Milenij hoteli d.o.o.", documentNumber: "38302/013/10", zki: "abc" }),
  );
  assert.equal(out.fields.sellerName, "Kavana Wagner");
  assert.equal(out.fields.zki, "abc");
  assert.deepEqual([out.disagreed, out.filled], [["sellerName"], ["zki"]]);
});

test("a difference the comparator ignores is not a disagreement", () => {
  const out = mergeScalars(production(), llm({ sellerName: "KAVANA  WAGNER", total: "517" }));
  assert.deepEqual(out.disagreed, []);
});

test("a null outside the buyer block never blanks a value", () => {
  const out = mergeScalars(production(), llm({ sellerName: null, total: null, issueTime: null }));
  assert.equal(out.fields.sellerName, "Kavana Wagner");
  assert.equal(out.fields.total, "517.00");
  assert.equal(out.fields.issueTime, "09:58");
});

test("a value the normaliser inferred or could not read is not the model's reading", () => {
  const empty = production({ fields: { buyerOib: "12345678903" }, sources: {}, qr: null });
  const inferred = mergeScalars(empty, llm({ currency: null }, { currency: "EUR" }));
  assert.equal(inferred.fields.currency, undefined);
  const unreadable = mergeScalars(empty, llm({ buyerOib: "OIB kupca" }, { buyerOib: null }));
  assert.equal(unreadable.fields.buyerOib, "12345678903");
});

test("with a grounding test, a value not on the page is no reading, and never 'empty'", () => {
  const out = mergeScalars(
    production(),
    llm({ buyerName: "Ana Horvat", paymentMethod: "Kartica", zki: "abc" }),
    (name) => name === "zki",
  );
  assert.equal(out.fields.buyerName, "Kavana Wagner");
  assert.equal(out.fields.paymentMethod, undefined);
  assert.equal(out.fields.zki, "abc");
  assert.deepEqual(out.rejectedUngrounded, ["buyerName", "paymentMethod"]);
});

test("tables are production's", () => {
  const reading = production();
  const out = mergeScalars(reading, { printed: { items: [] }, fields: { items: null } });
  assert.deepEqual(out.fields.items, reading.fields.items);
});
