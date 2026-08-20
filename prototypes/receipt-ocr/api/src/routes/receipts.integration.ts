import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  confirmReceiptResponseSchema,
  createReceiptResponseSchema,
  jsonExportResponseSchema,
  listReceiptsResponseSchema,
  receiptDetailResponseSchema,
  sourceDocumentResponseSchema,
} from "@receipt/shared";
import { createApp } from "../app.js";
import { config } from "../config.js";
import type { Database } from "../database.types.js";
import { ReceiptRepository } from "../repositories/receipts.js";
import {
  ExtractionError,
  type DocumentExtractionProvider,
} from "../providers/document-extraction/types.js";
import { sourceObjectPath } from "../storage/receipt-sources.js";

const userAId = randomUUID();
const userBId = randomUUID();
const password = "Task05-integration-password-123!";
const userAEmail = `task05-a-${userAId}@example.test`;
const userBEmail = `task05-b-${userBId}@example.test`;
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const admin = createServerClient(requiredEnv("SUPABASE_SECRET_KEY"));
const userA = createServerClient(requiredEnv("SUPABASE_PUBLISHABLE_KEY"));
const userB = createServerClient(requiredEnv("SUPABASE_PUBLISHABLE_KEY"));
const sourcePaths: string[] = [];
let extractionFailure: ExtractionError | null = null;
const provider: DocumentExtractionProvider = {
  async extract() {
    if (extractionFailure !== null) throw extractionFailure;
    return {
      fields: {
        sellerName: "Integration seller",
        documentNumber: "381/1/3",
        issueDate: "2026-08-19",
        total: "8.08",
        currency: "EUR",
      },
      metadata: {
        provider: "azure-document-intelligence",
        modelId: "prebuilt-invoice",
        apiVersion: "2024-11-30",
        analyzedAt: new Date().toISOString(),
        latencyMs: 1,
        documentConfidence: 1,
        fields: { documentNumber: { confidence: 0.5, source: "model" } },
        unreadableFields: [],
      },
      qr: null,
      raw: { status: "succeeded" },
    };
  },
};
const app = createApp({ extractionProvider: provider });

let tokenA = "";
let tokenB = "";
let uploadedReceiptId = "";
let reviewReceiptId = "";

beforeAll(async () => {
  tokenA = await createAndSignIn(userA, userAId, userAEmail);
  tokenB = await createAndSignIn(userB, userBId, userBEmail);
});

afterAll(async () => {
  await admin.storage.from(config.STORAGE_BUCKET).remove(sourcePaths);
  await admin.auth.admin.deleteUser(userAId);
  await admin.auth.admin.deleteUser(userBId);
});

