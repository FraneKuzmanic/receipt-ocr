import {
  HEALTH_PATH,
  apiErrorResponseSchema,
  confirmReceiptResponseSchema,
  createReceiptResponseSchema,
  listReceiptsResponseSchema,
  receiptDetailResponseSchema,
  sourceDocumentResponseSchema,
  sourceRegionsResponseSchema,
  type ConfirmReceiptResponse,
  type CreateReceiptResponse,
  type ExportFormat,
  type HealthResponse,
  type ListReceiptsResponse,
  type ReceiptDetailResponse,
  type ReceiptStatus,
  type SourceDocumentResponse,
  type SourceRegionsResponse,
  type UpdateReceiptRequest,
} from "@receipt/shared";
import { supabase } from "../lib/supabase";

// Empty by default so a relative path keeps working under Vite's dev proxy. Only needed when the
// client and API are deployed as separate origins, which have no such proxy in production.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

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

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

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

export async function getReceipt(id: string, signal?: AbortSignal): Promise<ReceiptDetailResponse> {
  const response = await request(`/api/receipts/${encodeURIComponent(id)}`, { signal });
  return receiptDetailResponseSchema.parse(await response.json());
}

export async function getReceipts(
  query: { page?: number; status?: ReceiptStatus } = {},
  signal?: AbortSignal,
): Promise<ListReceiptsResponse> {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.status !== undefined) params.set("status", query.status);
  const search = params.toString();

  const response = await request(`/api/receipts${search === "" ? "" : `?${search}`}`, { signal });
  return listReceiptsResponseSchema.parse(await response.json());
}

export async function retryReceipt(id: string): Promise<void> {
  await request(`/api/receipts/${encodeURIComponent(id)}/retry`, { method: "POST" });
}

export async function updateReceipt(
  id: string,
  patch: UpdateReceiptRequest,
): Promise<ReceiptDetailResponse> {
  const response = await request(`/api/receipts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return receiptDetailResponseSchema.parse(await response.json());
}

export async function confirmReceipt(id: string): Promise<ConfirmReceiptResponse> {
  const response = await request(`/api/receipts/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
  });
  return confirmReceiptResponseSchema.parse(await response.json());
}

export async function deleteReceipt(id: string): Promise<void> {
  await request(`/api/receipts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getReceiptSource(id: string): Promise<SourceDocumentResponse> {
  const response = await request(`/api/receipts/${encodeURIComponent(id)}/source`);
  return sourceDocumentResponseSchema.parse(await response.json());
}

export async function getReceiptRegions(id: string): Promise<SourceRegionsResponse> {
  const response = await request(`/api/receipts/${encodeURIComponent(id)}/regions`);
  return sourceRegionsResponseSchema.parse(await response.json());
}

export async function exportReceipts(format: ExportFormat): Promise<Blob> {
  const response = await request(`/api/receipts/export?format=${format}`);
  return await response.blob();
}
