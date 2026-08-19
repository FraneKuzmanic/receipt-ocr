import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { authenticated } from "../middleware/require-auth.js";
import { ReceiptRepository } from "../repositories/receipts.js";
import { extractReceipt } from "../services/receipt-extraction.js";
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
import type { DocumentExtractionProvider } from "../providers/document-extraction/types.js";

const idSchema = z.uuid();

export function createReceiptsRouter(extractionProvider: DocumentExtractionProvider): Router {
  const router = Router();

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

      res.json(receipt);
    }),
  );

  router.post(
    "/",
    receiptSourceUpload,
    authenticated(async (req, res, auth) => {
      const file = await validateSourceFile(req.file);
      const receiptId = randomUUID();
      const path = sourceObjectPath(auth.userId, receiptId);

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
