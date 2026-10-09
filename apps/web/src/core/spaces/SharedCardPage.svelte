<script lang="ts">
  import type { SharedCardView, SharedRecord } from "@assistant/shared";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import LogOut from "@lucide/svelte/icons/log-out";
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
  import { createQuery, dropCache, publish } from "../query.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import { SHARED_KEY, noLongerShared, sharedCardKey, sharesApi } from "./shares-api.ts";
  import { showValue } from "./spaces-api.ts";
  import SharedRecordSheet from "./SharedRecordSheet.svelte";

  // A card someone shared with me: its fields and the linked parts they included. With edit
  // access I can change the fields shown and add to sections (a guest, a song).
  let { shareId }: { shareId: string } = $props();

  const q = createQuery<SharedCardView>(
    () => sharedCardKey(shareId),
    () => sharesApi.open(shareId),
  );
  // Turned off or I was removed: forget the saved copy and show nothing of it.
  const revoked = $derived(noLongerShared(q.error));
  $effect(() => {
    if (revoked) dropCache(sharedCardKey(shareId));
  });
  const card = $derived(revoked ? undefined : q.data);
  const canEdit = $derived(card?.share.access === "edit");
  // The title is the page's title; the rest shows when filled in.
  const filled = $derived(card?.record.fields.filter((f) => !f.title && showValue(f, f.value)) ?? []);

  let sheet = $state<{
    title: string;
    fields: SharedCardView["sections"][number]["fields"];
    record: SharedRecord | null;
    section: string | null;
  } | null>(null);
  let sheetOpen = $state(false);

  function edit(fields: SharedCardView["sections"][number]["fields"], record: SharedRecord) {
    sheet = { title: `Edit ${record.title}`, fields, record, section: null };
    sheetOpen = true;
  }
  function add(s: SharedCardView["sections"][number]) {
    sheet = { title: `Add to ${s.title}`, fields: s.fields, record: null, section: s.key };
    sheetOpen = true;
  }
  const saved = (c: SharedCardView) => publish(sharedCardKey(shareId), c);

  /** A short line under each record: its first few filled values. */
  const summary = (r: SharedRecord) =>
    r.fields
      .filter((f) => !f.title)
      .map((f) => {
        const v = showValue(f, f.value);
        // Bare numbers and yes/no read better with their name ("Count: 2").
        return v && (f.type === "number" || f.type === "boolean") ? `${f.name}: ${v}` : v;
      })
      .filter(Boolean)
      .slice(0, 3)
      .join(" · ");

  async function leave() {
    const ok = await confirm({
      title: "Leave this card?",
      message: "It goes from your Shared with me list. You'd need the link again to come back.",
      confirmLabel: "Leave",
      destructive: true,
    });
    if (!ok) return;
    try {
      await sharesApi.leave(shareId);
      dropCache(sharedCardKey(shareId));
      dropCache(SHARED_KEY);
      toast.success("Left");
      navigate("/shared", { replace: true });
    } catch (e) {
      toast.error(e);
    }
  }
</script>

{#if !card}
  <PageHeader title="Shared card" back="/shared" backLabel="Shared" />
  {#if q.error}
    <EmptyState title="Can't open this" text="The owner may have stopped sharing it, or you're offline." />
  {:else}
    <Skeleton rows={5} label="Loading" />
  {/if}
{:else}
  <PageHeader
    title={card.record.title}
    subtitle="Shared by {card.share.owner}"
    back="/shared"
    backLabel="Shared"
  >
    {#snippet actions()}
      <Button variant="ghost" onclick={leave} aria-label="Leave">
        {#snippet icon()}<LogOut />{/snippet}
      </Button>
      {#if canEdit}
        <Button variant="primary" onclick={() => edit(card.record.fields, card.record)}>
          {#snippet icon()}<Pencil />{/snippet}
          Edit
        </Button>
      {/if}
    {/snippet}
  </PageHeader>
  <p class="access">
    <Pill tone={canEdit ? "green" : "grey"}>{canEdit ? "You can edit" : "View only"}</Pill>
  </p>

  <div class="stack">
    {#if filled.length}
      <ListGroup>
        {#each filled as f (f.id)}
          {#if f.type === "long_text"}
            <div class="long">
              <div class="label">{f.name}</div>
              <p>{f.value}</p>
            </div>
          {:else}
            <ListRow title={f.name} chevron={false}>
              {#snippet trailing()}<span class="value">{showValue(f, f.value)}</span>{/snippet}
            </ListRow>
          {/if}
        {/each}
      </ListGroup>
    {:else}
      <Card><p class="empty">Nothing else filled in.</p></Card>
    {/if}

    {#each card.sections as s (s.key)}
      <section class="section">
        <div class="head">
          <h2>{s.title}</h2>
          {#if s.can_add}
            <Button size="sm" onclick={() => add(s)}>
              {#snippet icon()}<Plus />{/snippet}
              Add
            </Button>
          {/if}
        </div>
        <ListGroup>
          {#each s.records as r (r.id)}
            {#if canEdit && s.fields.length}
              <ListRow title={r.title} subtitle={summary(r) || undefined} onclick={() => edit(s.fields, r)} />
            {:else}
              <ListRow title={r.title} subtitle={summary(r) || undefined} chevron={false} />
            {/if}
          {:else}
            <ListRow title="None yet" chevron={false} />
          {/each}
        </ListGroup>
      </section>
    {/each}
  </div>

  {#if sheet}
    <SharedRecordSheet
      bind:open={sheetOpen}
      {shareId}
      fields={sheet.fields}
      record={sheet.record}
      section={sheet.section}
      title={sheet.title}
      onsaved={saved}
    />
  {/if}
{/if}

<style>
  .stack {
    display: grid;
    gap: var(--space-6);
    max-width: var(--content-max);
  }
  .access {
    margin: 0 0 var(--space-4);
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
  .section {
    display: grid;
    gap: var(--space-2);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
</style>
