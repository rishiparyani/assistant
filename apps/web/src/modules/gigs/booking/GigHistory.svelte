<script lang="ts" module>
  /** "Changed the fee" after a name reads "Rishi changed the fee". */
  export function lower(s: string): string {
    return s ? s[0]!.toLowerCase() + s.slice(1) : s;
  }
</script>

<script lang="ts">
  import type { BookingView, GigHistoryEntry, GigHistoryView } from "@assistant/shared";
  import { isoDateIST } from "@assistant/shared";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import {
    Avatar,
    Button,
    EmptyState,
    ListGroup,
    NotSaved,
    PageHeader,
    Skeleton,
    toast,
  } from "../../../core/ui/index.ts";
  import { ApiError, errorText } from "../../../core/api.ts";
  import { createQuery } from "../../../core/query.svelte.ts";
  import { isOfflineError } from "../../../core/offline.svelte.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { time12 } from "../time.ts";

  // Who changed what on a gig, newest first (managers; decision 2026-10-03). The
  // first page is kept on this device like other screens, so it opens offline too.
  let { gigId }: { gigId: string } = $props();

  const gig = createQuery<BookingView>(
    () => `gig:${gigId}`,
    () => bookingsApi.get(gigId),
  );
  const first = createQuery<GigHistoryView>(
    () => `gig-history:${gigId}`,
    () => bookingsApi.history(gigId),
  );
  let older = $state<GigHistoryEntry[]>([]);
  let nextBefore = $state<number | null | undefined>(undefined);
  let loading = $state(false);
  $effect(() => {
    void first.data;
    older = [];
    nextBefore = undefined;
  });
  const items = $derived(first.data ? [...first.data.items, ...older] : null);
  const cursor = $derived(nextBefore === undefined ? (first.data?.next_before ?? null) : nextBefore);
  const forbidden = $derived(first.error instanceof ApiError && first.error.status === 403);

  async function more() {
    if (!cursor) return;
    loading = true;
    try {
      const page = await bookingsApi.history(gigId, cursor);
      older = [...older, ...page.items];
      nextBefore = page.next_before;
    } catch (e) {
      toast.error(e);
    } finally {
      loading = false;
    }
  }

  // Grouped by day (India time): Today, Yesterday, then dates.
  const today = isoDateIST(new Date().toISOString());
  const yesterday = isoDateIST(new Date(Date.now() - 86400_000).toISOString());
  function dayLabel(iso: string) {
    const d = isoDateIST(iso);
    if (d === today) return "Today";
    if (d === yesterday) return "Yesterday";
    return new Date(iso).toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: d.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
      timeZone: "Asia/Kolkata",
    });
  }
  const groups = $derived.by(() => {
    const out: { day: string; items: GigHistoryEntry[] }[] = [];
    for (const e of items ?? []) {
      const day = dayLabel(e.at);
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(e);
    }
    return out;
  });
</script>

<PageHeader title="History" subtitle={gig.data?.title} back="/gigs/{gigId}" backLabel="Gig" />

{#if forbidden}
  <EmptyState title="Only managers see the history" text="It includes the gig's money.">
    {#snippet icon()}<HistoryIcon size={26} />{/snippet}
  </EmptyState>
{:else if items === null}
  {#if first.error && isOfflineError(first.error)}<NotSaved />
  {:else if first.error}<EmptyState title="Couldn't load the history" text={errorText(first.error)} />
  {:else}<Skeleton rows={6} />{/if}
{:else}
  <div class="groups">
    {#each groups as g (g.day)}
      <ListGroup title={g.day}>
        {#each g.items as e (e.id)}
          <div class="entry">
            <Avatar name={e.who} size={32} />
            <div class="text">
              <p class="line"><strong>{e.is_me ? "You" : e.who}</strong> {lower(e.summary)}</p>
              {#each e.details as d, i (i)}<p class="detail">{d}</p>{/each}
              <p class="meta">{time12(e.at)} · {e.source_label}</p>
            </div>
          </div>
        {/each}
      </ListGroup>
    {/each}
    {#if cursor}
      <Button full onclick={more} {loading}>Show older changes</Button>
    {:else}
      <p class="end">That's everything since the gig was made.</p>
    {/if}
  </div>
{/if}

<style>
  .groups {
    display: grid;
    gap: var(--space-5);
    max-width: 760px;
  }
  .entry {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .entry + .entry {
    border-top: 1px solid var(--separator);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .text p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .line {
    color: var(--text);
  }
  .detail {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .meta {
    color: var(--text-3);
    font-size: var(--text-xs);
    margin-top: 2px !important;
  }
  .end {
    margin: 0;
    text-align: center;
    color: var(--text-3);
    font-size: var(--text-sm);
  }
</style>
