<script lang="ts">
  import { formatDateTimeIST, type BookingView, type GigGuestView } from "@assistant/shared";
  import Users from "@lucide/svelte/icons/users";
  import Share from "@lucide/svelte/icons/share-2";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import { Button, EmptyState, Pill, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { outbox } from "../../../core/outbox.svelte.ts";
  import PlusOnes from "./PlusOnes.svelte";
  import { parseGuest, parseGuests } from "./guest-parse.ts";
  import GuestSheet from "./GuestSheet.svelte";
  import GuestLimitsSheet from "./GuestLimitsSheet.svelte";
  import GuestShareSheet from "./GuestShareSheet.svelte";

  // A gig's guest list. Everyone adds their own guests until it closes; managers see all,
  // set limits and share it with the venue. Each guest counts as 1 + plus-ones.
  let {
    gig,
    onsaved,
    adding: startAdding = false,
  }: {
    gig: BookingView;
    onsaved: (g: BookingView) => void;
    /** Opened from the gig page's Add menu: start with the name box ready. */
    adding?: boolean;
  } = $props();
  $effect(() => {
    if (startAdding) document.getElementById(`${uid}-name`)?.focus();
  });

  const uid = $props.id();
  const list = $derived(gig.guest_list);
  const manager = $derived(gig.my_role === "manager");
  const me = $derived(gig.people.find((p) => p.is_me));
  let name = $state("");
  let plusOnes = $state(0);
  let hostId = $state("");
  let adding = $state(false);
  let guestOpen = $state(false);
  let guestFor = $state<GigGuestView | null>(null);
  let limitsOpen = $state(false);
  let shareOpen = $state(false);

  const heads = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const hostOptions = $derived(
    gig.people.map((p) => ({ id: p.id, name: p.is_me ? `${p.name} (you)` : p.name })),
  );

  // Managers see guests grouped by whose guests they are (mine first).
  const groups = $derived.by(() => {
    const out: { id: string; host: string; mine: boolean; guests: GigGuestView[] }[] = [];
    for (const g of list.guests) {
      let grp = out.find((x) => x.id === g.host_person_id);
      if (!grp) out.push((grp = { id: g.host_person_id, host: g.host_name, mine: g.is_mine, guests: [] }));
      grp.guests.push(g);
    }
    return out.sort((a, b) => Number(b.mine) - Number(a.mine) || a.host.localeCompare(b.host));
  });

  const closes = $derived(list.closes_at ? formatDateTimeIST(list.closes_at).replace(/ IST$/, "") : null);
  const closed = $derived(!!list.closes_at && Date.parse(list.closes_at) <= Date.now());

  async function save(guests: { name: string; plus_ones: number }[]) {
    // Cleared at once so the next guest can be typed; given back if the server says no.
    const typed = { name, plusOnes };
    name = "";
    plusOnes = 0;
    adding = true;
    try {
      onsaved(
        await bookingsApi.addGuests(
          gig.id,
          guests,
          manager && hostId && hostId !== me?.id ? hostId : undefined,
        ),
      );
      if (guests.length > 1) toast.success(`Added ${guests.length} guests`);
    } catch (err) {
      if (!name) ({ name, plusOnes } = typed);
      toast.error(err);
    } finally {
      adding = false;
    }
  }

  // "Rahul +2" typed in the box sets the plus-ones too (the stepper is used otherwise).
  function add(e: SubmitEvent) {
    e.preventDefault();
    const g = parseGuest(name);
    if (!g) return;
    void save([{ name: g.name, plus_ones: g.plus_ones || plusOnes }]);
  }

  // Pasting several lines (e.g. a list from WhatsApp) adds them all at once.
  function paste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!text.includes("\n")) return;
    const guests = parseGuests(text);
    if (guests.length < 2) return;
    e.preventDefault();
    void save(guests);
  }

  async function arrive(g: GigGuestView) {
    try {
      onsaved(await bookingsApi.updateGuest(gig.id, g.id, { arrived: !g.arrived }));
    } catch (err) {
      toast.error(err);
    }
  }

  const openGuest = (g: GigGuestView) => {
    if (!manager && !list.open) return;
    guestFor = g;
    guestOpen = true;
  };
</script>

