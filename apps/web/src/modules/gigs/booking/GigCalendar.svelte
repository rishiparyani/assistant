<script module lang="ts">
  // The month on screen survives opening a gig and coming back.
  let remembered: string | null = null;
</script>

<script lang="ts">
  import { isoDateIST, type MyEventView } from "@assistant/shared";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Plus from "@lucide/svelte/icons/plus";
  import { Button, ListGroup, ListRow, Spinner } from "../../../core/ui/index.ts";
  import { createQuery } from "../../../core/query.svelte.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { statusTone } from "../status.ts";
  import { todayIST } from "../time.ts";
  import GigEventRow from "./GigEventRow.svelte";

  // Month grid of my gigs (India time, weeks start on Monday). Tap a day for its gigs;
  // with no day picked, the month's gigs are listed under the grid.
  let { onadd }: { onadd: (date: string) => void } = $props();

  const today = todayIST();
  let month = $state(remembered ?? today.slice(0, 7)); // "YYYY-MM"
  let selected = $state<string | null>(null); // "YYYY-MM-DD"
  $effect(() => {
    remembered = month;
  });

  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const addMonths = (m: string, n: number) => {
    const [y, mo] = m.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
  };
  const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const dayName = (d: string) => {
    const date = new Date(`${d}T00:00:00Z`);
    return `${DAY_NAMES[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  };

  // All of the month's events (times without an offset are India time to the API).
  const query = createQuery(
    () => `gigs:calendar:${month}`,
    async () => {
      const params = {
        from: `${month}-01T00:00`,
        to: `${addMonths(month, 1)}-01T00:00`,
        order: "asc" as const,
        limit: 100,
      };
      const items: MyEventView[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await bookingsApi.myGigs({ ...params, cursor });
        items.push(...page.items);
        cursor = page.next_cursor ?? undefined;
        if (!cursor) break;
      }
      return items;
    },
  );

  const byDay = $derived.by(() => {
    const days: Record<string, MyEventView[]> = {};
    for (const e of query.data ?? []) (days[isoDateIST(e.start_at)] ??= []).push(e);
    return days;
  });

  // Blank cells before the 1st (Monday first) and after the last day, to fill whole weeks.
  const cells = $derived.by(() => {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) out.push(`${month}-${String(d).padStart(2, "0")}`);
    while (out.length % 7) out.push(null);
    return out;
  });

  const shown = $derived(selected ? (byDay[selected] ?? []) : (query.data ?? []));
  const gigCount = $derived(new Set((query.data ?? []).map((e) => e.gig_id)).size);

  function go(n: number) {
    month = addMonths(month, n);
    selected = null;
  }
  function goToday() {
    month = today.slice(0, 7);
    selected = today;
  }
  const pick = (d: string) => (selected = selected === d ? null : d);

  const dayLabel = (d: string, list: MyEventView[]) =>
    `${dayName(d)}${d === today ? ", today" : ""}: ${
      list.length === 0 ? "no gigs" : list.length === 1 ? "1 gig" : `${list.length} gigs`
    }`;

  // Swipe sideways on the grid to change month (phones).
  let touch: { x: number; y: number } | null = null;
  function touchStart(e: TouchEvent) {
    const t = e.touches[0];
    touch = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function touchEnd(e: TouchEvent) {
    const t = e.changedTouches[0];
    if (!touch || !t) return;
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 40) go(dx < 0 ? 1 : -1);
  }
</script>

<div class="calendar">
  <div class="bar">
    <button class="nav" type="button" aria-label="Previous month" onclick={() => go(-1)}>
      <ChevronLeft size={22} />
    </button>
    <h2 aria-live="polite">{monthName(month)}</h2>
    <button class="nav" type="button" aria-label="Next month" onclick={() => go(1)}>
      <ChevronRight size={22} />
    </button>
    <span class="spacer">
      {#if query.loading && !query.data}<Spinner size={16} />{/if}
    </span>
    {#if month !== today.slice(0, 7) || selected !== today}
      <Button size="sm" variant="ghost" onclick={goToday}>Today</Button>
    {/if}
  </div>

  <div
    class="grid-wrap"
    role="group"
    aria-label="Days of {monthName(month)}"
    ontouchstart={touchStart}
    ontouchend={touchEnd}
  >
    <div class="grid weekdays" aria-hidden="true">
      {#each WEEKDAYS as w (w)}<span>{w}</span>{/each}
    </div>
    <div class="grid days">
      {#each cells as d, i (d ?? `blank-${i}`)}
        {#if d}
          {@const list = byDay[d] ?? []}
          <button
            type="button"
            class="day"
            class:today={d === today}
            class:selected={d === selected}
            class:past={d < today}
            aria-pressed={d === selected}
            aria-label={dayLabel(d, list)}
            onclick={() => pick(d)}
          >
            <span class="num">{Number(d.slice(8))}</span>
            {#if list.length}
              <span class="dots" aria-hidden="true">
                {#each list.slice(0, 3) as e (e.event_id)}<span class="dot {statusTone(e.status)}"
                  ></span>{/each}
                {#if list.length > 3}<span class="more">+{list.length - 3}</span>{/if}
              </span>
              <span class="chips" aria-hidden="true">
                {#each list.slice(0, 2) as e (e.event_id)}
                  <span class="chip {statusTone(e.status)}" class:struck={e.status === "cancelled"}
                    >{e.gig_title}</span
                  >
                {/each}
                {#if list.length > 2}<span class="more">+{list.length - 2} more</span>{/if}
              </span>
            {/if}
          </button>
        {:else}
          <span class="blank"></span>
        {/if}
      {/each}
    </div>
  </div>

  {#if query.error && !query.data}
    <ListGroup>
      <ListRow title="Couldn't load this month" subtitle="Check your connection and try again." />
    </ListGroup>
    <Button onclick={() => query.refresh()}>Try again</Button>
  {:else if selected}
    <ListGroup title={dayName(selected)}>
      {#snippet action()}<button class="link" type="button" onclick={() => (selected = null)}
          >Whole month</button
        >{/snippet}
      {#each shown as e (e.event_id)}
        <GigEventRow {e} />
      {:else}
        <ListRow title="No gigs this day" />
      {/each}
    </ListGroup>
    {#if selected >= today}
      <Button onclick={() => onadd(selected!)}>
        {#snippet icon()}<Plus />{/snippet}
        Add a gig on {Number(selected.slice(8))}
        {MONTHS[Number(selected.slice(5, 7)) - 1]!.slice(0, 3)}
      </Button>
    {/if}
  {:else if query.data}
    <ListGroup
      title="{monthName(month)} · {gigCount === 0
        ? 'no gigs'
        : gigCount === 1
          ? '1 gig'
          : `${gigCount} gigs`}"
    >
      {#each shown as e (e.event_id)}
        <GigEventRow {e} />
      {:else}
        <ListRow title="Nothing this month" subtitle="Tap a day to add a gig on it." />
      {/each}
    </ListGroup>
  {/if}
</div>

<style>
  .calendar {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    justify-items: stretch;
  }
  .calendar > :global(button) {
    justify-self: start;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  h2 {
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.02em;
    min-width: 0;
    text-align: center;
    flex: 0 1 auto;
    padding: 0 var(--space-1);
  }
  .spacer {
    flex: 1;
    display: flex;
    justify-content: center;
  }
  .nav {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--accent-text);
    cursor: pointer;
  }
  .nav:hover {
    background: var(--surface-hover);
  }
  .grid-wrap {
    container-type: inline-size;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
    touch-action: pan-y;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
  }
  .weekdays span {
    text-align: center;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-3);
    padding: var(--space-1) 0 var(--space-2);
  }
  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 52px;
    padding: 6px 2px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .day:hover {
    background: var(--surface-hover);
  }
  .day.past .num {
    color: var(--text-3);
  }
  .num {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .day.today .num {
    background: var(--accent);
    color: var(--text-on-accent);
  }
  .day.selected {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .dots {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 8px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--grey);
  }
  .more {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-3);
    line-height: 1;
  }
  .chips {
    display: none;
  }
  .dot.blue {
    background: var(--blue);
  }
  .dot.green {
    background: var(--green);
  }
  .dot.amber {
    background: var(--amber);
  }
  .dot.red {
    background: var(--red);
  }
  .dot.violet {
    background: var(--violet);
  }
  .chip {
    display: block;
    width: 100%;
    padding: 2px 6px;
    border-radius: 6px;
    font-size: var(--text-xs);
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: var(--grey-soft);
    color: var(--grey);
  }
  .chip.blue {
    background: var(--blue-soft);
    color: var(--blue);
  }
  .chip.green {
    background: var(--green-soft);
    color: var(--green);
  }
  .chip.amber {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .chip.red {
    background: var(--red-soft);
    color: var(--red);
  }
  .chip.violet {
    background: var(--violet-soft);
    color: var(--violet);
  }
  .chip.struck {
    text-decoration: line-through;
  }
  /* Wide enough for names: show gig titles instead of dots. */
  @container (min-width: 560px) {
    .day {
      align-items: stretch;
      min-height: 96px;
      padding: 6px;
    }
    .num {
      align-self: flex-start;
    }
    .dots {
      display: none;
    }
    .chips {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .chips .more {
      padding-left: 6px;
      text-align: left;
    }
  }
  .link {
    border: 0;
    background: transparent;
    color: var(--accent-text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }
</style>
