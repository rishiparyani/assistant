<script lang="ts">
  import type { BookingView } from "@assistant/shared";
  import { Button, SelectField, Sheet, TextField, toast } from "../../../core/ui/index.ts";
  import Chips from "../Chips.svelte";
  import MoneyField from "../MoneyField.svelte";
  import { EXPENSE_CATEGORIES } from "../options.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { todayIST } from "../time.ts";

  // Record an expense for the gig, or for one of its events (managers).
  let {
    open = $bindable(false),
    gig,
    onsaved,
  }: { open?: boolean; gig: BookingView; onsaved: (g: BookingView) => void } = $props();

  const uid = $props.id();
  const formId = `expense-form-${uid}`;
  let category = $state("Travel");
  let amount = $state("");
  let spentOn = $state(todayIST());
  let eventId = $state("");
  let note = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    category = "Travel";
    amount = "";
    spentOn = todayIST();
    eventId = "";
    note = "";
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const saved = await bookingsApi.recordExpense(gig.id, {
        category,
        amount,
        spent_on: spentOn,
        note: note.trim() || undefined,
        event_id: eventId || undefined,
      });
      toast.success("Expense added");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Add expense">
  <form id={formId} class="form" onsubmit={submit}>
    <Chips
      label="Category"
      options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
      bind:value={category}
    />
    <MoneyField label="Amount" bind:value={amount} required />
    <TextField label="Date" id="{uid}-date" type="date" bind:value={spentOn} required />
    {#if gig.events.length > 1}
      <SelectField
        label="For"
        id="{uid}-event"
        bind:value={eventId}
        options={[
          { value: "", label: "The whole gig" },
          ...gig.events.map((e, i) => ({ value: e.id, label: e.title ?? `Event ${i + 1}` })),
        ]}
      />
    {/if}
    <TextField label="Note" id="{uid}-note" bind:value={note} placeholder="Optional" maxlength={500} />
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}>Add expense</Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
</style>
