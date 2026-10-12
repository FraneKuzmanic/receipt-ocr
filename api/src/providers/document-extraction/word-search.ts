import type { AnalyzeResultOutput } from "@azure-rest/ai-document-intelligence";

/** A printed address or a wrapped seller name runs to more words than a single value does. */
const MAX_RUN = 24;

export interface WordMatch {
  readonly pageNumber: number;
  /** The eight-number envelope of the matched words, in the page's own units. */
  readonly polygon: number[];
}

/** The forms a canonical date, OIB or amount is printed in on a Croatian receipt. */
export function printedForms(canonical: string): string[] {
  const forms = new Set<string>([canonical]);

  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(canonical);
  if (date) {
    const [, year, month, day] = date;
    for (const d of [day!, String(Number(day))]) {
      for (const m of [month!, String(Number(month))]) {
        for (const y of [year!, year!.slice(2)]) forms.add(`${d}.${m}.${y}`);
      }
    }
    return [...forms];
  }

  if (/^\d{11}$/.test(canonical)) forms.add(`HR${canonical}`);

  if (/^-?\d+(\.\d+)?$/.test(canonical)) {
    const [whole, decimals = ""] = canonical.split(".");
    forms.add(`${whole},${decimals.padEnd(2, "0").slice(0, 2)}`);
    if (decimals === "" || /^0+$/.test(decimals)) forms.add(whole!);
  }
  return [...forms];
}

/**
 * Letters and digits only, lower case, diacritics folded. Dropping every other character is what
 * lets `1234.56` meet a printed `1.234,56`, a date meet any of its separators, and `NOVCANICE`
 * meet the `(NOVCANICE)` of `screenshot-20190705-1907152`. This is a search for where a value is
 * printed, so it is far more tolerant than any rule that decides what a value is.
 */
function key(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function envelope(points: readonly number[]): number[] {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  return [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
    Math.min(...xs),
    Math.max(...ys),
  ];
}

/**
 * Finds where one of `candidates` is printed, as a run of consecutive words within one page, and
 * returns the first place in reading order. A value printed twice is therefore outlined at its
 * first occurrence, and one that is not on the page is not outlined at all.
 */
export function findWords(
  candidates: readonly string[],
  analyzeResult: AnalyzeResultOutput,
): WordMatch | null {
  // An empty key would match the first word of the page.
  const targets = new Set(candidates.map(key).filter((target) => target !== ""));
  if (targets.size === 0) return null;
  const longest = Math.max(...[...targets].map((target) => target.length));

  for (const page of analyzeResult.pages ?? []) {
    // OCR returns a label and its value as one word (`JIR:b19e…`), so a word is split at its
    // colons and each part keeps the word's polygon.
    const tokens = (page.words ?? []).flatMap((word) =>
      word.content
        .split(":")
        .map(key)
        .filter((part) => part !== "")
        .map((part) => ({ key: part, polygon: word.polygon ?? [] })),
    );

    for (let start = 0; start < tokens.length; start++) {
      let run = "";
      for (let length = 0; length < MAX_RUN && start + length < tokens.length; length++) {
        run += tokens[start + length]!.key;
        if (run.length > longest) break;
        if (!targets.has(run)) continue;
        const points = tokens.slice(start, start + length + 1).flatMap((token) => token.polygon);
        if (points.length < 8) break;
        return { pageNumber: page.pageNumber, polygon: envelope(points) };
      }
    }
  }
  return null;
}
