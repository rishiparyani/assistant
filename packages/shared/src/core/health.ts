// Shape of GET /api/health, shared by the Worker and the web app.
export interface HealthResponse {
  ok: true;
  environment: "development" | "dev" | "production";
  modules: string[];
  /** Number of applied D1 migrations (proves the database is reachable and migrated). */
  migrations: number;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.ok === true &&
    typeof v.environment === "string" &&
    Array.isArray(v.modules) &&
    typeof v.migrations === "number"
  );
}
