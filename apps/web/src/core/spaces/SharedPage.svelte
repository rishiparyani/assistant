<script lang="ts">
  import type { SharedWithMe } from "@assistant/shared";
  import { EmptyState, PageHeader, Skeleton } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { SHARED_KEY, sharesApi } from "./shares-api.ts";
  import SharedTile from "./SharedTile.svelte";

  // Things others shared with me (design §11, chat-first step 4), as cards: just those, nothing
  // else of theirs. They refresh by themselves when the owner changes them.
  const list = createQuery<SharedWithMe[]>(() => SHARED_KEY, sharesApi.sharedWithMe);
</script>

<PageHeader title="Shared with you" />
{#if !list.data}
  {#if list.error}
    <EmptyState title="Can't load this" text="Check your connection and try again." />
  {:else}
    <Skeleton rows={3} label="Loading" />
  {/if}
{:else if !list.data.length}
  <EmptyState
    title="Nothing shared with you yet"
    text="When someone shares a card, a list or a form with you, it shows up here."
  />
{:else}
  <div class="grid">
    {#each list.data as s (s.share_id)}
      <SharedTile share={s} />
    {/each}
  </div>
{/if}

<style>
  .grid {
    max-width: var(--content-max);
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    grid-auto-rows: max-content;
  }
</style>
