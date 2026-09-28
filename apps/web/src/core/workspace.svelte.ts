// The workspace being viewed, and the last one used (remembered per device).
import type { WorkspaceDetail } from "@assistant/shared";
import { api } from "./api.ts";

export const current = $state<{ workspace: WorkspaceDetail | null; error: string }>({
  workspace: null,
  error: "",
});

const KEY = "assistant:last-workspace";

export function lastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private mode etc.: not remembering is fine.
  }
}

export async function loadWorkspace(id: string, { force = false } = {}) {
  if (!force && current.workspace?.id === id) return current.workspace;
  current.error = "";
  try {
    const ws = await api.workspace(id);
    current.workspace = ws;
    remember(id);
    return ws;
  } catch (e) {
    current.workspace = null;
    current.error = e instanceof Error ? e.message : String(e);
    return null;
  }
}

export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "gigs" | "people" | "band" | "reports" | "settings";
  exact?: boolean;
}

/** The app's navigation (gig-centric: no workspaces; docs/design/gig-centric.md §2). */
export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "home", exact: true },
  { href: "/gigs", label: "Gigs", icon: "gigs" },
  { href: "/reports", label: "Reports", icon: "reports" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

/** Navigation for an old workspace page (kept until workspaces are retired). */
export function navFor(ws: WorkspaceDetail): NavItem[] {
  const base = `/w/${ws.id}`;
  const items: NavItem[] = [{ href: "/", label: "Home", icon: "home", exact: true }];
  if (ws.modules.includes("gigs")) {
    items.push({ href: `${base}/gigs`, label: "Gigs", icon: "gigs" });
    items.push({ href: `${base}/people`, label: "People", icon: "people" });
  }
  items.push(
    ws.kind === "band"
      ? { href: `${base}/members`, label: "Collective", icon: "band" }
      : { href: `${base}/members`, label: "Workspace", icon: "band" },
  );
  items.push({ href: "/settings", label: "Settings", icon: "settings" });
  return items;
}
