// The request context every service receives (architecture rule 2), and the single
// authorization middleware that builds it (rule 3): user → membership → role → module.
import { createMiddleware } from "hono/factory";
import { and, eq } from "drizzle-orm";
import type { Role, WorkspaceKind } from "@assistant/shared";
import { createDb, type Db } from "./db/client.ts";
import { member, organization, workspaceModules, type Source } from "./db/schema.ts";
import { getAuth } from "./auth/auth.ts";
import { AppError } from "./errors.ts";

export interface CtxUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface CtxWorkspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  role: Role;
  memberId: string;
}

/** What services get: never raw env, always scoped to the signed-in user. */
export interface UserCtx {
  db: Db;
  d1: D1Database;
  user: CtxUser;
  source: Source;
  baseUrl: string;
}

export interface Ctx extends UserCtx {
  workspace: CtxWorkspace;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    userCtx: UserCtx;
    ctx: Ctx;
    moduleIds: readonly string[];
    moduleSchemas: Record<string, unknown>;
  };
};

/** Requires a signed-in user (session cookie; API tokens and OAuth arrive in T09/T10). */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth({ env: c.env, moduleIds: c.get("moduleIds") });
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new AppError("unauthenticated", "Sign in required");
  const { user } = session;
  c.set("userCtx", {
    db: createDb(c.env.DB, c.get("moduleSchemas")),
    d1: c.env.DB,
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    source: "web",
    baseUrl: c.env.BASE_URL,
  });
  await next();
});

export interface WorkspaceRequirement {
  /** Minimum role. Owners can do everything members can. */
  role?: Role;
  /** Module that must be enabled for the workspace. */
  module?: string;
}

/**
 * Loads `:workspaceId` and checks membership, role and module. Non-members get 404
 * (never reveal that a workspace exists). Must run after requireUser.
 */
export function requireWorkspace(req: WorkspaceRequirement = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const userCtx = c.get("userCtx");
    const workspaceId = c.req.param("workspaceId");
    if (!workspaceId) throw new AppError("not_found", "Workspace not found");
    const [row] = await userCtx.db
      .select({
        id: organization.id,
        name: organization.name,
        kind: organization.kind,
        role: member.role,
        memberId: member.id,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userCtx.user.id)))
      .limit(1);
    if (!row) throw new AppError("not_found", "Workspace not found");
    const role = row.role as Role;
    if (req.role === "owner" && role !== "owner")
      throw new AppError("forbidden", "Only workspace owners can do this");
    if (req.module) {
      const [mod] = await userCtx.db
        .select({ enabled: workspaceModules.enabled })
        .from(workspaceModules)
        .where(and(eq(workspaceModules.workspaceId, row.id), eq(workspaceModules.moduleId, req.module)))
        .limit(1);
      if (!mod?.enabled)
        throw new AppError("forbidden", `The ${req.module} module is not enabled for this workspace`);
    }
    c.set("ctx", {
      ...userCtx,
      workspace: {
        id: row.id,
        name: row.name,
        kind: (row.kind ?? "band") as WorkspaceKind,
        role,
        memberId: row.memberId,
      },
    });
    await next();
  });
}
