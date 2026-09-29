<script lang="ts">
  import type { BookingView } from "@assistant/shared";
  import Users from "@lucide/svelte/icons/users";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import { ListGroup, ListRow } from "../../../core/ui/index.ts";

  // The way into the gig's shared space (guest list, lists, notes), kept apart from the
  // gig's own details: one row each, with where things stand.
  let { gig }: { gig: BookingView } = $props();

  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const ago = (iso: string) => {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
    const hours = Math.round(mins / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
  };

  const guests = $derived.by(() => {
    const l = gig.guest_list;
    if (!l.heads) return l.open ? "No guests yet" : "Closed";
    const count = l.total_limit ? `${l.heads} of ${l.total_limit}` : people(l.heads);
    const extra =
      gig.my_role === "manager" ? (l.link?.enabled ? "venue link on" : null) : `yours ${l.my_heads}`;
    return [count, extra].filter(Boolean).join(" · ");
  });
  const lists = $derived(
    gig.lists.length ? gig.lists.map((l) => l.title).join(", ") : "Setlists, packing, run of show",
  );
  const notes = $derived.by(() => {
    const n = gig.shared_notes;
    if (!n.length) return "Updates for everyone on the gig";
    return `${n.length} ${n.length === 1 ? "note" : "notes"} · latest from ${n[0]!.author}, ${ago(n[0]!.created_at)}`;
  });
</script>

<ListGroup title="Together">
  <ListRow href="/gigs/{gig.id}/guests" title="Guest list" subtitle={guests}>
    {#snippet leading()}<span class="ico violet"><Users size={18} /></span>{/snippet}
  </ListRow>
  <ListRow href="/gigs/{gig.id}/lists" title="Lists" subtitle={lists}>
    {#snippet leading()}<span class="ico blue"><ListChecks size={18} /></span>{/snippet}
  </ListRow>
  <ListRow href="/gigs/{gig.id}/notes" title="Notes" subtitle={notes}>
    {#snippet leading()}<span class="ico green"><MessageSquare size={18} /></span>{/snippet}
  </ListRow>
</ListGroup>

<style>
  .ico {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
  }
  .violet {
    background: var(--violet-soft);
    color: var(--violet);
  }
  .blue {
    background: var(--blue-soft);
    color: var(--blue);
  }
  .green {
    background: var(--green-soft);
    color: var(--green);
  }
</style>
