import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import { mapSourceRegions } from "./source-regions.js";

async function fixture(name: string): Promise<AnalyzeResultOutput> {
  const raw = JSON.parse(
    await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as { analyzeResult?: AnalyzeResultOutput };
  if (raw.analyzeResult === undefined) throw new Error(`Fixture ${name} has no analyze result.`);
  return raw.analyzeResult;
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
});
