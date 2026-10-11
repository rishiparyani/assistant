<script lang="ts">
  import { chordsOverLyricsToChordPro, looksLikeChordsOverLyrics, type SongView } from "@assistant/shared";
  import { untrack } from "svelte";
  import { Button, Sheet, TextArea, TextField, confirm, toast } from "../../core/ui/index.ts";
  import { musicApi } from "./music-api.ts";

  // Add a song, or edit / remove one. Charts pasted from chord websites (chords above the
  // lyrics) are turned into ChordPro so they transpose.
  let {
    open = $bindable(false),
    song = null,
    onsaved,
    onremoved,
  }: {
    open?: boolean;
    song?: SongView | null;
    onsaved: (s: SongView) => void;
    onremoved?: () => void;
  } = $props();

  const uid = $props.id();
  let title = $state("");
  let artist = $state("");
  let key = $state("");
  let tempo = $state("");
  let capo = $state("");
  let notes = $state("");
  let chart = $state("");
  let busy = $state(false);
  let errors = $state<Record<string, string>>({});

  $effect(() => {
    if (!open) return;
    untrack(() => {
      title = song?.title ?? "";
      artist = song?.artist ?? "";
      key = song?.key ?? "";
      tempo = song?.tempo_bpm ? String(song.tempo_bpm) : "";
      capo = song?.capo ? String(song.capo) : "";
      notes = song?.notes ?? "";
      chart = song?.chart ?? "";
      errors = {};
    });
  });

  const convertible = $derived(looksLikeChordsOverLyrics(chart));

  /** "f#m" → "F#m", "bb" → "Bb"; empty stays empty. */
  const normaliseKey = (k: string) => {
    const t = k.trim();
    return t ? t[0]!.toUpperCase() + t.slice(1).replace(/^B/, "b").replace(/M$/, "m") : "";
  };

  function check() {
    const e: Record<string, string> = {};
    const k = normaliseKey(key);
    if (k && !/^[A-G][#b]?m?$/.test(k)) e.key = "A key like C, F#, Bb or Am";
    const t = tempo.trim() ? Number(tempo) : null;
    if (t !== null && (!Number.isInteger(t) || t < 20 || t > 400)) e.tempo = "20 to 400";
    const c = capo.trim() ? Number(capo) : null;
    if (c !== null && (!Number.isInteger(c) || c < 0 || c > 11)) e.capo = "0 to 11";
    errors = e;
    return { ok: !Object.keys(e).length, k, t, c };
  }

  async function save(ev: SubmitEvent) {
    ev.preventDefault();
    const { ok, k, t, c } = check();
    if (!ok) return;
    busy = true;
    const fields = {
      title: title.trim(),
      artist: artist.trim() || null,
      key: k || null,
      tempo_bpm: t,
      capo: c || null,
      notes: notes.trim() || null,
      chart: chart.trim() ? chart.replace(/\s+$/, "") : null,
    };
    try {
      const saved = song ? await musicApi.update(song.id, fields) : await musicApi.create(fields);
      toast.success(song ? "Saved" : "Added to your songs");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!song) return;
    const ok = await confirm({
      title: `Remove “${song.title}”?`,
      message: "Setlists that have it keep the title.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    busy = true;
    try {
      await musicApi.remove(song.id);
      toast.success("Removed");
      open = false;
      onremoved?.();
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={song ? "Edit song" : "New song"}>
  <form id="song-form-{uid}" class="form" onsubmit={save}>
    <TextField label="Title" id="{uid}-title" bind:value={title} required maxlength={160} />
    <TextField label="Artist" id="{uid}-artist" bind:value={artist} maxlength={120} />
    <div class="three">
      <TextField
        label="Key"
        id="{uid}-key"
        bind:value={key}
        maxlength={4}
        placeholder="G"
        autocapitalize="characters"
        error={errors.key}
      />
      <TextField
        label="Tempo"
        id="{uid}-tempo"
        bind:value={tempo}
        inputmode="numeric"
        placeholder="bpm"
        error={errors.tempo}
      />
      <TextField label="Capo" id="{uid}-capo" bind:value={capo} inputmode="numeric" error={errors.capo} />
    </div>
    <div class="mono">
      <TextArea
        label="Chords and lyrics"
        id="{uid}-chart"
        bind:value={chart}
        rows={10}
        maxlength={40000}
        spellcheck="false"
        autocapitalize="off"
        hint="Put chords in brackets before the word: [G]Hello [C]world. Section names on their own line (Chorus:). Or paste chords above the lyrics from any site."
      />
    </div>
    {#if convertible}
      <div class="convert">
        <span>These chords are above the lyrics.</span>
        <Button size="sm" variant="tinted" onclick={() => (chart = chordsOverLyricsToChordPro(chart))}
          >Put them in the lyrics</Button
        >
      </div>
    {/if}
    <TextArea label="Notes" id="{uid}-notes" bind:value={notes} rows={3} maxlength={4000} />
  </form>
  {#snippet footer()}
    {#if song}
      <Button variant="danger" onclick={remove} disabled={busy}>Remove</Button>
    {:else}
      <Button onclick={() => (open = false)}>Cancel</Button>
    {/if}
    <Button variant="primary" type="submit" form="song-form-{uid}" loading={busy}
      >{song ? "Save" : "Add"}</Button
    >
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
  }
  .three {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-3);
  }
  .mono :global(textarea) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 15px;
  }
  .convert {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--text-sm);
  }
</style>
