<script lang="ts">
  import type { SongSummary } from "@assistant/shared";
  import Search from "@lucide/svelte/icons/search";
  import Check from "@lucide/svelte/icons/check";
  import { Button, EmptyState, Sheet, Skeleton } from "../../core/ui/index.ts";
  import { createQuery, readCache } from "../../core/query.svelte.ts";
  import { songFacts, musicApi } from "./music-api.ts";

  // Picks songs from my library, in the order tapped (e.g. to build a setlist).
  let {
    open = $bindable(false),
    title = "Add songs",
    onpick,
  }: { open?: boolean; title?: string; onpick: (songs: SongSummary[]) => void } = $props();

  let query = $state("");
  let picked = $state<SongSummary[]>([]);
  $effect(() => {
    if (open) {
      picked = [];
      query = "";
    }
  });

  const list = createQuery<SongSummary[]>(
    () => "songs:list:",
    () => musicApi.songs(),
  );
  const all = $derived(list.data ?? readCache<SongSummary[]>("songs:list:") ?? null);
  const shown = $derived.by(() => {
    if (!all) return null;
    const q = query.trim().toLowerCase();
    return q
      ? all.filter((s) => s.title.toLowerCase().includes(q) || (s.artist ?? "").toLowerCase().includes(q))
      : all;
  });
  const order = (s: SongSummary) => picked.findIndex((p) => p.id === s.id);

  function tap(s: SongSummary) {
    const i = order(s);
    picked = i >= 0 ? picked.filter((p) => p.id !== s.id) : [...picked, s];
  }
</script>

<Sheet bind:open {title}>
  <label class="search">
    <Search size={18} />
    <input type="search" placeholder="Search your songs" bind:value={query} aria-label="Search your songs" />
  </label>
  {#if shown === null}
    <Skeleton rows={5} label="Loading your songs" />
  {:else if shown.length === 0}
    <EmptyState
      title={query ? "No matches" : "No songs yet"}
      text={query ? "Try part of the title or artist." : "Add songs in the Songs tab, then pick them here."}
    />
  {:else}
    <ul class="songs">
      {#each shown as s (s.id)}
        {@const n = order(s)}
        <li>
          <button type="button" class="song" class:on={n >= 0} onclick={() => tap(s)} aria-pressed={n >= 0}>
            <span class="mark"
              >{#if n >= 0}{n + 1}{:else}<Check size={16} />{/if}</span
            >
            <span class="text">
              <span class="t">{s.title}</span>
              {#if s.artist || songFacts(s)}<span class="d"
                  >{[s.artist, songFacts(s)].filter(Boolean).join(" · ")}</span
                >{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button
      variant="primary"
      disabled={!picked.length}
      onclick={() => {
        onpick(picked);
        open = false;
      }}>{picked.length ? `Add ${picked.length} ${picked.length === 1 ? "song" : "songs"}` : "Add"}</Button
    >
  {/snippet}
</Sheet>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-3);
    margin-bottom: var(--space-3);
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-3);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    outline: none;
    font-size: 16px;
  }
  .songs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .song {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 52px;
    padding: var(--space-2) var(--space-2);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    text-align: left;
    font: inherit;
  }
  .song.on {
    background: var(--accent-soft);
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1.5px solid var(--border-strong);
    color: transparent;
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .on .mark {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-on-accent);
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .t {
    font-weight: 600;
  }
  .d {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
</style>
