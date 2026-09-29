<script lang="ts">
  import type { SharedGuestListView } from "@assistant/shared";
  import Search from "@lucide/svelte/icons/search";
  import Printer from "@lucide/svelte/icons/printer";
  import Check from "@lucide/svelte/icons/check";
  import { Button, Spinner, toast } from "../../../core/ui/index.ts";
  import { ApiError } from "../../../core/api.ts";
  import { bookingsApi } from "../gigs-api.ts";

  // What the venue sees from the band's link: no sign-in. The list, whose guest each one
  // is, and (if the band allows) a tick for door staff. Refreshes itself while open.
  let { token }: { token: string } = $props();

  let data = $state<SharedGuestListView | null>(null);
  let gone = $state(false);
  let query = $state("");
  let onlyWaiting = $state(false);
  let busyId = $state("");
  let updatedAt = $state<Date | null>(null);

  async function load() {
    try {
      data = await bookingsApi.sharedGuests(token);
      updatedAt = new Date();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) gone = true;
      else if (!data) toast.error(e);
    }
  }

  $effect(() => {
    document.title = "Guest list";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.append(meta);
    void load();
    // New guests added by the band show up by themselves.
    const t = setInterval(() => document.visibilityState === "visible" && !busyId && void load(), 20_000);
    return () => {
      clearInterval(t);
      meta.remove();
    };
  });

  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const shown = $derived(
    (data?.guests ?? []).filter(
      (g) =>
        (!onlyWaiting || !g.arrived) &&
        (!query.trim() || norm(`${g.name} ${g.guest_of} ${g.note ?? ""}`).includes(norm(query.trim()))),
    ),
  );

  async function toggle(id: string, arrived: boolean) {
    if (!data?.check_in) return;
    busyId = id;
    // Show it at once; the answer confirms it.
    data = { ...data, guests: data.guests.map((g) => (g.id === id ? { ...g, arrived } : g)) };
    try {
      data = await bookingsApi.sharedArrive(token, id, arrived);
      updatedAt = new Date();
    } catch (e) {
      toast.error(e);
      await load();
    } finally {
      busyId = "";
    }
  }
</script>

<main class="page">
  {#if gone}
    <div class="gone">
      <h1>This link doesn't work</h1>
      <p>It may have been turned off or replaced. Ask the band for the current guest list link.</p>
    </div>
  {:else if !data}
    <div class="loading"><Spinner size={22} label="Loading the guest list…" /></div>
  {:else}
    <header class="head">
      <p class="kicker">Guest list</p>
      <h1>{data.gig_title}</h1>
      <p class="when">
        {[data.starts_display?.replace(/ IST$/, ""), data.venue].filter(Boolean).join(" · ")}
      </p>
      <p class="totals">
        <strong class="num">{data.heads}</strong>
        {data.heads === 1 ? "person" : "people"}
        {#if data.check_in || data.arrived_heads}· <strong class="num">{data.arrived_heads}</strong> arrived{/if}
      </p>
    </header>

    <div class="tools">
      <label class="search">
        <Search size={18} />
        <input type="search" placeholder="Search a name" aria-label="Search a name" bind:value={query} />
      </label>
      {#if data.check_in}
        <label class="waiting"><input type="checkbox" bind:checked={onlyWaiting} /> Not arrived yet</label>
      {/if}
      <Button size="sm" onclick={() => window.print()}>
        {#snippet icon()}<Printer />{/snippet}
        Print
      </Button>
    </div>

    <ul class="list">
      {#each shown as g (g.id)}
        <li class:arrived={g.arrived}>
          <div class="who">
            <span class="name"
              >{g.name}{#if g.plus_ones}<span class="plus num">+{g.plus_ones}</span>{/if}</span
            >
            <span class="sub">Guest of {g.guest_of}{g.note ? ` · ${g.note}` : ""}</span>
          </div>
          {#if data.check_in}
            <button
              class="arrive"
              class:on={g.arrived}
              type="button"
              aria-pressed={g.arrived}
              aria-label="{g.arrived ? 'Arrived' : 'Mark arrived'}: {g.name}"
              disabled={busyId === g.id}
              onclick={() => toggle(g.id, !g.arrived)}
            >
              <Check size={18} />
              <span>{g.arrived ? "In" : "Arrived"}</span>
            </button>
            <span class="box print-only" aria-hidden="true"></span>
          {:else}
            <span class="box" aria-hidden="true"></span>
          {/if}
        </li>
      {:else}
        <li class="empty">{data.guests.length ? "No one matches." : "No guests on the list yet."}</li>
      {/each}
    </ul>
    <p class="foot">
      Shared by the band with Assistant. Updates by itself{updatedAt
        ? ` · checked ${updatedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`
        : ""}.
    </p>
  {/if}
</main>

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4) var(--space-10);
    min-height: 100dvh;
  }
  .loading,
  .gone {
    display: grid;
    place-items: center;
    gap: var(--space-2);
    min-height: 60dvh;
    text-align: center;
  }
  .gone p {
    color: var(--text-2);
    max-width: 36ch;
  }
  .kicker {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-text);
  }
  h1 {
    margin-top: var(--space-1);
    font-size: var(--text-2xl);
    font-weight: 750;
    letter-spacing: -0.03em;
    line-height: 1.1;
    overflow-wrap: anywhere;
  }
  .when {
    margin-top: var(--space-2);
    color: var(--text-2);
  }
  .totals {
    margin-top: var(--space-3);
    font-size: var(--text-md);
  }
  .tools {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-5) calc(-1 * var(--space-4)) 0;
    padding: var(--space-2) var(--space-4);
    background: var(--bg);
  }
  .search {
    flex: 1 1 220px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-3);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 16px;
    outline: none;
  }
  .waiting {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    font-size: var(--text-sm);
    color: var(--text-2);
  }
  .waiting input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .list {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 60px;
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--separator);
  }
  li:first-child {
    border-top: 0;
  }
  li.empty {
    color: var(--text-2);
  }
  .who {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .name {
    font-size: var(--text-md);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  li.arrived .name {
    color: var(--text-3);
  }
  .plus {
    margin-left: var(--space-2);
    padding: 1px 8px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .sub {
    font-size: var(--text-sm);
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .arrive {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 108px;
    height: 44px;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface);
    color: var(--text-2);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    flex: none;
  }
  .arrive.on {
    background: var(--green-soft);
    border-color: var(--green);
    color: var(--green);
  }
  .box {
    width: 22px;
    height: 22px;
    border: 1.5px solid var(--border-strong);
    border-radius: 5px;
    flex: none;
  }
  .foot {
    margin-top: var(--space-4);
    font-size: var(--text-xs);
    color: var(--text-3);
    text-align: center;
  }
  .print-only {
    display: none;
  }
  @media print {
    .print-only {
      display: block;
    }
    .tools,
    .foot {
      display: none;
    }
    .page {
      padding: 0;
    }
    .list {
      border: 0;
    }
    li {
      min-height: 36px;
      break-inside: avoid;
    }
    .arrive {
      display: none;
    }
  }
</style>
