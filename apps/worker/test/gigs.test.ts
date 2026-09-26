import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { ulid, type ClientView, type GigView, type Page, type VenueView } from "@assistant/shared";
import { createApp } from "../src/core/app.ts";
import { defineModule } from "../src/core/module.ts";
import { defineOperation, validateRegistry } from "../src/core/operations.ts";
import { gigsModule } from "../src/modules/gigs/index.ts";
import { call, json, signUp } from "./http.ts";

async function band() {
  const owner = await signUp("Test Owner");
  const ws = await json<{ id: string }>(
    await call("/api/workspaces", { cookie: owner.cookie, body: { name: "Test Band" } }),
  );
  const api = (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api/w/${ws.id}${path}`, { cookie: owner.cookie, ...init });
  return { owner, ws, api };
}

async function auditActions(workspaceId: string, entityType: string) {
  const { results } = await env.DB.prepare(
    `select action from audit_log where workspace_id = ? and entity_type = ? order by id`,
  )
    .bind(workspaceId, entityType)
    .all<{ action: string }>();
  return results.map((r) => r.action);
}

describe("clients", () => {
  it("creates, finds, updates and soft-deletes", async () => {
    const { ws, api } = await band();
    const created = await api("/clients", {
      body: { name: "Test Sharma Weddings", phone: "+91 90000 00001", organisation: "Test Events Pvt Ltd" },
    });
    expect(created.status).toBe(201);
    const client = await json<ClientView>(created);
    expect(client).toMatchObject({ name: "Test Sharma Weddings", email: null, notes: null });

    const found = await json<Page<ClientView>>(await api("/clients?q=events"));
    expect(found.items.map((c) => c.id)).toEqual([client.id]);

    const updated = await json<ClientView>(
      await api(`/clients/${client.id}`, {
        method: "PATCH",
        body: { email: "sharma@example.com", phone: null },
      }),
    );
    expect(updated).toMatchObject({ email: "sharma@example.com", phone: null, name: "Test Sharma Weddings" });

    expect((await api(`/clients/${client.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await json<Page<ClientView>>(await api("/clients"))).items).toEqual([]);
    expect((await api(`/clients/${client.id}`)).status).toBe(404);
    expect(await auditActions(ws.id, "client")).toEqual(["create_client", "update_client", "delete_client"]);
  });

  it("paginates by name with a cursor", async () => {
    const { api } = await band();
    for (const name of ["Test C", "test a", "Test B", "Test D", "Test E"])
      await api("/clients", { body: { name } });
    const first = await json<Page<ClientView>>(await api("/clients?limit=2"));
    expect(first.items.map((c) => c.name)).toEqual(["test a", "Test B"]);
    expect(first.next_cursor).toBeTruthy();
    const second = await json<Page<ClientView>>(await api(`/clients?limit=2&cursor=${first.next_cursor}`));
    expect(second.items.map((c) => c.name)).toEqual(["Test C", "Test D"]);
    const last = await json<Page<ClientView>>(await api(`/clients?limit=2&cursor=${second.next_cursor}`));
    expect(last).toMatchObject({ items: [{ name: "Test E" }], next_cursor: null });
    expect((await api("/clients?cursor=garbage")).status).toBe(400);
  });

  it("validates input", async () => {
    const { api } = await band();
    const res = await api("/clients", { body: { name: "" } });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: { code: "validation_failed" } });
  });
});

