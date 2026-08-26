import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import {
  exportFormatSchema,
  listReceiptsQuerySchema,
  updateReceiptRequestSchema,
  type CanonicalReceiptFields,
  type ReceiptFailureReason,
} from "@receipt/shared";
import { HttpError } from "../middleware/error-handler.js";
import { authenticated } from "../middleware/require-auth.js";
import { toCsv, toJsonExport } from "../export/receipts.js";
import { ReceiptRepository } from "../repositories/receipts.js";
import { extractReceipt } from "../services/receipt-extraction.js";
import { computeWarnings } from "../validation/warnings.js";
import {
  SOURCE_URL_TTL_SECONDS,
  createSourceSignedUrl,
  downloadSource,
  removeSource,
  sourceObjectPath,
  uploadSource,
} from "../storage/receipt-sources.js";
import { receiptSourceUpload } from "../upload/multipart.js";
import { validateSourceFile } from "../upload/source-file.js";
import {
  LOW_CONFIDENCE_THRESHOLD,
  type DocumentExtractionProvider,
} from "../providers/document-extraction/types.js";
import { parseFiscalQr } from "../providers/document-extraction/fiscal-qr.js";
import {
  mapSourceRegions,
  storedAnalyzeResult,
} from "../providers/document-extraction/source-regions.js";

const idSchema = z.uuid();

