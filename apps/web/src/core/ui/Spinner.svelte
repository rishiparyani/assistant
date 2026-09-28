<script lang="ts">
  // A small spinning ring, with an optional label beside it.
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<span class="wrap" role="status" aria-live="polite">
  <span class="ring" style:width="{size}px" style:height="{size}px" aria-hidden="true"></span>
  {#if label}<span class="label">{label}</span>{:else}<span class="sr">Loading</span>{/if}
</span>

<style>
  .wrap {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-2);
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .ring {
    flex-shrink: 0;
    border-radius: 50%;
    border: 2.5px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring {
      animation-duration: 2s;
    }
  }
</style>
