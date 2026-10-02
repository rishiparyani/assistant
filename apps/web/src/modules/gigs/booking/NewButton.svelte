<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import Music from "@lucide/svelte/icons/music";
  import Drum from "@lucide/svelte/icons/drum";
  import { ActionSheet, Button } from "../../../core/ui/index.ts";
  import RehearsalSheet from "./RehearsalSheet.svelte";

  // "New": a gig, or a rehearsal (for a gig by default; docs/design/rehearsals.md).
  let { onnewgig }: { onnewgig: () => void } = $props();
  let menuOpen = $state(false);
  let rehearsalOpen = $state(false);
</script>

<Button variant="primary" onclick={() => (menuOpen = true)}>
  {#snippet icon()}<Plus />{/snippet}
  New
</Button>
<ActionSheet
  bind:open={menuOpen}
  title="New"
  actions={[
    { label: "Gig", icon: Music, onclick: onnewgig },
    { label: "Rehearsal", icon: Drum, onclick: () => (rehearsalOpen = true) },
  ]}
/>
<RehearsalSheet bind:open={rehearsalOpen} />
