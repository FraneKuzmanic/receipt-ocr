import { HEALTH_PATH, type HealthResponse } from "@receipt/shared";
import { supabase } from "../lib/supabase";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
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
    throw new ApiError(response.status);
  }

  return response;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await request(HEALTH_PATH);
  return (await response.json()) as HealthResponse;
}
