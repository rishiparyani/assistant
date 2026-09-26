<script lang="ts">
  import type { Snippet } from "svelte";
  let { padded = true, children }: { padded?: boolean; children: Snippet } = $props();
</script>

<div class="card" class:padded>{@render children()}</div>

<style>
  .card {
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }
  .padded {
    padding: var(--space-4);
  }
</style>
