<script lang="ts">
  import {
    ulid,
    type SharedCardView,
    type SharedFieldInfo,
    type SharedFormView,
    type SharedOpened,
    type SharedRecord,
  } from "@assistant/shared";
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
  import SharedForm from "./SharedForm.svelte";
  import Comments from "./Comments.svelte";

  // Something shared with me: a card (its fields and the linked parts included), a view (its
  // records, live) or a form (fill it in; what I sent shows below). With edit access I can
  // change the fields shown and add records (a guest, a song).
  let { shareId }: { shareId: string } = $props();

  const q = createQuery<SharedOpened>(
    () => sharedCardKey(shareId),
    () => sharesApi.open(shareId),
  );
  // Turned off or I was removed: forget the saved copy and show nothing of it.
  const revoked = $derived(noLongerShared(q.error));
  $effect(() => {
    if (revoked) dropCache(sharedCardKey(shareId));
  });
  const opened = $derived(revoked ? undefined : q.data);
  const card = $derived(opened?.share.kind === "card" ? (opened as SharedCardView) : undefined);
  const form = $derived(opened?.share.kind === "form" ? (opened as SharedFormView) : undefined);
  const canEdit = $derived(opened?.share.access === "edit");
  // The title is the page's title; the rest shows when filled in.
  const filled = $derived(card?.record.fields.filter((f) => !f.title && showValue(f, f.value)) ?? []);
  // Sections to list: a card's linked parts, or a view's records as one section.
  type Section = SharedCardView["sections"][number];
  // A view's later pages, added below the first.
  let extra = $state<SharedRecord[]>([]);
  let cursor = $state<string | null>(null);
  let loadingMore = $state(false);
  $effect(() => {
    cursor =
      opened?.share.kind === "view"
        ? (opened as Extract<SharedOpened, { next_cursor: string | null }>).next_cursor
        : null;
    extra = [];
  });
  async function more() {
    if (!cursor) return;
    loadingMore = true;
    try {
      const next = (await sharesApi.open(shareId, cursor)) as Extract<
        SharedOpened,
        { next_cursor: string | null }
      >;
      extra = [...extra, ...next.records];
      cursor = next.next_cursor;
    } catch (e) {
      toast.error(e);
    } finally {
      loadingMore = false;
    }
  }
  const sections = $derived.by<Section[]>(() => {
    if (!opened) return [];
    if (opened.share.kind === "card") return (opened as SharedCardView).sections;
    if (opened.share.kind === "view") {
      const v = opened as Extract<SharedOpened, { collection: string; records: SharedRecord[] }>;
      return [
        {
          key: "view",
          title: v.collection,
          collection_id: "",
          can_add: v.can_add,
          fields: v.fields,
          records: [...v.records, ...extra.filter((r) => !v.records.some((x) => x.id === r.id))],
        },
      ];
    }
    return [];
  });
  const infoOf = (r: SharedRecord): SharedFieldInfo[] => r.fields.map((f) => ({ ...f, required: false }));

  let sheet = $state<{
    title: string;
    fields: SharedFieldInfo[];
    record: SharedRecord | null;
    section: string | null;
  } | null>(null);
  let sheetOpen = $state(false);

  function edit(fields: SharedFieldInfo[], record: SharedRecord) {
    sheet = { title: `Edit ${record.title}`, fields, record, section: null };
    sheetOpen = true;
  }
  function add(s: Section) {
    sheet = { title: `Add to ${s.title}`, fields: s.fields, record: null, section: s.key };
    sheetOpen = true;
  }
  const saved = (c: SharedOpened) => publish(sharedCardKey(shareId), c);
  async function sendForm(values: Record<string, unknown>) {
    saved(await sharesApi.add(shareId, "form", ulid(), values));
  }

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
      title: "Leave this?",
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

{#if !opened}
  <PageHeader title="Shared with me" back="/shared" backLabel="Shared" />
  {#if q.error}
    <EmptyState title="Can't open this" text="The owner may have stopped sharing it, or you're offline." />
  {:else}
    <Skeleton rows={5} label="Loading" />
  {/if}
{:else}
  <PageHeader
    title={opened.share.title}
    subtitle="Shared by {opened.share.owner}"
    back="/shared"
    backLabel="Shared"
  >
    {#snippet actions()}
      <Button variant="ghost" onclick={leave} aria-label="Leave">
        {#snippet icon()}<LogOut />{/snippet}
      </Button>
      {#if canEdit && card}
        <Button variant="primary" onclick={() => edit(infoOf(card.record), card.record)}>
          {#snippet icon()}<Pencil />{/snippet}
          Edit
        </Button>
      {/if}
    {/snippet}
  </PageHeader>
  <p class="access">
    {#if form}
      <Pill tone="blue">Form</Pill>
    {:else}
      <Pill tone={canEdit ? "green" : "grey"}>{canEdit ? "You can edit" : "View only"}</Pill>
    {/if}
  </p>

  <div class="stack">
    {#if form}
      {#if form.description}<p class="empty">{form.description}</p>{/if}
      <SharedForm fields={form.fields} send={sendForm} />
      {#if form.mine.length}
        <section class="section">
          <h2>What you sent</h2>
          <ListGroup>
            {#each form.mine as r (r.id)}
              {#if canEdit}
                <ListRow
                  title={r.title}
                  subtitle={summary(r) || undefined}
                  onclick={() => edit(form.fields, r)}
                />
              {:else}
                <ListRow title={r.title} subtitle={summary(r) || undefined} chevron={false} />
              {/if}
            {/each}
          </ListGroup>
        </section>
      {/if}
    {:else if !card}
      <!-- A view: its records below. -->
    {:else if filled.length}
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

    {#each sections as s (s.key)}
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
    {#if card}
      <Comments
        cacheKey={`${sharedCardKey(shareId)}:comments`}
        load={() => sharesApi.comments(shareId, card.record.id)}
        post={(id, body) => sharesApi.comment(shareId, card.record.id, id, body)}
      />
    {/if}
    {#if cursor}
      <div><Button onclick={more} loading={loadingMore}>Show more</Button></div>
    {/if}
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
