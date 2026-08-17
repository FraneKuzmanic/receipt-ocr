import { WARNING_CODES } from "@receipt/shared";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import hr from "./locales/hr.json";

const LOCALES = [
  ["en", en],
  ["hr", hr],
] as const;

/**
 * `/validate` Phase 6.5 only sees translation calls whose key is a string literal. Task 09 will
 * render these messages from a template literal built out of the warning code, which that check
 * cannot follow — so this test is the only thing standing between a newly added warning code and
 * a raw key shown to a user.
 *
 * It doubles as proof that the canonical model imports cleanly from the client, under Vite's
 * `bundler` resolution rather than Node's `nodenext`.
 */
describe("warning messages", () => {
  it.each(LOCALES)("%s has a non-empty message for every warning code", (_name, locale) => {
    for (const code of WARNING_CODES) {
      const message: string | undefined = locale.warnings[code];
      expect(message, `missing warnings.${code}`).toBeDefined();
      expect(message?.trim(), `empty warnings.${code}`).not.toBe("");
    }
  });

  it.each(LOCALES)("%s has no warning message without a matching code", (_name, locale) => {
    const known = new Set<string>(WARNING_CODES);
    expect(Object.keys(locale.warnings).filter((key) => !known.has(key))).toEqual([]);
  });
});
