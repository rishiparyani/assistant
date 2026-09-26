<script lang="ts">
  import type { GigView, WorkspaceDetail } from "@assistant/shared";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import { EmptyState, ListGroup, ListRow, PageHeader, Pill, Skeleton } from "../ui/index.ts";
  import { api } from "../api.ts";
  import { session } from "../session.svelte.ts";
  import GigDate from "../../modules/gigs/GigDate.svelte";
  import { statusTone, statusLabel } from "../../modules/gigs/status.ts";

  let { workspace }: { workspace: WorkspaceDetail } = $props();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = $derived(session.me?.user.name.split(" ")[0] ?? "");

  let upcoming = $state<GigView[] | null>(null);
  let error = $state("");
  $effect(() => {
    upcoming = null;
    api.findGigs(workspace.id, { from: new Date().toISOString(), limit: "5" }).then(
      (p) => (upcoming = p.items.filter((g) => g.status !== "cancelled")),
      (e) => (error = e instanceof Error ? e.message : String(e)),
    );
  });
</script>

<PageHeader title="{greeting}, {firstName}" subtitle={workspace.name} />

<div class="grid">
  <ListGroup title="Coming up">
    {#if error}
      <ListRow title="Couldn't load gigs" subtitle={error} />
    {:else if upcoming === null}
      <Skeleton rows={3} />
    {:else if upcoming.length === 0}
      <EmptyState title="No upcoming gigs" text="Gigs you add will show up here, soonest first.">
        {#snippet icon()}<CalendarPlus size={26} />{/snippet}
      </EmptyState>
    {:else}
      {#each upcoming as gig (gig.id)}
        <ListRow href="/w/{workspace.id}/gigs/{gig.id}" title={gig.title}>
          {#snippet leading()}<GigDate iso={gig.start_at} />{/snippet}
          <span class="meta">
            {#if gig.venue}<MapPin size={13} /><span class="ellipsis"
                >{gig.venue.name}{gig.venue.city ? `, ${gig.venue.city}` : ""}</span
              >{:else}<span class="ellipsis">{gig.start_display}</span>{/if}
          </span>
          {#snippet trailing()}<Pill tone={statusTone(gig.status)}>{statusLabel(gig.status)}</Pill>{/snippet}
        </ListRow>
      {/each}
    {/if}
  </ListGroup>
</div>

<style>
  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    color: var(--text-2);
    min-width: 0;
  }
  .meta :global(svg) {
    flex-shrink: 0;
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
