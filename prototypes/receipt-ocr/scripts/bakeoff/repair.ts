/**
 * The `repair` arm: an LLM pass on top of production. The model is given production's OCR text
 * and production's reading of it, and returns the scalar fields as printed.
 *
 * What the pass may change is not left to the prompt. Three policies, fixed before any paid call,
 * decide it deterministically, and the scorer applies all three to the same recorded calls.
 * Line items, VAT rows, positions and confidences are always production's.
 */
import type { CanonicalReceiptFields } from "@receipt/shared";
import type { FiscalQrData } from "../../api/src/providers/document-extraction/fiscal-qr.js";
import { qrCorroboratedFields } from "../../api/src/validation/warnings.js";
import { SCALAR_FIELDS, SCHEMA, SYSTEM } from "./field-schema.ts";
import { groundValue, type LayoutPage, type LayoutWord } from "./ground.ts";

const scalarProperties = Object.fromEntries(
  Object.entries(SCHEMA.properties).filter(([name]) => SCALAR_FIELDS.includes(name)),
);

/** The shared schema's scalar fields, descriptions unchanged. */
export const REPAIR_SCHEMA = {
  type: "object",
  properties: scalarProperties,
  required: Object.keys(scalarProperties),
  additionalProperties: false,
};

export const REPAIR_SYSTEM = `${SYSTEM}

Uz tekst dokumenta dobivaš i prvo automatsko čitanje tog dokumenta. To čitanje može sadržavati pogreške i praznine. Svako polje vrati onako kako je ispisano u tekstu dokumenta, a ne onako kako ga navodi prvo čitanje. Polje kojeg nema u tekstu dokumenta je null.`;

export function repairContent(text: string, productionFields: CanonicalReceiptFields): string {
  const reading = Object.fromEntries(
    SCALAR_FIELDS.map((name) => [
      name,
      (productionFields as Record<string, unknown>)[name] ?? null,
    ]),
  );
  return `<dokument>\n${text}\n</dokument>\n<prvo_citanje>\n${JSON.stringify(reading, null, 2)}\n</prvo_citanje>`;
}

export const POLICIES = ["fill", "weak", "all"] as const;
export type Policy = (typeof POLICIES)[number];

/** Where production is weakest (history 26), and so where `weak` lets the model overrule it. */
export const WEAK: readonly string[] = [
  "sellerName",
  "sellerAddress",
  "buyerName",
  "buyerAddress",
  "buyerOib",
  "paymentMethod",
];

export interface ProductionReading {
  fields: CanonicalReceiptFields;
  /** `metadata.fields` of the provider result. */
  sources: Record<string, { source: string }>;
  qr: FiscalQrData | null;
}

/** What the model returned: each value as it copied it, and as the normaliser read it. */
export interface LlmReading {
  printed: Record<string, unknown>;
  fields: CanonicalReceiptFields;
}

const filled = (value: unknown): value is string => typeof value === "string" && value !== "";

/** Fields no policy may change: the QR code supplied them, or agrees with them. */
export function lockedFields(production: ProductionReading): Set<string> {
  return new Set([
    ...Object.entries(production.sources)
      .filter(([, meta]) => meta.source === "qr")
      .map(([name]) => name),
    ...qrCorroboratedFields(production.fields, production.qr),
  ]);
}

/**
 * Is the value on the page? Looked for as the model copied it and, for a date, an amount or an
 * OIB, in the forms its canonical value is printed in. `ground.ts` folds diacritics when it
 * looks, which suits finding a value and is not the scoring rule.
 */
export function isGrounded(
  printed: unknown,
  canonical: unknown,
  words: LayoutWord[],
  pages: LayoutPage[],
): boolean {
  const candidates = [printed, canonical]
    .filter(filled)
    .map((value) => value.split(/\s*\n\s*/).join(" "));
  // OCR often returns a label and its value as one word ("JIR:b19e…"). The search ignores colons
  // anyway, so a word is split at them and the value can be found on its own.
  const tokens = words.flatMap((word) =>
    word.content
      .split(":")
      .filter((part) => part !== "")
      .map((content) => ({ ...word, content })),
  );
  // An address or a wrapped name runs to more words than the box test's default allows.
  return candidates.some((value) => groundValue(value, tokens, pages, { maxRun: 24 }).length > 0);
}

export interface Repaired {
  fields: CanonicalReceiptFields;
  /** Fields where a production value was replaced by a different one. */
  changed: string[];
  /** Fields production left empty and the model filled. */
  filled: string[];
  /** Fields the model returned a value for that is not on the page; never merged. */
  rejectedUngrounded: string[];
}

export function applyRepair(
  policy: Policy,
  production: ProductionReading,
  llm: LlmReading,
  words: LayoutWord[],
  pages: LayoutPage[],
): Repaired {
  const locked = lockedFields(production);
  const fields = { ...production.fields } as Record<string, unknown>;
  const result: Repaired = {
    fields: fields as CanonicalReceiptFields,
    changed: [],
    filled: [],
    rejectedUngrounded: [],
  };

  for (const name of SCALAR_FIELDS) {
    const offered = (llm.fields as Record<string, unknown>)[name];
    const current = fields[name];
    // A null from the model never blanks a production value, in any policy. A value the
    // normaliser inferred (a currency from the date) is not the model's, and one equal to
    // production's changes nothing.
    if (!filled(offered) || !filled(llm.printed[name]) || offered === current) continue;
    if (!isGrounded(llm.printed[name], offered, words, pages)) {
      result.rejectedUngrounded.push(name);
      continue;
    }
    if (!filled(current)) {
      if (locked.has(name)) continue;
      fields[name] = offered;
      result.filled.push(name);
      continue;
    }
    const mayReplace =
      !locked.has(name) && (policy === "all" || (policy === "weak" && WEAK.includes(name)));
    if (mayReplace) {
      fields[name] = offered;
      result.changed.push(name);
    }
  }
  return result;
}
