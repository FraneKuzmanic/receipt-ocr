import { HEALTH_PATH, type HealthResponse } from "@receipt/shared";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(HEALTH_PATH);
  if (!response.ok) {
    throw new ApiError(response.status);
  }
  return (await response.json()) as HealthResponse;
}
