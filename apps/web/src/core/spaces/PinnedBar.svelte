<script lang="ts">
  import type { SavedView } from "@assistant/shared";
  import Pin from "@lucide/svelte/icons/pin";
  import { createQuery } from "../query.svelte.ts";
  import { spacesApi, VIEWS_KEY } from "./spaces-api.ts";
  import ViewPanel from "./ViewPanel.svelte";

  // The shortcuts bar: pinned views as chips; a tap opens the view as a pop-up.
  let { all = false }: { /** Every saved view, not just pinned ones. */ all?: boolean } = $props();

  const views = createQuery<SavedView[]>(() => VIEWS_KEY, spacesApi.views);
  const shown = $derived((views.data ?? []).filter((v) => all || v.pinned));
  let selectedId = $state<string | null>(null);
  const selected = $derived((views.data ?? []).find((v) => v.id === selectedId) ?? null);
  let open = $state(false);
</script>

{#if shown.length}
  <nav class="bar" aria-label={all ? "Saved views" : "Pinned views"}>
    {#each shown as v (v.id)}
      <button
        type="button"
        class="chip"
        onclick={() => {
          selectedId = v.id;
          open = true;
        }}
      >
        {#if v.pinned}<Pin size={14} />{/if}
        {v.name}
      </button>
    {/each}
  </nav>
{/if}

{#if selected}
  <ViewPanel bind:open view={selected} onchanged={() => void views.refresh()} />
{/if}

<style>
  .bar {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding-bottom: var(--space-1);
    margin-bottom: var(--space-4);
    scrollbar-width: none;
  }
  .bar::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 44px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--text-base);
    font-weight: 600;
    cursor: pointer;
  }
  .chip :global(svg) {
    color: var(--accent-text);
  }
  .chip:hover {
    background: var(--surface-hover);
  }
</style>
