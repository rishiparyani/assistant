// Workspace API shapes, shared by the Worker (validation) and the web app.
import { z } from "zod";

export const WORKSPACE_KINDS = ["personal", "band"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];
export const ROLES = ["owner", "member"] as const;
export type Role = (typeof ROLES)[number];

export const CreateWorkspaceInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInput>;

export const InviteMemberInput = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(ROLES).default("member"),
});
export type InviteMemberInput = z.input<typeof InviteMemberInput>;

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  role: Role;
}

export interface MemberView {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: Role;
  joined_at: string;
}

export interface InvitationView {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string;
  role: Role;
  status: "pending" | "accepted" | "canceled" | "expired";
  expires_at: string;
  /** Link to send the invitee (WhatsApp etc.); no email is sent. */
  url: string;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  members: MemberView[];
  /** Pending invitations; owners only. */
  invitations: InvitationView[];
  modules: string[];
}

export interface MeResponse {
  user: { id: string; name: string; email: string; image: string | null };
  workspaces: WorkspaceSummary[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
