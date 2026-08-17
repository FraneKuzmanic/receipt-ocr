import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import hr from "./locales/hr.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

function values(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === "string" ? [value] : values(value),
  );
}

/**
 * Guards PRD §7.13 for every later task: adding a key to one language only fails here.
 */
describe("locale resources", () => {
  it("hr and en have identical key sets", () => {
    expect(flatten(hr).toSorted()).toEqual(flatten(en).toSorted());
  });

  it.each([
    ["en", en],
    ["hr", hr],
  ])("%s has no empty values", (_name, tree) => {
    for (const value of values(tree)) {
      expect(value.trim()).not.toBe("");
    }
  });
});
