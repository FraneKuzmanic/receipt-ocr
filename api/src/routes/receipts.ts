import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { authenticated } from "../middleware/require-auth.js";
import { ReceiptRepository } from "../repositories/receipts.js";
import {
  SOURCE_URL_TTL_SECONDS,
  createSourceSignedUrl,
  removeSource,
  sourceObjectPath,
  uploadSource,
} from "../storage/receipt-sources.js";
import { receiptSourceUpload } from "../upload/multipart.js";
import { validateSourceFile } from "../upload/source-file.js";

const idSchema = z.uuid();

export const receiptsRouter = Router();

/**
 * PRD §10.3. A receipt owned by someone else returns 404, never 403: telling a caller that an
 * id exists but is not theirs leaks exactly what ownership is meant to hide.
 *
 * There is deliberately no ownership check here. `findById` already filters on `user_id` and
 * `deleted_at`, and RLS enforces the same rule at the database, so a second check would be a
 * third copy of one rule to keep in sync.
 */
receiptsRouter.get(
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

receiptsRouter.post(
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

receiptsRouter.get(
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

receiptsRouter.delete(
  "/:id",
  authenticated(async (req, res, auth) => {
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) throw new HttpError(400, "invalid_request");

    const receipt = await new ReceiptRepository(auth.client, auth.userId).softDelete(id.data);
    if (receipt === null) throw new HttpError(404, "not_found");

    res.status(204).end();
  }),
);
