<script lang="ts">
  import type { PaymentMethod } from "@assistant/shared";
  import { Button, Sheet, TextField, toast } from "../../core/ui/index.ts";
  import Chips from "./Chips.svelte";
  import MoneyField from "./MoneyField.svelte";
  import { METHODS } from "./options.ts";
  import { todayIST } from "./time.ts";

  // Shared by "Record payment" (client → collective) and "Record payout" (collective → musician).
  let {
    open = $bindable(false),
    title,
    amountLabel = "Amount",
    suggested,
    submitLabel,
    onsubmit,
  }: {
    open?: boolean;
    title: string;
    amountLabel?: string;
    suggested?: number;
    submitLabel: string;
    onsubmit: (v: { amount: string; paid_on: string; method: PaymentMethod; note?: string }) => Promise<void>;
  } = $props();

  let amount = $state("");
  let paidOn = $state(todayIST());
  let method = $state<PaymentMethod>("upi");
  let note = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    amount = suggested && suggested > 0 ? String(suggested / 100) : "";
    paidOn = todayIST();
    method = "upi";
    note = "";
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      await onsubmit({ amount, paid_on: paidOn, method, note: note.trim() || undefined });
      open = false;
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
  const uid = $props.id();
  const formId = `pay-form-${uid}`;
</script>

<Sheet bind:open {title}>
  <form id={formId} class="form" onsubmit={submit}>
    <MoneyField label={amountLabel} bind:value={amount} required />
    <Chips label="Method" options={METHODS} bind:value={method} />
    <TextField label="Date" type="date" bind:value={paidOn} required />
    <TextField label="Note" bind:value={note} placeholder="Optional, e.g. advance, UPI ref" maxlength={500} />
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}>{submitLabel}</Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
  }
</style>
