<script lang="ts">
  import type { BookingView } from "@assistant/shared";
  import { formatDateIST } from "@assistant/shared";
  import { Button, Sheet, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { timeRange } from "../time.ts";

  // Confirming an enquiry with date options: which date(s) did the client pick? The others
  // are released (docs/design/holds.md).
  let {
    open = $bindable(false),
    gig,
    onsaved,
  }: { open?: boolean; gig: BookingView; onsaved: (g: BookingView) => void } = $props();

  const holds = $derived(gig.events.filter((e) => e.hold));
  let picked = $state<Record<string, boolean>>({});
  let busy = $state(false);
  $effect(() => {
    if (open) picked = {};
  });
  const chosen = $derived(holds.filter((e) => picked[e.id]).map((e) => e.id));
  // A gig with a fixed date as well can be confirmed with no option picked (all released).
  const hasFixed = $derived(gig.events.some((e) => e.kind === "show" && !e.hold));

  async function confirm() {
    busy = true;
    try {
      onsaved(await bookingsApi.setStatus(gig.id, "confirm", { keep_event_ids: chosen }));
      toast.success("Gig confirmed");
      open = false;
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Which date did they pick?">
  <div class="picks" role="group" aria-label="Date options">
    {#each holds as e (e.id)}
      <label class="pick" class:on={picked[e.id]}>
        <input type="checkbox" bind:checked={picked[e.id]} />
        <span class="text">
          <span class="day">{formatDateIST(e.start_at)}</span>
          <span class="muted"
            >{timeRange(e.start_at, e.end_at)}{e.venue_name ? ` · ${e.venue_name}` : ""}</span
          >
        </span>
      </label>
    {/each}
  </div>
  <p class="hint">
    {chosen.length && chosen.length < holds.length
      ? `The other ${holds.length - chosen.length === 1 ? "date is" : `${holds.length - chosen.length} dates are`} released.`
      : !chosen.length && hasFixed
        ? "None picked: the gig keeps its fixed date and these options are released."
        : "Pick one (or more, if they booked several days)."}
  </p>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" loading={busy} disabled={!chosen.length && !hasFixed} onclick={confirm}
      >Confirm gig</Button
    >
  {/snippet}
</Sheet>

<style>
  .picks {
    display: grid;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 56px;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
  }
  .pick + .pick {
    border-top: 1px solid var(--separator);
  }
  .pick.on {
    background: var(--accent-soft);
  }
  .pick input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  .text {
    display: grid;
    gap: 2px;
  }
  .day {
    font-weight: 600;
  }
  .muted {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .hint {
    margin: var(--space-3) 0 0;
    color: var(--text-3);
    font-size: var(--text-sm);
  }
</style>
