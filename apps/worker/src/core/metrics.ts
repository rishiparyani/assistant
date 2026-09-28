// Per-action metrics in Workers Analytics Engine (design §10a): which operation, its HTTP
// status and how long it took. Ids and numbers only, never personal data. Free plan:
// 100,000 data points written and 10,000 read queries a day.

type MetricsEnv = { METRICS?: AnalyticsEngineDataset };

export function recordOperation(env: MetricsEnv, operation: string, status: number, ms: number) {
  try {
    env.METRICS?.writeDataPoint({
      indexes: [operation],
      blobs: [operation, String(status)],
      doubles: [ms, status >= 500 ? 1 : 0, status >= 400 && status < 500 ? 1 : 0],
    });
  } catch (err) {
    // Metrics must never break a request.
    console.warn("metrics: couldn't record a data point", err);
  }
}

export interface OperationStats {
  operation: string;
  calls: number;
  server_errors: number;
  client_errors: number;
  p50_ms: number;
  p95_ms: number;
}

/**
 * The numbers per operation over the last `minutes` (default a day), from the Analytics Engine SQL API. Needs a
 * read-only token (Account Analytics: Read) and the account id; returns null without them.
 */
export async function operationStats(
  env: { ANALYTICS_TOKEN?: string; CLOUDFLARE_ACCOUNT_ID?: string; ENVIRONMENT: string },
  minutes = 24 * 60,
): Promise<OperationStats[] | null> {
  if (!env.ANALYTICS_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return null;
  const dataset = env.ENVIRONMENT === "production" ? "assistant_metrics" : "assistant_dev_metrics";
  const sql = `
    SELECT blob1 AS operation,
           SUM(_sample_interval) AS calls,
           SUM(_sample_interval * double2) AS server_errors,
           SUM(_sample_interval * double3) AS client_errors,
           quantileExactWeighted(0.5)(double1, _sample_interval) AS p50_ms,
           quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_ms
    FROM ${dataset}
    WHERE timestamp > NOW() - INTERVAL '${Math.max(1, Math.round(minutes))}' MINUTE
    GROUP BY operation
    ORDER BY calls DESC
    LIMIT 50
    FORMAT JSON`;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`,
    { method: "POST", headers: { authorization: `Bearer ${env.ANALYTICS_TOKEN}` }, body: sql },
  );
  if (!res.ok) throw new Error(`Analytics query failed (${res.status})`);
  const body = (await res.json()) as { data: Record<string, string | number>[] };
  return body.data.map((r) => ({
    operation: String(r.operation),
    calls: Math.round(Number(r.calls)),
    server_errors: Math.round(Number(r.server_errors)),
    client_errors: Math.round(Number(r.client_errors)),
    p50_ms: Math.round(Number(r.p50_ms)),
    p95_ms: Math.round(Number(r.p95_ms)),
  }));
}
