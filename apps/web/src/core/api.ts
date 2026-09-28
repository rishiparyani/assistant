// The web app's only way to reach the backend. No business logic here.
import {
  isHealthResponse,
  type ApiErrorBody,
  type HealthResponse,
  type InvitationView,
  type MeResponse,
  type WorkspaceDetail,
  type WorkspaceSummary,
} from "@assistant/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
  // Every write carries a fresh key so a retried request can't happen twice.
  if (method !== "GET") headers["idempotency-key"] = crypto.randomUUID();
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return data as T;
}

export interface AdminOverview {
  sections: {
    title: string;
    stats: { label: string; value: string | number; hint?: string; tone?: "ok" | "warn" | "bad" }[];
  }[];
  tools: {
    id: string;
    label: string;
    description: string;
    fields: { name: string; label: string; placeholder?: string }[];
  }[];
  generated_at: string;
}
export interface AdminList {
  owners: string[];
  admins: { email: string; added_at: string; added_by: string | null }[];
}
export interface AdminLogEntry {
  action: string;
  detail: unknown;
  at: string;
  actor: string | null;
}

/** The owner-only admin panel. Admin writes are naturally repeatable, so no Idempotency-Key. */
export const adminApi = {
  me: () => request<{ is_admin: boolean }>("GET", "/api/admin/me"),
  overview: () => request<AdminOverview>("GET", "/api/admin/overview"),
  admins: () => request<AdminList>("GET", "/api/admin/admins"),
  addAdmin: (email: string) => request<AdminList>("POST", "/api/admin/admins", { email }),
  removeAdmin: (email: string) =>
    request<AdminList>("DELETE", `/api/admin/admins/${encodeURIComponent(email)}`),
  runTool: (id: string, input: Record<string, string>) =>
    request<{ result: string }>("POST", `/api/admin/tools/${id}`, input),
  log: () => request<AdminLogEntry[]>("GET", "/api/admin/log"),
};

export const api = {
  health: async (): Promise<HealthResponse> => {
    const body = await request<unknown>("GET", "/api/health");
    if (!isHealthResponse(body)) throw new Error("Unexpected health response");
    return body;
  },
  me: () => request<MeResponse>("GET", "/api/me"),
  createWorkspace: (name: string) => request<WorkspaceSummary>("POST", "/api/workspaces", { name }),
  workspace: (id: string) => request<WorkspaceDetail>("GET", `/api/w/${id}`),
  invite: (workspaceId: string, email: string) =>
    request<InvitationView>("POST", `/api/w/${workspaceId}/invitations`, { email }),
  cancelInvitation: (workspaceId: string, invitationId: string) =>
    request<{ canceled: boolean }>("DELETE", `/api/w/${workspaceId}/invitations/${invitationId}`),
  removeMember: (workspaceId: string, memberId: string) =>
    request<{ removed: boolean }>("DELETE", `/api/w/${workspaceId}/members/${memberId}`),
  invitation: (id: string) => request<InvitationView>("GET", `/api/invitations/${id}`),
  acceptInvitation: (id: string) => request<WorkspaceSummary>("POST", `/api/invitations/${id}/accept`, {}),
};
