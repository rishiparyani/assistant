import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import { isHealthResponse } from "@assistant/shared";
import { createApp } from "../src/core/app.ts";
import { defineModule } from "../src/core/module.ts";

const fetchWorker = (path: string, init?: RequestInit) =>
  (exports as unknown as { default: Fetcher }).default.fetch(`https://example.com${path}`, init);

describe("GET /api/health", () => {
  it("returns ok with the environment and registered modules", async () => {
    const res = await fetchWorker("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isHealthResponse(body)).toBe(true);
    // environment comes from wrangler.jsonc, or .dev.vars when present locally.
    expect(body).toMatchObject({ ok: true, modules: [] });
  });

  it("returns a JSON 404 for unknown API routes", async () => {
    const res = await fetchWorker("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("module registry", () => {
  it("accepts a new module with no core changes", async () => {
    const app = createApp({ modules: [defineModule({ id: "example", name: "Example" })] });
    const res = await app.request("/api/health", {}, { ENVIRONMENT: "dev", BASE_URL: "x" } as Env);
    expect(await res.json()).toMatchObject({ modules: ["example"] });
  });

  it("rejects duplicate module ids", () => {
    const m = defineModule({ id: "example", name: "Example" });
    expect(() => createApp({ modules: [m, m] })).toThrow(/Duplicate module ids/);
  });
});
