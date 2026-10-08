import assert from "node:assert/strict";
import { test } from "node:test";
import { matches, scoreReceipt } from "./compare.ts";

test("amounts compare numerically", () => {
  assert.ok(matches("vatBreakdown.0.rate", "25", "25.00"));
  assert.ok(matches("total", "100.50", "100.5"));
  assert.ok(!matches("total", "100.50", "100.51"));
});

test("text ignores case, spacing, punctuation and diacritics", () => {
  assert.ok(matches("sellerName", "Građanin d.o.o.", "GRADANIN  DOO"));
  assert.ok(!matches("sellerName", "Milenij hoteli", "Kavana Wagner"));
});

test("dates, times, OIBs and currency are exact; JIR and ZKI ignore case", () => {
  assert.ok(!matches("issueTime", "10:30", "10:30:00"));
  assert.ok(!matches("issueDate", "2026-08-17", "2026-08-18"));
  assert.ok(matches("jir", "ab12-cd", "AB12-CD"));
});

test("null against null matches; null against a value does not", () => {
  assert.ok(matches("jir", null, undefined));
  assert.ok(!matches("jir", null, "ab12"));
  assert.ok(!matches("jir", "ab12", null));
});

test("an absent key is not scored and a null key is", () => {
  const score = scoreReceipt({ total: "10.00", jir: null }, { total: "10.00", jir: "ab12" });
  assert.deepEqual(
    score.cells.map((cell) => [cell.path, cell.match]),
    [
      ["total", true],
      ["jir", false],
    ],
  );
  assert.equal(score.noCriticalCorrection, true);
});

test("a missing row costs its cells and the row count", () => {
  const row = { description: "Kava", quantity: "1", unitPrice: "1.50", total: "1.50" };
  const score = scoreReceipt({ items: [row, row, row, row] }, { items: [row, row, row] });
  assert.equal(score.rowCountExact.items, false);
  const items = score.cells.filter((cell) => cell.group === "items");
  assert.equal(items.length, 16);
  assert.equal(items.filter((cell) => cell.match).length, 12);
  assert.equal(score.noCriticalCorrection, null);
});

test("rows returned where none are expected show in the row count only", () => {
  const score = scoreReceipt(
    { vatBreakdown: null },
    { vatBreakdown: [{ rate: "0", taxableBase: "100.00", vatAmount: "0.00" }] },
  );
  assert.equal(score.rowCountExact.vatBreakdown, false);
  assert.equal(score.cells.length, 0);
});
