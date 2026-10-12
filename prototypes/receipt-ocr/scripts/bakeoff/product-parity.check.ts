/**
 * The product's scalar reader is a copy of what this harness measured, because `api/` may not
 * import from `scripts/`. A copy drifts; this fails when it does. The measured accuracy is of
 * this wording and this schema, so a change on either side needs a new measurement, not an edit
 * to this file.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SCALAR_FIELDS as PRODUCT_FIELDS } from "../../api/src/providers/document-extraction/scalar-merge.js";
import {
  READER_SCHEMA,
  READER_SYSTEM,
  documentMessage,
} from "../../api/src/providers/document-extraction/scalar-reader.js";
import { SCALAR_FIELDS, SYSTEM } from "./field-schema.ts";
import { REPAIR_SCHEMA } from "./repair.ts";

test("the product's prompt is the measured one, character for character", () => {
  assert.equal(READER_SYSTEM, SYSTEM);
  assert.equal(documentMessage("x"), "<dokument>\nx\n</dokument>");
});

test("the product asks for the same scalar fields, in the same order", () => {
  assert.deepEqual([...PRODUCT_FIELDS], SCALAR_FIELDS);
});

test("the product's schema is the measured one, descriptions included", () => {
  assert.deepEqual(READER_SCHEMA, REPAIR_SCHEMA);
});
