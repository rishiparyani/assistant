<script lang="ts">
  import type { WorkflowView } from "@assistant/shared";
  import { EmptyState, PageHeader, Skeleton, toast } from "../ui/index.ts";
  import { createQuery, publish } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import WorkflowDiagram from "./WorkflowDiagram.svelte";
  import { WORKFLOWS_KEY, runsText, workflowsApi } from "./workflows-api.ts";

  // All my workflows (chat-first step 5): each with its switch, its plain words and how often
  // it ran; tap one for the diagram and its history.
  const list = createQuery<WorkflowView[]>(() => WORKFLOWS_KEY, workflowsApi.list);

  async function toggle(w: WorkflowView, on: boolean) {
    if (!connection.online) {
      toast.error("Turning a workflow on or off needs a connection.");
      publish(WORKFLOWS_KEY, list.data?.map((x) => ({ ...x })) ?? []);
      return;
    }
    try {
      const saved = await workflowsApi.setEnabled(w.id, on);
      publish(WORKFLOWS_KEY, list.data?.map((x) => (x.id === w.id ? saved : x)) ?? [saved]);
    } catch (e) {
      toast.error(e);
      publish(WORKFLOWS_KEY, list.data?.map((x) => ({ ...x })) ?? []);
    }
  }
</script>

<PageHeader title="Workflows" />
{#if !list.data}
  {#if list.error}
    <EmptyState title="Can't load this" text="Check your connection and try again." />
  {:else}
    <Skeleton rows={3} label="Loading" />
  {/if}
{:else if !list.data.length}
  <EmptyState
    title="No workflows yet"
    text="Ask the assistant, e.g. “tell me when an expense is over ₹5,000” or “remind the band a day before each gig”."
  />
{:else}
  <ul class="grid">
    {#each list.data as w (w.id)}
      <li class="card">
        <div class="top">
          <a class="name" href="/workflows/{w.id}">
            <span class="title">{w.name}</span>
            <span class="sub">{runsText(w)}</span>
          </a>
          <label class="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="{w.name} on"
              checked={w.enabled}
              onchange={(e) => toggle(w, e.currentTarget.checked)}
            />
          </label>
        </div>
        <WorkflowDiagram workflow={w} />
      </li>
    {/each}
  </ul>
{/if}

<style>
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    max-width: var(--content-max);
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    grid-auto-rows: max-content;
  }
  .card {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    min-width: 0;
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .name {
    display: grid;
    flex: 1;
    min-width: 0;
    min-height: 44px;
    color: inherit;
    text-decoration: none;
  }
  .title {
    font-weight: 600;
  }
  .sub {
    color: var(--text-3);
    font-size: var(--text-sm);
  }
  .switch {
    display: grid;
    place-items: center;
    min-width: 44px;
    min-height: 44px;
  }
  .switch input {
    appearance: none;
    position: relative;
    width: 50px;
    height: 30px;
    border-radius: var(--radius-full);
    background: var(--grey-soft);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.2s;
  }
  .switch input::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--shadow-sm);
    transition: transform 0.2s;
  }
  .switch input:checked {
    background: var(--green);
    border-color: var(--green);
  }
  .switch input:checked::after {
    transform: translateX(20px);
  }
</style>
