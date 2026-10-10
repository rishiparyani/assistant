<script lang="ts">
  import type { CollectionView } from "@assistant/shared";
  import List from "@lucide/svelte/icons/list";
  import type { StarterKind } from "@assistant/shared";
  import { ActionSheet, toast } from "../ui/index.ts";
  import { createQuery, refreshAll } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import { COLLECTIONS_KEY, spacesApi } from "./spaces-api.ts";
  import CollectionPanel from "./CollectionPanel.svelte";

  // "Your lists" in the side menu: every collection, one tap from its records. The way in
  // that never needs the assistant (screens work without AI).
  let { onopen }: { onopen?: () => void } = $props();

  const collections = createQuery<CollectionView[]>(() => COLLECTIONS_KEY, spacesApi.collections);
  let selected = $state<CollectionView | null>(null);
  let open = $state(false);

  // Nobody starts with lists (decision "Assistant first"): the assistant starts them as
  // they're needed; by hand is the fallback.
  let starting = $state(false);
  const KINDS: { kind: StarterKind; label: string }[] = [
    { kind: "notes", label: "Notes" },
    { kind: "reminders", label: "Reminders" },
    { kind: "events", label: "Events" },
    { kind: "expenses", label: "Expenses" },
  ];
  // The everyday lists not started yet (by name, as the server matches them).
  const missing = $derived(
    KINDS.filter(
      (k) => !(collections.data ?? []).some((c) => c.name.toLowerCase() === k.label.toLowerCase()),
    ),
  );
  // online-only: a new list is made on the server.
  async function start(kind: StarterKind) {
    if (!connection.online) {
      toast.error("Starting a list needs a connection.");
      return;
    }
    try {
      await spacesApi.startList(kind);
      refreshAll();
    } catch (e) {
      toast.error(e);
    }
  }
</script>

{#if collections.data?.length}
  <ul class="list">
    {#each collections.data as c (c.id)}
      <li>
        <button
          type="button"
          class="item"
          onclick={() => {
            selected = c;
            open = true;
            onopen?.();
          }}
        >
          <span class="ic"><List size={16} /></span>
          <span class="t">{c.name}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

{#if collections.data}
  <!-- By hand stays reachable for the lists not started yet (offline, or no AI budget). -->
  {#if !collections.data.length || missing.length}
    <div class="empty">
      {#if !collections.data.length}
        <p>No lists yet. Just ask: “remind me to call Rahul at 6”, “spent ₹450 on groceries”.</p>
      {/if}
      {#if missing.length}
        <button type="button" class="by-hand" onclick={() => (starting = true)}>
          {collections.data.length ? "Start another by hand" : "Start one by hand"}
        </button>
      {/if}
    </div>
  {/if}
  <ActionSheet
    bind:open={starting}
    title="Start a list"
    actions={missing.map((k) => ({ label: k.label, onclick: () => void start(k.kind) }))}
  />
{/if}

{#if selected}
  {#key selected.id}
    <CollectionPanel bind:open collection={selected} />
  {/key}
{/if}

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .empty {
    display: grid;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .empty p {
    margin: 0;
  }
  .by-hand {
    justify-self: start;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .item:hover {
    background: var(--surface-hover);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 9px;
    background: var(--kind-people-soft);
    color: var(--kind-people);
  }
  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
