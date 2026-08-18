import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.js";
import { ReceiptRepository } from "./receipts.js";

const supabaseUrl = requiredEnv("SUPABASE_URL");
const publishableKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
const bucketName = requiredEnv("STORAGE_BUCKET");

const userAId = randomUUID();
const userBId = randomUUID();
const repositoryReceiptId = randomUUID();
const crossUserReceiptId = randomUUID();
const storageReceiptId = randomUUID();
const password = "Task03-local-password-123!";
const userAEmail = `task03-a-${userAId}@example.test`;
const userBEmail = `task03-b-${userBId}@example.test`;
const storagePath = `${userAId}/${storageReceiptId}/source`;

const admin = createServerClient(secretKey);
const userA = createServerClient(publishableKey);
const userB = createServerClient(publishableKey);
const repositoryA = new ReceiptRepository(userA, userAId);
const repositoryB = new ReceiptRepository(userB, userBId);

beforeAll(async () => {
  const { data: bucket, error: bucketError } = await admin.storage.getBucket(bucketName);
  if (bucketError || !bucket || bucket.public) {
    throw new Error("Local receipt source bucket is missing or public.");
  }

  const { error: createAError } = await admin.auth.admin.createUser({
    id: userAId,
    email: userAEmail,
    password,
    email_confirm: true,
  });
  if (createAError) throw new Error("Could not create integration user A.");

  const { error: createBError } = await admin.auth.admin.createUser({
    id: userBId,
    email: userBEmail,
    password,
    email_confirm: true,
  });
  if (createBError) throw new Error("Could not create integration user B.");

  const { error: signInAError } = await userA.auth.signInWithPassword({
    email: userAEmail,
    password,
  });
  if (signInAError) throw new Error("Could not sign in integration user A.");

  const { error: signInBError } = await userB.auth.signInWithPassword({
    email: userBEmail,
    password,
  });
  if (signInBError) throw new Error("Could not sign in integration user B.");
});

afterAll(async () => {
  await admin.storage.from(bucketName).remove([storagePath]);
  await admin.auth.admin.deleteUser(userAId);
  await admin.auth.admin.deleteUser(userBId);
});

describe("ReceiptRepository against local Supabase", () => {
  it("inserts, reads, updates, lists, and soft deletes exact canonical data", async () => {
    const created = await repositoryA.create({
      id: repositoryReceiptId,
      sourceObjectPath: `${userAId}/${repositoryReceiptId}/source`,
      sourceOriginalFilename: "exact-total.jpg",
      sourceContentType: "image/jpeg",
      canonicalData: { sellerName: "Seller A", total: "100.50", currency: "EUR" },
    });

    expect(created).toMatchObject({
      id: repositoryReceiptId,
      userId: userAId,
      status: "processing",
      total: "100.50",
    });

    await expect(repositoryA.findById(repositoryReceiptId)).resolves.toMatchObject({
      total: "100.50",
    });

    const updated = await repositoryA.update(repositoryReceiptId, {
      status: "review",
      canonicalData: { sellerName: "Corrected seller", total: "100.50", currency: "EUR" },
    });
    expect(updated).toMatchObject({ status: "review", sellerName: "Corrected seller" });

    const current = await repositoryA.listCurrent();
    expect(current.some((receipt) => receipt.id === repositoryReceiptId)).toBe(true);

    const deleted = await repositoryA.softDelete(repositoryReceiptId);
    expect(deleted?.deletedAt).not.toBeNull();
    await expect(repositoryA.findById(repositoryReceiptId)).resolves.toBeNull();
    await expect(repositoryA.listCurrent()).resolves.not.toContainEqual(
      expect.objectContaining({ id: repositoryReceiptId }),
    );
  });

  it("prevents a second authenticated user from reading, updating, or inserting for user A", async () => {
    await repositoryA.create({
      id: crossUserReceiptId,
      sourceObjectPath: `${userAId}/${crossUserReceiptId}/source`,
      sourceOriginalFilename: "owner-a.jpg",
      sourceContentType: "image/jpeg",
    });

    await expect(repositoryB.findById(crossUserReceiptId)).resolves.toBeNull();
    await expect(repositoryB.update(crossUserReceiptId, { status: "failed" })).resolves.toBeNull();

    const { error } = await userB.from("receipts").insert({
      id: randomUUID(),
      user_id: userAId,
      source_object_path: `${userAId}/${randomUUID()}/source`,
      source_original_filename: "forged-owner.jpg",
      source_content_type: "image/jpeg",
    });
    expect(error?.code).toBe("42501");
  });

  it("keeps receipt sources private and scoped to the first path segment", async () => {
    const body = new TextEncoder().encode("private receipt source");
    const { error: uploadError } = await userA.storage
      .from(bucketName)
      .upload(storagePath, body, { contentType: "text/plain" });
    expect(uploadError).toBeNull();

    const { data: download, error: downloadError } = await userA.storage
      .from(bucketName)
      .download(storagePath);
    expect(downloadError).toBeNull();
    await expect(download?.text()).resolves.toBe("private receipt source");

    const { data: crossUserDownload, error: crossUserDownloadError } = await userB.storage
      .from(bucketName)
      .download(storagePath);
    expect(crossUserDownload).toBeNull();
    expect(crossUserDownloadError).not.toBeNull();

    const { error: forgedPathError } = await userB.storage
      .from(bucketName)
      .upload(`${userAId}/${randomUUID()}/source`, body, { contentType: "text/plain" });
    expect(forgedPathError).not.toBeNull();

    const publicUrl = admin.storage.from(bucketName).getPublicUrl(storagePath).data.publicUrl;
    const unsignedResponse = await fetch(publicUrl);
    // Storage v1.69 returns 400 for this route locally; hosted versions have also used
    // 403/404. All three mean the private object was denied without authorization.
    expect([400, 403, 404]).toContain(unsignedResponse.status);

    const { error: removeError } = await userA.storage.from(bucketName).remove([storagePath]);
    expect(removeError).toBeNull();
  });
});

function createServerClient(key: string): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Supabase integration tests.`);
  return value;
}
