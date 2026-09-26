<script lang="ts">
  import Hammer from "@lucide/svelte/icons/hammer";
  import { EmptyState, PageHeader } from "../ui/index.ts";
  let { title, text }: { title: string; text: string } = $props();
</script>

<PageHeader {title} />
<EmptyState title="Coming in the next update" {text}>
  {#snippet icon()}<Hammer size={26} />{/snippet}
</EmptyState>
