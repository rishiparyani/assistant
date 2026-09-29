<script lang="ts">
  import CloudOff from "@lucide/svelte/icons/cloud-off";
  import { connection } from "../offline.svelte.ts";

  // Says when there's no connection: screens then show what's saved on this device.
</script>

{#if !connection.online}
  <div class="bar" role="status">
    <CloudOff size={16} />
    <span>Offline · showing what's saved on this device</span>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    background: var(--amber-soft);
    color: var(--amber);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
  }
</style>
