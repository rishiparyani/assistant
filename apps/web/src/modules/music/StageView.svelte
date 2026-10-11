<script lang="ts">
  import { transposeKey } from "@assistant/shared";
  import X from "@lucide/svelte/icons/x";
  import Play from "@lucide/svelte/icons/play";
  import Pause from "@lucide/svelte/icons/pause";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import AArrowUp from "@lucide/svelte/icons/a-arrow-up";
  import AArrowDown from "@lucide/svelte/icons/a-arrow-down";
  import ChordChart from "./ChordChart.svelte";
  import type { StageSong } from "./music-api.ts";

  // Stage mode: one song (or a setlist, song by song) full screen, big and dark, the screen
  // kept awake. Scrolls by itself if wanted; a Bluetooth page turner (it sends arrow or
  // page keys) turns pages, and the next song comes at the end.
  let { songs, start = 0, onclose }: { songs: StageSong[]; start?: number; onclose: () => void } = $props();

  let index = $derived(Math.min(Math.max(start, 0), songs.length - 1));
  let scale = $state(1);
  let playing = $state(false);
  let speed = $state(3); // 1..6
  let scroller: HTMLDivElement | undefined = $state();

  const song = $derived(songs[index]!);
  const shownKey = $derived(song.key ? transposeKey(song.key, song.steps ?? 0) : null);

  // Keep the screen on while on stage (where the browser allows it).
  $effect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<typeof lock> } };
    const take = () =>
      nav.wakeLock
        ?.request("screen")
        .then((l) => (lock = l))
        .catch(() => {});
    void take();
    const again = () => document.visibilityState === "visible" && void take();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      void lock?.release().catch(() => {});
    };
  });

  // Auto-scroll: a steady crawl; speed 1-6.
  $effect(() => {
    if (!playing || !scroller) return;
    let last = performance.now();
    let frame = 0;
    let carry = 0;
    const tick = (now: number) => {
      carry += ((now - last) / 1000) * speed * 12;
      last = now;
      const px = Math.floor(carry);
      if (px && scroller) {
        scroller.scrollTop += px;
        carry -= px;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) playing = false;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  function go(i: number) {
    if (i < 0 || i >= songs.length) return;
    index = i;
    playing = false;
    scroller?.scrollTo({ top: 0 });
  }

  /** A page down; at the end of a song, the next song. */
  function pageDown() {
    if (!scroller) return;
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
    if (atEnd) go(index + 1);
    else scroller.scrollBy({ top: scroller.clientHeight * 0.85, behavior: "smooth" });
  }
  function pageUp() {
    if (!scroller) return;
    if (scroller.scrollTop <= 4) go(index - 1);
    else scroller.scrollBy({ top: -scroller.clientHeight * 0.85, behavior: "smooth" });
  }

  function onkey(e: KeyboardEvent) {
    if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) {
      e.preventDefault();
      pageDown();
    } else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) {
      e.preventDefault();
      pageUp();
    } else if (e.key === "Escape") onclose();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="stage" role="dialog" aria-modal="true" aria-label="Stage mode: {song.title}">
  <header>
    <button class="icon" onclick={onclose} aria-label="Close stage mode"><X size={24} /></button>
    <div class="title">
      <strong>{song.title}</strong>
      <span
        >{[
          shownKey,
          song.tempo_bpm ? `${song.tempo_bpm} bpm` : null,
          song.capo ? `capo ${song.capo}` : null,
          songs.length > 1 ? `${index + 1} of ${songs.length}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}</span
      >
    </div>
    <button class="icon" onclick={() => (scale = Math.max(0.7, scale - 0.1))} aria-label="Smaller text"
      ><AArrowDown size={22} /></button
    >
    <button class="icon" onclick={() => (scale = Math.min(1.8, scale + 0.1))} aria-label="Bigger text"
      ><AArrowUp size={22} /></button
    >
  </header>

  <div class="scroll" bind:this={scroller} style:font-size="{scale}em">
    {#if song.pause !== undefined}
      <div class="pause">
        <strong>{song.title}</strong>
        {#if song.pause}<span>{song.pause}</span>{/if}
      </div>
    {:else if song.chart}
      <ChordChart chart={song.chart} steps={song.steps ?? 0} toKey={shownKey} size="stage" />
    {:else}
      <p class="none">No chart for this song yet.</p>
    {/if}
    {#if index < songs.length - 1}
      <button class="next-song" onclick={() => go(index + 1)}>Next: {songs[index + 1]!.title} →</button>
    {/if}
  </div>

  <footer>
    <button class="icon" onclick={() => go(index - 1)} disabled={index === 0} aria-label="Previous song"
      ><ChevronLeft size={26} /></button
    >
    <button
      class="play"
      onclick={() => (playing = !playing)}
      aria-label={playing ? "Stop scrolling" : "Scroll"}
    >
      {#if playing}<Pause size={22} />{:else}<Play size={22} />{/if}
    </button>
    <label class="speed"
      >Speed <input
        type="range"
        min="1"
        max="6"
        step="1"
        bind:value={speed}
        aria-label="Scroll speed"
      /></label
    >
    <button
      class="icon"
      onclick={() => go(index + 1)}
      disabled={index >= songs.length - 1}
      aria-label="Next song"><ChevronRight size={26} /></button
    >
  </footer>
</div>

<style>
  .stage {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    background: #0c0c10;
    color: #f4f4f6;
    --accent-text: #fbbf24;
    --text-2: #a1a1ab;
    padding-top: var(--safe-top);
    padding-bottom: var(--safe-bottom);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }
  .title {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .title strong {
    font-size: var(--text-lg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title span {
    color: #a1a1ab;
    font-size: var(--text-sm);
  }
  .icon,
  .play {
    display: inline-grid;
    place-items: center;
    min-width: 44px;
    min-height: 44px;
    border-radius: 12px;
    border: 0;
    background: #1d1d24;
    color: inherit;
  }
  .icon:disabled {
    opacity: 0.35;
  }
  .play {
    background: #4f46e5;
    min-width: 56px;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4) var(--space-5) 40vh;
    -webkit-overflow-scrolling: touch;
  }
  .speed {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: #a1a1ab;
    font-size: var(--text-sm);
  }
  .speed input {
    flex: 1;
    accent-color: #fbbf24;
  }
  .none {
    color: #a1a1ab;
  }
  .pause {
    display: grid;
    gap: var(--space-3);
    justify-items: center;
    padding: 18vh var(--space-4) 0;
    text-align: center;
    color: #a1a1ab;
  }
  .pause strong {
    font-size: 2em;
    color: #f4f4f6;
    overflow-wrap: anywhere;
  }
  .next-song {
    margin-top: var(--space-6);
    width: 100%;
    min-height: 56px;
    border-radius: 14px;
    border: 1px dashed #363640;
    background: transparent;
    color: #fbbf24;
    font-size: var(--text-md);
    font-weight: 650;
  }
</style>
