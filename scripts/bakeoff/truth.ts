/**
 * The one ground truth both scorers read.
 *
 * Scalars come from `.agents/fixtures/expected/<sample>.json`, which the product owner verified.
 * `ground-truth/<sample>.json` adds what those files do not hold: line items, and the whole truth
 * of a receipt that has no expected file because it has no recorded fixture.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EXPECTED_DIR, GROUND_TRUTH_DIR, type Sample } from "./samples.ts";

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

export function groundTruth(sample: Sample): Record<string, unknown> {
  const expectedPath = join(EXPECTED_DIR, `${sample.name}.json`);
  const additionsPath = join(GROUND_TRUTH_DIR, `${sample.name}.json`);
  const expected = existsSync(expectedPath) ? readJson(expectedPath) : null;
  const file = existsSync(additionsPath) ? readJson(additionsPath) : null;
  if (expected === null && file === null) throw new Error(`no ground truth for '${sample.name}'`);

  const { verifiedBy: _verifiedBy, notes: _notes, ...additions } = file ?? {};
  for (const key of Object.keys(additions)) {
    if (
      expected !== null &&
      key in expected &&
      JSON.stringify(expected[key]) !== JSON.stringify(additions[key])
    ) {
      throw new Error(
        `'${sample.name}': '${key}' is in both ground-truth files with different values`,
      );
    }
  }
  return { ...expected, ...additions };
}

/**
 * Line items live in `ground-truth/` and VAT rows in the expected files; neither table has been
 * checked by the product owner until every ground-truth file names who verified it.
 */
export const TABLES_VERIFIED: boolean = readdirSync(GROUND_TRUTH_DIR)
  .filter((name) => name.endsWith(".json"))
  .every((name) => Boolean(readJson(join(GROUND_TRUTH_DIR, name))["verifiedBy"]));
