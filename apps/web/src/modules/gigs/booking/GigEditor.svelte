<script lang="ts">
  import { untrack } from "svelte";
  import type {
    AutofillView,
    BookingRole,
    BookingView,
    ContactKind,
    ContactView,
    DuplicateWarning,
  } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Users from "@lucide/svelte/icons/users";
  import {
    Button,
    Segmented,
    SelectField,
    Sheet,
    SuggestField,
    TextArea,
    TextField,
    toast,
  } from "../../../core/ui/index.ts";
  import { navigate } from "../../../core/router.svelte.ts";
  import { session } from "../../../core/session.svelte.ts";
  import { bookingsApi, type EventFields, type PersonFields } from "../gigs-api.ts";
  import MoneyField from "../MoneyField.svelte";
  import { EVENT_TYPES } from "../options.ts";
  import { nextDay, todayIST, toApiLocal } from "../time.ts";
  import TagInput from "./TagInput.svelte";

  // New gig (details, events, people) or edit an existing gig's details. Events and people
  // of an existing gig are changed on the gig page.
  let {
    open = $bindable(false),
    gig = null,
    date = null,
    onsaved,
  }: {
    open?: boolean;
    gig?: BookingView | null;
    /** A new gig's first date ("YYYY-MM-DD"), e.g. the day picked in the calendar. */
    date?: string | null;
    onsaved?: (g: BookingView) => void;
  } = $props();

  type EventRow = { title: string; date: string; start: string; end: string; venue: string; city: string };
  type PersonRow = { who: string; role: BookingRole; user_id?: string; email?: string; phone?: string };

  const uid = $props.id();
  const formId = `gig-form-${uid}`;
  const editing = $derived(!!gig);

  let title = $state("");
  let eventType = $state("");
  let status = $state<"enquiry" | "confirmed">("confirmed");
  let clientName = $state("");
  let clientPhone = $state("");
  let fee = $state("");
  let collective = $state("");
  let tags = $state<string[]>([]);
  let notes = $state("");
  let events = $state<EventRow[]>([]);
  let people = $state<PersonRow[]>([]);
  let busy = $state(false);

  let collectiveSuggestions = $state<string[]>([]);
  let tagSuggestions = $state<string[]>([]);
  let autofill = $state<AutofillView | null>(null);
  let warnings = $state<DuplicateWarning[]>([]);

  const blankEvent = (): EventRow => ({
    title: "",
    date: todayIST(),
    start: "19:00",
    end: "",
    venue: "",
    city: "",
  });

  // Filled once per opening: a live refresh of the gig mustn't wipe what's being typed.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      const g = gig;
      title = g?.title ?? "";
      eventType = g?.event_type ?? "";
      status = "confirmed";
      clientName = g?.client?.name ?? "";
      clientPhone = g?.client?.phone ?? "";
      fee = g?.money.fee ? String(g.money.fee.amount_paise / 100) : "";
      collective = g?.collective?.name ?? "";
      tags = g?.tags.map((t) => t.name) ?? [];
      notes = g?.notes ?? "";
      events = g ? [] : [{ ...blankEvent(), date: date ?? todayIST() }];
      people = [];
      autofill = null;
      warnings = [];
      bookingsApi.tags().then(
        (all) => {
          collectiveSuggestions = all.filter((t) => t.kind === "collective").map((t) => t.name);
          tagSuggestions = all.filter((t) => t.kind === "custom").map((t) => t.name);
        },
        () => {},
      );
    });
  });

  // "Use the people from the last Monsoon Project gig?" (new gigs only).
  async function offerAutofill() {
    autofill = null;
    const name = collective.trim();
    if (editing || !name) return;
    try {
      const found = await bookingsApi.autofill(name);
      if (found.people.length) autofill = found;
    } catch {
      // Autofill is a convenience; ignore failures.
    }
  }
  function useAutofill() {
    if (!autofill) return;
    const have = new Set(people.map((p) => p.user_id ?? p.who.toLowerCase()));
    for (const p of autofill.people) {
      if (have.has(p.user_id ?? p.name.toLowerCase())) continue;
      people.push({ who: p.name, role: "player", user_id: p.user_id ?? undefined });
    }
    autofill = null;
  }

  // Duplicate warnings: someone I've played with already has a gig that day there.
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!open || editing) return;
    const checks = events
      .filter((e) => e.date && (e.venue.trim() || clientName.trim()))
      .map((e) => ({
        start_at: toApiLocal(e.date, e.start),
        venue_name: e.venue.trim(),
        client_name: clientName.trim(),
      }));
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const all = await Promise.all(checks.map((c) => bookingsApi.duplicates(c)));
        warnings = all.flat();
      } catch {
        warnings = [];
      }
    }, 500);
  });

  // Suggestions from my address book while typing a client, venue or person.
  const fromBook = (kind: ContactKind) => (text: string) =>
    bookingsApi.contacts({ kind, q: text || undefined, limit: 6 }).catch(() => [] as ContactView[]);
  const detailOf = (c: ContactView) => [c.phone, c.email, c.city].filter(Boolean).join(" · ") || null;
  function pickPerson(p: PersonRow, c: ContactView) {
    p.who = c.name;
    p.user_id = c.user_id ?? undefined;
    p.email = c.email ?? undefined;
    p.phone = c.phone ?? undefined;
  }

  function eventFields(e: EventRow): EventFields {
    const endDate = e.end && e.end < e.start ? nextDay(e.date) : e.date;
    return {
      title: e.title.trim() || null,
      start_at: toApiLocal(e.date, e.start),
      end_at: e.end ? toApiLocal(endDate, e.end) : null,
      venue_name: e.venue.trim() || null,
      venue_city: e.city.trim() || null,
    };
  }
  function personFields(p: PersonRow): PersonFields {
    const who = p.who.trim();
    if (p.user_id) return { user_id: p.user_id, role: p.role };
    const phone = p.phone ? { phone: p.phone } : {};
    if (p.email) return { email: p.email, name: who, role: p.role, ...phone };
    return who.includes("@") ? { email: who, role: p.role } : { name: who, role: p.role, ...phone };
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const details = {
        title: title.trim(),
        event_type: eventType || null,
        client: clientName.trim() ? { name: clientName.trim(), phone: clientPhone.trim() || null } : null,
        notes: notes.trim() || null,
        fee: fee.trim() || "0",
        collective: collective.trim() || null,
        tags,
      };
      if (gig) {
        const saved = await bookingsApi.update(gig.id, gig.version, details);
        toast.success("Gig updated");
        open = false;
        onsaved?.(saved);
      } else {
        const created = await bookingsApi.create({
          ...details,
          status,
          events: events.map(eventFields),
          people: people.filter((p) => p.who.trim()).map(personFields),
        });
        toast.success("Gig added");
        open = false;
        onsaved?.(created);
        navigate(`/gigs/${created.id}`);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={editing ? "Edit gig" : "New gig"}>
  <form id={formId} class="form" onsubmit={submit}>
    <TextField
      label="Title"
      id="{uid}-title"
      bind:value={title}
      placeholder="e.g. Sharma wedding"
      required
      maxlength={160}
    />
    {#if !editing}
      <Segmented
        label="Status"
        bind:value={status}
        options={[
          { value: "confirmed", label: "Confirmed" },
          { value: "enquiry", label: "Enquiry" },
        ]}
      />
    {/if}
    <div class="two">
      <SelectField
        label="Type"
        id="{uid}-type"
        bind:value={eventType}
        options={[
          { value: "", label: "—" },
          ...EVENT_TYPES.map((t) => ({ value: t.toLowerCase(), label: t })),
        ]}
      />
      <MoneyField label="Fee" bind:value={fee} />
    </div>

    <div class="field-group">
      <TextField
        label="Collective"
        id="{uid}-collective"
        bind:value={collective}
        list="{uid}-collectives"
        placeholder="e.g. Monsoon Project (optional)"
        maxlength={60}
        onchange={offerAutofill}
      />
      <datalist id="{uid}-collectives">
        {#each collectiveSuggestions as c (c)}<option value={c}></option>{/each}
      </datalist>
      {#if autofill}
        <div class="notice">
          <Users size={18} />
          <span
            >Use the {autofill.people.length}
            {autofill.people.length === 1 ? "person" : "people"} from “{autofill.from_gig?.title}”?</span
          >
          <Button size="sm" variant="tinted" onclick={useAutofill}>Add them</Button>
        </div>
      {/if}
    </div>
    <TagInput label="Tags" bind:value={tags} suggestions={tagSuggestions} />

    <div class="two">
      <SuggestField
        label="Client"
        id="{uid}-client"
        bind:value={clientName}
        placeholder="Name (optional)"
        maxlength={120}
        load={fromBook("client")}
        detail={detailOf}
        onpick={(c) => {
          if (c.phone) clientPhone = c.phone;
        }}
      />
      <TextField label="Client phone" id="{uid}-phone" type="tel" bind:value={clientPhone} maxlength={40} />
    </div>

    {#if !editing}
      <section class="block">
        <h3>{events.length > 1 ? "Events" : "When and where"}</h3>
        {#each events as ev, i (i)}
          <div class="event">
            {#if events.length > 1}
              <div class="event-head">
                <TextField
                  label="Event {i + 1}"
                  id="{uid}-ev{i}-title"
                  bind:value={ev.title}
                  placeholder="e.g. Sangeet"
                  maxlength={80}
                />
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Remove event {i + 1}"
                  onclick={() => events.splice(i, 1)}><X size={18} /></button
                >
              </div>
            {/if}
            <div class="three">
              <TextField label="Date" id="{uid}-ev{i}-date" type="date" bind:value={ev.date} required />
              <TextField label="Starts" id="{uid}-ev{i}-start" type="time" bind:value={ev.start} required />
              <TextField label="Ends" id="{uid}-ev{i}-end" type="time" bind:value={ev.end} hint="Optional" />
            </div>
            <div class="two">
              <SuggestField
                label="Venue"
                id="{uid}-ev{i}-venue"
                bind:value={ev.venue}
                maxlength={120}
                load={fromBook("venue")}
                detail={(c) => c.city}
                onpick={(c) => {
                  if (c.city) ev.city = c.city;
                }}
              />
              <TextField label="City" id="{uid}-ev{i}-city" bind:value={ev.city} maxlength={80} />
            </div>
          </div>
        {/each}
        {#if events.length < 20}
          <Button
            size="sm"
            variant="ghost"
            onclick={() => events.push({ ...blankEvent(), date: events.at(-1)?.date ?? todayIST() })}
          >
            {#snippet icon()}<Plus />{/snippet}
            Add another event
          </Button>
        {/if}
      </section>

      {#if warnings.length}
        <div class="warn" role="status">
          <TriangleAlert size={18} />
          <div>
            {#each warnings as w (w.message)}<p>{w.message}</p>{/each}
          </div>
        </div>
      {/if}

      <section class="block">
        <h3>People</h3>
        <p class="hint">
          You're added as a manager. Add others by email (they'll see it on their Home) or just a name.
        </p>
        {#each people as p, i (i)}
          <div class="person">
            <SuggestField
              label="Person {i + 1}"
              id="{uid}-p{i}"
              bind:value={p.who}
              placeholder="Email or name"
              maxlength={200}
              disabled={!!p.user_id || !!p.email || !!p.phone}
              hint={!p.user_id ? (p.email ?? p.phone) : undefined}
              load={fromBook("person")}
              detail={detailOf}
              onpick={(c) => pickPerson(p, c)}
            />
            <SelectField
              label="Role"
              id="{uid}-p{i}-role"
              bind:value={p.role}
              options={[
                { value: "player", label: "Player" },
                { value: "manager", label: "Manager" },
              ]}
            />
            <button
              type="button"
              class="icon-btn"
              aria-label="Remove person {i + 1}"
              onclick={() => people.splice(i, 1)}><X size={18} /></button
            >
          </div>
        {/each}
        <Button size="sm" variant="ghost" onclick={() => people.push({ who: "", role: "player" })}>
          {#snippet icon()}<Plus />{/snippet}
          Add a person
        </Button>
      </section>
    {/if}

    <TextArea label="Notes" id="{uid}-notes" bind:value={notes} rows={3} maxlength={4000} />
    {#if !editing && session.me}
      <p class="hint">
        Everyone on the gig sees its details. Players see only their own share unless you change that on the
        gig page.
      </p>
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}
      >{editing ? "Save" : "Add gig"}</Button
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
  .field-group {
    display: grid;
    gap: var(--space-2);
  }
  .block {
    display: grid;
    gap: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid var(--separator);
  }
  .block :global(.btn) {
    justify-self: start;
  }
  h3 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-md);
    font-weight: 700;
  }
  .event {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .event-head,
  .person {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--space-2);
  }
  .person {
    grid-template-columns: minmax(0, 1fr) minmax(0, 7.5rem) auto;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 48px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .hint {
    margin: 0;
    color: var(--text-3);
    font-size: var(--text-sm);
  }
  .notice,
  .warn {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--text-sm);
  }
  .notice span {
    flex: 1;
    min-width: 0;
  }
  .warn {
    align-items: flex-start;
    background: var(--amber-soft);
    color: var(--text);
  }
  .warn :global(svg) {
    flex-shrink: 0;
    color: var(--amber);
    margin-top: 2px;
  }
  .warn p {
    margin: 0;
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
