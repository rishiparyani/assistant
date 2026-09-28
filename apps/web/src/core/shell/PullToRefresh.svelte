<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { activity } from "../activity.svelte.ts";
  import { refreshAll } from "../query.svelte.ts";

  // Pull down at the top of a page to refresh what's on screen (home-screen apps have
  // no browser reload). Also refreshes when you come back to the app.
  const THRESHOLD = 70;
  let startY: number | null = null;
  let pull = $state(0);
  let refreshing = $state(false);

  function onstart(e: TouchEvent) {
    if (window.scrollY > 0 || document.querySelector("dialog[open]")) return;
    startY = e.touches[0]!.clientY;
  }
  function onmove(e: TouchEvent) {
    if (startY === null) return;
    const dy = e.touches[0]!.clientY - startY;
    pull = dy > 0 && window.scrollY <= 0 ? Math.min(110, dy * 0.5) : 0;
  }
  function onend() {
    if (startY !== null && pull >= THRESHOLD * 0.5 + 10) run();
    startY = null;
    pull = 0;
  }
  function run() {
    refreshing = true;
    refreshAll();
    // Spin until the requests it started have finished.
    setTimeout(function wait() {
      if (activity.pending > 0) setTimeout(wait, 150);
      else refreshing = false;
    }, 300);
  }

  $effect(() => {
    const onvisible = () => document.visibilityState === "visible" && refreshAll();
    document.addEventListener("visibilitychange", onvisible);
    return () => document.removeEventListener("visibilitychange", onvisible);
  });
</script>

<svelte:window ontouchstart={onstart} ontouchmove={onmove} ontouchend={onend} />

{#if pull > 0 || refreshing}
  <div class="ptr" style:transform="translate(-50%, {refreshing ? 56 : pull}px)" aria-live="polite">
    <span class="bubble" class:spin={refreshing} style:rotate="{refreshing ? 0 : pull * 4}deg">
      <RefreshCw size={18} />
    </span>
    {#if refreshing}<span class="sr">Refreshing</span>{/if}
  </div>
{/if}

<style>
  .ptr {
    position: fixed;
    z-index: 30;
    top: calc(var(--safe-top) + 8px);
    left: 50%;
    pointer-events: none;
    transition: transform 0.15s ease-out;
  }
  .bubble {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    color: var(--accent);
  }
  .spin {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