<div class="guests">
  <section class="summary" aria-label="Guest list summary">
    <div class="counts">
      <div>
        <span class="big num">{list.heads}</span>
        <span class="of"
          >{list.total_limit ? `of ${list.total_limit} places` : heads(list.heads).split(" ")[1]}</span
        >
      </div>
      {#if !manager || list.per_person_limit}
        <div class="mine">
          <span class="label">Yours</span>
          <span class="num">{list.my_heads}{list.per_person_limit ? ` of ${list.per_person_limit}` : ""}</span
          >
        </div>
      {/if}
      {#if list.arrived_heads}
        <div class="mine">
          <span class="label">Arrived</span>
          <span class="num">{list.arrived_heads}</span>
        </div>
      {/if}
    </div>
    {#if list.total_limit}
      <div class="bar" aria-hidden="true">
        <span style:width="{Math.min(100, (list.heads / list.total_limit) * 100)}%"></span>
      </div>
    {/if}
    <p class="status">
      {#if closed}<Pill tone="grey">Closed</Pill>{#if manager}<span class="muted">
            Only managers can change it now.</span
          >{/if}
      {:else if !list.open}<Pill tone="grey">Closed</Pill>
      {:else if closes}<span class="muted">Closes {closes}</span>
      {:else}<span class="muted">Open. Each guest counts as one, plus their plus-ones.</span>{/if}
    </p>
    {#if manager}
      <div class="tools">
        <Button size="sm" onclick={() => (limitsOpen = true)}>
          {#snippet icon()}<SlidersHorizontal />{/snippet}
          Limits
        </Button>
        <Button size="sm" variant="tinted" onclick={() => (shareOpen = true)}>
          {#snippet icon()}<Share />{/snippet}
          Share with venue{#if list.link?.enabled}<span class="dot" aria-label="(link on)"></span>{/if}
        </Button>
      </div>
    {/if}
  </section>

  {#if list.open}
    <form class="add" onsubmit={add}>
      <label class="sr" for="{uid}-name">Guest's name</label>
      <input
        id="{uid}-name"
        class="name"
        type="text"
        placeholder="Add a guest, e.g. Rahul +2"
        maxlength={90}
        onpaste={paste}
        autocomplete="off"
        bind:value={name}
      />
      <div class="add-row">
        <PlusOnes bind:value={plusOnes} label="Plus-ones" />
        {#if manager && hostOptions.length > 1}
          <select class="host" aria-label="Whose guest" bind:value={hostId}>
            <option value="">My guest</option>
            {#each hostOptions.filter((h) => h.id !== me?.id) as h (h.id)}
              <option value={h.id}>Guest of {h.name}</option>
            {/each}
          </select>
        {/if}
        <Button variant="primary" type="submit" loading={adding} disabled={!name.trim()}>Add</Button>
      </div>
    </form>
  {/if}

  {#if list.guests.length === 0}
    <EmptyState
      title={manager ? "No guests yet" : "You haven't added anyone"}
      text={list.open
        ? "Add the people you're bringing. Managers can set limits and share the list with the venue."
        : "The guest list is closed. Ask a manager if you need a change."}
    >
      {#snippet icon()}<Users size={26} />{/snippet}
    </EmptyState>
  {:else}
    {#each manager ? groups : [{ id: "mine", host: "", mine: true, guests: list.guests }] as grp (grp.id)}
      <section class="group">
        {#if manager}
          <h2>
            {grp.mine ? "Your guests" : `Guests of ${grp.host}`}
            <span class="muted">· {heads(grp.guests.reduce((n, g) => n + 1 + g.plus_ones, 0))}</span>
          </h2>
        {/if}
        <ul>
          {#each grp.guests as g (g.id)}
            <li class:arrived={g.arrived}>
              {#if manager}
                <input
                  class="tick"
                  type="checkbox"
                  checked={g.arrived}
                  aria-label="Arrived: {g.name}"
                  onchange={() => arrive(g)}
                />
              {/if}
              <button
                class="guest"
                type="button"
                onclick={() => openGuest(g)}
                disabled={!manager && !list.open}
                aria-label="Edit {g.name}"
              >
                <span class="gname"
                  >{g.name}{#if g.plus_ones}<span class="plus num">+{g.plus_ones}</span>{/if}</span
                >
                {#if g.note || g.arrived || (g.pending && outbox.showWaiting)}<span class="note"
                    >{[
                      g.arrived ? "arrived" : null,
                      g.note,
                      g.pending && outbox.showWaiting ? "waiting to sync" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}</span
                  >{/if}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

{#if guestFor}
  <GuestSheet
    bind:open={guestOpen}
    {gig}
    guest={list.guests.find((g) => g.id === guestFor!.id) ?? guestFor}
    {onsaved}
  />
{/if}
{#if manager}
  <GuestLimitsSheet bind:open={limitsOpen} {gig} {onsaved} />
  <GuestShareSheet bind:open={shareOpen} {gig} {onsaved} />
{/if}

<style>
  .guests {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .summary,
  .add,
  .group {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    min-width: 0;
  }
  .summary {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .counts {
    display: flex;
    align-items: flex-end;
    gap: var(--space-6);
    flex-wrap: wrap;
  }
  .big {
    font-size: var(--text-2xl);
    font-weight: 750;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .of {
    margin-left: var(--space-1);
    color: var(--text-2);
  }
  .mine {
    display: grid;
    gap: 2px;
  }
  .label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  .bar {
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--grey-soft);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .muted {
    color: var(--text-2);
    font-size: var(--text-sm);
    font-weight: 400;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-left: 6px;
    border-radius: var(--radius-full);
    background: var(--green);
  }
  .add {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .add .name {
    height: 44px;
    border: 0;
    border-bottom: 1px solid var(--separator);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 16px;
    outline: none;
  }
  .add-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .add-row :global(.btn) {
    margin-left: auto;
  }
  .host {
    height: 44px;
    min-width: 0;
    max-width: 100%;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }
  h2 {
    padding: var(--space-3) var(--space-4) var(--space-2);
    font-size: var(--text-md);
    font-weight: 700;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 52px;
    padding: 0 var(--space-3);
    border-top: 1px solid var(--separator);
  }
  .group > ul:first-child li:first-child {
    border-top: 0;
  }
  .tick {
    width: 22px;
    height: 22px;
    margin: 0 var(--space-1);
    accent-color: var(--green);
    flex: none;
    cursor: pointer;
  }
  .guest {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    display: grid;
    align-content: center;
    gap: 2px;
    padding: var(--space-2) var(--space-1);
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .guest:disabled {
    cursor: default;
  }
  .gname {
    overflow-wrap: anywhere;
  }
  .plus {
    margin-left: var(--space-2);
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--text-xs);
    font-weight: 700;
  }
  .note {
    font-size: var(--text-sm);
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  li.arrived .gname {
    color: var(--text-2);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
