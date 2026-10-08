/**
 * Finds a value among OCR words, which is the box test's ground truth: where on the page is
 * the text the model says it read? Ported from payslip-ocr's harness.
 *
 * Output coordinates are page-relative fractions in [0,1], which is what makes inch-based PDFs
 * and pixel-based photos interchangeable.
 */
import type { LayoutOperation } from "./layout.ts";

export interface LayoutWord {
  content: string;
  polygon: number[]; // [x1,y1,x2,y2,x3,y3,x4,y4]
  pageNumber: number;
}

export interface LayoutPage {
  pageNumber: number;
  width: number;
  height: number;
}

export interface Region {
  page: number;
  corners: { x: number; y: number }[];
  matchedText: string;
}

/** Croatian surface forms a canonical value might be printed as. */
export function surfaceForms(canonical: string): string[] {
  const forms = new Set<string>([canonical]);

  // date: YYYY-MM-DD -> DD.MM.YYYY and friends
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(canonical);
  if (date) {
    const [, y, mm, dd] = date;
    const d = String(Number(dd));
    const m = String(Number(mm));
    const yy = y!.slice(2);
    for (const day of [dd!, d]) {
      for (const mon of [mm!, m]) {
        for (const year of [y!, yy]) {
          forms.add(`${day}.${mon}.${year}`);
          forms.add(`${day}.${mon}.${year}.`);
          forms.add(`${day}/${mon}/${year}`);
          forms.add(`${day}-${mon}-${year}`);
        }
      }
    }
    return [...forms];
  }

  // OIB printed with an HR (VAT) prefix
  if (/^\d{11}$/.test(canonical)) forms.add(`HR${canonical}`);

  if (/^-?\d+(\.\d+)?$/.test(canonical)) {
    const [intPart, decPart = ""] = canonical.split(".");
    const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const dec2 = decPart.padEnd(2, "0").slice(0, 2);
    forms.add(`${grouped},${dec2}`); // 1.234,56
    forms.add(`${intPart},${dec2}`); // 1234,56
    forms.add(`${intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${dec2}`); // 1 234,56
    if (decPart === "" || /^0+$/.test(decPart)) {
      forms.add(grouped);
      forms.add(intPart!);
    }
  }
  return [...forms];
}

/**
 * Comparison key: diacritic-, case-, whitespace- and separator-insensitive. Dropping `.` and
 * `,` is what lets "1234.56" meet printed "1.234,56", and absorbs a trailing full stop.
 */
function key(s: string): string {
  return s
    .replace(/[\s ]/g, "")
    .replace(/[.,;:]/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

function envelope(words: LayoutWord[], page: LayoutPage): { x: number; y: number }[] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of words) {
    for (let i = 0; i < w.polygon.length; i += 2) {
      xs.push(w.polygon[i]!);
      ys.push(w.polygon[i + 1]!);
    }
  }
  const x0 = clamp(Math.min(...xs) / page.width);
  const x1 = clamp(Math.max(...xs) / page.width);
  const y0 = clamp(Math.min(...ys) / page.height);
  const y1 = clamp(Math.max(...ys) / page.height);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Find `value` among the words, as a contiguous run within one page. Returns every match, so
 * a value printed several times can be judged against the nearest.
 */
export function groundValue(
  value: string,
  words: LayoutWord[],
  pages: LayoutPage[],
  opts: { maxRun?: number } = {},
): Region[] {
  if (!value) return [];
  const maxRun = opts.maxRun ?? 12;
  const targets = surfaceForms(value).map(key).filter(Boolean);
  if (!targets.length) return [];

  const byPage = new Map<number, LayoutPage>(pages.map((p) => [p.pageNumber, p]));
  const out: Region[] = [];

  for (let i = 0; i < words.length; i++) {
    const page = byPage.get(words[i]!.pageNumber);
    if (!page) continue;
    let acc = "";
    for (let n = 0; n < maxRun && i + n < words.length; n++) {
      const w = words[i + n]!;
      if (w.pageNumber !== words[i]!.pageNumber) break;
      acc += key(w.content);
      if (acc.length > 200) break;
      if (targets.includes(acc)) {
        const run = words.slice(i, i + n + 1);
        out.push({
          page: page.pageNumber,
          corners: envelope(run, page),
          matchedText: run.map((r) => r.content).join(" "),
        });
        break;
      }
    }
  }
  return out;
}

/** Pull words and page dimensions out of a recorded layout operation. */
export function layoutGeometry(raw: LayoutOperation): { words: LayoutWord[]; pages: LayoutPage[] } {
  const src = raw.analyzeResult?.pages ?? [];
  const pages: LayoutPage[] = src
    .filter((p) => p.width > 0 && p.height > 0)
    .map((p) => ({ pageNumber: p.pageNumber, width: p.width, height: p.height }));
  const words: LayoutWord[] = [];
  for (const p of src) {
    for (const w of p.words ?? []) {
      words.push({ content: w.content, polygon: w.polygon, pageNumber: p.pageNumber });
    }
  }
  return { words, pages };
}
