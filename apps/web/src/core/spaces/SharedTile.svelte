<script lang="ts">
  import type { SharedOpened, SharedWithMe } from "@assistant/shared";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Rows from "@lucide/svelte/icons/rows-3";
  import StickyNote from "@lucide/svelte/icons/sticky-note";
  import { Pill } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { sharedCardKey, sharesApi } from "./shares-api.ts";

  // One thing shared with me, as a card (chat-first step 4): what it is, who it's from, and a
  // peek at it (a few fields, the first rows, or "fill in"). The peek comes from the offline
  // copy first and refreshes with live updates; tap opens it.
  let { share }: { share: SharedWithMe } = $props();
  const q = createQuery<SharedOpened>(
    () => sharedCardKey(share.share_id),
    () => sharesApi.open(share.share_id),
  );

  const kindLabel = $derived(share.kind === "form" ? "Form" : share.kind === "view" ? "List" : "Card");
  const peek = $derived.by((): string[] => {
    const o = q.data;
    if (!o) return [];
    if (o.share.kind === "card" && "record" in o)
      return o.record.fields
        .filter((f) => !f.title && f.display !== null && f.display !== "")
        .slice(0, 3)
        .map((f) => `${f.name}: ${Array.isArray(f.display) ? f.display.join(", ") : f.display}`);
    if (o.share.kind === "view" && "records" in o) return o.records.slice(0, 3).map((r) => r.title);
    if (o.share.kind === "form" && "mine" in o)
      return [o.mine.length ? `You sent ${o.mine.length}` : "Tap to fill it in"];
    return [];
  });
  const count = $derived(
    q.data && q.data.share.kind === "view" && "records" in q.data ? q.data.records.length : null,
  );
  // Only the first page is loaded; with more pages the count isn't exact.
  const morePages = $derived(
    !!q.data && q.data.share.kind === "view" && "next_cursor" in q.data && !!q.data.next_cursor,
  );
</script>

<a class="tile {share.kind}" href="/shared/{share.share_id}">
  <header>
    <span class="kind" aria-hidden="true">
      {#if share.kind === "form"}<ClipboardList size={18} />{:else if share.kind === "view"}<Rows
          size={18}
        />{:else}<StickyNote size={18} />{/if}
    </span>
    <span class="head">
      <span class="title">{share.title}</span>
      <span class="from">{kindLabel} from {share.owner}</span>
    </span>
    <Pill tone={share.access === "edit" ? "green" : "grey"}
      >{share.access === "edit" ? (share.kind === "form" ? "Fill in" : "Can edit") : "View"}</Pill
    >
  </header>
  {#if peek.length}
    <ul>
      {#each peek as line, i (i)}<li>{line}</li>{/each}
    </ul>
  {/if}
  {#if count !== null && (count > 3 || morePages)}<p class="more">
      {morePages ? "and more" : `and ${count - 3} more`}
    </p>{/if}
</a>

<style>
  .tile {
    --k: var(--kind-note);
    --k-soft: var(--kind-note-soft);
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    color: inherit;
    text-decoration: none;
    min-width: 0;
    min-height: 44px;
    animation: rise-in var(--dur) var(--ease) backwards;
  }
  .tile.form {
    --k: var(--kind-form);
    --k-soft: var(--kind-form-soft);
  }
  .tile.card {
    --k: var(--kind-people);
    --k-soft: var(--kind-people-soft);
  }
  .tile:hover {
    border-color: var(--k);
  }
  .tile:focus-visible {
    outline: 2px solid var(--k);
    outline-offset: 2px;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .from,
  .more {
    color: var(--text-3);
    font-size: var(--text-sm);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
  }
  li {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
  }
  .more {
    margin: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .tile {
      animation: none;
    }
  }
</style>
