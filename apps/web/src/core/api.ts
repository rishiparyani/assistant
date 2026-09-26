// The web app's only way to reach the backend. No business logic here.
import { isHealthResponse, type HealthResponse } from "@assistant/shared";

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  const body: unknown = await res.json();
  if (!res.ok || !isHealthResponse(body)) throw new Error(`Health check failed (${res.status})`);
  return body;
}
