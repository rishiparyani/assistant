<script lang="ts">
  import Compass from "@lucide/svelte/icons/compass";
  import { Button, EmptyState } from "../ui/index.ts";

  let {
    title = "Page not found",
    text = "That link doesn't lead anywhere in the app.",
  }: { title?: string; text?: string } = $props();
</script>

<EmptyState {title} {text}>
  {#snippet icon()}<Compass size={26} />{/snippet}
  {#snippet action()}<Button href="/" variant="primary">Go to Home</Button>{/snippet}
</EmptyState>
