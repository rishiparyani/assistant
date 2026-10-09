<script lang="ts">
  import type { OpenedView, SavedView } from "@assistant/shared";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import {
    Button,
    EmptyState,
    ListGroup,
    ListRow,
    Pill,
    Sheet,
    Skeleton,
    confirm,
    toast,
  } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import { filterLabel, isPending, spacesApi, summaryOf, viewKey } from "./spaces-api.ts";

  // A saved view as a pop-up (design §10): its records, open in full, pin or unpin, delete.
  let {
    open = $bindable(false),
    view,
    onchanged,
  }: { open?: boolean; view: SavedView; onchanged?: () => void } = $props();

  const opened = createQuery<OpenedView>(
    () => viewKey(view.id),
    () => spacesApi.openView(view.id),
  );
  const data = $derived(opened.data);
  let busy = $state(false);

  async function togglePin() {
    busy = true;
    try {
      await spacesApi.updateView(view.id, { pinned: !view.pinned });
      toast.success(view.pinned ? "Unpinned" : "Pinned");
      onchanged?.();
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
  async function remove() {
    const ok = await confirm({
      title: `Delete the view “${view.name}”?`,
      message: "Only the saved view goes; its records stay.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await spacesApi.deleteView(view.id);
      toast.success("View deleted");
      open = false;
      onchanged?.();
    } catch (e) {
      toast.error(e);
    }
  }
  function openFull() {
    open = false;
    navigate(`/c/${view.collection_id}?view=${encodeURIComponent(view.id)}`);
  }
</script>

<Sheet bind:open title={view.name}>
  {#if data}
    {#if data.view.filters.length || data.view.search}
      <p class="what">
        {view.collection}:
        {[
          ...data.view.filters.map((f) => filterLabel(data.collection, f)),
          ...(data.view.search ? [`“${data.view.search}”`] : []),
        ].join(" · ")}
      </p>
    {/if}
    {#if data.result.items.length}
      <ListGroup>
        {#each data.result.items as r (r.id)}
          <ListRow
            title={r.title}
            subtitle={summaryOf(data.collection, r) || undefined}
            onclick={() => {
              open = false;
              navigate(`/c/${view.collection_id}/${r.id}`);
            }}
            chevron
          >
            {#snippet trailing()}{#if isPending(r)}<Pill tone="amber">Waiting</Pill>{/if}{/snippet}
          </ListRow>
        {/each}
      </ListGroup>
      {#if data.result.next_cursor}<p class="what">More in the full view.</p>{/if}
    {:else}
      <EmptyState title="Nothing here right now" text="Records that match show up here." />
    {/if}
  {:else if opened.error}
    <EmptyState title="Can't open this view" text="You may be offline, or it was removed." />
  {:else}
    <Skeleton rows={4} label="Loading" />
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={remove} disabled={busy}>Delete</Button>
    <Button onclick={togglePin} loading={busy}>
      {#snippet icon()}{#if view.pinned}<PinOff />{:else}<Pin />{/if}{/snippet}
      {view.pinned ? "Unpin" : "Pin"}
    </Button>
    <Button variant="primary" onclick={openFull}>Open</Button>
  {/snippet}
</Sheet>

<style>
  .what {
    margin: 0 0 var(--space-3);
    color: var(--text-2);
    font-size: var(--text-sm);
  }
</style>