describe("venues", () => {
  it("creates, searches by city, updates and deletes", async () => {
    const { api } = await band();
    const venue = await json<VenueView>(await api("/venues", { body: { name: "Test Hall", city: "Pune" } }));
    await api("/venues", { body: { name: "Test Lawn", city: "Mumbai" } });
    const pune = await json<Page<VenueView>>(await api("/venues?q=pune"));
    expect(pune.items.map((v) => v.name)).toEqual(["Test Hall"]);
    const renamed = await json<VenueView>(
      await api(`/venues/${venue.id}`, { method: "PATCH", body: { name: "Test Hall 2" } }),
    );
    expect(renamed).toMatchObject({ name: "Test Hall 2", city: "Pune" });
    expect((await api(`/venues/${venue.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await json<Page<VenueView>>(await api("/venues"))).items.map((v) => v.name)).toEqual([
      "Test Lawn",
    ]);
  });
});

describe("gigs", () => {
  it("creates a gig with India times, a rupee fee and names resolved to ids", async () => {
    const { ws, api } = await band();
    const client = await json<ClientView>(await api("/clients", { body: { name: "Test Sharma" } }));
    const venue = await json<VenueView>(await api("/venues", { body: { name: "Test Hall", city: "Pune" } }));
    const res = await api("/gigs", {
      body: {
        title: "Test Wedding Sangeet",
        event_type: "wedding",
        start_at: "2026-12-12T19:00",
        end_at: "2026-12-12T23:30",
        fee: "₹50,000",
        client_name: "test sharma",
        venue_name: "TEST HALL",
      },
    });
    expect(res.status).toBe(201);
    const gig = await json<GigView>(res);
    expect(gig).toMatchObject({
      title: "Test Wedding Sangeet",
      status: "enquiry",
      start_at: "2026-12-12T13:30:00.000Z",
      start_display: "Sat, 12 Dec 2026, 7:00 pm IST",
      date: "2026-12-12",
      end_display: "Sat, 12 Dec 2026, 11:30 pm IST",
      fee: { amount_paise: 5_000_000, amount_display: "₹50,000" },
      client: { id: client.id, name: "Test Sharma" },
      venue: { id: venue.id, name: "Test Hall", city: "Pune" },
    });
    expect(await auditActions(ws.id, "gig")).toEqual(["create_gig"]);
  });

  it("never guesses between similar names", async () => {
    const { api } = await band();
    await api("/clients", { body: { name: "Test Sharma" } });
    await api("/clients", { body: { name: "Test Sharma" } });
    await api("/clients", { body: { name: "Test Sharmila" } });
    const base = { title: "Test Gig", start_at: "2026-12-12T19:00" };

    const twoExact = await api("/gigs", { body: { ...base, client_name: "Test Sharma" } });
    expect(twoExact.status).toBe(409);
    const body = await json(twoExact);
    expect(body.error.code).toBe("ambiguous");
    expect(body.error.details.candidates).toHaveLength(2);

    const partial = await api("/gigs", { body: { ...base, client_name: "sharm" } });
    expect(partial.status).toBe(409);
    expect((await json(partial)).error.details.candidates.map((c: { name: string }) => c.name)).toEqual([
      "Test Sharma",
      "Test Sharma",
      "Test Sharmila",
    ]);

    const none = await api("/gigs", { body: { ...base, client_name: "Nobody Known" } });
    expect(none.status).toBe(404);
    const both = await api("/gigs", { body: { ...base, client_name: "Test Sharmila", client_id: "x" } });
    expect(both.status).toBe(400);
    // Nothing was created by the failed attempts.
    expect((await json<Page<GigView>>(await api("/gigs"))).items).toEqual([]);
  });

  it("rejects bad times and fees", async () => {
    const { api } = await band();
    for (const body of [
      { title: "x", start_at: "next friday" },
      { title: "x", start_at: "2026-02-30T19:00" },
      { title: "x", start_at: "2026-12-12T19:00", end_at: "2026-12-12T18:00" },
      { title: "x", start_at: "2026-12-12T19:00", fee: "lots" },
      { title: "x", start_at: "2026-12-12T19:00", fee: "100", fee_paise: 10000 },
    ]) {
      expect((await api("/gigs", { body })).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("finds gigs by date range, status and title, in order, with pagination", async () => {
    const { api } = await band();
    const make = (title: string, start_at: string) =>
      api("/gigs", { body: { title, start_at } }).then((r) => json<GigView>(r));
    const nov = await make("Test Club Night", "2026-11-20T21:00");
    const dec1 = await make("Test Wedding A", "2026-12-05T19:00");
    const dec2 = await make("Test Wedding B", "2026-12-19T19:00");
    await api(`/gigs/${dec2.id}/confirm`, { method: "POST" });

    const december = await json<Page<GigView>>(await api("/gigs?from=2026-12-01&to=2027-01-01"));
    expect(december.items.map((g) => g.id)).toEqual([dec1.id, dec2.id]);
    const confirmed = await json<Page<GigView>>(await api("/gigs?status=confirmed"));
    expect(confirmed.items.map((g) => g.id)).toEqual([dec2.id]);
    const weddingsDesc = await json<Page<GigView>>(await api("/gigs?q=wedding&order=desc"));
    expect(weddingsDesc.items.map((g) => g.id)).toEqual([dec2.id, dec1.id]);

    const p1 = await json<Page<GigView>>(await api("/gigs?limit=2"));
    expect(p1.items.map((g) => g.id)).toEqual([nov.id, dec1.id]);
    const p2 = await json<Page<GigView>>(await api(`/gigs?limit=2&cursor=${p1.next_cursor}`));
    expect(p2).toMatchObject({ items: [{ id: dec2.id }], next_cursor: null });
  });

  it("moves through statuses and refuses impossible changes", async () => {
    const { ws, api } = await band();
    const gig = await json<GigView>(
      await api("/gigs", { body: { title: "Test Gig", start_at: "2026-12-12T19:00" } }),
    );
    const post = (path: string, body?: unknown) =>
      api(`/gigs/${gig.id}/${path}`, { method: "POST", body: body ?? {} });

    expect((await json<GigView>(await post("confirm"))).status).toBe("confirmed");
    expect((await json<GigView>(await post("confirm"))).status).toBe("confirmed"); // no-op
    expect((await json<GigView>(await post("complete"))).status).toBe("completed");
    const cancel = await post("cancel", { reason: "Rain" });
    expect(cancel.status).toBe(409);
    expect((await json(cancel)).error.message).toContain("completed gig can't be marked cancelled");

    const other = await json<GigView>(
      await api("/gigs", { body: { title: "Test Gig 2", start_at: "2026-12-13T19:00" } }),
    );
    const cancelled = await json<GigView>(
      await api(`/gigs/${other.id}/cancel`, { method: "POST", body: { reason: "Client postponed" } }),
    );
    expect(cancelled).toMatchObject({ status: "cancelled", notes: "Cancelled: Client postponed" });
    expect((await api(`/gigs/${other.id}/confirm`, { method: "POST", body: {} })).status).toBe(409);
    expect(await auditActions(ws.id, "gig")).toEqual([
      "create_gig",
      "confirm_gig",
      "complete_gig",
      "create_gig",
      "cancel_gig",
    ]);
  });

  it("updates only the given fields and can clear links", async () => {
    const { api } = await band();
    const client = await json<ClientView>(await api("/clients", { body: { name: "Test Client" } }));
    const gig = await json<GigView>(
      await api("/gigs", {
        body: { title: "Test Gig", start_at: "2026-12-12T19:00", client_id: client.id, fee_paise: 100_00 },
      }),
    );
    const updated = await json<GigView>(
      await api(`/gigs/${gig.id}`, {
        method: "PATCH",
        body: { fee: "25000", client_id: null, notes: "Test note" },
      }),
    );
    expect(updated).toMatchObject({
      title: "Test Gig",
      client: null,
      notes: "Test note",
      fee: { amount_display: "₹25,000" },
      start_at: gig.start_at,
    });
    const bad = await api(`/gigs/${gig.id}`, { method: "PATCH", body: { end_at: "2026-12-12T10:00" } });
    expect(bad.status).toBe(400);
  });

  it("deletes a mistaken gig, but not one with payments", async () => {
    const { owner, ws, api } = await band();
    const mistake = await json<GigView>(
      await api("/gigs", { body: { title: "Test Typo", start_at: "2026-12-12T19:00" } }),
    );
    expect((await api(`/gigs/${mistake.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/gigs/${mistake.id}`)).status).toBe(404);

    const paid = await json<GigView>(
      await api("/gigs", { body: { title: "Test Paid", start_at: "2026-12-12T19:00", fee: 1000 } }),
    );
    await env.DB.prepare(
      `insert into payments (id, workspace_id, gig_id, amount_paise, paid_on, method, created_by) values (?, ?, ?, 50000, '2026-12-01', 'upi', ?)`,
    )
      .bind(ulid(), ws.id, paid.id, owner.id)
      .run();
    expect((await api(`/gigs/${paid.id}`, { method: "DELETE" })).status).toBe(409);
  });
});

describe("workspace isolation for gigs", () => {
  it("keeps another workspace's clients, venues and gigs out of reach", async () => {
    const a = await band();
    const b = await band();
    const client = await json<ClientView>(await a.api("/clients", { body: { name: "Test Private Client" } }));
    const gig = await json<GigView>(
      await a.api("/gigs", { body: { title: "Test Private Gig", start_at: "2026-12-12T19:00" } }),
    );

    // B's own workspace can't see or link A's records.
    expect((await b.api(`/gigs/${gig.id}`)).status).toBe(404);
    expect((await b.api(`/clients/${client.id}`)).status).toBe(404);
    expect(
      (await b.api("/gigs", { body: { title: "x", start_at: "2026-12-12T19:00", client_id: client.id } }))
        .status,
    ).toBe(404);
    expect(
      (
        await b.api("/gigs", {
          body: { title: "x", start_at: "2026-12-12T19:00", client_name: "Test Private Client" },
        })
      ).status,
    ).toBe(404);
    expect((await json<Page<GigView>>(await b.api("/gigs"))).items).toEqual([]);

    // B can't reach A's workspace at all.
    const direct = await call(`/api/w/${a.ws.id}/gigs`, { cookie: b.owner.cookie });
    expect(direct.status).toBe(404);
    const patch = await call(`/api/w/${a.ws.id}/gigs/${gig.id}`, {
      cookie: b.owner.cookie,
      method: "PATCH",
      body: { title: "hacked" },
    });
    expect(patch.status).toBe(404);
    expect((await json<GigView>(await a.api(`/gigs/${gig.id}`))).title).toBe("Test Private Gig");
  });

  it("needs the gigs module enabled", async () => {
    const { ws, api } = await band();
    await env.DB.prepare(
      `update workspace_modules set enabled = 0 where workspace_id = ? and module_id = 'gigs'`,
    )
      .bind(ws.id)
      .run();
    expect((await api("/gigs")).status).toBe(403);
  });
});

describe("idempotency", () => {
  it("replays a repeated write instead of doing it twice", async () => {
    const { api } = await band();
    const key = crypto.randomUUID();
    const first = await api("/clients", { body: { name: "Test Once" }, idempotencyKey: key });
    const second = await api("/clients", { body: { name: "Test Once" }, idempotencyKey: key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(await json(second)).toEqual(await json(first));
    expect((await json<Page<ClientView>>(await api("/clients"))).items).toHaveLength(1);
  });

  it("rejects a reused key with a different request, and writes without a key", async () => {
    const { api } = await band();
    const key = crypto.randomUUID();
    await api("/clients", { body: { name: "Test One" }, idempotencyKey: key });
    const reused = await api("/clients", { body: { name: "Test Two" }, idempotencyKey: key });
    expect(reused.status).toBe(409);
    expect((await json(reused)).error.details.reason).toBe("idempotency_key_reused");
    const missing = await api("/clients", { body: { name: "Test Three" }, idempotencyKey: null });
    expect(missing.status).toBe(400);
    expect((await json<Page<ClientView>>(await api("/clients"))).items.map((c) => c.name)).toEqual([
      "Test One",
    ]);
  });

  it("lets a failed write be retried with the same key", async () => {
    const { api } = await band();
    const key = crypto.randomUUID();
    const body = { title: "Test Gig", start_at: "2026-12-12T19:00", client_name: "Test Later" };
    expect((await api("/gigs", { body, idempotencyKey: key })).status).toBe(404);
    await api("/clients", { body: { name: "Test Later" } });
    expect((await api("/gigs", { body, idempotencyKey: key })).status).toBe(201);
  });
});

describe("operation registry", () => {
  it("serves a new module's operation with no core changes", async () => {
    const example = defineModule({
      id: "example",
      name: "Example",
      operations: [
        defineOperation({
          id: "example.echo",
          tool: "example_echo",
          description: "Test-only operation.",
          scope: "workspace",
          kind: "read",
          http: { method: "GET", path: "/example/echo" },
          input: z.object({ text: z.string() }),
          handler: async (ctx, input) => ({ text: input.text, workspace: ctx.workspace.name }),
        }),
      ],
    });
    const app = createApp({ modules: [gigsModule, example] });
    const u = await signUp();
    const ws = await json<{ id: string }>(
      await call("/api/workspaces", { cookie: u.cookie, body: { name: "Test Band" } }),
    );
    // New workspaces enable every registered module, so enable it for this one by hand.
    await env.DB.prepare(`insert into workspace_modules (workspace_id, module_id) values (?, 'example')`)
      .bind(ws.id)
      .run();
    const res = await app.request(
      `/api/w/${ws.id}/example/echo?text=hi`,
      { headers: { cookie: u.cookie } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "hi", workspace: "Test Band" });
    expect((await app.request(`/api/w/${ws.id}/example/echo?text=hi`, {}, env)).status).toBe(401);
  });

  it("refuses duplicate tools and misnamed module operations", () => {
    const op = (id: string, tool: string, path: string) =>
      defineOperation({
        id,
        tool,
        description: "x",
        scope: "workspace",
        kind: "read",
        http: { method: "GET", path },
        input: z.object({}),
        handler: async () => null,
      });
    expect(() => validateRegistry([op("a.one", "same", "/a"), op("a.two", "same", "/b")])).toThrow(
      /Duplicate/,
    );
    expect(() => validateRegistry([op("a.one", "one", "/a"), op("a.two", "two", "/a")])).toThrow(/Duplicate/);
    expect(() => defineModule({ id: "a", name: "A", operations: [op("b.one", "one", "/a")] })).toThrow(
      /must start with/,
    );
  });

  it("exposes every gigs operation from docs/api.md", () => {
    const tools = gigsModule.operations.map((o) => o.tool).sort();
    for (const t of [
      "create_gig",
      "find_gigs",
      "get_gig",
      "update_gig",
      "confirm_gig",
      "complete_gig",
      "cancel_gig",
      "create_client",
      "find_clients",
      "get_client_history",
      "create_venue",
      "find_venues",
    ]) {
      expect(tools).toContain(t);
    }
  });
});
