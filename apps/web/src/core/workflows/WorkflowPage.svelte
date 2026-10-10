<script lang="ts">
  import type { WorkflowDetail } from "@assistant/shared";
  import Trash from "@lucide/svelte/icons/trash-2";
  import {
    Button,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Skeleton,
    confirm,
    toast,
  } from "../ui/index.ts";
  import { createQuery, dropCache, refreshAll } from "../query.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import WorkflowCard from "./WorkflowCard.svelte";
  import { shortDay, workflowKey, workflowsApi } from "./workflows-api.ts";

  // One workflow full screen: the card (diagram, words, on/off), what it did lately, delete.
  let { id }: { id: string } = $props();
  const q = createQuery<WorkflowDetail>(
    () => workflowKey(id),
    () => workflowsApi.get(id),
  );

  async function remove() {
    const ok = await confirm({
      title: "Delete this workflow?",
      message: "It stops at once. What it already did stays.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await workflowsApi.remove(id);
      dropCache(workflowKey(id));
      refreshAll();
      toast.success("Deleted");
      navigate("/workflows");
    } catch (e) {
      toast.error(e);
    }
  }
</script>

<PageHeader title={q.data?.workflow.name ?? "Workflow"} back="/workflows" backLabel="Workflows">
  {#snippet actions()}
    {#if q.data}
      <Button variant="ghost" onclick={remove} aria-label="Delete">
        {#snippet icon()}<Trash />{/snippet}
      </Button>
    {/if}
  {/snippet}
</PageHeader>
{#if !q.data}
  {#if q.error}
    <EmptyState title="Can't open this" text="It may have been deleted, or you're offline." />
  {:else}
    <Skeleton rows={4} label="Loading" />
  {/if}
{:else}
  <div class="stack">
    <WorkflowCard {id} full />
    <ListGroup title="What it did lately">
      {#each q.data.history as h (h.id)}
        <ListRow
          title={h.detail}
          subtitle="{shortDay(h.at)}{h.record ? ` · ${h.record}` : ''}{h.ok ? '' : ' · didn’t work'}"
          chevron={false}
        />
      {:else}
        <ListRow title="Nothing yet" subtitle="Runs show here, with what each one did." chevron={false} />
      {/each}
    </ListGroup>
  </div>
{/if}

<style>
  .stack {
    max-width: var(--content-max);
    display: grid;
    gap: var(--space-4);
  }
</style>
