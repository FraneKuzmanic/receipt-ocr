import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error-handler.js";
import { authenticated } from "../middleware/require-auth.js";
import { ReceiptRepository } from "../repositories/receipts.js";

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