export function createReceiptsRouter(extractionProvider: DocumentExtractionProvider): Router {
  const router = Router();

  /** PRD §10.2. Owner scoping and soft-delete filtering live in the repository. */
  router.get(
    "/",
    authenticated(async (req, res, auth) => {
      const query = listReceiptsQuerySchema.safeParse(req.query);
      if (!query.success) throw new HttpError(400, "invalid_request");

      const page = await new ReceiptRepository(auth.client, auth.userId).listPage(query.data);
      res.json({ ...page, page: query.data.page, limit: query.data.limit });
    }),
  );

  router.get(
    "/export",
    authenticated(async (req, res, auth) => {
      const format = exportFormatSchema.safeParse(req.query["format"]);
      if (!format.success) throw new HttpError(400, "invalid_request");

      const receipts = await new ReceiptRepository(
        auth.client,
        auth.userId,
      ).listConfirmedForExport();

      if (format.data === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="receipts.csv"');
        res.send(toCsv(receipts));
        return;
      }

      res.json(toJsonExport(receipts));
    }),
  );

  /**
   * One receipt in the same portable formats as the bulk export. Scope matches PRD §7.12: only a
   * confirmed receipt leaves the PoC, so a draft cannot be mistaken downstream for final data.
   *
   * Two segments, so Express can never confuse this with the bulk `/export` route above.
   */
  router.get(
    "/:id/export",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const format = exportFormatSchema.safeParse(req.query["format"]);
      if (!format.success) throw new HttpError(400, "invalid_request");

      const receipt = await new ReceiptRepository(auth.client, auth.userId).findById(id.data);
      if (receipt === null) throw new HttpError(404, "not_found");
      if (receipt.status !== "confirmed") throw new HttpError(409, "export_not_allowed");

      if (format.data === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="receipt-${receipt.id}.csv"`);
        res.send(toCsv([receipt]));
        return;
      }

      res.json(toJsonExport([receipt]));
    }),
  );

  /**
   * PRD §10.3. A receipt owned by someone else returns 404, never 403: telling a caller that an
   * id exists but is not theirs leaks exactly what ownership is meant to hide.
   *
   * There is deliberately no ownership check here. `findById` already filters on `user_id` and
   * `deleted_at`, and RLS enforces the same rule at the database, so a second check would be a
   * third copy of one rule to keep in sync.
   */
  router.get(
    "/:id",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const repository = new ReceiptRepository(auth.client, auth.userId);
      const receipt = await repository.findById(id.data);
      if (receipt === null) throw new HttpError(404, "not_found");

      const state = await repository.findReviewState(id.data);
      if (state === null) throw new HttpError(404, "not_found");

      res.json({
        ...receipt,
        lowConfidenceFields: lowConfidenceFields(state.extractionMetadata),
        failureReason: failureReason(receipt.status, state.extractionMetadata),
        editedFields: editedFields(receipt, state.originalExtraction),
      });
    }),
  );

  router.patch(
    "/:id",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const body = updateReceiptRequestSchema.safeParse(req.body);
      if (!body.success) throw new HttpError(400, "invalid_request");

      const repository = new ReceiptRepository(auth.client, auth.userId);
      const state = await repository.findReviewState(id.data);
      if (state === null) throw new HttpError(404, "not_found");
      if (state.status !== "review" && state.status !== "confirmed") {
        throw new HttpError(409, "edit_not_allowed");
      }

      const fields = { ...state.fields, ...body.data };
      const receipt = await repository.update(id.data, {
        canonicalData: fields,
        warnings: computeWarnings({
          fields,
          qr: storedQr(state.qrExtraction),
          unreadable: unreadableFields(state.extractionMetadata),
          vatTextPresent: vatTextPresent(state.extractionMetadata),
        }),
      });
      if (receipt === null) throw new HttpError(404, "not_found");

      res.json({
        ...receipt,
        lowConfidenceFields: lowConfidenceFields(state.extractionMetadata),
        failureReason: failureReason(receipt.status, state.extractionMetadata),
        editedFields: editedFields(receipt, state.originalExtraction),
      });
    }),
  );

  router.post(
    "/:id/confirm",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const repository = new ReceiptRepository(auth.client, auth.userId);
      const receipt = await repository.findById(id.data);
      if (receipt === null) throw new HttpError(404, "not_found");
      if (receipt.status === "confirmed") {
        res.json({ id: receipt.id, status: receipt.status, confirmedAt: receipt.confirmedAt });
        return;
      }
      if (receipt.status !== "review") throw new HttpError(409, "confirm_not_allowed");

      const confirmed = await repository.update(id.data, {
        status: "confirmed",
        confirmedAt: new Date().toISOString(),
      });
      if (confirmed === null) throw new HttpError(404, "not_found");

      res.json({ id: confirmed.id, status: confirmed.status, confirmedAt: confirmed.confirmedAt });
    }),
  );

  router.post(
    "/",
    receiptSourceUpload,
    authenticated(async (req, res, auth) => {
      const file = await validateSourceFile(req.file);
      const receiptId = randomUUID();
      const path = sourceObjectPath(auth.userId, receiptId);
      const extraction = extractionProvider.extract({
        bytes: file.bytes,
        contentType: file.contentType,
      });
      void extraction.catch(() => undefined);

      await uploadSource(auth.client, path, file.bytes, file.contentType);

      try {
        const receipt = await new ReceiptRepository(auth.client, auth.userId).create({
          id: receiptId,
          sourceObjectPath: path,
          sourceOriginalFilename: file.originalFilename,
          sourceContentType: file.contentType,
        });
        res
          .status(201)
          .json({ id: receipt.id, status: receipt.status, createdAt: receipt.createdAt });
        void extractReceipt({
          provider: extractionProvider,
          client: auth.client,
          userId: auth.userId,
          receiptId: receipt.id,
          bytes: file.bytes,
          contentType: file.contentType,
          extraction,
        });
      } catch (error) {
        try {
          await removeSource(auth.client, path);
        } catch {
          // The row error is more important than a failed best-effort cleanup.
        }
        throw error;
      }
    }),
  );

  router.post(
    "/:id/retry",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const repository = new ReceiptRepository(auth.client, auth.userId);
      const state = await repository.findExtractionState(id.data);
      if (state === null) throw new HttpError(404, "not_found");
      if (
        (state.status !== "failed" && state.status !== "processing") ||
        isExplicitlyNonRetryable(state.extractionMetadata)
      ) {
        throw new HttpError(409, "retry_not_allowed");
      }

      const source = await repository.findSourceById(id.data);
      if (source === null) throw new HttpError(404, "not_found");
      const bytes = await downloadSource(auth.client, sourceObjectPath(auth.userId, id.data));
      const receipt = await repository.update(id.data, { status: "processing" });
      if (receipt === null) throw new HttpError(404, "not_found");

      res.status(202).json({ id: receipt.id, status: receipt.status });
      void extractReceipt({
        provider: extractionProvider,
        client: auth.client,
        userId: auth.userId,
        receiptId: receipt.id,
        bytes,
        contentType: source.contentType,
      });
    }),
  );

  router.get(
    "/:id/source",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const repository = new ReceiptRepository(auth.client, auth.userId);
      const source = await repository.findSourceById(id.data);
      if (source === null) throw new HttpError(404, "not_found");

      const url = await createSourceSignedUrl(auth.client, sourceObjectPath(auth.userId, id.data));
      res.json({
        url,
        contentType: source.contentType,
        originalFilename: source.originalFilename,
        expiresAt: new Date(Date.now() + SOURCE_URL_TTL_SECONDS * 1000).toISOString(),
      });
    }),
  );

  router.get(
    "/:id/regions",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const providerResult = await new ReceiptRepository(
        auth.client,
        auth.userId,
      ).findProviderResultById(id.data);
      if (providerResult === null) throw new HttpError(404, "not_found");

      const analyzeResult = storedAnalyzeResult(providerResult.rawProviderResult);
      res.json(
        analyzeResult === null ? { pages: [], regions: [] } : mapSourceRegions(analyzeResult),
      );
    }),
  );

  router.delete(
    "/:id",
    authenticated(async (req, res, auth) => {
      const id = idSchema.safeParse(req.params["id"]);
      if (!id.success) throw new HttpError(400, "invalid_request");

      const receipt = await new ReceiptRepository(auth.client, auth.userId).softDelete(id.data);
      if (receipt === null) throw new HttpError(404, "not_found");

      res.status(204).end();
    }),
  );

  return router;
}

function isExplicitlyNonRetryable(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const failure = (metadata as Record<string, unknown>)["failure"];
  return (
    failure !== null &&
    typeof failure === "object" &&
    !Array.isArray(failure) &&
    (failure as Record<string, unknown>)["retryable"] === false
  );
}

function failureReason(status: string, metadata: unknown): ReceiptFailureReason | null {
  if (
    status !== "failed" ||
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  )
    return null;
  const failure = (metadata as Record<string, unknown>)["failure"];
  if (failure === null || typeof failure !== "object" || Array.isArray(failure)) return null;
  const reason = (failure as Record<string, unknown>)["reason"];
  return reason === "unreadable_document" ||
    reason === "provider_rejected" ||
    reason === "provider_unavailable"
    ? reason
    : null;
}

export function lowConfidenceFields(metadata: unknown): string[] {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const fields = (metadata as Record<string, unknown>)["fields"];
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return [];

  return Object.entries(fields).flatMap(([field, value]) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
    const confidence = (value as Record<string, unknown>)["confidence"];
    return typeof confidence === "number" && confidence < LOW_CONFIDENCE_THRESHOLD ? [field] : [];
  });
}

// Only the flat scalar fields. `vatBreakdown`/`items` are deliberately excluded: their row
// indices can shift when the user adds or removes a row, which would make a per-index comparison
// misleading rather than merely incomplete.
const EDITABLE_SCALAR_FIELDS = [
  "sellerName",
  "sellerAddress",
  "sellerOib",
  "buyerName",
  "buyerAddress",
  "buyerOib",
  "documentNumber",
  "issueDate",
  "issueTime",
  "subtotal",
  "total",
  "currency",
  "paymentMethod",
  "jir",
  "zki",
] as const satisfies readonly (keyof CanonicalReceiptFields)[];

export function editedFields(
  current: CanonicalReceiptFields,
  original: CanonicalReceiptFields | null,
): string[] {
  if (original === null) return [];
  return EDITABLE_SCALAR_FIELDS.filter(
    (field) => (current[field] ?? null) !== (original[field] ?? null),
  );
}

function unreadableFields(metadata: unknown): string[] {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const values = (metadata as Record<string, unknown>)["unreadableFields"];
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
}

function vatTextPresent(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>)["vatTextPresent"] === true;
}

function storedQr(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)["raw"];
  return typeof raw === "string" ? parseFiscalQr(raw) : null;
}
