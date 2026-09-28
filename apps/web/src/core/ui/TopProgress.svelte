<script lang="ts">
  import { activity } from "../activity.svelte.ts";

  // A thin bar across the top while the app waits on the server. Appears only after a
  // short delay, so quick requests don't flicker.
  let visible = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const busy = activity.pending > 0;
    clearTimeout(timer);
    if (busy) timer = setTimeout(() => (visible = true), 200);
    else visible = false;
    return () => clearTimeout(timer);
  });
</script>

{#if visible}
  <div class="bar" role="progressbar" aria-label="Loading"><span></span></div>
{/if}

<style>
  .bar {
    position: fixed;
    z-index: 100;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    overflow: hidden;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  span {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 40%;
    background: var(--accent);
    border-radius: 3px;
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      left: -40%;
    }
    to {
      left: 100%;
    }
  }
</style>
