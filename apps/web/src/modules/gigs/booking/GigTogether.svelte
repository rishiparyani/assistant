<script lang="ts">
  import type { BookingView } from "@assistant/shared";
  import { PageHeader, Segmented, Skeleton } from "../../../core/ui/index.ts";
  import { navigate } from "../../../core/router.svelte.ts";
  import NotFound from "../../../core/pages/NotFound.svelte";
  import { ApiError } from "../../../core/api.ts";
  import { createQuery, dropCache } from "../../../core/query.svelte.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { withDefaults } from "./gig-defaults.ts";
  import GigGuests from "./GigGuests.svelte";
  import GigLists from "./GigLists.svelte";
  import GigNotes from "./GigNotes.svelte";

  // A gig's shared space, apart from its details: the guest list, lists and notes that
  // everyone on the gig works on together. Same gig data (and cache) as the gig page.
  type Section = "guests" | "lists" | "notes";
  let { gigId, section }: { gigId: string; section: Section } = $props();

  const q = createQuery<BookingView>(
    () => `gig:${gigId}`,
    () => bookingsApi.get(gigId),
  );
  const gig = $derived(q.data ? withDefaults(q.data) : null);
  const missing = $derived(q.error instanceof ApiError && q.error.status === 404);
  $effect(() => {
    if (missing) dropCache(`gig:${gigId}`);
  });
  const set = (g: BookingView) => q.set(g);

  const TITLES: Record<Section, string> = { guests: "Guest list", lists: "Lists", notes: "Notes" };
  const first = $derived(gig?.events[0]);
  const subtitle = $derived(
    gig
      ? [
          gig.title,
          first
            ? new Date(first.start_at).toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
                timeZone: "Asia/Kolkata",
              })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined,
  );

  // Follows the address; picking a section changes the address.
  let current = $derived<Section>(section);
  $effect(() => {
    if (current !== section) navigate(`/gigs/${gigId}/${current}`, { replace: true });
  });
</script>

{#if missing}
  <NotFound title="Gig not found" text="It may have been deleted, or you're not on it." />
{:else}
  <PageHeader title={TITLES[section]} {subtitle} back="/gigs/{gigId}" backLabel="Gig" />
  <div class="page">
    <Segmented
      label="Together"
      bind:value={current}
      options={[
        { value: "guests", label: "Guest list" },
        { value: "lists", label: "Lists" },
        { value: "notes", label: "Notes" },
      ]}
    />
    {#if !gig}
      <Skeleton rows={5} />
    {:else if section === "guests"}
      <GigGuests {gig} onsaved={set} />
    {:else if section === "lists"}
      <GigLists {gig} onsaved={set} />
    {:else}
      <GigNotes {gig} onsaved={set} />
    {/if}
  </div>
{/if}

<style>
  .page {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
  }
</style>
