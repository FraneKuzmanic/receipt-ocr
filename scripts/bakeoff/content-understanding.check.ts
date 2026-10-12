import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANALYZER_ID,
  analyzerDefinition,
  cuDetails,
  cuFields,
  cuUsd,
  cuWords,
  type CuOperation,
} from "./content-understanding.ts";

const at = (y: number): string => `D(1,10,${y},50,${y},50,${y + 5},10,${y + 5})`;
const cell = (valueString: string, y?: number) => ({
  type: "string",
  valueString,
  ...(y === undefined ? {} : { source: at(y) }),
});

const operation: CuOperation = {
  status: "Succeeded",
  result: {
    contents: [
      {
        pages: [
          {
            pageNumber: 1,
            width: 100,
            height: 200,
            words: [{ content: "UKUPNO", source: at(150) }, { content: "bez izvora" }],
          },
        ],
        fields: {
          sellerName: {
            type: "string",
            valueString: "Primjer d.o.o.",
            confidence: 0.4,
            source: at(10),
          },
          total: { type: "string", valueString: "12,50", confidence: 0.9 },
          jir: { type: "string" },
          vatBreakdown: { type: "array" },
          items: {
            type: "array",
            valueArray: [
              { valueObject: { description: cell("Treći", 90), total: cell("3,00", 90) } },
              { valueObject: { description: cell("Prvi", 30), total: cell("1,00", 30) } },
              { valueObject: { description: cell("Bez izvora") } },
              { valueObject: { description: cell("Drugi", 60) } },
            ],
          },
        },
      },
    ],
  },
};

test("a scalar is its printed value and a field with none is null", () => {
  const fields = cuFields(operation);
  assert.equal(fields["sellerName"], "Primjer d.o.o.");
  assert.equal(fields["total"], "12,50");
  assert.equal(fields["jir"], null);
  assert.equal(fields["zki"], null);
  assert.equal(Object.keys(fields).length, 16);
});

test("an empty table is no rows", () => {
  assert.deepEqual(cuFields(operation)["vatBreakdown"], []);
  assert.deepEqual(cuFields({})["items"], []);
});

test("rows are sorted top to bottom and an unplaced row keeps its position", () => {
  const items = cuFields(operation)["items"] as Record<string, unknown>[];
  assert.deepEqual(
    items.map((row) => row["description"]),
    ["Prvi", "Drugi", "Bez izvora", "Treći"],
  );
  assert.deepEqual(items[0], {
    description: "Prvi",
    quantity: null,
    unitPrice: null,
    total: "1,00",
  });
});

test("confidence and position are reported per returned scalar", () => {
  assert.deepEqual(cuDetails(operation), {
    sellerName: { confidence: 0.4, sourced: true },
    total: { confidence: 0.9, sourced: false },
  });
});

test("the service's words carry their position", () => {
  const { words, pages } = cuWords(operation);
  assert.deepEqual(pages, [{ pageNumber: 1, width: 100, height: 200 }]);
  assert.deepEqual(words, [
    { content: "UKUPNO", polygon: [10, 150, 50, 150, 50, 155, 10, 155], pageNumber: 1 },
  ]);
});

test("cost counts pages, contextualization and tokens, cached ones inside the input count", () => {
  const usage = {
    documentPagesStandard: 2,
    contextualizationTokens: 2000,
    tokens: { "gpt-4.1-input": 15000, "gpt-4.1-cached-input": 5000, "gpt-4.1-output": 1000 },
  };
  // 2 x 0.005 + 2000 x 1/M + 10000 x 2/M + 5000 x 0.5/M + 1000 x 8/M
  assert.ok(Math.abs(cuUsd(usage) - 0.0425) < 1e-9);
  // Without caching all 15000 input tokens are at the full price.
  assert.ok(Math.abs(cuUsd(usage, false) - 0.05) < 1e-9);
  assert.equal(cuUsd(undefined), 0);
});

test("the analyzer carries the shared schema within the service's limits", () => {
  const definition = analyzerDefinition("gpt-4.1");
  const fields = definition.fieldSchema.fields as Record<
    string,
    { description: string; items?: { properties: Record<string, { description: string }> } }
  >;
  assert.equal(Object.keys(fields).length, 16);
  assert.ok(!ANALYZER_ID.includes("-"));
  assert.equal(definition.models.completion, "gpt-4.1");
  const descriptions = [
    definition.description,
    ...Object.values(fields).flatMap((field) => [
      field.description,
      ...Object.values(field.items?.properties ?? {}).map((c) => c.description),
    ]),
  ];
  assert.ok(descriptions.every((text) => text.length <= 1024));
  assert.ok(!("subtotal" in fields));
});
