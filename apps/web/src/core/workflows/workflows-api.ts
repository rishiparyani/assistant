// Workflows (docs/design/chat-first.md step 5): the saved definitions, their on/off switch
// and what they did. Reading works offline from the saved copy.
import type { WorkflowDetail, WorkflowView } from "@assistant/shared";
import { request } from "../api.ts";

const enc = encodeURIComponent;
export const WORKFLOWS_KEY = "workflows:list";
export const workflowKey = (id: string) => `workflows:one:${id}`;

export const workflowsApi = {
  list: () => request<WorkflowView[]>("GET", "/api/workflows"),
  get: (id: string) => request<WorkflowDetail>("GET", `/api/workflows/${enc(id)}`),
  // online-only: a workflow runs in the space on the server; turning it on schedules it there.
  setEnabled: (id: string, enabled: boolean) =>
    request<WorkflowView>("PUT", `/api/workflows/${enc(id)}/enabled`, { enabled }),
  // online-only: deleting stops it on the server at once.
  remove: (id: string) => request<{ deleted: string }>("DELETE", `/api/workflows/${enc(id)}`),
};

/** "2 Nov", or "today" / "yesterday". */
export function shortDay(iso: string): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const now = new Date();
  if (day(d) === day(now)) return "today";
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return "yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** "Ran 3 times · last on 2 Nov", or "Hasn't run yet". */
export function runsText(w: WorkflowView): string {
  if (!w.runs) return "Hasn't run yet";
  return `Ran ${w.runs === 1 ? "once" : `${w.runs} times`} · last ${w.last_run_at ? shortDay(w.last_run_at) : ""}`.trim();
}
