<script lang="ts">
  import type { CollectionView } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Layers from "@lucide/svelte/icons/layers";
  import { Button, EmptyState, ListGroup, ListRow, PageHeader, Skeleton, toast } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import { COLLECTIONS_KEY, spacesApi } from "./spaces-api.ts";
  import CollectionSheet from "./CollectionSheet.svelte";
  import PinnedBar from "./PinnedBar.svelte";

  // My collections: the starter ones (notes, reminders, events, expenses) and any I make.
  let adding = $state(false);
  const list = createQuery<CollectionView[]>(() => COLLECTIONS_KEY, spacesApi.collections);
  $effect(() => {
    if (list.error && !list.data) toast.error(list.error);
  });

  /** "What · Amount · Date · Category" (the first few fields). */
  const kinds = (c: CollectionView) => {
    const names = c.fields.slice(0, 4).map((f) => f.name);
    return names.join(" · ") + (c.fields.length > 4 ? ` +${c.fields.length - 4}` : "");
  };
</script>

<PageHeader
  title="Collections"
  subtitle="Your notes, reminders, expenses and anything else you keep track of."
>
  {#snippet actions()}
    <Button variant="ghost" href="/help" aria-label="Help">
      {#snippet icon()}<CircleHelp />{/snippet}
    </Button>
    <Button variant="primary" onclick={() => (adding = true)}>
      {#snippet icon()}<Plus />{/snippet}
      New
    </Button>
  {/snippet}
</PageHeader>

<PinnedBar all />

{#if !list.data}
  <Skeleton rows={4} label="Loading your collections" />
{:else if list.data.length === 0}
  <EmptyState title="No collections yet" text="Make one for anything you want to keep track of.">
    {#snippet icon()}<Layers size={26} />{/snippet}
    {#snippet action()}<Button variant="primary" onclick={() => (adding = true)}>New collection</Button
      >{/snippet}
  </EmptyState>
{:else}
  <ListGroup>
    {#each list.data as c (c.id)}
      <ListRow title={c.name} subtitle={c.description ?? kinds(c)} href="/c/{c.id}" chevron>
        {#snippet leading()}<span class="badge">{c.name.charAt(0).toUpperCase()}</span>{/snippet}
      </ListRow>
    {/each}
  </ListGroup>
{/if}

<CollectionSheet
  bind:open={adding}
  onsaved={(c) => {
    list.set([...(list.data ?? []), c]);
    navigate(`/c/${c.id}`);
  }}
/>

<style>
  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 700;
  }
</style>
