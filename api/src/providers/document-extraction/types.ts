import type { CanonicalReceiptFields, SourceContentType } from "@receipt/shared";
import type { FiscalQrData } from "./fiscal-qr.js";

/** Metadata for Task 09's low-confidence highlighting; it never suppresses a value. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

export interface ExtractionInput {
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
}

export interface ExtractionFieldMetadata {
  readonly confidence: number | null;
  readonly source: "model" | "text" | "inferred";
}

export interface ExtractionMetadata {
  readonly provider: string;
  readonly modelId: string;
  readonly apiVersion: string;
  readonly analyzedAt: string;
  readonly latencyMs: number;
  readonly documentConfidence: number | null;
  readonly fields: Record<string, ExtractionFieldMetadata>;
  readonly unreadableFields: string[];
  readonly vatTextPresent?: boolean;
}

export interface ProviderExtractionResult {
  readonly fields: CanonicalReceiptFields;
  readonly metadata: ExtractionMetadata;
  /** Decoded QR payload when Azure found a QR code; null when it found none. */
  readonly qr: FiscalQrData | null;
  /** Provider response retained verbatim for debugging. */
  readonly raw: unknown;
}

export class ExtractionError extends Error {
  readonly retryable: boolean;
  readonly reason: string;

  constructor(reason: string, retryable: boolean, cause?: unknown) {
    super(reason, cause === undefined ? undefined : { cause });
    this.name = "ExtractionError";
    this.reason = reason;
    this.retryable = retryable;
  }
}

export interface DocumentExtractionProvider {
  extract(input: ExtractionInput): Promise<ProviderExtractionResult>;
}
