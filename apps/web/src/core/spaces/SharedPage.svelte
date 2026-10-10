<script lang="ts">
  import type { SharedWithMe } from "@assistant/shared";
  import { EmptyState, ListGroup, ListRow, PageHeader, Pill, Skeleton } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { SHARED_KEY, sharesApi } from "./shares-api.ts";

  // Cards others shared with me (design §11): just the cards, nothing else of theirs.
  const list = createQuery<SharedWithMe[]>(() => SHARED_KEY, sharesApi.sharedWithMe);
</script>

<PageHeader title="Shared with me" />
{#if !list.data}
  {#if list.error}
    <EmptyState title="Can't load this" text="Check your connection and try again." />
  {:else}
    <Skeleton rows={3} label="Loading" />
  {/if}
{:else if !list.data.length}
  <EmptyState
    title="Nothing shared with you yet"
    text="When someone shares a card with you (a gig, a list), open their link and it shows up here."
  />
{:else}
  <div class="wrap">
    <ListGroup>
      {#each list.data as s (s.share_id)}
        <ListRow title={s.title} subtitle="From {s.owner}" href="/shared/{s.share_id}">
          {#snippet trailing()}
            <Pill tone={s.access === "edit" ? "green" : "grey"}
              >{s.access === "edit" ? "Can edit" : "View"}</Pill
            >
          {/snippet}
        </ListRow>
      {/each}
    </ListGroup>
  </div>
{/if}

<style>
  .wrap {
    max-width: var(--content-max);
  }
</style>
