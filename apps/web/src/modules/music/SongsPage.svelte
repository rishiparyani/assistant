<script lang="ts">
  import { matchesSongSearch, type SongSummary } from "@assistant/shared";
  import Search from "@lucide/svelte/icons/search";
  import Music from "@lucide/svelte/icons/music";
  import { EmptyState, ListGroup, ListRow, PageHeader, Skeleton, toast } from "../../core/ui/index.ts";
  import { createQuery, readCache } from "../../core/query.svelte.ts";
  import { musicApi, songFacts } from "./music-api.ts";

  // My song library: search, open a song, add one.
  let query = $state("");
  let search = $state("");

  $effect(() => {
    const q = query.trim();
    const t = setTimeout(() => (search = q), 200);
    return () => clearTimeout(t);
  });

  const list = createQuery<SongSummary[]>(
    () => `songs:list:${search}`,
    () => musicApi.songs(search || undefined),
  );
  $effect(() => {
    if (list.error) toast.error(list.error);
  });

  // Offline, a search finds songs in the saved library.
  const songs = $derived.by(() => {
    if (list.data) return list.data;
    const all = readCache<SongSummary[]>("songs:list:");
    if (!all || !search) return all ?? null;
    return all.filter((s) => matchesSongSearch(s, search));
  });

  /** Songs grouped by first letter (ignoring "The"/"A"). */
  const groups = $derived.by(() => {
    if (!songs) return null;
    const out: { letter: string; items: SongSummary[] }[] = [];
    for (const s of songs) {
      const first = s.title
        .replace(/^(the|a|an)\s+/i, "")
        .charAt(0)
        .toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : "#";
      const g = out.at(-1);
      if (g?.letter === letter) g.items.push(s);
      else out.push({ letter, items: [s] });
    }
    return out;
  });
</script>

<PageHeader
  title="Songbook"
  subtitle="Your songs with keys, tempos and chord charts. Ask the assistant to add or change one; open one for its chart and stage mode."
/>

<label class="search">
  <Search size={18} />
  <input
    type="search"
    placeholder="Search title or artist"
    bind:value={query}
    aria-label="Search your songs"
  />
</label>

{#if groups === null}
  <Skeleton rows={6} label="Loading your songs" />
{:else if groups.length === 0}
  <EmptyState
    title={query ? "No matches" : "No songs yet"}
    text={query
      ? "Try part of the title or the artist."
      : "Tell the assistant a song you play, with its key, tempo and chords (paste a chart from any chord site), and it's added here."}
  >
    {#snippet icon()}<Music size={26} />{/snippet}
  </EmptyState>
{:else}
  <div class="groups">
    {#each groups as g (g.letter)}
      <ListGroup title={g.letter}>
        {#each g.items as s (s.id)}
          <ListRow
            title={s.title}
            subtitle={[s.artist, songFacts(s)].filter(Boolean).join(" · ") || undefined}
            href="/songs/{s.id}"
            chevron
          >
            {#snippet trailing()}{#if s.key}<span class="key">{s.key}</span>{/if}{/snippet}
          </ListRow>
        {/each}
      </ListGroup>
    {/each}
  </div>
{/if}

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-3);
    margin-bottom: var(--space-5);
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-3);
    max-width: 520px;
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
  .groups {
    display: grid;
    gap: var(--space-5);
  }
  .key {
    font-weight: 700;
    color: var(--accent-text);
    min-width: 2.2em;
    text-align: right;
  }
</style>
