import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EXPECTED_DIR = join(ROOT, ".agents", "fixtures", "expected");
export const SOURCES_DIR = join(ROOT, ".agents", "fixtures", "receipts");
export const GROUND_TRUTH_DIR = join(ROOT, "scripts", "bakeoff", "ground-truth");
export const CACHE_DIR = join(ROOT, ".bakeoff");
export const FIXTURES_DIR = join(ROOT, "api/src/providers/document-extraction/fixtures");
export const SECONDARY_FIXTURES_DIR = join(FIXTURES_DIR, "secondary");

export interface Sample {
  /** The basename of its expected file and of its recorded fixtures. */
  readonly name: string;
  readonly sourceFile: string;
  readonly contentType: "image/png" | "image/jpeg" | "application/pdf";
  readonly sourceKind: "pdf" | "image";
}

const sample = (name: string, sourceFile: string): Sample => {
  const ext = sourceFile.split(".").pop()!.toLowerCase();
  const contentType =
    ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
  return { name, sourceFile, contentType, sourceKind: ext === "pdf" ? "pdf" : "image" };
};

// Names follow no slug rule, so the pairing is written out rather than derived.
export const SAMPLES: readonly Sample[] = [
  sample("22559270", "22559270.png"),
  sample("26515835", "26515835.jpg"),
  sample("gradanin-gotovina-pos", "gradanin-gotovina-pos.jpg"),
  sample("images", "images.jpg"),
  sample("ina-racun-sladoled", "ina-racun-sladoled.jpg"),
  sample("inareceipt", "inareceipt.jpg"),
  sample("lira_trogir", "lira_trogir.jpg"),
  sample("primjer1-hr-nopdv", "primjer1-hr-nopdv.pdf"),
  sample("primjer-pdf-racuna", "primjer-pdf-racuna.pdf"),
  sample("racuntaksi1", "racuntaksi1.jpg"),
  sample("receipt123", "receipt123.jpg"),
  sample("receiptEuroMistake", "receiptEuroMistake.jpg"),
  sample("receiptWithTaxMistake", "receiptWithTaxMistake.jpg"),
  sample("screenshot-20190705-1907152", "Screenshot_20190705-1907152.png"),
];

/** Expected values exist for these, but no source file, so no arm can be given them. */
export const EXCLUDED = ["31231822", "racun-mobilna-trgovina"] as const;

export function sourceBytes(s: Sample): Buffer {
  const path = join(SOURCES_DIR, s.sourceFile);
  if (!existsSync(path)) throw new Error(`missing source file: ${path}`);
  return readFileSync(path);
}

export function cachePath(kind: string, name: string): string {
  const dir = join(CACHE_DIR, kind);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.json`);
}

export function readCache<T>(kind: string, name: string): T | null {
  const path = join(CACHE_DIR, kind, `${name}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

export function writeCache(kind: string, name: string, data: unknown): void {
  writeFileSync(cachePath(kind, name), JSON.stringify(data, null, 2), "utf8");
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`\n  Missing ${name} in prototypes/receipt-ocr/.env — cannot run.\n`);
    process.exit(1);
  }
  return value;
}

export function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
