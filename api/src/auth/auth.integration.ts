import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../app.js";
import type { Database } from "../database.types.js";
import { ReceiptRepository } from "../repositories/receipts.js";

const supabaseUrl = requiredEnv("SUPABASE_URL");
const publishableKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");

const userAId = randomUUID();
const userBId = randomUUID();
const receiptId = randomUUID();
const deletedReceiptId = randomUUID();
const password = "Task04-integration-password-123!";

// A greppable, per-run prefix: these users live in the real hosted project, so an orphan left by
// a crashed run has to be findable. Never a fixed id or address.
const userAEmail = `task04-a-${userAId}@example.test`;
const userBEmail = `task04-b-${userBId}@example.test`;

const admin = createServerClient(secretKey);
const userA = createServerClient(publishableKey);
const userB = createServerClient(publishableKey);

// The real authenticator, against real ES256 tokens. Stubbing it here would prove nothing.
const app = createApp();

let tokenA = "";
let tokenB = "";

beforeAll(async () => {
  tokenA = await createAndSignIn(userA, userAId, userAEmail);
  tokenB = await createAndSignIn(userB, userBId, userBEmail);

  const repositoryA = new ReceiptRepository(userA, userAId);

  await repositoryA.create({
    id: receiptId,
    sourceObjectPath: `${userAId}/${receiptId}/source`,
    sourceOriginalFilename: "owner-a.jpg",
    sourceContentType: "image/jpeg",
    canonicalData: { sellerName: "Seller A", total: "100.50", currency: "EUR" },
  });

  await repositoryA.create({
    id: deletedReceiptId,
    sourceObjectPath: `${userAId}/${deletedReceiptId}/source`,
    sourceOriginalFilename: "deleted-a.jpg",
    sourceContentType: "image/jpeg",
  });
  await repositoryA.softDelete(deletedReceiptId);
});

afterAll(async () => {
  // Unconditional, including after a failed assertion. `receipts.user_id` is declared
  // `on delete cascade`, so removing the user removes the seeded rows with it — cleanup is
  // structural rather than something each test has to remember row by row.
  await admin.auth.admin.deleteUser(userAId);
  await admin.auth.admin.deleteUser(userBId);
});

describe("GET /api/receipts/:id against the hosted project", () => {
  it("rejects a request with no token", async () => {
    const response = await request(app).get(`/api/receipts/${receiptId}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "unauthorized" } });
  });

  it("rejects a token that is not a JWT", async () => {
    const response = await request(app)
      .get(`/api/receipts/${receiptId}`)
      .set("Authorization", "Bearer not-a-jwt");

    expect(response.status).toBe(401);
  });

  it("returns the owner's receipt with the identity taken from the token", async () => {
    const response = await request(app)
      .get(`/api/receipts/${receiptId}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: receiptId, userId: userAId, total: "100.50" });
  });

  it("returns 404, not 403, for another user's receipt so existence never leaks", async () => {
    const response = await request(app)
      .get(`/api/receipts/${receiptId}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "not_found" } });
  });

  it("returns 404 for a receipt id that does not exist", async () => {
    const response = await request(app)
      .get(`/api/receipts/${randomUUID()}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(404);
  });

  it("returns 400 for an id that is not a UUID", async () => {
    const response = await request(app)
      .get("/api/receipts/not-a-uuid")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "invalid_request" } });
  });

  it("ignores a forged userId in the query and the body (PRD §9.1)", async () => {
    const asOwner = await request(app)
      .get(`/api/receipts/${receiptId}?userId=${userBId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ userId: userBId });

    expect(asOwner.status).toBe(200);
    expect(asOwner.body).toMatchObject({ userId: userAId });

    // The same forgery in the other direction cannot promote user B either.
    const asStranger = await request(app)
      .get(`/api/receipts/${receiptId}?userId=${userAId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ userId: userAId });

    expect(asStranger.status).toBe(404);
  });

  it("returns 404 for a soft-deleted receipt, even to its own owner", async () => {
    const response = await request(app)
      .get(`/api/receipts/${deletedReceiptId}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(response.status).toBe(404);
  });
});

async function createAndSignIn(
  client: SupabaseClient<Database>,
  id: string,
  email: string,
): Promise<string> {
  // `email_confirm: true` sends no email, so these runs never touch the project's email quota.
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
  return createClient<Database>(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Supabase integration tests.`);
  return value;
}
