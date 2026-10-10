<script lang="ts">
  import {
    formatINR,
    type CollectionView,
    type FieldView,
    type FindResult,
    type LiveRef,
    type OpenedView,
    type RecordView,
  } from "@assistant/shared";
  import Pin from "@lucide/svelte/icons/pin";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Maximize from "@lucide/svelte/icons/maximize-2";
  import Check from "@lucide/svelte/icons/check";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import IndianRupee from "@lucide/svelte/icons/indian-rupee";
  import Rows from "@lucide/svelte/icons/rows-3";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import { Button, Skeleton, toast } from "../ui/index.ts";
  import { createQuery, publish } from "../query.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import {
    VIEWS_KEY,
    isPending,
    listKey,
    recordKey,
    showValue,
    spacesApi,
    updateRecord,
    viewKey,
    type FindQuery,
  } from "./spaces-api.ts";
  import RecordSheet from "./RecordSheet.svelte";
  import ShareSheet from "./ShareSheet.svelte";

  // A live card in the chat (docs/design/chat-first.md step 2): a record, a list or a saved
  // view the assistant worked with, loaded fresh (and from the offline copy), so a change made
  // anywhere shows here. Tick, edit, open full screen or pin, without asking again.
  // The chat passes its collections (one request for all cards, not one each).
  let { live, collections }: { live: LiveRef; collections: CollectionView[] | undefined } = $props();
  const collectionOf = (id: string) => collections?.find((c) => c.id === id) ?? null;

  const record = createQuery<RecordView | null>(
    () => (live.kind === "record" ? recordKey(live.collection_id, live.record_id) : "live:none"),
    () => (live.kind === "record" ? spacesApi.record(live.record_id) : Promise.resolve(null)),
  );
  const listQuery = $derived<FindQuery>(live.kind === "list" ? (live.query as FindQuery) : {});
  const list = createQuery<FindResult | null>(
    () => (live.kind === "list" ? listKey(live.collection_id, listQuery) : "live:none"),
    () => (live.kind === "list" ? spacesApi.find(live.collection_id, listQuery) : Promise.resolve(null)),
  );
  const view = createQuery<OpenedView | null>(
    () => (live.kind === "view" ? viewKey(live.view_id) : "live:none"),
    () => (live.kind === "view" ? spacesApi.openView(live.view_id) : Promise.resolve(null)),
  );

  const collection = $derived(
    live.kind === "view" ? (view.data?.collection ?? null) : collectionOf(live.collection_id),
  );
  const rows = $derived<RecordView[]>(
    live.kind === "list"
      ? (list.data?.items ?? [])
      : live.kind === "view"
        ? (view.data?.result.items ?? [])
        : [],
  );
  const more = $derived(
    live.kind === "list"
      ? !!list.data?.next_cursor
      : live.kind === "view"
        ? !!view.data?.result.next_cursor
        : false,
  );
  const title = $derived(
    live.kind === "record"
      ? (record.data?.title ?? "")
      : live.kind === "list"
        ? live.title
        : (view.data?.view.name ?? "Saved view"),
  );
  const failed = $derived(
    live.kind === "record" ? !!record.error : live.kind === "list" ? !!list.error : !!view.error,
  );

  // A headline amount or total only when the collection has exactly one money field, so it can
  // never show the wrong one (e.g. Total vs Paid); with several, each shows as a labelled row.
  const moneyFields = $derived(collection?.fields.filter((f) => f.type === "money") ?? []);
  const moneyField = $derived(moneyFields.length === 1 ? moneyFields[0]! : null);
  const tickField = $derived(collection?.fields.find((f) => f.type === "boolean") ?? null);
  /** Money cards are green, lists and notes amber (design §3). */
  const kind = $derived(moneyFields.length ? "money" : "note");
  const total = $derived(
    moneyField
      ? rows.reduce(
          (sum, r) =>
            sum + (typeof r.values[moneyField.id] === "number" ? (r.values[moneyField.id] as number) : 0),
          0,
        )
      : 0,
  );
  const shown = $derived(rows.slice(0, 8));

  /** A record's filled-in fields (not the title), as "name: value". */
  function details(c: CollectionView, r: RecordView): { field: FieldView; text: string }[] {
    return c.fields
      .filter((f) => f.id !== c.title_field_id && f.type !== "boolean" && f.type !== "long_text")
      .map((f) => ({
        field: f,
        text:
          f.type === "link"
            ? (r.links[f.id] ?? []).map((l) => l.title).join(", ")
            : showValue(f, r.values[f.id]),
      }))
      .filter((d) => d.text)
      .slice(0, 5);
  }

  async function tick(r: RecordView) {
    if (!collection || !tickField || isPending(r)) return;
    try {
      await updateRecord(collection, r, {
        values: { [tickField.id]: r.values[tickField.id] !== true },
        links: {},
      });
    } catch (e) {
      toast.error(e);
    }
  }

  let editing = $state<RecordView | null>(null);
  let editOpen = $state(false);
  function edit(r: RecordView) {
    editing = r;
    editOpen = true;
  }

  // Share the card (or the saved view) with people, from the chat (step 4).
  let sharing = $state(false);

  let pinning = $state(false);
  async function pin() {
    if (live.kind !== "list" || !collection) return;
    pinning = true;
    try {
      await spacesApi.saveView({
        name: live.title.slice(0, 80),
        collection: collection.id,
        filters: (live.query.filters ?? []) as never,
        search: live.query.search ?? null,
        sort: live.query.sort ?? null,
        mode: "list",
        pinned: true,
      });
      publish(VIEWS_KEY, await spacesApi.views());
      toast.success("Pinned to the menu");
    } catch (e) {
      toast.error(e);
    } finally {
      pinning = false;
    }
  }
