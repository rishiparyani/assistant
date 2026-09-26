<script lang="ts">
  import type { Snippet } from "svelte";
  import { navigate } from "../router.svelte.ts";
  import { session } from "../session.svelte.ts";

  let { children }: { children: Snippet } = $props();

  $effect(() => {
    if (session.loaded && !session.me) {
      const next = window.location.pathname + window.location.search;
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  });
</script>

{#if session.me}
  {@render children()}
{/if}
