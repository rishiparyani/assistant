<script lang="ts">
  import { untrack } from "svelte";
  import type { BookingView, GigGuestView } from "@assistant/shared";
  import { Button, Sheet, TextField, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import PlusOnes from "./PlusOnes.svelte";

  // Change one guest: name, plus-ones, note, (managers) arrived; or take them off the list.
  let {
    open = $bindable(false),
    gig,
    guest,
    onsaved,
  }: { open?: boolean; gig: BookingView; guest: GigGuestView; onsaved: (g: BookingView) => void } = $props();

  const uid = $props.id();
  const formId = `guest-form-${uid}`;
  const manager = $derived(gig.my_role === "manager");
  let name = $state("");
  let plusOnes = $state(0);
  let note = $state("");
  let arrived = $state(false);
  let busy = $state(false);

  // Filled once per opening: a live refresh mustn't wipe what's being typed.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = guest.name;
      plusOnes = guest.plus_ones;
      note = guest.note ?? "";
      arrived = guest.arrived;
    });
  });

  async function run(fn: () => Promise<BookingView>, done: string) {
    busy = true;
    try {
      const saved = await fn();
      toast.success(done);
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    void run(
      () =>
        bookingsApi.updateGuest(gig.id, guest.id, {
          name: name.trim(),
          plus_ones: plusOnes,
          note: note.trim() || null,
          ...(manager && arrived !== guest.arrived ? { arrived } : {}),
        }),
      "Saved",
    );
  }
</script>

<Sheet bind:open title="Guest">
  <form id={formId} class="form" onsubmit={submit}>
    {#if manager && !guest.is_mine}<p class="hint">Guest of {guest.host_name}</p>{/if}
    <TextField label="Name" id="{uid}-name" bind:value={name} required maxlength={80} />
    <div class="row">
      <span class="label">Plus-ones</span>
      <PlusOnes bind:value={plusOnes} label="Plus-ones for {name || 'this guest'}" />
    </div>
    <TextField
      label="Note"
      id="{uid}-note"
      bind:value={note}
      maxlength={120}
      placeholder="Optional, e.g. press, arrives late"
    />
    {#if manager}
      <label class="toggle">
        <span>Arrived</span>
        <input type="checkbox" role="switch" bind:checked={arrived} />
      </label>
    {/if}
  </form>
  {#snippet footer()}
    <Button
      variant="danger"
      disabled={busy}
      onclick={() => run(() => bookingsApi.removeGuest(gig.id, guest.id), "Taken off the list")}
      >Remove</Button
    >
    <Button variant="primary" type="submit" form={formId} loading={busy}>Save</Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .hint {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .row,
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 44px;
  }
  .label {
    font-weight: 500;
  }
  .toggle input {
    appearance: none;
    flex-shrink: 0;
    position: relative;
    width: 50px;
    height: 30px;
    border-radius: var(--radius-full);
    background: var(--grey-soft);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.2s;
  }
  .toggle input::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--shadow-sm);
    transition: transform 0.2s;
  }
  .toggle input:checked {
    background: var(--green);
    border-color: var(--green);
  }
  .toggle input:checked::after {
    transform: translateX(20px);
  }
</style>
