import {
  HEALTH_PATH,
  apiErrorResponseSchema,
  canonicalReceiptSchema,
  createReceiptResponseSchema,
  type CanonicalReceipt,
  type CreateReceiptResponse,
  type HealthResponse,
} from "@receipt/shared";
import { supabase } from "../lib/supabase";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Every API call goes through here so the bearer token is attached in exactly one place.
 *
 * `getSession()` transparently refreshes an expiring token, so there is no hand-rolled refresh
 * logic to get wrong.
 */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);

  if (data.session) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }

  const response = await fetch(path, { ...init, headers });

  if (response.status === 401) {
    // The token is gone or no longer valid. Signing out fires onAuthStateChange, which clears
    // the session and lets ProtectedRoute do the redirect — no navigation logic lives here.
    // Signing out an already-signed-out client is a no-op, so this cannot loop.
    await supabase.auth.signOut();
    throw new ApiError(401);
  }

  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .then((value: unknown) => apiErrorResponseSchema.safeParse(value))
      .catch(() => null);

    throw new ApiError(response.status, body?.success ? body.data.error.code : undefined);
  }

  return response;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await request(HEALTH_PATH);
  return (await response.json()) as HealthResponse;
}

export async function createReceipt(file: File): Promise<CreateReceiptResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await request("/api/receipts", { method: "POST", body: formData });
  return createReceiptResponseSchema.parse(await response.json());
}

export async function getReceipt(id: string, signal?: AbortSignal): Promise<CanonicalReceipt> {
  const response = await request(`/api/receipts/${encodeURIComponent(id)}`, { signal });
  return canonicalReceiptSchema.parse(await response.json());
}
