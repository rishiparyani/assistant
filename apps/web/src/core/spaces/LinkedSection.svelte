<script lang="ts">
  import type { CollectionView, FindResult } from "@assistant/shared";
  import { ListGroup, ListRow, Pill } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { isPending, listKey, spacesApi, summaryOf, type FindQuery } from "./spaces-api.ts";

  // Records in another collection that link to this one (a gig's rehearsals).
  let {
    target,
    fieldId,
    title,
    recordId,
  }: { target: CollectionView; fieldId: string; title: string; recordId: string } = $props();

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
</ListGroup>

<style>
</style>
