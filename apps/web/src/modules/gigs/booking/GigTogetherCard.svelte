<script lang="ts">
  import type { BookingView } from "@assistant/shared";
  import Users from "@lucide/svelte/icons/users";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import MessageSquare from "@lucide/svelte/icons/message-square";

  // The way into the gig's shared space (guest list, lists, notes), kept apart from the
  // gig's own details: a tile for each that has something in it (empty ones are started
  // from the gig page's Add menu), with where things stand.
  let { gig }: { gig: BookingView } = $props();

  // Short, so the three sit side by side on a phone.
  const guests = $derived.by(() => {
    const l = gig.guest_list;
    if (!l.heads) return l.open ? "None yet" : "Closed";
    return l.total_limit
      ? `${l.heads} of ${l.total_limit}`
      : `${l.heads} ${l.heads === 1 ? "guest" : "guests"}`;
  });
  const count = (n: number, one: string, many: string, none: string) =>
    n ? `${n} ${n === 1 ? one : many}` : none;
  const tiles = $derived(
    [
      {
        href: `/gigs/${gig.id}/guests`,
        label: "Guests",
        sub: guests,
        icon: Users,
        tone: "violet",
        has: gig.guest_list.heads > 0,
      },
      {
        href: `/gigs/${gig.id}/lists`,
        label: "Lists",
        sub: count(gig.lists.length, "list", "lists", ""),
        icon: ListChecks,
        tone: "blue",
        has: gig.lists.length > 0,
      },
      {
        href: `/gigs/${gig.id}/notes`,
        label: "Notes",
        sub: count(gig.shared_notes.length, "note", "notes", ""),
        icon: MessageSquare,
        tone: "green",
        has: gig.shared_notes.length > 0,
      },
    ].filter((t) => t.has),
  );
</script>

{#if tiles.length}
  <nav class="together" aria-label="Together: guests, lists and notes">
    {#each tiles as t (t.href)}
      <a class="tile" href={t.href}>
        <span class="label"><span class="ico {t.tone}"><t.icon size={16} /></span>{t.label}</span>
        <span class="sub">{t.sub}</span>
      </a>
    {/each}
  </nav>
{/if}

<style>
  .together {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .tile {
    display: grid;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    min-height: 56px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    color: var(--text);
    min-width: 0;
  }
  .tile:hover {
    background: var(--surface-hover);
  }
  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  .sub {
    max-width: 100%;
    font-size: var(--text-sm);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ico {
    display: inline-flex;
  }
  .violet {
    color: var(--violet);
  }
  .blue {
    color: var(--blue);
  }
  .green {
    color: var(--green);
  }
</style>
