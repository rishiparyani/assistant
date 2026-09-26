<script lang="ts">
  import type { Snippet } from "svelte";

  // An iOS-style inset group: optional header, rounded card of rows, optional footer.
  let {
    title,
    footer,
    action,
    children,
  }: { title?: string; footer?: string; action?: Snippet; children: Snippet } = $props();
</script>

<section class="group">
  {#if title || action}
    <header>
      {#if title}<h2>{title}</h2>{/if}
      {#if action}<div class="action">{@render action()}</div>{/if}
    </header>
  {/if}
  <div class="rows">{@render children()}</div>
  {#if footer}<p class="footer">{footer}</p>{/if}
</section>

<style>
  /* Never let long, unwrapped row text widen a grid or flex parent. */
  .group {
    min-width: 0;
  }
  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 0 var(--space-4) var(--space-2);
  }
  h2 {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .rows {
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .footer {
    padding: var(--space-2) var(--space-4) 0;
    font-size: var(--text-sm);
    color: var(--text-3);
  }
</style>
