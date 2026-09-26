<script lang="ts">
  import { Button, Sheet, TextField, toast } from "../../core/ui/index.ts";
  import MoneyField from "./MoneyField.svelte";
  import { EXPENSE_CATEGORIES } from "./options.ts";
  import { todayIST } from "./time.ts";

  let {
    open = $bindable(false),
    onsubmit,
  }: {
    open?: boolean;
    onsubmit: (v: { category: string; amount: string; spent_on: string; note?: string }) => Promise<void>;
  } = $props();

  let category = $state("travel");
  let amount = $state("");
  let spentOn = $state(todayIST());
  let note = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    category = "travel";
    amount = "";
    spentOn = todayIST();
    note = "";
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      await onsubmit({ category, amount, spent_on: spentOn, note: note.trim() || undefined });
      open = false;
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
  const uid = $props.id();
  const formId = `expense-form-${uid}`;
</script>

<Sheet bind:open title="Add expense">
  <form id={formId} class="form" onsubmit={submit}>
    <div class="field">
      <span class="label">Category</span>
      <div class="chips">
        {#each EXPENSE_CATEGORIES as c (c)}
          <button
            type="button"
            class:active={category === c.toLowerCase()}
            aria-pressed={category === c.toLowerCase()}
            onclick={() => (category = c.toLowerCase())}>{c}</button
          >
        {/each}
      </div>
    </div>
    <MoneyField label="Amount" bind:value={amount} required />
    <TextField label="Date" type="date" bind:value={spentOn} required />
    <TextField label="Note" bind:value={note} placeholder="Optional, e.g. cab to venue" maxlength={500} />
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}>Add expense</Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
  }
  .field {
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
