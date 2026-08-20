import { RECEIPT_STATUSES } from "@receipt/shared";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import hr from "./locales/hr.json";

const LOCALES = [
  ["en", en],
  ["hr", hr],
] as const;

/** History status keys are computed from a template literal, beyond Phase 6.5's literal-key scan. */
describe("receipt status messages", () => {
  it.each(LOCALES)("%s has a non-empty message for every receipt status", (_name, locale) => {
    for (const status of RECEIPT_STATUSES) {
      const message: string | undefined = locale.history.status[status];
      expect(message, `missing history.status.${status}`).toBeDefined();
      expect(message?.trim(), `empty history.status.${status}`).not.toBe("");
    }
  });

  it.each(LOCALES)(
    "%s has no status message without a matching receipt status",
    (_name, locale) => {
      const known = new Set<string>(RECEIPT_STATUSES);
      expect(Object.keys(locale.history.status).filter((key) => !known.has(key))).toEqual([]);
    },
  );
});