</script>

<article class="card {kind}">
  <header>
    <span class="kind" aria-hidden="true">
      {#if live.kind === "record"}
        {#if kind === "money"}<IndianRupee size={17} />{:else}<ListChecks size={17} />{/if}
      {:else}<Rows size={17} />{/if}
    </span>
    <span class="head">
      <b>{title || collection?.name || ""}</b>
      <span>
        {#if live.kind === "record"}{collection?.name ?? ""}{:else}{rows.length}{more ? "+" : ""}
          {rows.length === 1 ? "item" : "items"}{/if}
      </span>
    </span>
  </header>

  {#if failed}
    <p class="muted">This isn't available any more, or you're offline and it isn't saved on this device.</p>
  {:else if live.kind === "record"}
    {#if record.data && collection}
      {@const r = record.data}
      {#if moneyField && typeof r.values[moneyField.id] === "number"}
        <div class="amount">{formatINR(r.values[moneyField.id] as number)}</div>
      {/if}
      {#if tickField}
        <button
          type="button"
          class="tick"
          class:done={r.values[tickField.id] === true}
          onclick={() => tick(r)}
        >
          <span class="box"><Check size={14} /></span>
          {tickField.name}
        </button>
      {/if}
      {#each details(collection, r).filter((d) => d.field.id !== moneyField?.id) as d (d.field.id)}
        <div class="pair"><span>{d.field.name}</span><span>{d.text}</span></div>
      {/each}
      <footer>
        <Button size="sm" onclick={() => edit(r)} disabled={isPending(r)}>
          {#snippet icon()}<Pencil />{/snippet}
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onclick={() => navigate(`/c/${r.collection_id}/${r.id}`)}
          disabled={isPending(r)}
        >
          {#snippet icon()}<Maximize />{/snippet}
          Open
        </Button>
        <Button size="sm" variant="ghost" onclick={() => (sharing = true)} disabled={isPending(r)}>
          {#snippet icon()}<UserPlus />{/snippet}
          Share
        </Button>
      </footer>
    {:else}
      <Skeleton rows={2} label="Loading" />
    {/if}
  {:else if collection && (live.kind === "list" ? list.data : view.data)}
    {#if moneyField && rows.length}
      <p class="col">{moneyField.name} total</p>
      <div class="amount">
        {formatINR(total)}{#if more}<small> in the first {rows.length}</small>{/if}
      </div>
    {/if}
    {#if rows.length}
      {#if tickField}<p class="col">✓ {tickField.name}</p>{/if}
      <ul class="rows">
        {#each shown as r (r.id)}
          <li>
            {#if tickField}
              <button
                type="button"
                class="tick row-tick"
                class:done={r.values[tickField.id] === true}
                aria-label="{r.values[tickField.id] === true ? 'Untick' : 'Tick'} {r.title}"
                onclick={() => tick(r)}
              >
                <span class="box"><Check size={14} /></span>
              </button>
            {/if}
            <button
              type="button"
              class="row"
              onclick={() => !isPending(r) && navigate(`/c/${r.collection_id}/${r.id}`)}
            >
              <span class="t" class:struck={tickField && r.values[tickField.id] === true}>{r.title}</span>
              {#if moneyField && typeof r.values[moneyField.id] === "number"}
                <span class="v">{formatINR(r.values[moneyField.id] as number)}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if rows.length > shown.length || more}
        <p class="muted">And more: find them in Your lists, in the menu.</p>
      {/if}
    {:else}
      <p class="muted">Nothing matches right now.</p>
    {/if}
    {#if live.kind === "list"}
      <footer>
        <Button size="sm" onclick={pin} loading={pinning}>
          {#snippet icon()}<Pin />{/snippet}
          Pin
        </Button>
      </footer>
    {:else if view.data}
      <footer>
        <Button size="sm" variant="ghost" onclick={() => (sharing = true)}>
          {#snippet icon()}<UserPlus />{/snippet}
          Share
        </Button>
      </footer>
    {/if}
  {:else}
    <Skeleton rows={3} label="Loading" />
  {/if}
</article>

{#if collection && live.kind === "record" && record.data}
  <ShareSheet bind:open={sharing} {collection} target={{ kind: "card", record: record.data }} />
{:else if collection && live.kind === "view" && view.data}
  <ShareSheet bind:open={sharing} {collection} target={{ kind: "view", view: view.data.view }} />
{/if}
{#if editing && collection}
  {#key editing.id}
    <RecordSheet bind:open={editOpen} {collection} record={editing} />
  {/key}
{/if}

<style>
  .card {
    --k: var(--kind-note);
    --k-soft: var(--kind-note-soft);
    align-self: stretch;
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    min-width: 0;
  }
  .card.money {
    --k: var(--kind-money);
    --k-soft: var(--kind-money-soft);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .kind {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--k-soft);
    color: var(--k);
  }
  .head {
    display: grid;
    min-width: 0;
  }
  .head b {
    font-weight: 650;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .head span {
    font-size: var(--text-xs);
    color: var(--text-3);
  }
  .amount {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  .amount small {
    font-size: var(--text-sm);
    font-weight: 500;
    letter-spacing: 0;
    color: var(--text-3);
  }
  .pair {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }
  .pair span:first-child {
    color: var(--text-3);
  }
  .pair span:last-child {
    text-align: right;
    overflow-wrap: anywhere;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border-top: 1px solid var(--separator);
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color var(--dur-fast);
  }
  .t.struck {
    color: var(--text-3);
    text-decoration: line-through;
  }
  .v {
    flex: none;
    color: var(--text-2);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .tick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .row-tick {
    width: 44px;
    justify-content: flex-start;
  }
  .box {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 7px;
    border: 2px solid var(--border-strong);
    color: transparent;
    transition:
      background var(--dur-fast),
      border-color var(--dur-fast),
      transform var(--dur) var(--ease-spring);
  }
  .tick.done .box {
    background: var(--green);
    border-color: var(--green);
    color: #fff;
    transform: scale(1.08);
  }
  .col {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .muted {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-3);
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-top: var(--space-1);
  }
</style>
