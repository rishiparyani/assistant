<script lang="ts">
  import { transposeKey, type SongView } from "@assistant/shared";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Maximize from "@lucide/svelte/icons/maximize";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import { Button, EmptyState, NotSaved, PageHeader, Pill, Skeleton, toast } from "../../core/ui/index.ts";
  import { isOfflineError } from "../../core/offline.svelte.ts";
  import { createQuery, dropCache } from "../../core/query.svelte.ts";
  import { navigate } from "../../core/router.svelte.ts";
  import { musicApi, savedSong, saveSongsAhead } from "./music-api.ts";
  import ChordChart from "./ChordChart.svelte";
  import SongSheet from "./SongSheet.svelte";
  import StageView from "./StageView.svelte";

  // One song: details, notes and the chart, transposable; stage mode full screen.
  let { songId }: { songId: string } = $props();

  const q = createQuery<SongView>(
    () => `song:${songId}`,
    () => musicApi.song(songId),
  );
  const song = $derived(q.data ?? savedSong(songId));
  $effect(() => {
    if (q.error && !song) toast.error(q.error);
  });

  // Transpose, remembered per song on this device.
  const store = $derived(`transpose:${songId}`);
  let steps = $state(0);
  $effect(() => {
    try {
      steps = Number(localStorage.getItem(store)) || 0;
    } catch {
      steps = 0;
    }
  });
  function transpose(by: number) {
    // Keep it within half an octave either way (+7 is the same key as -5).
    let next = steps + by;
    if (next > 6) next -= 12;
    if (next < -6) next += 12;
    steps = next;
    try {
      if (steps) localStorage.setItem(store, String(steps));
      else localStorage.removeItem(store);
    } catch {
      // Private mode: kept for this visit only.
    }
  }
  const shownKey = $derived(song?.key ? transposeKey(song.key, steps) : null);

  let editing = $state(false);
  let stage = $state(false);

  function saved(s: SongView) {
    q.set(s);
    dropCache("songs:list:");
    void saveSongsAhead().catch(() => {});
  }
</script>

{#if !song}
  {#if q.error && isOfflineError(q.error)}
    <NotSaved />
  {:else if q.error}
    <EmptyState title="Song not found" text="It may have been removed from your library.">
      {#snippet action()}<Button href="/songs">Your songs</Button>{/snippet}
    </EmptyState>
  {:else}
    <Skeleton rows={8} label="Loading the song" />
  {/if}
{:else}
  <PageHeader title={song.title} subtitle={song.artist ?? undefined} back="/songs" backLabel="Songs">
    {#snippet actions()}
      <Button onclick={() => (editing = true)}>
        {#snippet icon()}<Pencil />{/snippet}
        Edit
      </Button>
    {/snippet}
  </PageHeader>

  <div class="facts">
    {#if song.key}
      <div class="transpose" role="group" aria-label="Key">
        <button onclick={() => transpose(-1)} aria-label="Down a semitone"><Minus size={18} /></button>
        <span class="key"
          >{shownKey}{#if steps}<small>{steps > 0 ? `+${steps}` : steps}</small>{/if}</span
        >
        <button onclick={() => transpose(1)} aria-label="Up a semitone"><Plus size={18} /></button>
      </div>
      {#if steps}<button class="reset" onclick={() => transpose(-steps)}>Back to {song.key}</button>{/if}
    {/if}
    {#if song.tempo_bpm}<Pill>{song.tempo_bpm} bpm</Pill>{/if}
    {#if song.capo}<Pill>Capo {song.capo}</Pill>{/if}
    <span class="grow"></span>
    <Button variant="primary" onclick={() => (stage = true)} disabled={!song.chart}>
      {#snippet icon()}<Maximize />{/snippet}
      Stage mode
    </Button>
  </div>

  {#if song.notes}<p class="notes">{song.notes}</p>{/if}

  <div class="chart-card">
    {#if song.chart}
      <ChordChart chart={song.chart} {steps} toKey={shownKey} />
    {:else}
      <p class="empty">
        No chords yet. <button class="link" onclick={() => (editing = true)}>Add them</button>
      </p>
    {/if}
  </div>

  <SongSheet
    bind:open={editing}
    {song}
    onsaved={saved}
    onremoved={() => navigate("/songs", { replace: true })}
  />

  {#if stage}
    <StageView songs={[{ ...song, steps }]} onclose={() => (stage = false)} />
  {/if}
{/if}

<style>
  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .grow {
    flex: 1;
  }
  .transpose {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .transpose button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--text);
  }
  .key {
    min-width: 3.2em;
    text-align: center;
    font-weight: 750;
    font-size: var(--text-md);
    color: var(--accent-text);
  }
  .key small {
    margin-left: 2px;
    font-size: var(--text-xs);
    color: var(--text-3);
  }
  .reset,
  .link {
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-2);
    min-height: 44px;
  }
  .notes {
    white-space: pre-wrap;
    color: var(--text-2);
    margin-bottom: var(--space-4);
  }
  .chart-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    overflow-x: auto;
  }
  .empty {
    color: var(--text-3);
  }
</style>
