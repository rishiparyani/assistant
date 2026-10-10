<script lang="ts">
  import type { CollectionView, LinkedRef, RecordView } from "@assistant/shared";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash from "@lucide/svelte/icons/trash-2";
  import Share2 from "@lucide/svelte/icons/share-2";
  import {
    Button,
    Card,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    Skeleton,
    confirm,
    toast,
  } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import {
    COLLECTIONS_KEY,
    deleteRecord,
    isPending,
    recordKey,
    savedCollections,
    showValue,
    spacesApi,
  } from "./spaces-api.ts";
  import RecordSheet from "./RecordSheet.svelte";
  import LinkedSection from "./LinkedSection.svelte";
  import ShareSheet from "./ShareSheet.svelte";
  import Comments from "./Comments.svelte";
  import { commentsApi, commentsKey } from "./shares-api.ts";

  // One record: its values, what it links to, and what links to it (each with + Add).
  let { collectionId, recordId }: { collectionId: string; recordId: string } = $props();

  const col = createQuery<CollectionView>(
    () => `spaces:collection:${collectionId}`,
    () => spacesApi.collection(collectionId),
  );
  const collection = $derived(col.data ?? savedCollections()?.find((c) => c.id === collectionId));
  const rec = createQuery<RecordView>(
    () => recordKey(collectionId, recordId),
    () => spacesApi.record(recordId),
  );
  const record = $derived(rec.data);
  // Every collection, for the sections of records that link here.
  const all = createQuery<CollectionView[]>(() => COLLECTIONS_KEY, spacesApi.collections);
  const gone = $derived(!!(record as (RecordView & { deleted?: boolean }) | undefined)?.deleted);

  let editing = $state(false);
  let sharing = $state(false);
  // Adding a record in another collection that links back to this one.
  let addTo = $state<{ collection: CollectionView; links: Record<string, LinkedRef[]> } | null>(null);
  let addOpen = $state(false);

  const filled = $derived(
    collection && record
      ? collection.fields.filter(
          (f) =>
            f.id !== collection.title_field_id &&
            f.type !== "link" &&
            !f.options.personal &&
            showValue(f, record.values[f.id]),
        )
      : [],
  );
  const linkFields = $derived(collection?.fields.filter((f) => f.type === "link") ?? []);
  // Fields each person answers for themselves: everyone's answers, mine first.
  const personalFields = $derived(collection?.fields.filter((f) => f.options.personal) ?? []);

  async function remove() {
    if (!collection || !record) return;
    const ok = await confirm({
      title: `Delete “${record.title}”?`,
      message: "Records linked to it follow their link's rule (most just lose the link).",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteRecord(collection, record);
      toast.success("Deleted");
      navigate(`/c/${collection.id}`, { replace: true });
    } catch (e) {
      toast.error(e);
    }
  }

  function addLinked(target: CollectionView, fieldId: string) {
    if (!record) return;
    addTo = {
      collection: target,
      links: { [fieldId]: [{ id: record.id, collection_id: record.collection_id, title: record.title }] },
    };
    addOpen = true;
  }
</script>

{#if !collection || !record || gone}
  <PageHeader
    title={collection?.name ?? "Record"}
    back="/c/{collectionId}"
    backLabel={collection?.name ?? "Back"}
  />
  {#if gone}
    <EmptyState title="Deleted" text="It's gone once the change syncs." />
  {:else if rec.error}
    <EmptyState title="Can't open this" text="It may have been deleted, or you're offline." />
  {:else}
    <Skeleton rows={5} label="Loading" />
  {/if}
{:else}
  <PageHeader title={record.title} back="/c/{collection.id}" backLabel={collection.name}>
    {#snippet actions()}
      <Button variant="ghost" onclick={remove} aria-label="Delete">
        {#snippet icon()}<Trash />{/snippet}
      </Button>
      <Button variant="ghost" onclick={() => (sharing = true)} aria-label="Share">
        {#snippet icon()}<Share2 />{/snippet}
      </Button>
      <Button variant="primary" onclick={() => (editing = true)}>
        {#snippet icon()}<Pencil />{/snippet}
        Edit
      </Button>
    {/snippet}
  </PageHeader>
  {#if isPending(record)}<p class="pending"><Pill tone="amber">Waiting to sync</Pill></p>{/if}

  <div class="stack">
    {#if filled.length}
      <ListGroup>
        {#each filled as f (f.id)}
          {#if f.type === "long_text"}
            <div class="long">
              <div class="label">{f.name}</div>
              <p>{record.values[f.id]}</p>
            </div>
          {:else}
            <ListRow title={f.name} chevron={false}>
              {#snippet trailing()}<span class="value">{showValue(f, record.values[f.id])}</span>{/snippet}
            </ListRow>
          {/if}
        {/each}
      </ListGroup>
    {:else}
      <Card><p class="empty">Nothing filled in yet. Tap Edit to add details.</p></Card>
    {/if}

    {#each personalFields as f (f.id)}
      {@const answers = record.answers?.[f.id] ?? []}
      <ListGroup title="{f.name} · {answers.length} {answers.length === 1 ? 'answer' : 'answers'}">
        {#each answers as a (a.user_id)}
          <ListRow title={a.name} chevron={false}>
            {#snippet trailing()}<span class="value"
                >{Array.isArray(a.display) ? a.display.join(", ") : (a.display ?? "")}</span
              >{/snippet}
          </ListRow>
        {:else}
          <ListRow title="No answers yet" subtitle="Tap Edit to give yours" chevron={false} />
        {/each}
      </ListGroup>
    {/each}

    {#each linkFields as f (f.id)}
      {@const linked = record.links[f.id] ?? []}
      <ListGroup title={f.name}>
        {#each linked as l (l.id)}
          <ListRow title={l.title} href="/c/{l.collection_id}/{l.id}" chevron />
        {:else}
          <ListRow title="None yet" chevron={false} />
        {/each}
      </ListGroup>
    {/each}

    {#each collection.linked_from as lf (lf.field_id)}
      {@const target = (all.data ?? savedCollections())?.find((c) => c.id === lf.collection_id)}
      {#if target}
        <LinkedSection
          {target}
          fieldId={lf.field_id}
          title={collection.linked_from.filter((x) => x.collection_id === lf.collection_id).length > 1
            ? `${lf.collection} (${lf.field})`
            : lf.collection}
          recordId={record.id}
          onadd={() => addLinked(target, lf.field_id)}
        />
      {/if}
    {/each}
  </div>

  <div class="after">
    <Comments
      cacheKey={commentsKey(record.id)}
      load={() => commentsApi.list(record.id)}
      post={(id, body) => commentsApi.add(record.id, id, body)}
      remove={commentsApi.remove}
    />
  </div>

  <RecordSheet bind:open={editing} {collection} {record} onsaved={() => void rec.refresh()} />
  <ShareSheet bind:open={sharing} {collection} target={{ kind: "card", record }} />
  {#if addTo}
    <RecordSheet bind:open={addOpen} collection={addTo.collection} links={addTo.links} />
  {/if}
{/if}

<style>
  .stack {
    display: grid;
    gap: var(--space-6);
    max-width: var(--content-max);
  }
  .after {
    margin-top: var(--space-6);
  }
  .value {
    color: var(--text-2);
    text-align: right;
  }
  .long {
    padding: var(--space-3) var(--space-4);
  }
  .long .label {
    font-size: var(--text-sm);
    color: var(--text-2);
    font-weight: 600;
  }
  .long p {
    margin: var(--space-1) 0 0;
    white-space: pre-wrap;
  }
  .empty {
    margin: 0;
    color: var(--text-2);
  }
  .pending {
    margin: 0 0 var(--space-4);
  }
</style>
