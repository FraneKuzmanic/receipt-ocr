import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";
import { hasUnreadVatSignal } from "./tax-signals.js";

async function content(name: string): Promise<string> {
  const raw = JSON.parse(
    await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as { analyzeResult?: AnalyzeResultOutput };
  if (raw.analyzeResult === undefined) throw new Error(`Fixture ${name} has no analyze result.`);
  return raw.analyzeResult.content;
}

describe("unread VAT signals", () => {
  it.each(["26515835", "31231822", "racun-mobilna-trgovina"])(
    "recognizes the structural VAT recap in %s",
    async (name) => {
      await expect(content(name).then(hasUnreadVatSignal)).resolves.toBe(true);
    },
  );

  it.each([
    ["racuntaksi1", "VAT exemption under article 90"],
    ["primjer-pdf-racuna", "PDV nije obračunat"],
    ["screenshot-20190705-1907152", "not in the VAT system"],
  ])("does not warn for %s: %s", async (name) => {
    await expect(content(name).then(hasUnreadVatSignal)).resolves.toBe(false);
  });

  it("requires more than one structural marker", () => {
    expect(hasUnreadVatSignal("Osnovica 10,00")).toBe(false);
  });
});
