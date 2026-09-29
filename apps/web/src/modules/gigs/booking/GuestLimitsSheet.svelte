<script lang="ts">
  import { untrack } from "svelte";
  import { isoDateIST, type BookingView } from "@assistant/shared";
  import { Button, Sheet, TextField, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { timeIST, toApiLocal } from "../time.ts";

  // Guest list limits (total, per person) and when it closes for players (managers).
  let {
    open = $bindable(false),
    gig,
    onsaved,
  }: { open?: boolean; gig: BookingView; onsaved: (g: BookingView) => void } = $props();

  const uid = $props.id();
  const formId = `guest-limits-${uid}`;
  let total = $state("");
  let perPerson = $state("");
  let closeDate = $state("");
  let closeTime = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      const l = gig.guest_list;
      total = l.total_limit ? String(l.total_limit) : "";
      perPerson = l.per_person_limit ? String(l.per_person_limit) : "";
      closeDate = l.closes_at ? isoDateIST(l.closes_at) : "";
      closeTime = l.closes_at ? timeIST(l.closes_at) : "";
    });
  });

  const firstStart = $derived(gig.events[0]?.start_at ?? null);
  function closeAtStart() {
    if (!firstStart) return;
    closeDate = isoDateIST(firstStart);
    closeTime = timeIST(firstStart);
  }

  // Text fields with a number keypad (number inputs would hand back numbers).
  const limit = (v: string) => {
    const n = Math.floor(Number(v.trim()));
    return v.trim() && Number.isFinite(n) ? Math.min(5000, Math.max(1, n)) : null;
  };

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const saved = await bookingsApi.setGuestList(gig.id, {
        total_limit: limit(total),
        per_person_limit: limit(perPerson),
        closes_at: closeDate ? toApiLocal(closeDate, closeTime || "23:59") : null,
      });
      toast.success("Guest list saved");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Guest list limits">
  <form id={formId} class="form" onsubmit={submit}>
    <p class="hint">Each guest counts as one, plus their plus-ones. Leave a box empty for no limit.</p>
    <div class="two">
      <TextField
        label="Total"
        id="{uid}-total"
        inputmode="numeric"
        pattern="[0-9]*"
        bind:value={total}
        placeholder="No limit"
      />
      <TextField
        label="Per person"
        id="{uid}-each"
        inputmode="numeric"
        pattern="[0-9]*"
        bind:value={perPerson}
        placeholder="No limit"
      />
    </div>
    <div class="two">
      <TextField label="Closes on" id="{uid}-date" type="date" bind:value={closeDate} />
      <TextField label="At" id="{uid}-time" type="time" bind:value={closeTime} />
    </div>
    <div class="quick">
      {#if firstStart}<Button size="sm" onclick={closeAtStart}>When the gig starts</Button>{/if}
      {#if closeDate}<Button size="sm" variant="ghost" onclick={() => ((closeDate = ""), (closeTime = ""))}
          >Keep open</Button
        >{/if}
    </div>
    <p class="hint">After it closes, only managers can change the list. India time.</p>
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}>Save</Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .hint {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
</style>
