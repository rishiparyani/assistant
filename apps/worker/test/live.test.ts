// Live updates: a signed-in app's WebSocket hears when a gig it's on changes. Fake data only.
import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import { call, signUp } from "./http.ts";

const BASE = "http://localhost:8787";
const worker = () => (exports as unknown as { default: Fetcher }).default;

function open(cookie: string, origin = BASE) {
  return worker().fetch(`${BASE}/api/live`, { headers: { cookie, origin, upgrade: "websocket" } });
}

describe("live updates", () => {
  it("tells my open app when a gig I'm on changes", async () => {
    const owner = await signUp("Test Owner");
    const res = await open(owner.cookie);
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const got: string[] = [];
    ws.addEventListener("message", (e) => got.push(String(e.data)));

    ws.send("ping");
    const created = await call("/api/gigs", {
      cookie: owner.cookie,
      body: { title: "Test Live Gig", events: [{ start_at: "2027-02-01T19:00" }] },
    });
    const { id } = (await created.json()) as { id: string };

    const until = Date.now() + 8000;
    while (!got.some((m) => m.includes(id)) && Date.now() < until)
      await new Promise((r) => setTimeout(r, 100));
    expect(got).toContain("pong");
    expect(got.map((m) => (m === "pong" ? m : JSON.parse(m)))).toContainEqual({
      type: "gig_changed",
      gig_id: id,
    });
    ws.close(1000);
  });

  it("refuses strangers, other sites and plain requests", async () => {
    const u = await signUp();
    expect(
      (await worker().fetch(`${BASE}/api/live`, { headers: { origin: BASE, upgrade: "websocket" } })).status,
    ).toBe(401);
    expect((await open(u.cookie, "https://evil.example")).status).toBe(403);
    expect((await call("/api/live", { cookie: u.cookie })).status).toBe(426);
  });
});
