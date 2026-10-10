<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Info from "@lucide/svelte/icons/info";
  import { flip } from "svelte/animate";
  import { fade, fly } from "svelte/transition";
  import { backOut } from "svelte/easing";
  import { toasts } from "./toast.svelte.ts";
</script>

<div class="toaster" role="status" aria-live="polite">
  {#each toasts as t (t.id)}
    <div
      class="toast {t.kind}"
      animate:flip={{ duration: 250 }}
      in:fly={{ y: 24, duration: 380, easing: backOut }}
      out:fade={{ duration: 180 }}
    >
      {#if t.kind === "success"}<CircleCheck size={18} />{:else if t.kind === "error"}<CircleAlert
          size={18}
        />{:else}<Info size={18} />{/if}
      <span>{t.text}</span>
    </div>
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    z-index: 100;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(var(--tabbar-h) + var(--safe-bottom) + var(--space-3));
    display: grid;
    gap: var(--space-2);
    width: min(440px, calc(100vw - 32px));
    pointer-events: none;
  }
  @media (min-width: 768px) {
    .toaster {
      bottom: var(--space-6);
    }
  }
  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 12px 16px;
    border-radius: var(--radius);
    background: var(--text);
    color: var(--bg);
    font-weight: 500;
    font-size: var(--text-sm);
    box-shadow: var(--shadow-lg);
  }
  .success :global(svg) {
    color: var(--green);
  }
  .error :global(svg) {
    color: var(--red);
  }
</style>
