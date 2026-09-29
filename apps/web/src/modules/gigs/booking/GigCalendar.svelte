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

  // Month grid of my gigs in the style of the iPhone Calendar (India time, weeks start on
  // Sunday). A day is always picked (today, or the 1st of another month); its gigs are
  // listed under the grid.
  let { onadd }: { onadd: (date: string) => void } = $props();

  const today = todayIST();
  const firstOf = (m: string) => (m === today.slice(0, 7) ? today : `${m}-01`);
  let month = $state(remembered?.slice(0, 7) ?? today.slice(0, 7)); // "YYYY-MM"
  let selected = $state(remembered ?? today); // "YYYY-MM-DD"
  $effect(() => {
    remembered = selected;
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
  const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
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
  const weekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

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

  // Whole weeks, Sunday first: blank cells before the 1st and after the last day.
  const weeks = $derived.by(() => {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const lead = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
    while (cells.length % 7) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  });

  const shown = $derived(byDay[selected] ?? []);

  function go(n: number) {
    month = addMonths(month, n);
    selected = firstOf(month);
  }
  function goToday() {
    month = today.slice(0, 7);
    selected = today;
  }

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
    <h2 aria-live="polite">
      <span class="m">{MONTHS[Number(month.slice(5, 7)) - 1]}</span>
      <span class="y">{month.slice(0, 4)}</span>
    </h2>
    <span class="spacer">
      {#if query.loading && !query.data}<Spinner size={16} />{/if}
    </span>
    {#if selected !== today}
      <button class="today-btn" type="button" onclick={goToday}>Today</button>
    {/if}
    <button class="nav" type="button" aria-label="Previous month" onclick={() => go(-1)}>
      <ChevronLeft size={22} />
    </button>
    <button class="nav" type="button" aria-label="Next month" onclick={() => go(1)}>
      <ChevronRight size={22} />
    </button>
  </div>

  <div
    class="month"
    role="group"
    aria-label="Days of {monthName(month)}"
    ontouchstart={touchStart}
    ontouchend={touchEnd}
  >
    <div class="week weekdays" aria-hidden="true">
      {#each WEEKDAYS as w, i (i)}<span class:weekend={i === 0 || i === 6}>{w}</span>{/each}
    </div>
    {#each weeks as week, w (w)}
      <div class="week">
        {#each week as d, i (d ?? `blank-${w}-${i}`)}
          {#if d}
            {@const list = byDay[d] ?? []}
            <button
              type="button"
              class="day"
              class:today={d === today}
              class:selected={d === selected}
              class:weekend={weekend(d)}
              aria-pressed={d === selected}
              aria-label={dayLabel(d, list)}
              onclick={() => (selected = d)}
            >
              <span class="num">{Number(d.slice(8))}</span>
              <span class="dot" class:on={list.length > 0} aria-hidden="true"></span>
              {#if list.length}
                <span class="titles" aria-hidden="true">
                  {#each list.slice(0, 3) as e (e.event_id)}
                    <span class="title {statusTone(e.status)}" class:struck={e.status === "cancelled"}
                      >{e.gig_title}</span
                    >
                  {/each}
                  {#if list.length > 3}<span class="more">{list.length - 3} more</span>{/if}
                </span>
              {/if}
            </button>
          {:else}
            <span class="blank"></span>
          {/if}
        {/each}
      </div>
    {/each}
  </div>

  {#if query.error && !query.data}
    <ListGroup>
      <ListRow title="Couldn't load this month" subtitle="Check your connection and try again." />
    </ListGroup>
    <Button onclick={() => query.refresh()}>Try again</Button>
  {:else}
    <ListGroup title={dayName(selected)}>
      {#each shown as e (e.event_id)}
        <GigEventRow {e} />
      {:else}
        <ListRow title={query.data ? "No gigs" : "Loading…"} />
      {/each}
    </ListGroup>
    {#if selected >= today}
      <Button onclick={() => onadd(selected)}>
        {#snippet icon()}<Plus />{/snippet}
        Add a gig on {Number(selected.slice(8))}
        {MONTHS[Number(selected.slice(5, 7)) - 1]!.slice(0, 3)}
      </Button>
    {/if}
  {/if}
</div>

<style>
  .calendar {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
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
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  h2 .m {
    font-size: var(--text-xl);
    font-weight: 750;
    letter-spacing: -0.03em;
    color: var(--red);
  }
  h2 .y {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-3);
  }
  .spacer {
    flex: 1;
    display: flex;
    justify-content: center;
  }
  .today-btn {
    min-height: 44px;
    padding: 0 var(--space-3);
    border: 0;
    background: transparent;
    color: var(--red);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .nav {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--red);
    cursor: pointer;
  }
  .nav:hover {
    background: var(--surface-hover);
  }
  .month {
    container-type: inline-size;
    touch-action: pan-y;
  }
  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    border-top: 1px solid var(--separator);
  }
  .weekdays {
    border-top: 0;
  }
  .weekdays span {
    text-align: center;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text);
    padding-bottom: var(--space-2);
  }
  .weekdays span.weekend {
    color: var(--text-3);
  }
  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
    min-height: 56px;
    padding: 6px 2px 4px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .day.weekend .num {
    color: var(--text-3);
  }
  .num {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    font-size: var(--text-md);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .day.today .num {
    color: var(--red);
    font-weight: 650;
  }
  .day.selected .num {
    background: var(--text);
    color: var(--bg);
    font-weight: 650;
  }
  .day.selected.today .num {
    background: var(--red);
    color: var(--text-on-accent);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
  }
  .dot.on {
    background: var(--text-3);
  }
  .titles {
    display: none;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title::before {
    content: "";
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--grey);
  }
  .title.blue::before {
    background: var(--blue);
  }
  .title.green::before {
    background: var(--green);
  }
  .title.amber::before {
    background: var(--amber);
  }
  .title.red::before {
    background: var(--red);
  }
  .title.violet::before {
    background: var(--violet);
  }
  .title.struck {
    text-decoration: line-through;
    color: var(--text-3);
  }
  .more {
    font-size: var(--text-xs);
    color: var(--text-3);
    padding-left: 10px;
  }
  /* iPad-style month on wide screens: number at the top right, gig titles in the day. */
  @container (min-width: 560px) {
    .week:not(.weekdays) {
      min-height: 104px;
    }
    .day {
      align-items: stretch;
      padding: 4px;
      border-radius: 0;
    }
    .day + .day,
    .blank + .day,
    .day + .blank {
      border-left: 1px solid var(--separator);
    }
    .num {
      align-self: flex-end;
      width: 28px;
      height: 28px;
      font-size: var(--text-sm);
    }
    .dot {
      display: none;
    }
    .titles {
      display: grid;
      gap: 2px;
      min-width: 0;
      text-align: left;
    }
  }
</style>
