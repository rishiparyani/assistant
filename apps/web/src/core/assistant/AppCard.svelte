<script lang="ts">
  import type { LiveRef } from "@assistant/shared";
  import Music from "@lucide/svelte/icons/music";
  import Box from "@lucide/svelte/icons/box";
  import { Button } from "../ui/index.ts";

  // Something an app made or found (a Songbook song), as a card in the chat: what it was
  // then, and Open for the app's own screen (where it's always current).
  let { live }: { live: Extract<LiveRef, { kind: "app" }> } = $props();
  const Icon = $derived(live.app === "music" ? Music : Box);
</script>

<article class="card">
  <header>
    <span class="kind" aria-hidden="true"><Icon size={18} /></span>
    <span class="head">
      <span class="title">{live.title}</span>
      {#if live.subtitle}<span class="sub">{live.subtitle}</span>{/if}
    </span>
  </header>
  <footer>
    <Button size="sm" variant="primary" href={live.href}>Open</Button>
  </footer>
</article>

<style>
  .card {
    --k: var(--kind-note);
    --k-soft: var(--kind-note-soft);
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .kind {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--k-soft);
    color: var(--k);
  }
  .head {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 600;
  }
  .sub {
    color: var(--text-3);
    font-size: var(--text-sm);
  }
  footer {
    display: flex;
    gap: var(--space-2);
  }
</style>
