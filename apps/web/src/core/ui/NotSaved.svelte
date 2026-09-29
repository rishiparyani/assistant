<script lang="ts">
  import CloudOff from "@lucide/svelte/icons/cloud-off";
  import EmptyState from "./EmptyState.svelte";

  // Offline, and this screen was never saved on the device.
</script>

<EmptyState
  title="Not saved on this device yet"
  text="You're offline. Open this once while online and it'll be here next time."
>
  {#snippet icon()}<CloudOff size={26} />{/snippet}
</EmptyState>
