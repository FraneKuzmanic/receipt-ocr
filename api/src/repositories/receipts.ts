import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalReceiptFieldsSchema,
  canonicalReceiptSchema,
  receiptStatusSchema,
  receiptWarningSchema,
  sourceContentTypeSchema,
  type CanonicalReceipt,
  type CanonicalReceiptFields,
  type ReceiptStatus,
  type ReceiptWarning,
  type SourceContentType,
} from "@receipt/shared";
import type { Database, Json } from "../database.types.js";

type ReceiptRow = Database["public"]["Tables"]["receipts"]["Row"];
type ReceiptInsert = Database["public"]["Tables"]["receipts"]["Insert"];
type ReceiptUpdate = Database["public"]["Tables"]["receipts"]["Update"];

const uuidSchema = z.uuid();
const warningsSchema = z.array(receiptWarningSchema);
const EXPORT_PAGE_SIZE = 500;

export interface CreateReceiptInput {
  id?: string;
  sourceObjectPath: string;
  sourceOriginalFilename: string;
  sourceContentType: string;
  status?: ReceiptStatus;
  canonicalData?: CanonicalReceiptFields;
  originalExtraction?: CanonicalReceiptFields | null;
  extractionMetadata?: Json | null;
  qrExtraction?: Json | null;
  rawProviderResult?: Json | null;
  warnings?: ReceiptWarning[];
}

export interface UpdateReceiptInput {
  status?: ReceiptStatus;
  canonicalData?: CanonicalReceiptFields;
  originalExtraction?: CanonicalReceiptFields | null;
  extractionMetadata?: Json | null;
  qrExtraction?: Json | null;
  rawProviderResult?: Json | null;
  warnings?: ReceiptWarning[];
  confirmedAt?: string | null;
  deletedAt?: string | null;
}

export interface ReceiptSourceMetadata {
  readonly contentType: SourceContentType;
  readonly originalFilename: string;
}

export interface ReceiptExtractionState {
  readonly status: ReceiptStatus;
  readonly extractionMetadata: Json | null;
}

export interface ReceiptReviewState {
  readonly status: ReceiptStatus;
  readonly fields: CanonicalReceiptFields;
  readonly qrExtraction: Json | null;
  readonly extractionMetadata: Json | null;
}

export interface ListReceiptsOptions {
  readonly page: number;
  readonly limit: number;
  readonly status?: ReceiptStatus;
}

export interface ReceiptPage {
  readonly items: CanonicalReceipt[];
  readonly total: number;
}

export type ReceiptRepositoryErrorCode = "invalid_data" | "query_failed";

export class ReceiptRepositoryError extends Error {
  readonly code: ReceiptRepositoryErrorCode;

  constructor(code: ReceiptRepositoryErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "ReceiptRepositoryError";
    this.code = code;
  }
}

export class ReceiptRepository {
  readonly #client: SupabaseClient<Database>;
  readonly #userId: string;

  constructor(client: SupabaseClient<Database>, userId: string) {
    this.#client = client;
    this.#userId = uuidSchema.parse(userId);
  }

  async create(input: CreateReceiptInput): Promise<CanonicalReceipt> {
    const canonicalData = canonicalReceiptFieldsSchema.parse(input.canonicalData ?? {});
    const warnings = warningsSchema.parse(input.warnings ?? []);
    const originalExtraction =
      input.originalExtraction === undefined || input.originalExtraction === null
        ? input.originalExtraction
        : canonicalReceiptFieldsSchema.parse(input.originalExtraction);

    const insert: ReceiptInsert = {
      id: input.id === undefined ? undefined : uuidSchema.parse(input.id),
      user_id: this.#userId,
      source_object_path: input.sourceObjectPath,
      source_original_filename: input.sourceOriginalFilename,
      source_content_type: input.sourceContentType,
      status: input.status ?? "processing",
      canonical_data: toJson(canonicalData),
      original_extraction:
        originalExtraction === undefined ? undefined : toNullableJson(originalExtraction),
      extraction_metadata: input.extractionMetadata,
      qr_extraction: input.qrExtraction,
      raw_provider_result: input.rawProviderResult,
      warnings: toJson(warnings),
    };

    const { data, error } = await this.#client.from("receipts").insert(insert).select("*").single();

    if (error) throw new ReceiptRepositoryError("query_failed", error);
    return mapReceiptRow(data);
  }

  async findById(id: string): Promise<CanonicalReceipt | null> {
    const { data, error } = await this.#client
      .from("receipts")
      .select("*")
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new ReceiptRepositoryError("query_failed", error);
    return data === null ? null : mapReceiptRow(data);
  }

  /** Source metadata stays internal to this focused read; canonical receipt DTOs expose no storage fields. */
  async findSourceById(id: string): Promise<ReceiptSourceMetadata | null> {
    const { data, error } = await this.#client
      .from("receipts")
      .select("source_content_type, source_original_filename")
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new ReceiptRepositoryError("query_failed", error);
    if (data === null) return null;

    const contentType = sourceContentTypeSchema.safeParse(data.source_content_type);
    if (!contentType.success) throw new ReceiptRepositoryError("invalid_data");

    return { contentType: contentType.data, originalFilename: data.source_original_filename };
  }

  async findExtractionState(id: string): Promise<ReceiptExtractionState | null> {
    const { data, error } = await this.#client
      .from("receipts")
      .select("status, extraction_metadata")
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new ReceiptRepositoryError("query_failed", error);
    return data === null
      ? null
      : {
          status: receiptStatusSchema.parse(data.status),
          extractionMetadata: data.extraction_metadata,
        };
  }

