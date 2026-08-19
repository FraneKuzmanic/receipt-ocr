import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createReceiptResponseSchema, sourceDocumentResponseSchema } from "@receipt/shared";
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
        fields: {},
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
    const before = await new ReceiptRepository(userA, userAId).listCurrent();
    const response = await request(app)
      .post("/api/receipts")
      .set("Authorization", `Bearer ${tokenA}`)
      .attach("file", Buffer.from("MZ executable"), {
        filename: "receipt.jpg",
        contentType: "image/jpeg",
      });

    expect(response.status).toBe(415);
    expect(response.body).toEqual({ error: { code: "unsupported_media_type" } });
    await expect(new ReceiptRepository(userA, userAId).listCurrent()).resolves.toHaveLength(
      before.length,
    );
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
