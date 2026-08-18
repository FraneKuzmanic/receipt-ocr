import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Authenticator } from "./auth/authenticator.js";
import { createApp } from "./app.js";

/** Never consulted: every case below sends no token, so the header check rejects first. */
const unusedAuthenticator: Authenticator = { authenticate: () => Promise.resolve(null) };

describe("GET /api/health", () => {
  it("returns the shared HealthResponse contract", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(typeof response.body.uptimeSeconds).toBe("number");
  });
});

describe("unknown routes", () => {
  it("returns a JSON error body, not an HTML stack trace", async () => {
    const response = await request(createApp()).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "not_found" } });
  });
});

describe("the /api/receipts prefix without a token", () => {
  const app = () => createApp({ authenticator: unusedAuthenticator });

  it("rejects a receipt request", async () => {
    const response = await request(app()).get(`/api/receipts/${randomUUID()}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "unauthorized" } });
  });

  it("rejects a path under the prefix that has no route yet, with 401 rather than 404", async () => {
    // Proves the guard sits on the prefix. If it ever moves to individual routes, this
    // becomes 404 and every route a later task adds ships public by default.
    const response = await request(app()).get("/api/receipts");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "unauthorized" } });
  });

  it("rejects a request carrying a forged userId query parameter", async () => {
    const response = await request(app()).get(`/api/receipts?userId=${randomUUID()}`);

    expect(response.status).toBe(401);
  });
});
