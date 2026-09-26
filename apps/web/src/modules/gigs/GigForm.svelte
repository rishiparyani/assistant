<script lang="ts">
  import type { ClientView, GigView, VenueView } from "@assistant/shared";
  import {
    Avatar,
    Button,
    Picker,
    PickerField,
    Segmented,
    Sheet,
    TextArea,
    TextField,
    toast,
  } from "../../core/ui/index.ts";
  import { gigsApi, type GigInput } from "./api.ts";
  import MoneyField from "./MoneyField.svelte";
  import { EVENT_TYPES } from "./options.ts";
  import { nextDay, timeIST, toApiLocal, todayIST } from "./time.ts";

  // Add or edit a gig. `gig` set = edit mode.
  let {
    open = $bindable(false),
    workspaceId,
    gig = null,
    onsaved,
  }: { open?: boolean; workspaceId: string; gig?: GigView | null; onsaved: (g: GigView) => void } = $props();

  const api = $derived(gigsApi(workspaceId));

  let title = $state("");
  let date = $state(todayIST());
  let start = $state("19:00");
  let end = $state("");
  let fee = $state("");
  let eventType = $state("");
  let status = $state<"enquiry" | "confirmed">("enquiry");
  let notes = $state("");
  let client = $state<{ id: string; name: string } | null>(null);
  let venue = $state<{ id: string; name: string } | null>(null);
  let busy = $state(false);
  let clientPicker = $state(false);
  let venuePicker = $state(false);

  // Fill the form each time it opens.
  $effect(() => {
    if (!open) return;
    title = gig?.title ?? "";
    date = gig ? gig.date : todayIST();
    start = gig ? timeIST(gig.start_at) : "19:00";
    end = gig?.end_at ? timeIST(gig.end_at) : "";
    fee = gig ? String(gig.fee.amount_paise / 100) : "";
    eventType = gig?.event_type ?? "";
    notes = gig?.notes ?? "";
    client = gig?.client ?? null;
    venue = gig?.venue ?? null;
    status = "enquiry";
  });

  // An end time earlier than the start means the gig runs past midnight.
  function endValue(): string | null {
    if (!end) return null;
    return toApiLocal(end <= start ? nextDay(date) : date, end);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const input: GigInput = {
        title,
        start_at: toApiLocal(date, start),
        end_at: endValue(),
        fee: fee.trim() || "0",
        event_type: eventType || null,
        client_id: client?.id ?? null,
        venue_id: venue?.id ?? null,
        notes: notes.trim() || null,
      };
      const saved = gig ? await api.updateGig(gig.id, input) : await api.createGig({ ...input, status });
      toast.success(gig ? "Gig updated" : "Gig added");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  const loadClients = (q: string) => api.findClients({ q, limit: 50 }).then((p) => p.items);
  const loadVenues = (q: string) => api.findVenues({ q, limit: 50 }).then((p) => p.items);

  async function newClient(name: string) {
    try {
      client = await api.createClient({ name });
      toast.success(`Client “${name}” added`);
    } catch (err) {
      toast.error(err);
    }
  }
  async function newVenue(name: string) {
    try {
      venue = await api.createVenue({ name });
      toast.success(`Venue “${name}” added`);
    } catch (err) {
      toast.error(err);
    }
  }
  const uid = $props.id();
  const formId = `gig-form-${uid}`;
</script>

<Sheet bind:open title={gig ? "Edit gig" : "New gig"}>
  <form id={formId} class="form" onsubmit={save}>
    <TextField
      label="Title"
      bind:value={title}
      placeholder="e.g. Sharma–Kapoor Sangeet"
      required
      maxlength={160}
    />
    <div class="when">
      <TextField label="Date" type="date" bind:value={date} required />
      <div class="times">
        <TextField label="Starts" type="time" bind:value={start} required />
        <TextField
          label="Ends"
          type="time"
          bind:value={end}
          hint={end && end <= start ? "Next day" : undefined}
        />
      </div>
    </div>
    <MoneyField
      label="Fee"
      bind:value={fee}
      hint="The total the client pays. Leave empty if not agreed yet."
    />
    <PickerField
      label="Client"
      value={client?.name}
      placeholder="Choose or add a client"
      onopen={() => (clientPicker = true)}
      onclear={() => (client = null)}
    />
    <PickerField
      label="Venue"
      value={venue?.name}
      placeholder="Choose or add a venue"
      onopen={() => (venuePicker = true)}
      onclear={() => (venue = null)}
    />
    <div class="types" role="group" aria-label="Event type">
      <span class="label">Event type</span>
      <div class="chips">
        {#each EVENT_TYPES as t (t)}
          <button
            type="button"
            class:active={eventType === t.toLowerCase()}
            aria-pressed={eventType === t.toLowerCase()}
            onclick={() => (eventType = eventType === t.toLowerCase() ? "" : t.toLowerCase())}>{t}</button
          >
        {/each}
      </div>
    </div>
    {#if !gig}
      <div class="types">
        <span class="label">Status</span>
        <Segmented
          label="Status"
          bind:value={status}
          options={[
            { value: "enquiry", label: "Enquiry" },
            { value: "confirmed", label: "Confirmed" },
          ]}
        />
      </div>
    {/if}
    <TextArea
      label="Notes"
      bind:value={notes}
      placeholder="Set timings, contact on the day, song requests…"
    />
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}>{gig ? "Save" : "Add gig"}</Button>
  {/snippet}
</Sheet>

<Picker
  bind:open={clientPicker}
  title="Client"
  load={loadClients}
  selectedId={client?.id}
  onpick={(c: ClientView) => (client = c)}
  oncreate={newClient}
  createLabel="Add client"
  subtitle={(c: ClientView) => c.organisation ?? c.phone ?? undefined}
>
  {#snippet row(c)}<Avatar name={c.name} size={32} />{/snippet}
</Picker>
<Picker
  bind:open={venuePicker}
  title="Venue"
  load={loadVenues}
  selectedId={venue?.id}
  onpick={(v: VenueView) => (venue = v)}
  oncreate={newVenue}
  createLabel="Add venue"
  subtitle={(v: VenueView) => v.city ?? undefined}
>
  {#snippet row(v)}<Avatar name={v.name} size={32} square />{/snippet}
</Picker>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
  }
  .when {
    display: grid;
    gap: var(--space-4);
  }
  .times {
    display: grid;
    align-items: start;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }
  @media (min-width: 768px) {
    .when {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr);
      gap: var(--space-2);
    }
  }
  .types {
    display: grid;
    gap: 6px;
  }
  .label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chips button {
    min-height: 34px;
    padding: 0 12px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    font-weight: 600;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .chips button.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-text);
  }
</style>
