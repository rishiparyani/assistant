<script lang="ts">
  import { untrack } from "svelte";
  import type { AutofillView, BookingView } from "@assistant/shared";
  import { formatDateIST } from "@assistant/shared";
  import Users from "@lucide/svelte/icons/users";
  import { Button, SelectField, Sheet, TextArea, TextField, toast } from "../../../core/ui/index.ts";
  import { navigate } from "../../../core/router.svelte.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { addDays, nextDay, todayIST, toApiLocal } from "../time.ts";

  // A new rehearsal (docs/design/rehearsals.md). It's for a gig unless you choose "Not for
  // a gig": the soonest upcoming gig I manage is picked to start with. With `gig` given,
  // it changes a rehearsal of its own (name, band, notes); its dates are edited on its page.
  let {
    open = $bindable(false),
    gig = null,
    onsaved,
  }: { open?: boolean; gig?: BookingView | null; onsaved?: (g: BookingView) => void } = $props();

  const NONE = "none";
  const uid = $props.id();
  const formId = `rehearsal-form-${uid}`;
  const editing = $derived(!!gig);

  let gigs = $state<{ id: string; label: string; date: string }[]>([]);
  let loadingGigs = $state(false);
  let forGig = $state(NONE);
  let title = $state("");
  let band = $state("");
  let date = $state("");
  let start = $state("18:00");
  let end = $state("");
  let venue = $state("");
  let city = $state("");
  let notes = $state("");
  let busy = $state(false);
  let autofill = $state<AutofillView | null>(null);
  let useBand = $state(false);
  let openedVersion = 0;

  $effect(() => {
    if (!open) return;
    untrack(() => {
      openedVersion = gig?.version ?? 0;
      title = gig?.title ?? "";
      band = gig?.collective?.name ?? "";
      notes = gig?.notes ?? "";
      date = addDays(todayIST(), 1);
      start = "18:00";
      end = "";
      venue = "";
      city = "";
      autofill = null;
      useBand = false;
      if (!gig) void loadGigs();
    });
  });

  /** Upcoming gigs I manage (one entry per gig), soonest first. */
  async function loadGigs() {
    loadingGigs = true;
    try {
      const page = await bookingsApi.myGigs({
        from: new Date().toISOString(),
        kind: "show",
        order: "asc",
        limit: 50,
      });
      // The first (soonest) event of each gig; a plain object, not reactive state.
      const firsts = new Map(
        page.items
          .filter((e) => e.role === "manager" && e.status !== "cancelled")
          .reverse()
          .map((e) => [e.gig_id, e]),
      );
      gigs = [...firsts.values()]
        .sort((a, b) => a.start_at.localeCompare(b.start_at))
        .map((e) => ({
          id: e.gig_id,
          label: `${e.gig_title} · ${formatDateIST(e.start_at).replace(/ \d{4}$/, "")}`,
          date: e.start_at,
        }));
    } catch {
      gigs = []; // offline or failed: a rehearsal of its own still works when back online
    } finally {
      loadingGigs = false;
    }
    forGig = gigs[0]?.id ?? NONE;
    pickDate();
  }

  // Two days before the chosen gig (not in the past), else tomorrow.
  function pickDate() {
    const g = gigs.find((x) => x.id === forGig);
    const tomorrow = addDays(todayIST(), 1);
    const before = g ? addDays(formatISODate(g.date), -2) : tomorrow;
    date = before < tomorrow ? tomorrow : before;
  }
  const formatISODate = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

  const own = $derived(editing || forGig === NONE);
  const options = $derived([
    ...gigs.map((g) => ({ value: g.id, label: g.label })),
    { value: NONE, label: "Not for a gig" },
  ]);

  // A band's people from its last gig, offered for a rehearsal of its own.
  let lookup: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const name = band.trim();
    if (!open || editing || !own) return;
    clearTimeout(lookup);
    autofill = null;
    useBand = false;
    if (!name) return;
    lookup = setTimeout(async () => {
      try {
        const found = await bookingsApi.autofill(name);
        if (found.people.length && band.trim() === name) autofill = found;
      } catch {
        // no suggestion
      }
    }, 300);
    return () => clearTimeout(lookup);
  });

  async function submit(ev: SubmitEvent) {
    ev.preventDefault();
    busy = true;
    try {
      if (gig) {
        const saved = await bookingsApi.update(gig.id, openedVersion, {
          title: title.trim(),
          collective: band.trim() || null,
          notes: notes.trim() || null,
        });
        toast.success("Saved");
        open = false;
        onsaved?.(saved);
        return;
      }
      const event = {
        kind: "rehearsal" as const,
        start_at: toApiLocal(date, start),
        end_at: end ? toApiLocal(end < start ? nextDay(date) : date, end) : null,
        venue_name: venue.trim() || null,
        venue_city: city.trim() || null,
        notes: notes.trim() || null,
      };
      if (!own) {
        await bookingsApi.addEvent(forGig, event);
        toast.success("Rehearsal added");
        open = false;
        navigate(`/gigs/${forGig}`);
        return;
      }
      const people =
        useBand && autofill
          ? autofill.people.map((p) =>
              p.user_id
                ? { user_id: p.user_id, role: "player" as const }
                : { name: p.name, role: "player" as const },
            )
          : [];
      const made = await bookingsApi.create({
        kind: "rehearsal",
        title: title.trim(),
        collective: band.trim() || null,
        events: [{ ...event, notes: null }],
        notes: notes.trim() || null,
        people,
      });
      toast.success(people.length ? "Rehearsal added" : "Rehearsal added. Add who's coming under People.");
      open = false;
      navigate(`/gigs/${made.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={editing ? "Edit rehearsal" : "New rehearsal"}>
  <form id={formId} class="form" onsubmit={submit}>
    {#if !editing}
      <SelectField
        label="For"
        id="{uid}-for"
        bind:value={forGig}
        {options}
        disabled={loadingGigs}
        onchange={pickDate}
        hint={forGig === NONE
          ? "A rehearsal of its own, e.g. a weekly band practice."
          : "Everyone on the gig sees it and can say if they're coming."}
      />
    {/if}
    {#if own}
      <TextField
        label="Name"
        id="{uid}-title"
        bind:value={title}
        placeholder="e.g. Band practice"
        maxlength={160}
        required
      />
      <TextField label="Band" id="{uid}-band" bind:value={band} placeholder="Optional" maxlength={60} />
      {#if autofill && !editing}
        <label class="band-people">
          <input type="checkbox" bind:checked={useBand} />
          <Users size={18} />
          <span
            >Add the {autofill.people.length}
            {autofill.people.length === 1 ? "person" : "people"} from {autofill.from_gig?.title ??
              "its last gig"}</span
          >
        </label>
      {/if}
    {/if}
    {#if !editing}
      <div class="three">
        <TextField label="Date" id="{uid}-date" type="date" bind:value={date} required />
        <TextField label="Starts" id="{uid}-start" type="time" bind:value={start} required />
        <TextField label="Ends" id="{uid}-end" type="time" bind:value={end} hint="Optional" />
      </div>
      <div class="two">
        <TextField
          label="Where"
          id="{uid}-venue"
          bind:value={venue}
          placeholder="e.g. a studio"
          maxlength={120}
        />
        <TextField label="City" id="{uid}-city" bind:value={city} maxlength={80} />
      </div>
    {/if}
    <TextArea
      label="Notes"
      id="{uid}-notes"
      bind:value={notes}
      rows={3}
      maxlength={2000}
      placeholder="e.g. Bring the in-ears; new songs first"
    />
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}
      >{editing ? "Save" : "Add rehearsal"}</Button
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
  .band-people {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .band-people input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
</style>
