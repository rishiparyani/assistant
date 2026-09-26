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
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

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
    request<void>("DELETE", `/api/w/${workspaceId}/invitations/${invitationId}`),
  removeMember: (workspaceId: string, memberId: string) =>
    request<void>("DELETE", `/api/w/${workspaceId}/members/${memberId}`),
  invitation: (id: string) => request<InvitationView>("GET", `/api/invitations/${id}`),
  acceptInvitation: (id: string) => request<WorkspaceSummary>("POST", `/api/invitations/${id}/accept`, {}),
};
