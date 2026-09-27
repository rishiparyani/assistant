<script lang="ts">
  import type { GigMoneyView, MusicianView } from "@assistant/shared";
  import { formatINR, parseINR, splitEqual, splitPercent } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import { Avatar, Button, Segmented, Sheet, Skeleton, TextField, toast } from "../../core/ui/index.ts";
  import { gigsApi, type LineupEntryInput } from "./api.ts";

  // Who plays and each person's share. Replaces the whole lineup on save.
  let {
    open = $bindable(false),
    workspaceId,
    money,
    onsaved,
  }: {
    open?: boolean;
    workspaceId: string;
    money: GigMoneyView;
    onsaved: (m: GigMoneyView) => void;
  } = $props();

  const api = $derived(gigsApi(workspaceId));
  type Mode = "equal" | "percent" | "amount";
  type Entry = { role: string; share: string; percent: string };

  let roster = $state<MusicianView[] | null>(null);
  let chosen = $state<Record<string, Entry>>({});
  let order = $state<string[]>([]);
  let mode = $state<Mode>("equal");
  let busy = $state(false);
  let newName = $state("");

  $effect(() => {
    if (!open) return;
    roster = null;
    api.findMusicians({ limit: 100 }).then(
      (p) => (roster = p.items),
      (e) => {
        toast.error(e);
        roster = [];
      },
    );
    chosen = Object.fromEntries(
      money.lineup.map((l) => [
        l.musician.id,
        { role: l.role ?? "", share: String(l.share.amount_paise / 100), percent: "" },
      ]),
    );
    order = money.lineup.map((l) => l.musician.id);
    mode = money.lineup.length ? "amount" : "equal";
  });

  function toggle(m: MusicianView) {
    if (chosen[m.id]) {
      delete chosen[m.id];
      order = order.filter((id) => id !== m.id);
    } else {
      chosen[m.id] = { role: m.instrument ?? "", share: "", percent: "" };
      order = [...order, m.id];
    }
  }

  const fee = $derived(money.fee.amount_paise);

  // Live preview of each share in paise (null = not valid yet).
  const preview = $derived.by((): (number | null)[] => {
    try {
      if (mode === "equal") return order.length ? splitEqual(fee, order.length) : [];
      if (mode === "percent") {
        const pct = order.map((id) => Number(chosen[id]?.percent || 0));
        return splitPercent(fee, pct);
      }
      return order.map((id) => {
        try {
          return chosen[id]?.share ? parseINR(chosen[id]!.share) : null;
        } catch {
          return null;
        }
      });
    } catch {
      return order.map(() => null);
    }
  });
  const allocated = $derived(preview.reduce<number>((s, v) => s + (v ?? 0), 0));

  async function addToRoster(e: SubmitEvent) {
    e.preventDefault();
    try {
      const m = await api.createMusician({ name: newName.trim() });
      roster = [...(roster ?? []), m];
      newName = "";
      toggle(m);
    } catch (err) {
      toast.error(err);
    }
  }

  async function save() {
    busy = true;
    try {
      const lineup: LineupEntryInput[] = order.map((id) => {
        const e = chosen[id]!;
        const base = { musician_id: id, role: e.role.trim() || null };
        if (mode === "percent") return { ...base, percent: Number(e.percent || 0) };
        if (mode === "amount") return { ...base, share: e.share || "0" };
        return base;
      });
      const saved = await api.setLineup(money.gig.id, {
        lineup,
        ...(mode === "equal" ? { split: "equal" as const } : {}),
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

<Sheet bind:open title="Lineup and shares">
  <Segmented
    label="How to split"
    bind:value={mode}
    options={[
      { value: "equal", label: "Equal" },
      { value: "percent", label: "Percent" },
      { value: "amount", label: "Amount" },
    ]}
  />
  <p class="hint">
    {#if mode === "equal"}The fee ({money.fee.amount_display}) is divided equally; any leftover paise go to
      the first person.{:else if mode === "percent"}Percentages of the fee ({money.fee.amount_display}). Under
      100% leaves the rest with the collective.{:else}Fixed amounts. Whatever isn't shared stays with the
      collective.{/if}
  </p>

  {#if roster === null}
    <Skeleton rows={3} />
  {:else}
    <div class="people">
      {#each roster as m (m.id)}
        {@const on = !!chosen[m.id]}
        {@const i = order.indexOf(m.id)}
        <div class="person" class:on>
          <button class="pick" type="button" aria-pressed={on} onclick={() => toggle(m)}>
            <span class="box" aria-hidden="true">{on ? "✓" : ""}</span>
            <Avatar name={m.name} size={32} />
            <span class="name"
              >{m.name}{#if m.instrument}<span class="inst"> · {m.instrument}</span>{/if}</span
            >
            {#if on && preview[i] !== null && preview[i] !== undefined}<span class="amt num"
                >{formatINR(preview[i]!)}</span
              >{/if}
          </button>
          {#if on && mode !== "equal"}
            <div class="inputs">
              {#if mode === "percent"}
                <TextField
                  label="Percent"
                  id="pct-{m.id}"
                  inputmode="decimal"
                  bind:value={chosen[m.id]!.percent}
                  placeholder="e.g. 25"
                />
              {:else}
                <TextField
                  label="Share"
                  id="share-{m.id}"
                  prefix="₹"
                  inputmode="decimal"
                  bind:value={chosen[m.id]!.share}
                  placeholder="0"
                />
              {/if}
              <TextField
                label="Role"
                id="role-{m.id}"
                bind:value={chosen[m.id]!.role}
                placeholder="e.g. drums, dep"
              />
            </div>
          {/if}
        </div>
      {:else}
        <p class="hint">Your roster is empty. Add people below.</p>
      {/each}
    </div>
    <form class="add" onsubmit={addToRoster}>
      <input
        placeholder="Add someone to the roster"
        bind:value={newName}
        aria-label="New musician's name"
        required
      />
      <Button type="submit" size="sm">{#snippet icon()}<Plus />{/snippet}Add</Button>
    </form>
  {/if}

  <div class="totals">
    <span>Shared <strong class="num">{formatINR(allocated)}</strong> of {money.fee.amount_display}</span>
    <span class:neg={fee - allocated < 0}
      >Collective keeps <strong class="num">{formatINR(fee - allocated)}</strong></span
    >
  </div>

  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" onclick={save} loading={busy}>Save lineup</Button>
  {/snippet}
</Sheet>

<style>
  .hint {
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
  .add {
    display: flex;
    gap: var(--space-2);
  }
  .add input {
    flex: 1;
    min-width: 0;
    height: 40px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
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
  .neg strong {
    color: var(--red);
  }
</style>