describe("receipt source lifecycle against the hosted project", () => {
  it("uploads a JPEG and preserves its exact bytes", async () => {
    const response = await request(app)
      .post("/api/receipts")
      .set("Authorization", `Bearer ${tokenA}`)
      .attach("file", jpeg, { filename: "račun-ožujak.jpg", contentType: "image/jpeg" });

    expect(response.status).toBe(201);
    const created = createReceiptResponseSchema.parse(response.body);
    expect(created.status).toBe("processing");
    uploadedReceiptId = created.id;
    sourcePaths.push(sourceObjectPath(userAId, created.id));

    const { data, error } = await userA.storage
      .from(config.STORAGE_BUCKET)
      .download(sourceObjectPath(userAId, created.id));
    expect(error).toBeNull();
    expect(Buffer.from(await data!.arrayBuffer())).toEqual(jpeg);
  });

  it("uploads a PDF", async () => {
    const response = await request(app)
      .post("/api/receipts")
      .set("Authorization", `Bearer ${tokenA}`)
      .attach("file", await pdf(), { filename: "receipt.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(201);
    const created = createReceiptResponseSchema.parse(response.body);
    sourcePaths.push(sourceObjectPath(userAId, created.id));
  });

  it("rejects renamed executable bytes without creating a row", async () => {
    const before = (await new ReceiptRepository(userA, userAId).listPage({ page: 1, limit: 100 }))
      .total;
    const response = await request(app)
      .post("/api/receipts")
      .set("Authorization", `Bearer ${tokenA}`)
      .attach("file", Buffer.from("MZ executable"), {
        filename: "receipt.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(415);
    expect(response.body).toEqual({ error: { code: "unsupported_media_type" } });
    await expect(
      new ReceiptRepository(userA, userAId)
        .listPage({ page: 1, limit: 100 })
        .then((page) => page.total),
    ).resolves.toBe(before);
  });

  it("rejects an oversized file cleanly", async () => {
    const response = await request(app)
      .post("/api/receipts")
      .set("Authorization", `Bearer ${tokenA}`)
      .attach("file", Buffer.alloc(config.MAX_UPLOAD_BYTES + 1), {
        filename: "too-large.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: { code: "file_too_large" } });
  });

  it("returns a working short-lived URL only to the owner", async () => {
    const response = await request(app)
      .get(`/api/receipts/${uploadedReceiptId}/source`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(200);
    const source = sourceDocumentResponseSchema.parse(response.body);
    expect(source.contentType).toBe("image/jpeg");
    expect(source.originalFilename).toBe("račun-ožujak.jpg");
    const remaining = new Date(source.expiresAt).getTime() - Date.now();
    expect(remaining).toBeGreaterThanOrEqual(295000);
    expect(remaining).toBeLessThanOrEqual(301000);

    const download = await fetch(source.url);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(jpeg);

    const crossUser = await request(app)
      .get(`/api/receipts/${uploadedReceiptId}/source`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(crossUser.status).toBe(404);
  });

  it("soft-deletes the receipt and prevents subsequent source access", async () => {
    const response = await request(app)
      .delete(`/api/receipts/${uploadedReceiptId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(response.status).toBe(204);

    for (const path of [
      `/api/receipts/${uploadedReceiptId}`,
      `/api/receipts/${uploadedReceiptId}/source`,
    ]) {
      const lookup = await request(app).get(path).set("Authorization", `Bearer ${tokenA}`);
      expect(lookup.status).toBe(404);
    }
  });

  it("lists only current, owner-scoped receipts with filters and paging", async () => {
    const reviewId = randomUUID();
    const confirmedId = randomUUID();
    const processingId = randomUUID();
    const userBReceiptId = randomUUID();
    const rows = [
      { id: reviewId, status: "review" as const, userId: userAId, client: userA },
      { id: confirmedId, status: "confirmed" as const, userId: userAId, client: userA },
      { id: processingId, status: "processing" as const, userId: userAId, client: userA },
      { id: userBReceiptId, status: "confirmed" as const, userId: userBId, client: userB },
    ];

    for (const row of rows) {
      const path = sourceObjectPath(row.userId, row.id);
      await new ReceiptRepository(row.client, row.userId).create({
        id: row.id,
        sourceObjectPath: path,
        sourceOriginalFilename: "list.jpg",
        sourceContentType: "image/jpeg",
        status: row.status,
      });
      sourcePaths.push(path);
    }

    const all = await request(app).get("/api/receipts").set("Authorization", `Bearer ${tokenA}`);
    expect(all.status).toBe(200);
    const allPage = listReceiptsResponseSchema.parse(all.body);
    const ids = allPage.items.map((receipt) => receipt.id);
    expect(ids).toEqual(expect.arrayContaining([reviewId, confirmedId, processingId]));
    expect(ids).not.toContain(userBReceiptId);
    expect(ids).not.toContain(uploadedReceiptId);
    expect(allPage.items.map((receipt) => receipt.createdAt)).toEqual(
      allPage.items
        .map((receipt) => receipt.createdAt)
        .toSorted()
        .toReversed(),
    );

    const confirmed = await request(app)
      .get("/api/receipts?status=confirmed")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(confirmed.status).toBe(200);
    expect(listReceiptsResponseSchema.parse(confirmed.body).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: confirmedId, status: "confirmed" })]),
    );
    expect(
      listReceiptsResponseSchema
        .parse(confirmed.body)
        .items.every((receipt) => receipt.status === "confirmed"),
    ).toBe(true);

    const processing = await request(app)
      .get("/api/receipts?status=processing")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(processing.status).toBe(200);
    expect(listReceiptsResponseSchema.parse(processing.body).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: processingId, status: "processing" })]),
    );

    const first = await request(app)
      .get("/api/receipts?limit=1&page=1")
      .set("Authorization", `Bearer ${tokenA}`);
    const second = await request(app)
      .get("/api/receipts?limit=1&page=2")
      .set("Authorization", `Bearer ${tokenA}`);
    const firstPage = listReceiptsResponseSchema.parse(first.body);
    const secondPage = listReceiptsResponseSchema.parse(second.body);
    expect(firstPage.items).toHaveLength(1);
    expect(secondPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.id).not.toBe(secondPage.items[0]?.id);
    expect(firstPage.total).toBe(secondPage.total);

    const beyond = await request(app)
      .get("/api/receipts?limit=1&page=999")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(beyond.status).toBe(200);
    expect(listReceiptsResponseSchema.parse(beyond.body).items).toEqual([]);

    const invalid = await request(app)
      .get("/api/receipts?status=nonsense")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: { code: "invalid_request" } });
  });

  it("exports only confirmed, non-deleted owner receipts", async () => {
    const exportedId = randomUUID();
    const reviewId = randomUUID();
    const deletedId = randomUUID();
    const userBReceiptId = randomUUID();
    const rows = [
      {
        id: exportedId,
        status: "confirmed" as const,
        userId: userAId,
        client: userA,
        canonicalData: { sellerName: "=Formula seller", total: "100.50", currency: "EUR" },
      },
      {
        id: reviewId,
        status: "review" as const,
        userId: userAId,
        client: userA,
        canonicalData: { sellerName: "Review seller", total: "10.00", currency: "EUR" },
      },
      {
        id: deletedId,
        status: "confirmed" as const,
        userId: userAId,
        client: userA,
        canonicalData: { sellerName: "Deleted seller", total: "20.00", currency: "EUR" },
      },
      {
        id: userBReceiptId,
        status: "confirmed" as const,
        userId: userBId,
        client: userB,
        canonicalData: { sellerName: "Other user seller", total: "30.00", currency: "EUR" },
      },
    ];

    for (const row of rows) {
      const path = sourceObjectPath(row.userId, row.id);
      await new ReceiptRepository(row.client, row.userId).create({
        id: row.id,
        sourceObjectPath: path,
        sourceOriginalFilename: "export.jpg",
        sourceContentType: "image/jpeg",
        status: row.status,
        canonicalData: row.canonicalData,
      });
      sourcePaths.push(path);
    }
    await new ReceiptRepository(userA, userAId).softDelete(deletedId);

    const csv = await request(app)
      .get("/api/receipts/export?format=csv")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/^text\/csv/);
    expect(csv.text.at(0)).toBe("\uFEFF");
    expect(csv.text).toContain(exportedId);
    expect(csv.text).toContain("'=Formula seller");
    expect(csv.text).toContain(",100.50,");
    expect(csv.text).not.toContain(reviewId);
    expect(csv.text).not.toContain(deletedId);
    expect(csv.text).not.toContain(userBReceiptId);

    const json = await request(app)
      .get("/api/receipts/export?format=json")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(json.status).toBe(200);
    const body = jsonExportResponseSchema.parse(json.body);
    expect(body.schemaVersion).toBe(1);
    expect(body.receipts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: exportedId, total: "100.50" })]),
    );
    expect(body.receipts.map((receipt) => receipt.id)).not.toEqual(
      expect.arrayContaining([reviewId, deletedId, userBReceiptId]),
    );
    expect(JSON.stringify(body)).not.toContain("rawProviderResult");
  });

  it("rejects invalid export requests", async () => {
    const missing = await request(app)
      .get("/api/receipts/export")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ error: { code: "invalid_request" } });

    const invalid = await request(app)
      .get("/api/receipts/export?format=xml")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: { code: "invalid_request" } });

    const unauthorized = await request(app).get("/api/receipts/export?format=json");
    expect(unauthorized.status).toBe(401);
  });

  it("lets a direct signed URL expire", async () => {
    const { data, error } = await userA.storage
      .from(config.STORAGE_BUCKET)
      .createSignedUrl(sourceObjectPath(userAId, uploadedReceiptId), 1);
    expect(error).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch(data!.signedUrl);
    expect([400, 403, 404]).toContain(response.status);
  });

  it("moves an uploaded receipt to review and retains the original extraction", async () => {
    const response = await request(app)
      .post("/api/receipts")
      .set("Authorization", `Bearer ${tokenA}`)
      .attach("file", jpeg, { filename: "task07-review.jpg", contentType: "image/jpeg" });
    const created = createReceiptResponseSchema.parse(response.body);
    sourcePaths.push(sourceObjectPath(userAId, created.id));

    const receipt = await waitForStatus(created.id, tokenA, "review");
    reviewReceiptId = created.id;
    expect(receipt).toMatchObject({ sellerName: "Integration seller", total: "8.08" });

    const { data, error } = await admin
      .from("receipts")
      .select("canonical_data, original_extraction, raw_provider_result, extraction_metadata")
      .eq("id", created.id)
      .single();
    expect(error).toBeNull();
    expect(data?.original_extraction).toEqual(data?.canonical_data);
    expect(data?.raw_provider_result).not.toBeNull();
    expect(data?.extraction_metadata).toMatchObject({ latencyMs: 1 });
  });

  it("edits and confirms a review receipt without changing its machine extraction", async () => {
    const patch = await request(app)
      .patch(`/api/receipts/${reviewReceiptId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ documentNumber: "381/1/4" });
    expect(patch.status).toBe(200);
    expect(receiptDetailResponseSchema.parse(patch.body)).toMatchObject({
      documentNumber: "381/1/4",
      status: "review",
      lowConfidenceFields: ["documentNumber"],
    });

    const afterPatch = await admin
      .from("receipts")
      .select("canonical_data, original_extraction")
      .eq("id", reviewReceiptId)
      .single();
    expect(afterPatch.data?.canonical_data).toMatchObject({ documentNumber: "381/1/4" });
    expect(afterPatch.data?.original_extraction).toMatchObject({ documentNumber: "381/1/3" });

    const confirmed = await request(app)
      .post(`/api/receipts/${reviewReceiptId}/confirm`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(confirmed.status).toBe(200);
    expect(confirmReceiptResponseSchema.parse(confirmed.body)).toMatchObject({
      status: "confirmed",
    });

    const repeat = await request(app)
      .post(`/api/receipts/${reviewReceiptId}/confirm`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(repeat.status).toBe(200);

    const afterConfirm = await admin
      .from("receipts")
      .select("original_extraction")
      .eq("id", reviewReceiptId)
      .single();
    expect(afterConfirm.data?.original_extraction).toMatchObject({ documentNumber: "381/1/3" });
  });

  it("rejects edits and confirmation outside review, forged bodies, and cross-user access", async () => {
    const processingId = randomUUID();
    await new ReceiptRepository(userA, userAId).create({
      id: processingId,
      sourceObjectPath: sourceObjectPath(userAId, processingId),
      sourceOriginalFilename: "processing.jpg",
      sourceContentType: "image/jpeg",
    });

    const editProcessing = await request(app)
      .patch(`/api/receipts/${processingId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ documentNumber: "381/1/4" });
    expect(editProcessing.status).toBe(409);

    const confirmProcessing = await request(app)
      .post(`/api/receipts/${processingId}/confirm`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(confirmProcessing.status).toBe(409);

    const forged = await request(app)
      .patch(`/api/receipts/${reviewReceiptId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ userId: userBId });
    expect(forged.status).toBe(400);

    const crossUserPatch = await request(app)
      .patch(`/api/receipts/${reviewReceiptId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ documentNumber: "nope" });
    expect(crossUserPatch.status).toBe(404);

    const crossUserConfirm = await request(app)
      .post(`/api/receipts/${reviewReceiptId}/confirm`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(crossUserConfirm.status).toBe(404);
  });

  it("retries a retryable failure but never allows another user or review receipt to retry", async () => {
    extractionFailure = new ExtractionError("provider_unavailable", true);
    const upload = await request(app)
      .post("/api/receipts")
      .set("Authorization", `Bearer ${tokenA}`)
      .attach("file", jpeg, { filename: "task07-retry.jpg", contentType: "image/jpeg" });
    const created = createReceiptResponseSchema.parse(upload.body);
    sourcePaths.push(sourceObjectPath(userAId, created.id));
    await waitForStatus(created.id, tokenA, "failed");

    extractionFailure = null;
    const retry = await request(app)
      .post(`/api/receipts/${created.id}/retry`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(retry.status).toBe(202);
    await waitForStatus(created.id, tokenA, "review");

    const reviewRetry = await request(app)
      .post(`/api/receipts/${created.id}/retry`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(reviewRetry.status).toBe(409);

    const crossUser = await request(app)
      .post(`/api/receipts/${created.id}/retry`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(crossUser.status).toBe(404);
  });
});

async function waitForStatus(id: string, token: string, status: "review" | "failed") {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await request(app)
      .get(`/api/receipts/${id}`)
      .set("Authorization", `Bearer ${token}`);
    if (response.body.status === status) return response.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Receipt ${id} did not reach ${status}.`);
}

async function pdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage();
  return Buffer.from(await document.save());
}

async function createAndSignIn(
  client: SupabaseClient<Database>,
  id: string,
  email: string,
): Promise<string> {
  const { error: createError } = await admin.auth.admin.createUser({
    id,
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw new Error(`Could not create integration user ${email}.`);

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Could not sign in integration user ${email}.`);
  return data.session.access_token;
}

function createServerClient(key: string): SupabaseClient<Database> {
  return createClient<Database>(requiredEnv("SUPABASE_URL"), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Supabase integration tests.`);
  return value;
}
