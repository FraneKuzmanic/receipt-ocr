import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import type { SourceRegion } from "@receipt/shared";
import { mapAnalyzeResult } from "./azure-fields.js";
import { mergeExtractions, type ModelExtraction } from "./merge.js";
import { mapSourceRegions, mapStoredSourceRegions } from "./source-regions.js";

function readModel(analyzeResult: AnalyzeResultOutput): ModelExtraction {
  const mapped = mapAnalyzeResult(analyzeResult);
  return {
    fields: mapped.fields,
    metadata: mapped.fieldMetadata,
    unreadableFields: mapped.unreadableFields,
  };
}

async function fixture(name: string): Promise<AnalyzeResultOutput> {
  const raw = JSON.parse(
    await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as { analyzeResult?: AnalyzeResultOutput };
  if (raw.analyzeResult === undefined) throw new Error(`Fixture ${name} has no analyze result.`);
  return raw.analyzeResult;
}

async function secondaryFixture(name: string): Promise<AnalyzeResultOutput> {
  const raw = JSON.parse(
    await readFile(new URL(`./fixtures/secondary/${name}.json`, import.meta.url), "utf8"),
  ) as { analyzeResult?: AnalyzeResultOutput };
  if (raw.analyzeResult === undefined) throw new Error(`Fixture ${name} has no analyze result.`);
  return raw.analyzeResult;
}

function contains(region: SourceRegion, point: { x: number; y: number }): boolean {
  return (
    point.x >= region.corners[0]!.x &&
    point.x <= region.corners[2]!.x &&
    point.y >= region.corners[0]!.y &&
    point.y <= region.corners[2]!.y
  );
}

describe("source region projection", () => {
  it("normalizes both pixel and inch coordinates", async () => {
    const [image, document] = await Promise.all([
      fixture("racuntaksi1"),
      fixture("primjer-pdf-racuna"),
    ]);

    for (const result of [mapSourceRegions(image), mapSourceRegions(document)]) {
      expect(result.pages.length).toBeGreaterThan(0);
      for (const region of result.regions) {
        expect(region.corners).toHaveLength(4);
        for (const corner of region.corners) {
          expect(corner.x).toBeGreaterThanOrEqual(0);
          expect(corner.x).toBeLessThanOrEqual(1);
          expect(corner.y).toBeGreaterThanOrEqual(0);
          expect(corner.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("merges canonical fields that share one location and indexes array cells", async () => {
    const result = mapSourceRegions(await fixture("images"));
    expect(result.regions.filter((region) => region.fields.includes("total"))).toEqual([
      expect.objectContaining({ fields: expect.arrayContaining(["total", "currency"]) }),
    ]);
    expect(
      result.regions.some((region) =>
        region.fields.some((field) => field.startsWith("vatBreakdown.0.")),
      ),
    ).toBe(true);
    expect(
      result.regions.some((region) => region.fields.some((field) => field.startsWith("items.0."))),
    ).toBe(true);
  });

  it("projects canonical VAT paths from table-cell geometry", async () => {
    const result = mapSourceRegions(await fixture("racun-mobilna-trgovina"));

    for (const field of [
      "vatBreakdown.0.rate",
      "vatBreakdown.0.taxableBase",
      "vatBreakdown.0.vatAmount",
    ]) {
      const region = result.regions.find((entry) => entry.fields.includes(field));
      expect(region).toBeDefined();
      expect(region?.corners).toHaveLength(4);
      for (const corner of region?.corners ?? []) {
        expect(corner.x).toBeGreaterThanOrEqual(0);
        expect(corner.x).toBeLessThanOrEqual(1);
        expect(corner.y).toBeGreaterThanOrEqual(0);
        expect(corner.y).toBeLessThanOrEqual(1);
      }
    }
    expect(result.regions.flatMap((region) => region.fields)).not.toContain(
      "vatBreakdown.1.vatAmount",
    );
  });

  it("maps fiscal text fallbacks against source offsets after a marker", async () => {
    const result = mapSourceRegions(await fixture("26515835"));
    expect(result.regions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fields: expect.arrayContaining(["jir"]), origin: "text" }),
        expect.objectContaining({ fields: expect.arrayContaining(["zki"]), origin: "text" }),
      ]),
    );
  });

  it("returns no regions when the stored analysis has no pages", async () => {
    const raw = JSON.parse(
      await readFile(new URL("./fixtures/mapper-edge-cases.json", import.meta.url), "utf8"),
    ) as { invoice: AnalyzeResultOutput };
    expect(mapSourceRegions(raw.invoice)).toEqual({ pages: [], regions: [] });
  });

  it("outlines each field from the model that actually supplied its value", async () => {
    const [primary, secondary] = await Promise.all([
      fixture("lira_trogir"),
      secondaryFixture("lira_trogir"),
    ]);
    const stored = {
      analyzeResult: primary,
      secondaryAnalyzeResult: secondary,
      fieldModels: { items: "secondary", vatBreakdown: "secondary", issueTime: "secondary" },
    };

    const merged = mapStoredSourceRegions(stored);
    const itemRows = new Set(
      merged.regions
        .flatMap((region) => region.fields)
        .filter((field) => field.startsWith("items."))
        .map((field) => field.split(".")[1]),
    );

    // The receipt model reads four items here; the invoice model reads three, so projecting from
    // the primary response alone could never outline the fourth row.
    expect(itemRows).toEqual(new Set(["0", "1", "2", "3"]));
    expect(mapSourceRegions(primary).regions.flatMap((r) => r.fields)).not.toContain(
      "items.3.description",
    );
  });

  it("outlines an item cell filled from the other model from that model's response", async () => {
    const [primary, secondary] = await Promise.all([
      fixture("primjer1-hr-nopdv"),
      secondaryFixture("primjer1-hr-nopdv"),
    ]);
    const merged = mergeExtractions(readModel(primary), readModel(secondary));
    expect(merged.fields.items).toEqual([
      expect.objectContaining({ quantity: "1", unitPrice: "100.00" }),
    ]);

    const fields = mapStoredSourceRegions({
      analyzeResult: primary,
      secondaryAnalyzeResult: secondary,
      fieldModels: merged.fieldModels,
    }).regions.flatMap((region) => region.fields);
    // The receipt model supplies the row but read no quantity; the outline must still appear.
    expect(fields).toEqual(
      expect.arrayContaining(["items.0.description", "items.0.quantity", "items.0.unitPrice"]),
    );
    expect(mapSourceRegions(secondary).regions.flatMap((r) => r.fields)).not.toContain(
      "items.0.quantity",
    );
  });

  it("outlines a euro total replaced from text where the euro amount is printed", async () => {
    // Both models return "136,68 kn" as the total; the mapper stores the "ZA PLATITI 18,14 €" amount.
    const result = await fixture("ina-racun-sladoled");
    const page = result.pages![0]!;
    const centre = (content: string) => {
      const polygon = page.words!.find((word) => word.content === content)!.polygon!;
      const xs = polygon.filter((_, index) => index % 2 === 0);
      const ys = polygon.filter((_, index) => index % 2 === 1);
      return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2 / page.width!,
        y: (Math.min(...ys) + Math.max(...ys)) / 2 / page.height!,
      };
    };
    const totals = mapSourceRegions(result).regions.filter((region) =>
      region.fields.includes("total"),
    );
    expect(totals).toEqual([
      expect.objectContaining({
        fields: expect.arrayContaining(["total", "currency"]),
        origin: "text",
      }),
    ]);
    expect(contains(totals[0]!, centre("18,14"))).toBe(true);
    expect(contains(totals[0]!, centre("136,68"))).toBe(false);
  });

  it("falls back to the single stored response for a receipt read by one model", async () => {
    const primary = await fixture("racuntaksi1");
    expect(mapStoredSourceRegions({ analyzeResult: primary })).toEqual(mapSourceRegions(primary));
  });
});
