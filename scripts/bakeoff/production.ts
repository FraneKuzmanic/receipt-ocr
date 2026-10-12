/**
 * The `production` arm: one live extraction through the product's own provider, so the baseline
 * is what the app would store for this file — both prebuilt models, the merge, the Croatian
 * rules and the QR code's JIR. Nothing of that path is rebuilt here.
 *
 * Importing the provider loads `api/src/config.ts`, which needs the Supabase and Document
 * Intelligence variables: run with `--env-file-if-exists=.env`.
 */
import type { CanonicalReceiptFields } from "@receipt/shared";
import { createAzureProvider } from "../../api/src/providers/document-extraction/azure.js";
import { stripContentMarkers } from "../../api/src/providers/document-extraction/content-markers.js";
import type { ProviderExtractionResult } from "../../api/src/providers/document-extraction/types.js";
import { layoutGeometry, type LayoutPage, type LayoutWord } from "./ground.ts";
import type { LayoutOperation } from "./layout.ts";
import type { UploadInput } from "./inputs.ts";

export interface ProductionRecord {
  arm: "production";
  /** Wall clock around the provider call. */
  latencyMs: number;
  fields: CanonicalReceiptFields;
  metadata: ProviderExtractionResult["metadata"];
  qr: ProviderExtractionResult["qr"];
  /** The primary operation at the top level, plus `secondaryAnalyzeResult` and `fieldModels`. */
  raw: unknown;
}

export async function runProduction(input: UploadInput): Promise<ProductionRecord> {
  const started = Date.now();
  const result = await createAzureProvider().extract({
    bytes: input.bytes,
    contentType: input.contentType,
  });
  return {
    arm: "production",
    latencyMs: Date.now() - started,
    fields: result.fields,
    metadata: result.metadata,
    qr: result.qr,
    raw: result.raw,
  };
}

/** The primary model's OCR text, as the Croatian rules read it. */
export function productionText(record: ProductionRecord): string {
  return stripContentMarkers((record.raw as LayoutOperation).analyzeResult?.content ?? "").text;
}

/** The primary model's words, for finding a value on the page. */
export function productionWords(record: ProductionRecord): {
  words: LayoutWord[];
  pages: LayoutPage[];
} {
  return layoutGeometry(record.raw as LayoutOperation);
}

/** Pages billed: every page, once per prebuilt model that read it. */
export function productionPages(record: ProductionRecord): number {
  const pages = (record.raw as LayoutOperation).analyzeResult?.pages?.length ?? 1;
  return pages * (record.metadata.secondaryModelId ? 2 : 1);
}
