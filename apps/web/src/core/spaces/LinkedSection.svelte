<script lang="ts">
  import type { CollectionView, FindResult } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import { ListGroup, ListRow, Pill } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { isPending, listKey, spacesApi, summaryOf, type FindQuery } from "./spaces-api.ts";

  // Records in another collection that link to this one (a gig's rehearsals), with + Add.
  let {
    target,
    fieldId,
    title,
    recordId,
    onadd,
  }: { target: CollectionView; fieldId: string; title: string; recordId: string; onadd: () => void } =
    $props();

  const query = $derived<FindQuery>({ filters: [{ field: fieldId, op: "eq", value: recordId }], limit: 50 });
  const list = createQuery<FindResult>(
    () => listKey(target.id, query),
    () => spacesApi.find(target.id, query, true),
  );
</script>

<ListGroup {title}>
  {#each list.data?.items ?? [] as r (r.id)}
    <ListRow
      title={r.title}
      subtitle={summaryOf(target, r, 3, fieldId) || undefined}
      href="/c/{target.id}/{r.id}"
      chevron
    >
      {#snippet trailing()}{#if isPending(r)}<Pill tone="amber">Waiting</Pill>{/if}{/snippet}
    </ListRow>
  {/each}
  <ListRow title="Add to {title}" onclick={onadd} chevron={false}>
    {#snippet leading()}<span class="add"><Plus size={18} /></span>{/snippet}
  </ListRow>
</ListGroup>

<style>
  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
</style>
