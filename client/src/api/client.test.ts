import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { supabase } from "../lib/supabase";
import {
  ApiError,
  createReceipt,
  deleteReceipt,
  exportReceipts,
  getHealth,
  getReceipt,
  getReceipts,
} from "./client";

type SessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
type SignOutResult = Awaited<ReturnType<typeof supabase.auth.signOut>>;

let getSession: MockInstance<typeof supabase.auth.getSession>;
let signOut: MockInstance<typeof supabase.auth.signOut>;

/** The client only ever reads `access_token`, so a fuller session object would be noise. */
function sessionResult(accessToken: string | null): SessionResult {
  const session = accessToken === null ? null : { access_token: accessToken };
  return { data: { session }, error: null } as SessionResult;
}

function respondWith(status: number, body: unknown) {
  // Typed with fetch's own parameters so the recorded call can be inspected below.
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function sentHeaders(fetchMock: ReturnType<typeof respondWith>): Headers {
  return fetchMock.mock.calls[0]?.[1]?.headers as Headers;
}

beforeEach(() => {
  // Spies are created per test: afterEach restores them, and a restored spy no longer
  // intercepts, so re-mocking a module-scope spy would silently do nothing.
  getSession = vi.spyOn(supabase.auth, "getSession");
  signOut = vi.spyOn(supabase.auth, "signOut");
  signOut.mockResolvedValue({ error: null } as SignOutResult);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the API client", () => {
  it("attaches the access token when a session exists", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const fetchMock = respondWith(200, { status: "ok", uptimeSeconds: 1 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHealth()).resolves.toEqual({ status: "ok", uptimeSeconds: 1 });
    expect(sentHeaders(fetchMock).get("Authorization")).toBe("Bearer token-abc");
  });

  it("sends no Authorization header when signed out", async () => {
    getSession.mockResolvedValue(sessionResult(null));
    const fetchMock = respondWith(200, { status: "ok", uptimeSeconds: 1 });
    vi.stubGlobal("fetch", fetchMock);

    await getHealth();

    expect(sentHeaders(fetchMock).get("Authorization")).toBeNull();
  });

  it("signs out exactly once on a 401 so ProtectedRoute can redirect", async () => {
    getSession.mockResolvedValue(sessionResult("stale-token"));
    vi.stubGlobal("fetch", respondWith(401, { error: { code: "unauthorized" } }));

    await expect(getHealth()).rejects.toThrow(ApiError);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("does not sign out on other failures", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    vi.stubGlobal("fetch", respondWith(404, { error: { code: "not_found" } }));

    await expect(getHealth()).rejects.toThrow(ApiError);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("uploads the original file as the only multipart part", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const source = new File(["receipt"], "receipt.jpg", { type: "image/jpeg" });
    const response = {
      id: "00000000-0000-4000-8000-000000000001",
      status: "processing",
      createdAt: "2026-08-18T10:00:00.000Z",
    };
    const fetchMock = respondWith(201, response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(createReceipt(source)).resolves.toEqual(response);

    const init = fetchMock.mock.calls[0]?.[1];
    const formData = init?.body as FormData;
    expect(init?.method).toBe("POST");
    expect([...formData.entries()]).toEqual([["file", source]]);
    expect(sentHeaders(fetchMock).get("Content-Type")).toBeNull();
    expect(sentHeaders(fetchMock).get("Authorization")).toBe("Bearer token-abc");
  });

  it("forwards the abort signal when fetching a receipt", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const controller = new AbortController();
    const receipt = {
      id: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      status: "processing",
      warnings: [],
      lowConfidenceFields: [],
      editedFields: [],
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    };
    const fetchMock = respondWith(200, receipt);
    vi.stubGlobal("fetch", fetchMock);

    await expect(getReceipt(receipt.id, controller.signal)).resolves.toEqual(receipt);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("requests filtered receipt pages and parses the shared response", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const response = { items: [], page: 2, limit: 20, total: 42 };
    const fetchMock = respondWith(200, response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(getReceipts({ page: 2, status: "confirmed" })).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/receipts?page=2&status=confirmed",
      expect.any(Object),
    );
  });

  it("deletes a receipt without parsing the empty response body", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteReceipt("receipt/id")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/receipts/receipt%2Fid",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("downloads exports through the authenticated request path", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    const body = "id,total\r\n1,100.50";
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/csv; charset=utf-8" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await exportReceipts("csv");

    expect(fetchMock).toHaveBeenCalledWith("/api/receipts/export?format=csv", expect.any(Object));
    expect(sentHeaders(fetchMock).get("Authorization")).toBe("Bearer token-abc");
    await expect(blob.text()).resolves.toBe(body);
    expect(blob.type).toBe("text/csv;charset=utf-8");
  });

  it("keeps a stable server error code and tolerates malformed errors", async () => {
    getSession.mockResolvedValue(sessionResult("token-abc"));
    vi.stubGlobal("fetch", respondWith(415, { error: { code: "unsupported_media_type" } }));

    await expect(getHealth()).rejects.toMatchObject({
      status: 415,
      code: "unsupported_media_type",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not json", { status: 500 }))),
    );
    await expect(getHealth()).rejects.toMatchObject({ status: 500, code: undefined });
  });
});
