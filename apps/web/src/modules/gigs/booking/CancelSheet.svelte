<script lang="ts">
  import type { BookingView, PaymentMethod } from "@assistant/shared";
  import { Button, Segmented, Sheet, TextField, toast } from "../../../core/ui/index.ts";
  import Chips from "../Chips.svelte";
  import MoneyField from "../MoneyField.svelte";
  import { METHODS } from "../options.ts";
  import { bookingsApi } from "../gigs-api.ts";

  // Cancel a gig. If the client paid an advance, choose to keep it or refund some or all;
  // what's kept stays as the gig's income.
  let {
    open = $bindable(false),
    gig,
    onsaved,
  }: { open?: boolean; gig: BookingView; onsaved: (g: BookingView) => void } = $props();

  const uid = $props.id();
  const formId = `cancel-form-${uid}`;
  const paid = $derived(gig.money.received?.amount_paise ?? 0);
  let reason = $state("");
  let choice = $state<"keep" | "some" | "all">("keep");
  let amount = $state("");
  let method = $state<PaymentMethod>("upi");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    reason = "";
    choice = "keep";
    amount = "";
    method = "upi";
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const refund = choice === "all" ? String(paid / 100) : choice === "some" ? amount : undefined;
      const saved = await bookingsApi.setStatus(gig.id, "cancel", {
        reason: reason.trim() || undefined,
        ...(refund ? { refund, refund_method: method } : {}),
      });
      toast.success("Gig cancelled");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Cancel this gig?">
  <form id={formId} class="form" onsubmit={submit}>
    <p class="hint">It stays in everyone's history as cancelled.</p>
    <TextField label="Reason" id="{uid}-reason" bind:value={reason} placeholder="Optional" maxlength={500} />
    {#if paid > 0}
      <Segmented
        label="The advance"
        bind:value={choice}
        options={[
          { value: "keep", label: "Keep it" },
          { value: "some", label: "Refund some" },
          { value: "all", label: "Refund all" },
        ]}
      />
      <p class="hint">
        The client paid {gig.money.received?.amount_display}.
        {#if choice === "keep"}It's kept as this gig's income.{:else if choice === "all"}All of it goes back;
          the gig earns nothing.{:else}The rest is kept as income.{/if}
      </p>
      {#if choice === "some"}
        <MoneyField label="Refund" bind:value={amount} required />
      {/if}
      {#if choice !== "keep"}
        <Chips label="Refunded by" options={METHODS} bind:value={method} />
      {/if}
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Back</Button>
    <Button variant="danger" type="submit" form={formId} loading={busy}>Cancel gig</Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .hint {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
</style>
