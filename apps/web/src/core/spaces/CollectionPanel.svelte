<script lang="ts">
  import type { CollectionView, FindResult } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import { Button, EmptyState, ListGroup, ListRow, Pill, Sheet, Skeleton } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import { isPending, listKey, spacesApi, summaryOf } from "./spaces-api.ts";
  import RecordSheet from "./RecordSheet.svelte";

  // One list (collection) as a pop-up from the side menu: its newest records, a tap opens one
  // as a card, Add makes one. Works offline and without the assistant.
  let { open = $bindable(false), collection }: { open?: boolean; collection: CollectionView } = $props();

  const list = createQuery<FindResult>(
    () => listKey(collection.id),
    () => spacesApi.find(collection.id),
  );
  let adding = $state(false);
</script>

<Sheet bind:open title={collection.name}>
  {#if list.data}
    {#if list.data.items.length}
      <ListGroup>
        {#each list.data.items as r (r.id)}
          <ListRow
            title={r.title}
            subtitle={summaryOf(collection, r) || undefined}
            onclick={() => {
              if (isPending(r)) return;
              open = false;
              navigate(`/c/${collection.id}/${r.id}`);
            }}
            chevron={!isPending(r)}
          >
            {#snippet trailing()}{#if isPending(r)}<Pill tone="amber">Waiting</Pill>{/if}{/snippet}
          </ListRow>
        {/each}
      </ListGroup>
      {#if list.data.next_cursor}<p class="more">Showing the newest {list.data.items.length}.</p>{/if}
    {:else}
      <EmptyState title="Nothing here yet" text="Add one here, or ask the assistant." />
    {/if}
  {:else if list.error}
    <EmptyState title="Can't open this" text="You may be offline and it isn't saved on this device yet." />
  {:else}
    <Skeleton rows={4} label="Loading" />
  {/if}
  {#snippet footer()}
    <Button variant="primary" onclick={() => (adding = true)}>
      {#snippet icon()}<Plus />{/snippet}
      Add
    </Button>
  {/snippet}
</Sheet>

<RecordSheet bind:open={adding} {collection} onsaved={() => void list.refresh()} />

<style>
  .more {
    margin: var(--space-2) 0 0;
    color: var(--text-3);
    font-size: var(--text-sm);
  }
</style>
