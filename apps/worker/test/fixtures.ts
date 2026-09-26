// Obviously fake data only (public repo).
import { env } from "cloudflare:workers";
import { ulid } from "@assistant/shared";

const now = () => new Date().toISOString();

export async function seedWorkspace(kind: "band" | "personal" = "band") {
  const userId = ulid();
  const workspaceId = ulid();
  await env.DB.batch([
    env.DB.prepare(
      `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt) values (?, ?, ?, 0, ?, ?)`,
    ).bind(userId, "Test Owner", `owner-${userId}@example.com`, now(), now()),
    env.DB.prepare(`insert into organization (id, name, slug, createdAt, kind) values (?, ?, ?, ?, ?)`).bind(
      workspaceId,
      "Test Band",
      `test-band-${workspaceId}`,
      now(),
      kind,
    ),
    env.DB.prepare(
      `insert into member (id, organizationId, userId, role, createdAt) values (?, ?, ?, 'owner', ?)`,
    ).bind(ulid(), workspaceId, userId, now()),
  ]);
  return { userId, workspaceId };
}

export async function seedGig(workspaceId: string, userId: string, feePaise = 5_000_000) {
  const gigId = ulid();
  await env.DB.prepare(
    `insert into gigs (id, workspace_id, title, start_at, fee_paise, created_by) values (?, ?, 'Test Wedding', '2026-12-12T13:30:00.000Z', ?, ?)`,
  )
    .bind(gigId, workspaceId, feePaise, userId)
    .run();
  return gigId;
}
