<script lang="ts">
  import type { WorkflowDetail, WorkflowView } from "@assistant/shared";
  import Workflow from "@lucide/svelte/icons/workflow";
  import { Button, Pill, Skeleton, toast } from "../ui/index.ts";
  import { createQuery, publish, refreshAll } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import WorkflowDiagram from "./WorkflowDiagram.svelte";
  import { runsText, workflowKey, workflowsApi } from "./workflows-api.ts";

  // A workflow as a card (chat-first step 5): the diagram and plain words from its saved
  // definition, on or off, and how often it ran. A new one is off until Turn on is tapped.
  let { id, full = false }: { id: string; full?: boolean } = $props();
  const q = createQuery<WorkflowDetail>(
    () => workflowKey(id),
    () => workflowsApi.get(id),
  );
  const w = $derived<WorkflowView | undefined>(q.data?.workflow);
  let busy = $state(false);

  async function toggle() {
    if (!w) return;
    if (!connection.online) {
      toast.error("Turning a workflow on or off needs a connection.");
      return;
    }
    busy = true;
    try {
      const saved = await workflowsApi.setEnabled(w.id, !w.enabled);
      publish(workflowKey(id), { ...q.data!, workflow: saved });
      toast.success(saved.enabled ? "It's on" : "It's off");
      refreshAll();
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<article class="card" class:full>
  <header>
    <span class="kind" aria-hidden="true"><Workflow size={18} /></span>
    <span class="head">
      <span class="title">{w?.name ?? "Workflow"}</span>
      {#if w}<span class="sub">{runsText(w)}</span>{/if}
    </span>
    {#if w}<Pill tone={w.enabled ? "green" : "grey"}>{w.enabled ? "On" : "Off"}</Pill>{/if}
  </header>
  {#if !w}
    {#if q.error}<p class="sub">Can't load this workflow.</p>{:else}<Skeleton rows={3} label="Loading" />{/if}
  {:else}
    <WorkflowDiagram workflow={w} />
    <footer>
      <Button size="sm" variant={w.enabled ? "secondary" : "primary"} loading={busy} onclick={toggle}>
        {w.enabled ? "Turn off" : "Turn on"}
      </Button>
      {#if !full}<Button size="sm" variant="ghost" href="/workflows/{w.id}">Open</Button>{/if}
    </footer>
  {/if}
</article>

<style>
  .card {
    --k: var(--kind-flow);
    --k-soft: var(--kind-flow-soft);
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .kind {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--k-soft);
    color: var(--k);
  }
  .head {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 600;
  }
  .sub {
    color: var(--text-3);
    font-size: var(--text-sm);
    margin: 0;
  }
  footer {
    display: flex;
    gap: var(--space-2);
  }
</style>
