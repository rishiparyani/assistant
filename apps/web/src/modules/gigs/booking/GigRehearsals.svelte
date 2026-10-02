<script lang="ts">
  import type { BookingEventView, BookingView } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import { Avatar, Button, ListGroup, ListRow, Pill, toast } from "../../../core/ui/index.ts";
  import GigDate from "../GigDate.svelte";
  import { bookingsApi } from "../gigs-api.ts";
  import { timeRange } from "../time.ts";

  // A gig's rehearsals (docs/design/rehearsals.md): when and where, and who's coming.
  // Everyone on the gig answers for themselves; managers add and change rehearsals.
  let {
    gig,
    onsaved,
    onadd,
    onedit,
  }: {
    gig: BookingView;
    onsaved: (g: BookingView) => void;
    onadd: () => void;
    onedit: (e: BookingEventView) => void;
  } = $props();

  const manager = $derived(gig.my_role === "manager");
  const editable = $derived(gig.status !== "cancelled");
  const rehearsals = $derived(gig.events.filter((e) => e.kind === "rehearsal"));
  // People who haven't answered are counted only when I can see everyone on the gig.
  const everyone = $derived(manager || gig.settings.players_see_lineup);
  let unfolded = $state<Record<string, boolean>>({});
  let busy = $state("");

  const isOver = (e: BookingEventView) =>
    (e.end_at ? Date.parse(e.end_at) : Date.parse(e.start_at) + 4 * 3600_000) <= Date.now();

  function counts(e: BookingEventView) {
    const going = e.attendance.filter((a) => a.going).length;
    const cant = e.attendance.length - going;
    const unanswered = everyone ? Math.max(0, gig.people.length - e.attendance.length) : 0;
    return [
      going ? `${going} going` : null,
      cant ? `${cant} can't` : null,
      unanswered ? `${unanswered} haven't said` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function answer(e: BookingEventView, going: boolean) {
    if (e.my_going === going) return;
    busy = `${e.id}:${going}`;
    try {
      onsaved(await bookingsApi.setAttendance(gig.id, e.id, going));
      toast.success(going ? "See you there" : "Got it, you can't make it");
    } catch (err) {
      toast.error(err);
    } finally {
      busy = "";
    }
  }
</script>

{#if rehearsals.length}
  <ListGroup title={gig.kind === "rehearsal" ? (rehearsals.length > 1 ? "Dates" : "When") : "Rehearsals"}>
    {#snippet action()}
      {#if manager && editable}<button class="link" onclick={onadd}>Add</button>{/if}
    {/snippet}
    {#each rehearsals as e (e.id)}
      {@const over = isOver(e)}
      {@const summary = counts(e)}
      {@const open = unfolded[e.id] ?? false}
      <div class="rehearsal">
        <div class="head">
          <GigDate iso={e.start_at} muted={over || gig.status === "cancelled"} />
          <div class="grow">
            <span class="title">{e.title ?? "Rehearsal"}</span>
            <span class="muted">{timeRange(e.start_at, e.end_at)}</span>
            {#if e.venue_name}
              <span class="muted place"
                ><MapPin size={14} />{e.venue_name}{e.venue_city ? `, ${e.venue_city}` : ""}</span
              >
            {/if}
          </div>
          {#if manager && editable}<button class="link" onclick={() => onedit(e)}>Edit</button>{/if}
        </div>
        {#if e.notes}<p class="notes">{e.notes}</p>{/if}
        {#if !over && editable}
          <div class="answer" role="group" aria-label="Are you coming to {e.title ?? 'the rehearsal'}?">
            <button
              type="button"
              class:on={e.my_going === true}
              class="yes"
              aria-pressed={e.my_going === true}
              disabled={busy !== ""}
              onclick={() => answer(e, true)}>Going</button
            >
            <button
              type="button"
              class:on={e.my_going === false}
              class="no"
              aria-pressed={e.my_going === false}
              disabled={busy !== ""}
              onclick={() => answer(e, false)}>Can't make it</button
            >
          </div>
        {/if}
        {#if summary}
          <button class="fold" type="button" aria-expanded={open} onclick={() => (unfolded[e.id] = !open)}>
            <span class="grow">{summary}</span>
            {#if e.attendance.length}<span class="chev" class:turned={open}><ChevronDown size={18} /></span
              >{/if}
          </button>
          {#if open}
            {#each e.attendance as a (a.person_id)}
              <ListRow title={a.is_me ? `${a.name} (you)` : a.name}>
                {#snippet leading()}<Avatar name={a.name} size={28} />{/snippet}
                {#snippet trailing()}<Pill tone={a.going ? "green" : undefined}
                    >{a.going ? "Going" : "Can't"}</Pill
                  >{/snippet}
              </ListRow>
            {/each}
          {/if}
        {/if}
      </div>
    {/each}
  </ListGroup>
{:else if manager && editable && gig.kind === "gig"}
  <Button variant="ghost" onclick={onadd}>
    {#snippet icon()}<Plus />{/snippet}
    Add a rehearsal
  </Button>
{/if}

<style>
  .rehearsal {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .rehearsal + .rehearsal {
    border-top: 1px solid var(--separator);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .title {
    font-weight: 600;
  }
  .muted {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .place {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .notes {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
    white-space: pre-wrap;
  }
  .link {
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .answer {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .answer button {
    min-height: 44px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .answer .yes.on {
    background: var(--green-soft);
    border-color: var(--green);
    color: var(--green);
  }
  .answer .no.on {
    background: var(--grey-soft);
    border-color: var(--text-3);
    color: var(--text);
  }
  .answer button:disabled {
    opacity: 0.7;
  }
  .fold {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-2);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  .chev {
    display: inline-flex;
    transition: transform 0.15s;
  }
  .turned {
    transform: rotate(180deg);
  }
</style>
