<script lang="ts">
  import type { SavedView } from "@assistant/shared";
  import Pin from "@lucide/svelte/icons/pin";
  import { createQuery } from "../query.svelte.ts";
  import { router } from "../router.svelte.ts";
  import { spacesApi, VIEWS_KEY } from "./spaces-api.ts";
  import ViewPanel from "./ViewPanel.svelte";

  // Pinned views in the side menu; a tap opens one as a pop-up. "/?view=<id>" opens one too
  // (Siri's "Show a Gigspree view" lands there).
  let { onopen }: { /** Called when a view opens (the phone's menu closes). */ onopen?: () => void } =
    $props();

  const views = createQuery<SavedView[]>(() => VIEWS_KEY, spacesApi.views);
  const pinned = $derived((views.data ?? []).filter((v) => v.pinned));
  let selectedId = $state<string | null>(null);
  const selected = $derived((views.data ?? []).find((v) => v.id === selectedId) ?? null);
  let open = $state(false);

  $effect(() => {
    const id = router.route.query.get("view");
    if (!id) return;
    selectedId = id;
    open = true;
    history.replaceState(null, "", window.location.pathname);
  });

  function show(v: SavedView) {
    selectedId = v.id;
    open = true;
    onopen?.();
  }
</script>

{#if pinned.length}
  <ul class="list">
    {#each pinned as v (v.id)}
      <li>
        <button type="button" class="item" onclick={() => show(v)}>
          <span class="ic"><Pin size={16} /></span>
          <span class="t">{v.name}</span>
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <p class="none">Ask the assistant to pin a view, like “pin my expenses this month”.</p>
{/if}

{#if selected}
  <ViewPanel bind:open view={selected} onchanged={() => void views.refresh()} />
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
    background: var(--kind-note-soft);
    color: var(--kind-note);
  }
  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    margin: 0;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-3);
  }
</style>