  async findReviewState(id: string): Promise<ReceiptReviewState | null> {
    const { data, error } = await this.#client
      .from("receipts")
      .select("status, canonical_data, qr_extraction, extraction_metadata")
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw new ReceiptRepositoryError("query_failed", error);
    if (data === null) return null;

    try {
      return {
        status: receiptStatusSchema.parse(data.status),
        fields: canonicalReceiptFieldsSchema.parse(data.canonical_data),
        qrExtraction: data.qr_extraction,
        extractionMetadata: data.extraction_metadata,
      };
    } catch (caught) {
      throw new ReceiptRepositoryError("invalid_data", caught);
    }
  }

  /** PRD §10.2 — the authenticated user's non-deleted receipts, newest first. */
  async listPage(options: ListReceiptsOptions): Promise<ReceiptPage> {
    const from = (options.page - 1) * options.limit;
    const filtered = this.#client
      .from("receipts")
      .select("*", { count: "exact" })
      .eq("user_id", this.#userId)
      .is("deleted_at", null);

    const { data, error, count } = await (
      options.status === undefined ? filtered : filtered.eq("status", options.status)
    )
      .order("created_at", { ascending: false })
      .range(from, from + options.limit - 1);

    if (error?.code === "PGRST103") {
      const { error: countError, count: exactCount } = await (
        options.status === undefined
          ? this.#client
              .from("receipts")
              .select("*", { count: "exact" })
              .eq("user_id", this.#userId)
              .is("deleted_at", null)
          : this.#client
              .from("receipts")
              .select("*", { count: "exact" })
              .eq("user_id", this.#userId)
              .is("deleted_at", null)
              .eq("status", options.status)
      )
        .order("created_at", { ascending: false })
        .range(0, 0);

      if (countError) throw new ReceiptRepositoryError("query_failed", countError);
      return { items: [], total: exactCount ?? 0 };
    }
    if (error) throw new ReceiptRepositoryError("query_failed", error);
    return { items: data.map(mapReceiptRow), total: count ?? 0 };
  }

  /** PRD §10.9 — confirmed, non-deleted receipts for a portable user export. */
  async listConfirmedForExport(): Promise<CanonicalReceipt[]> {
    const items: CanonicalReceipt[] = [];

    for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
      const { data, error } = await this.#client
        .from("receipts")
        .select("*")
        .eq("user_id", this.#userId)
        .is("deleted_at", null)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + EXPORT_PAGE_SIZE - 1);

      if (error) throw new ReceiptRepositoryError("query_failed", error);
      items.push(...data.map(mapReceiptRow));
      if (data.length < EXPORT_PAGE_SIZE) return items;
    }
  }

  async update(id: string, input: UpdateReceiptInput): Promise<CanonicalReceipt | null> {
    const update: ReceiptUpdate = { updated_at: new Date().toISOString() };

    if (input.status !== undefined) update.status = input.status;
    if (input.canonicalData !== undefined) {
      update.canonical_data = toJson(canonicalReceiptFieldsSchema.parse(input.canonicalData));
    }
    if (input.originalExtraction !== undefined) {
      update.original_extraction = toNullableJson(
        input.originalExtraction === null
          ? null
          : canonicalReceiptFieldsSchema.parse(input.originalExtraction),
      );
    }
    if (input.extractionMetadata !== undefined) {
      update.extraction_metadata = input.extractionMetadata;
    }
    if (input.qrExtraction !== undefined) update.qr_extraction = input.qrExtraction;
    if (input.rawProviderResult !== undefined) {
      update.raw_provider_result = input.rawProviderResult;
    }
    if (input.warnings !== undefined) {
      update.warnings = toJson(warningsSchema.parse(input.warnings));
    }
    if (input.confirmedAt !== undefined) update.confirmed_at = input.confirmedAt;
    if (input.deletedAt !== undefined) update.deleted_at = input.deletedAt;

    const { data, error } = await this.#client
      .from("receipts")
      .update(update)
      .eq("id", uuidSchema.parse(id))
      .eq("user_id", this.#userId)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();

    if (error) throw new ReceiptRepositoryError("query_failed", error);
    return data === null ? null : mapReceiptRow(data);
  }

  async softDelete(id: string): Promise<CanonicalReceipt | null> {
    return this.update(id, { deletedAt: new Date().toISOString() });
  }
}

export function mapReceiptRow(row: ReceiptRow): CanonicalReceipt {
  try {
    const fields = canonicalReceiptFieldsSchema.parse(row.canonical_data);
    const warnings = warningsSchema.parse(row.warnings);

    return canonicalReceiptSchema.parse({
      ...fields,
      id: row.id,
      userId: row.user_id,
      status: row.status,
      warnings,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
      confirmedAt: normalizeNullableTimestamp(row.confirmed_at),
      deletedAt: normalizeNullableTimestamp(row.deleted_at),
    });
  } catch (error) {
    throw new ReceiptRepositoryError("invalid_data", error);
  }
}

function normalizeTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("invalid timestamp");
  return timestamp.toISOString();
}

function normalizeNullableTimestamp(value: string | null): string | null {
  return value === null ? null : normalizeTimestamp(value);
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function toNullableJson(value: unknown | null): Json | null {
  return value === null ? null : toJson(value);
}
