<script lang="ts">
  import { matchesSongSearch, type SongSummary } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Music from "@lucide/svelte/icons/music";
  import {
    Button,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Skeleton,
    toast,
  } from "../../core/ui/index.ts";
  import { createQuery, readCache } from "../../core/query.svelte.ts";
  import { navigate } from "../../core/router.svelte.ts";
  import { musicApi, songFacts } from "./music-api.ts";
  import SongSheet from "./SongSheet.svelte";

  // My song library: search, open a song, add one.
  let query = $state("");
  let search = $state("");
  let adding = $state(false);

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
  title="Songs"
  subtitle="Your songs with keys, tempos and chord charts. Add them to a gig's setlist."
>
  {#snippet actions()}
    <Button variant="primary" onclick={() => (adding = true)}>
      {#snippet icon()}<Plus />{/snippet}
      Add
    </Button>
  {/snippet}
</PageHeader>

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
      : "Add the songs you play: key, tempo and the chords. Paste a chart from any chord site and it's tidied up."}
  >
    {#snippet icon()}<Music size={26} />{/snippet}
    {#snippet action()}
      {#if !query}<Button variant="primary" onclick={() => (adding = true)}>Add a song</Button>{/if}
    {/snippet}
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

<SongSheet
  bind:open={adding}
  onsaved={(s) => {
    list.refresh();
    navigate(`/songs/${s.id}`);
  }}
/>

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
