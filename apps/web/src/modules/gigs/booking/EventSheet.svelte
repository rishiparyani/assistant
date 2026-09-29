<script lang="ts">
  import { untrack } from "svelte";
  import type { BookingEventView, BookingView } from "@assistant/shared";
  import { isoDateIST } from "@assistant/shared";
  import { Button, Sheet, TextArea, TextField, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { nextDay, timeIST, todayIST, toApiLocal } from "../time.ts";

  // Add an event to a gig, or change one (managers).
  let {
    open = $bindable(false),
    gig,
    event = null,
    onsaved,
  }: {
    open?: boolean;
    gig: BookingView;
    event?: BookingEventView | null;
    onsaved: (g: BookingView) => void;
  } = $props();

  const uid = $props.id();
  const formId = `event-form-${uid}`;
  let title = $state("");
  let date = $state("");
  let start = $state("");
  let end = $state("");
  let venue = $state("");
  let city = $state("");
  let notes = $state("");
  let busy = $state(false);

  // Filled once per opening: a live refresh of the gig mustn't wipe what's being typed.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      const e = event;
      title = e?.title ?? "";
      date = e
        ? isoDateIST(e.start_at)
        : gig.events.at(-1)
          ? isoDateIST(gig.events.at(-1)!.start_at)
          : todayIST();
      start = e ? timeIST(e.start_at) : "19:00";
      end = e?.end_at ? timeIST(e.end_at) : "";
      venue = e?.venue_name ?? gig.events.at(-1)?.venue_name ?? "";
      city = e?.venue_city ?? gig.events.at(-1)?.venue_city ?? "";
      notes = e?.notes ?? "";
    });
  });

  async function submit(ev: SubmitEvent) {
    ev.preventDefault();
    busy = true;
    const fields = {
      title: title.trim() || null,
      start_at: toApiLocal(date, start),
      end_at: end ? toApiLocal(end < start ? nextDay(date) : date, end) : null,
      venue_name: venue.trim() || null,
      venue_city: city.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      const saved = event
        ? await bookingsApi.updateEvent(gig.id, event.id, gig.version, fields)
        : await bookingsApi.addEvent(gig.id, fields);
      toast.success(event ? "Event updated" : "Event added");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={event ? "Edit event" : "Add event"}>
  <form id={formId} class="form" onsubmit={submit}>
    <TextField
      label="Name"
      id="{uid}-title"
      bind:value={title}
      placeholder="e.g. Sangeet, Reception"
      maxlength={80}
    />
    <div class="three">
      <TextField label="Date" id="{uid}-date" type="date" bind:value={date} required />
      <TextField label="Starts" id="{uid}-start" type="time" bind:value={start} required />
      <TextField label="Ends" id="{uid}-end" type="time" bind:value={end} hint="Optional" />
    </div>
    <div class="two">
      <TextField label="Venue" id="{uid}-venue" bind:value={venue} maxlength={120} />
      <TextField label="City" id="{uid}-city" bind:value={city} maxlength={80} />
    </div>
    <TextArea label="Notes" id="{uid}-notes" bind:value={notes} rows={3} maxlength={2000} />
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}
      >{event ? "Save" : "Add event"}</Button
    >
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .two,
  .three {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .three {
    grid-template-columns: minmax(0, 1.4fr) repeat(2, minmax(0, 1fr));
  }
  @media (max-width: 420px) {
    .three {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .three :global(.field:first-child) {
      grid-column: 1 / -1;
    }
  }
</style>
