<script lang="ts">
  import type { BookingEventView, BookingView } from "@assistant/shared";
  import { formatINR, parseINR, splitEqual, splitPercent } from "@assistant/shared";
  import { untrack } from "svelte";
  import Plus from "@lucide/svelte/icons/plus";
  import { Avatar, Button, Segmented, Sheet, TextField, toast } from "../../../core/ui/index.ts";
  import MoneyField from "../MoneyField.svelte";
  import { bookingsApi, type LineupFields } from "../gigs-api.ts";

  // Who plays one event, their part and share. Replaces the event's lineup on save.
  let {
    open = $bindable(false),
    gig,
    event,
    onsaved,
  }: {
    open?: boolean;
    gig: BookingView;
    event: BookingEventView;
    onsaved: (g: BookingView) => void;
  } = $props();

  type Mode = "equal" | "percent" | "amount";
  type Entry = { part: string; share: string; percent: string };

  let chosen = $state<Record<string, Entry>>({});
  let order = $state<string[]>([]);
  let mode = $state<Mode>("equal");
  let total = $state("");
  let busy = $state(false);

  // Set up once per opening (the gig changes while open when someone is added).
  // The version this sheet was opened on: saving checks it, so a change someone else made
  // meanwhile is reported instead of silently overwritten (live refreshes update `gig`).
  let openedVersion = 0;
  $effect(() => {
    if (!open) return;
    untrack(setUp);
  });
  function setUp() {
    openedVersion = gig?.version ?? 0;
    chosen = Object.fromEntries(
      event.lineup.map((l) => [
        l.person_id,
        { part: l.part ?? "", share: String((l.share?.amount_paise ?? 0) / 100), percent: "" },
      ]),
    );
    order = event.lineup.map((l) => l.person_id);
    mode = event.lineup.length ? "amount" : "equal";
    // Split the fee across events by default.
    const fee = gig.money.fee?.amount_paise ?? 0;
    total = fee ? String(Math.floor(fee / gig.events.length) / 100) : "";
  }

  function toggle(id: string) {
    if (chosen[id]) {
      delete chosen[id];
      order = order.filter((x) => x !== id);
    } else {
      chosen[id] = { part: "", share: "", percent: "" };
      order = [...order, id];
    }
  }

  const totalPaise = $derived.by(() => {
    try {
      return total.trim() ? parseINR(total) : 0;
    } catch {
      return 0;
    }
  });

  // Live preview of each share in paise (null = not valid yet).
  const preview = $derived.by((): (number | null)[] => {
    try {
      if (mode === "equal") return order.length ? splitEqual(totalPaise, order.length) : [];
      if (mode === "percent")
        return splitPercent(
          totalPaise,
          order.map((id) => Number(chosen[id]?.percent || 0)),
        );
      return order.map((id) => {
        try {
          return chosen[id]?.share ? parseINR(chosen[id]!.share) : 0;
        } catch {
          return null;
        }
      });
    } catch {
      return order.map(() => null);
    }
  });
  const allocated = $derived(preview.reduce<number>((s, v) => s + (v ?? 0), 0));
  const eventName = $derived(event.title ?? (gig.events.length > 1 ? "this event" : "the gig"));

  // Add someone to the gig right here, and put them on this lineup.
  let newPerson = $state("");
  let adding = $state(false);
  async function addPerson(e: SubmitEvent) {
    e.preventDefault();
    const who = newPerson.trim();
    if (!who) return;
    adding = true;
    try {
      const before = new Set(gig.people.map((p) => p.id));
      const updated = await bookingsApi.addPerson(
        gig.id,
        who.includes("@") ? { email: who, role: "player" } : { name: who, role: "player" },
      );
      // My own addition moved the version on by one; anyone else's change still counts.
      if (updated.version === openedVersion + 1) openedVersion = updated.version;
      onsaved(updated);
      const added = updated.people.find((p) => !before.has(p.id));
      if (added && !chosen[added.id]) {
        chosen[added.id] = { part: "", share: "", percent: "" };
        order = [...order, added.id];
      }
      newPerson = "";
    } catch (err) {
      toast.error(err);
    } finally {
      adding = false;
    }
  }

  async function save() {
    busy = true;
    try {
      const lineup: LineupFields[] = order.map((id) => {
        const e = chosen[id]!;
        const base = { person_id: id, part: e.part.trim() || null };
        if (mode === "percent") return { ...base, percent: Number(e.percent || 0) };
        if (mode === "amount") return { ...base, share: e.share || "0" };
        return base;
      });
      const saved = await bookingsApi.setLineup(gig.id, event.id, openedVersion, lineup, {
        equal: mode === "equal",
        total: mode === "amount" ? undefined : total || "0",
      });
      toast.success("Lineup saved");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Who plays {eventName}">
  <Segmented
    label="How to split"
    bind:value={mode}
    options={[
      { value: "equal", label: "Equal" },
      { value: "percent", label: "Percent" },
      { value: "amount", label: "Amount" },
    ]}
  />
  {#if mode !== "amount"}
    <MoneyField
      label="Amount to share"
      bind:value={total}
      hint="Defaults to the fee divided by the number of events."
    />
  {/if}

  <div class="people">
    {#each gig.people as p (p.id)}
      {@const on = !!chosen[p.id]}
      {@const i = order.indexOf(p.id)}
      <div class="person" class:on>
        <button class="pick" type="button" aria-pressed={on} onclick={() => toggle(p.id)}>
          <span class="box" aria-hidden="true">{on ? "✓" : ""}</span>
          <Avatar name={p.name} size={32} />
          <span class="name"
            >{p.name}{#if p.is_me}<span class="inst"> (you)</span>{/if}</span
          >
          {#if on && preview[i] !== null && preview[i] !== undefined}<span class="amt num"
              >{formatINR(preview[i]!)}</span
            >{/if}
        </button>
        {#if on}
          <div class="inputs" class:single={mode === "equal"}>
            {#if mode === "percent"}
              <TextField
                label="Percent"
                id="pct-{p.id}"
                inputmode="decimal"
                bind:value={chosen[p.id]!.percent}
                placeholder="e.g. 25"
              />
            {:else if mode === "amount"}
              <TextField
                label="Share"
                id="share-{p.id}"
                prefix="₹"
                inputmode="decimal"
                bind:value={chosen[p.id]!.share}
                placeholder="0"
              />
            {/if}
            <TextField
              label="Part"
              id="part-{p.id}"
              bind:value={chosen[p.id]!.part}
              placeholder="e.g. drums, keys"
              maxlength={60}
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <form class="add" onsubmit={addPerson}>
    <input
      bind:value={newPerson}
      placeholder="Add someone: email or name"
      aria-label="Add someone to this gig"
      maxlength={200}
    />
    <Button type="submit" size="sm" loading={adding}>{#snippet icon()}<Plus />{/snippet}Add</Button>
  </form>
  <p class="hint">With an email, they'll see this gig when they sign in. Added as a player.</p>

  <div class="totals">
    <span>Shared <strong class="num">{formatINR(allocated)}</strong></span>
    {#if gig.money.fee}<span>Fee {gig.money.fee.amount_display}</span>{/if}
  </div>

  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" onclick={save} loading={busy}>Save lineup</Button>
  {/snippet}
</Sheet>

<style>
  .hint {
    margin: 0;
    color: var(--text-3);
    font-size: var(--text-sm);
  }
  .people {
    display: grid;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .person + .person {
    border-top: 1px solid var(--separator);
  }
  .person.on {
    background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface));
  }
  .pick {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: 8px var(--space-4);
    border: 0;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .box {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    border: 2px solid var(--border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 800;
    color: var(--text-on-accent);
    flex-shrink: 0;
  }
  .on .box {
    background: var(--accent);
    border-color: var(--accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inst {
    color: var(--text-3);
    font-weight: 400;
  }
  .amt {
    font-weight: 650;
  }
  .inputs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-3) calc(var(--space-4) + 22px + var(--space-3));
  }
  .inputs.single {
    grid-template-columns: 1fr;
  }
  .add {
    display: flex;
    gap: var(--space-2);
  }
  .add input {
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 16px;
  }
  .totals {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: var(--text-sm);
    color: var(--text-2);
  }
  .totals strong {
    color: var(--text);
  }
</style>
