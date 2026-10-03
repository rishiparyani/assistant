<script lang="ts">
  import { untrack } from "svelte";
  import type { BookingEventView, BookingView } from "@assistant/shared";
  import { isoDateIST } from "@assistant/shared";
  import { Button, Sheet, TextArea, TextField, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { addDays, nextDay, timeIST, todayIST, toApiLocal } from "../time.ts";

  // Add an event or a rehearsal to a gig, or change one (managers).
  let {
    open = $bindable(false),
    gig,
    event = null,
    kind = "show",
    hold = false,
    onsaved,
    onremove,
  }: {
    open?: boolean;
    gig: BookingView;
    event?: BookingEventView | null;
    /** What a new event is (an edited one keeps its own). */
    kind?: "show" | "rehearsal";
    /** A new date option on an enquiry (soft block). */
    hold?: boolean;
    onsaved: (g: BookingView) => void;
    /** Shown when editing one of several events (a gig keeps at least one). */
    onremove?: (e: BookingEventView) => void;
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
  const rehearsal = $derived((event?.kind ?? kind) === "rehearsal" || gig.kind === "rehearsal");
  const option = $derived(!rehearsal && (event?.hold ?? hold));
  const noun = $derived(rehearsal ? "rehearsal" : option ? "date option" : "event");
  /** A gig keeps one show; a rehearsal can always go unless it's all there is. */
  const removable = $derived(
    event !== null &&
      gig.events.length > 1 &&
      (event.kind === "rehearsal" || gig.events.filter((e) => e.kind === "show").length > 1),
  );

  // Filled once per opening: a live refresh of the gig mustn't wipe what's being typed.
  // The version this sheet was opened on: saving checks it, so a change someone else made
  // meanwhile is reported instead of silently overwritten (live refreshes update `gig`).
  let openedVersion = 0;
  $effect(() => {
    if (!open) return;
    untrack(() => {
      openedVersion = gig?.version ?? 0;
      const e = event;
      title = e?.title ?? "";
      notes = e?.notes ?? "";
      if (e) {
        date = isoDateIST(e.start_at);
        start = timeIST(e.start_at);
        end = e.end_at ? timeIST(e.end_at) : "";
        venue = e.venue_name ?? "";
        city = e.venue_city ?? "";
      } else if (rehearsal) {
        // A new rehearsal: like the last one (same place and time, a week on), or else
        // two days before the gig, in the evening.
        const last = gig.events.filter((x) => x.kind === "rehearsal").at(-1);
        const show = gig.events.find((x) => x.kind === "show");
        const today = todayIST();
        const day = last
          ? addDays(isoDateIST(last.start_at), 7)
          : show
            ? addDays(isoDateIST(show.start_at), -2)
            : today;
        date = day < today ? today : day;
        start = last ? timeIST(last.start_at) : "18:00";
        end = last?.end_at ? timeIST(last.end_at) : "";
        venue = last?.venue_name ?? "";
        city = last?.venue_city ?? show?.venue_city ?? "";
      } else {
        const prev = gig.events.filter((x) => x.kind === "show").at(-1);
        date = prev ? isoDateIST(prev.start_at) : todayIST();
        start = "19:00";
        end = "";
        venue = prev?.venue_name ?? "";
        city = prev?.venue_city ?? "";
      }
    });
  });

  async function submit(ev: SubmitEvent) {
    ev.preventDefault();
    busy = true;
    const fields = {
      ...(event
        ? {}
        : {
            kind: rehearsal ? ("rehearsal" as const) : ("show" as const),
            ...(option ? { hold: true } : {}),
          }),
      title: title.trim() || null,
      start_at: toApiLocal(date, start),
      end_at: end ? toApiLocal(end < start ? nextDay(date) : date, end) : null,
      venue_name: venue.trim() || null,
      venue_city: city.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      const saved = event
        ? await bookingsApi.updateEvent(gig.id, event.id, openedVersion, fields)
        : await bookingsApi.addEvent(gig.id, fields);
      toast.success(
        option
          ? event
            ? "Date option updated"
            : "Date held"
          : rehearsal
            ? event
              ? "Rehearsal updated"
              : "Rehearsal added"
            : event
              ? "Event updated"
              : "Event added",
      );
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={event ? `Edit ${noun}` : `Add ${noun}`}>
  <form id={formId} class="form" onsubmit={submit}>
    <TextField
      label="Name"
      id="{uid}-title"
      bind:value={title}
      placeholder={rehearsal ? "Optional, e.g. Full run-through" : "e.g. Sangeet, Reception"}
      maxlength={80}
    />
    <div class="three">
      <TextField label="Date" id="{uid}-date" type="date" bind:value={date} required />
      <TextField label="Starts" id="{uid}-start" type="time" bind:value={start} required />
      <TextField label="Ends" id="{uid}-end" type="time" bind:value={end} hint="Optional" />
    </div>
    <div class="two">
      <TextField
        label={rehearsal ? "Where" : "Venue"}
        id="{uid}-venue"
        bind:value={venue}
        placeholder={rehearsal ? "e.g. a studio" : undefined}
        maxlength={120}
      />
      <TextField label="City" id="{uid}-city" bind:value={city} maxlength={80} />
    </div>
    <TextArea
      label="Notes"
      id="{uid}-notes"
      bind:value={notes}
      rows={3}
      maxlength={2000}
      placeholder={rehearsal ? "e.g. Bring the in-ears; new songs first" : undefined}
    />
    {#if event && onremove && removable}
      <button
        type="button"
        class="remove"
        onclick={() => {
          open = false;
          onremove(event);
        }}>{option ? "Release this date" : `Remove this ${noun}`}</button
      >
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}
      >{event ? "Save" : `Add ${noun}`}</Button
    >
  {/snippet}
</Sheet>

<style>
  .remove {
    justify-self: start;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--red);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
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
