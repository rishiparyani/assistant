<script lang="ts">
  import type { CollectionView, FindResult, RecordView } from "@assistant/shared";
  import {
    Button,
    EmptyState,
    ListGroup,
    ListRow,
    Pill,
    Sheet,
    Skeleton,
    TextField,
    toast,
  } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import { isPending, listKey, spacesApi, summaryOf } from "./spaces-api.ts";
  import PickBoard from "./PickBoard.svelte";

  // One list (collection) as a pop-up from the side menu: search, its records page by page, a
  // tap opens one as a card, Pick to choose among them. Works offline. Records, fields and
  // rules are made and changed in the chat (decision "Chat makes, screens use").
  let { open = $bindable(false), collection }: { open?: boolean; collection: CollectionView } = $props();

  let showBoard = $state(false);
  let typed = $state("");
  let search = $state("");
  $effect(() => {
    const t = typed.trim();
    const timer = setTimeout(() => (search = t), 250);
    return () => clearTimeout(timer);
  });
  const query = $derived(search ? { search } : {});
  const list = createQuery<FindResult>(
    () => listKey(collection.id, query),
    () => spacesApi.find(collection.id, query),
  );
  // Later pages, loaded on "Show more" (the first page stays live in the cache).
  let more = $state<RecordView[]>([]);
  let cursor = $state<string | null>(null);
  let loadingMore = $state(false);
  $effect(() => {
    void list.data;
    more = [];
    cursor = list.data?.next_cursor ?? null;
  });
  const items = $derived([...(list.data?.items ?? []), ...more]);

  async function showMore() {
    if (!cursor) return;
    loadingMore = true;
    try {
      const page = await spacesApi.find(collection.id, { ...query, cursor });
      more = [...more, ...page.items];
      cursor = page.next_cursor;
    } catch (e) {
      toast.error(e);
    } finally {
      loadingMore = false;
    }
  }
</script>

<Sheet bind:open title={collection.name}>
  <TextField label="Search" type="search" bind:value={typed} placeholder="Search {collection.name}" />
  {#if list.data}
    {#if items.length}
      <ListGroup>
        {#each items as r (r.id)}
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
      {#if cursor}
        <Button onclick={showMore} loading={loadingMore}>Show more</Button>
      {/if}
    {:else if search}
      <EmptyState title="Nothing matches" text="Try other words." />
    {:else}
      <EmptyState title="Nothing here yet" text="Ask the assistant to add one." />
    {/if}
  {:else if list.error}
    <EmptyState title="Can't open this" text="You may be offline and it isn't saved on this device yet." />
  {:else}
    <Skeleton rows={4} label="Loading" />
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (showBoard = true)}>Pick</Button>
  {/snippet}
</Sheet>

{#if showBoard}<PickBoard bind:open={showBoard} {collection} />{/if}
