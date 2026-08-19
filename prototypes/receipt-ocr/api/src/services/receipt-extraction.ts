import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "../database.types.js";
import type { Database } from "../database.types.js";
import { logger } from "../logger.js";
import { ReceiptRepository } from "../repositories/receipts.js";
import {
  ExtractionError,
  type DocumentExtractionProvider,
} from "../providers/document-extraction/types.js";
import type { SourceContentType } from "@receipt/shared";

export interface ExtractReceiptInput {
  readonly provider: DocumentExtractionProvider;
  readonly client: SupabaseClient<Database>;
  readonly userId: string;
  readonly receiptId: string;
  readonly bytes: Buffer;
  readonly contentType: SourceContentType;
}

/** Background extraction must never reject after an HTTP response has already been sent. */
export async function extractReceipt(input: ExtractReceiptInput): Promise<void> {
  const repository = new ReceiptRepository(input.client, input.userId);

  try {
    const result = await input.provider.extract({
      bytes: input.bytes,
      contentType: input.contentType,
    });
    await repository.update(input.receiptId, {
      status: "review",
      canonicalData: result.fields,
      originalExtraction: result.fields,
      extractionMetadata: json(result.metadata),
      rawProviderResult: json(result.raw),
    });
    logger.info(
      {
        receiptId: input.receiptId,
        modelId: result.metadata.modelId,
        latencyMs: result.metadata.latencyMs,
        status: "review",
      },
      "receipt extraction finished",
    );
  } catch (error) {
    const failure =
      error instanceof ExtractionError
        ? { reason: error.reason, retryable: error.retryable }
        : { reason: "provider_unavailable", retryable: true };

    try {
      await repository.update(input.receiptId, {
        status: "failed",
        extractionMetadata: { failure },
      });
      logger.warn({ receiptId: input.receiptId, status: "failed" }, "receipt extraction failed");
    } catch (updateError) {
      logger.error(
        { err: updateError, receiptId: input.receiptId, status: "failed" },
        "receipt extraction status update failed",
      );
    }
  }
}

function json(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
