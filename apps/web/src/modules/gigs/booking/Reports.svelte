<script lang="ts">
  import type { MyReportView, MyTagView } from "@assistant/shared";
  import BarChart from "@lucide/svelte/icons/chart-column";
  import {
    Card,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    Segmented,
    SelectField,
    Skeleton,
    Stat,
    TextField,
    toast,
  } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { statusLabel, statusTone } from "../status.ts";
  import { todayIST } from "../time.ts";

  // My money over a period: only my own (shares, paid, owed), plus the full money of
  // gigs I manage. Filters: role, collective, custom tags (all must match).
  type Range = "month" | "last_month" | "year" | "custom";
  let range = $state<Range>("month");
  let from = $state("");
  let to = $state("");
  let role = $state("");
  let collective = $state("");
  let tag = $state("");
  let tags = $state<MyTagView[]>([]);
  let report = $state<MyReportView | null>(null);

  const today = todayIST();
  function bounds(r: Range): [string, string] {
    const [y, m] = today.split("-").map(Number) as [number, number];
    const pad = (n: number) => String(n).padStart(2, "0");
    const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    if (r === "month") return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${lastDay(y, m)}`];
    if (r === "last_month") {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${lastDay(py, pm)}`];
    }
    // Indian financial year: April to March.
    const fy = m >= 4 ? y : y - 1;
    return [`${fy}-04-01`, `${fy + 1}-03-31`];
  }
  $effect(() => {
    if (range !== "custom") [from, to] = bounds(range);
  });

  bookingsApi.tags().then(
    (t) => (tags = t),
    () => {},
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const p = {
      from,
      to,
      role: role || undefined,
      collective: collective || undefined,
      tags: tag || undefined,
    };
    if (!p.from || !p.to) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      bookingsApi.report(p).then(
        (r) => (report = r),
        (e) => toast.error(e),
      );
    }, 150);
  });

  const collectives = $derived(tags.filter((t) => t.kind === "collective"));
  const custom = $derived(tags.filter((t) => t.kind === "custom"));
</script>

<PageHeader title="Reports" subtitle="Only your own money, and the full money of gigs you manage." />

<div class="filters">
  <Segmented
    label="Period"
    bind:value={range}
    options={[
      { value: "month", label: "This month" },
      { value: "last_month", label: "Last month" },
      { value: "year", label: "This FY" },
      { value: "custom", label: "Custom" },
    ]}
  />
  {#if range === "custom"}
    <div class="two">
      <TextField label="From" id="report-from" type="date" bind:value={from} />
      <TextField label="To" id="report-to" type="date" bind:value={to} />
    </div>
  {/if}
  <div class="three">
    <SelectField
      label="Role"
      id="report-role"
      bind:value={role}
      options={[
        { value: "", label: "Any" },
        { value: "player", label: "Playing" },
        { value: "manager", label: "Managing" },
      ]}
    />
    <SelectField
      label="Collective"
      id="report-collective"
      bind:value={collective}
      options={[{ value: "", label: "Any" }, ...collectives.map((t) => ({ value: t.name, label: t.name }))]}
    />
    <SelectField
      label="Tag"
      id="report-tag"
      bind:value={tag}
      options={[{ value: "", label: "Any" }, ...custom.map((t) => ({ value: t.name, label: t.name }))]}
    />
  </div>
</div>

{#if !report}
  <Skeleton rows={5} />
{:else if report.gigs.length === 0}
  <EmptyState title="No gigs in this period" text="Try a longer period or fewer filters.">
    {#snippet icon()}<BarChart size={26} />{/snippet}
  </EmptyState>
{:else}
  <div class="layout">
    <div class="col">
      {#if !report.managed || report.mine.share.amount_paise !== 0 || report.mine.paid.amount_paise !== 0}
        <Card>
          <div class="block">
            <span class="eyebrow"
              >My share · {report.mine.gigs} {report.mine.gigs === 1 ? "gig" : "gigs"}</span
            >
            <div class="stats">
              <Stat label="Earned" value={report.mine.share.amount_display} />
              <Stat label="Paid to me" value={report.mine.paid.amount_display} tone="green" />
              <Stat
                label="Still owed"
                value={report.mine.owed.amount_display}
                tone={report.mine.owed.amount_paise > 0 ? "amber" : undefined}
              />
            </div>
          </div>
        </Card>
      {/if}
      {#if report.managed}
        <Card>
          <div class="block">
            <span class="eyebrow">Gigs I manage · {report.managed.gigs}</span>
            <div class="stats">
              <Stat label="Fees" value={report.managed.fee.amount_display} />
              <Stat label="Received" value={report.managed.received.amount_display} tone="green" />
              <Stat
                label="Due"
                value={report.managed.due.amount_display}
                tone={report.managed.due.amount_paise > 0 ? "amber" : undefined}
              />
              <Stat
                label="Shares"
                value={report.managed.shares.amount_display}
                hint="Paid out {report.managed.paid_out.amount_display}"
              />
              <Stat label="Expenses" value={report.managed.expenses.amount_display} />
              <Stat
                label="Net"
                value={report.managed.net.amount_display}
                tone={report.managed.net.amount_paise < 0 ? "red" : "green"}
              />
            </div>
          </div>
        </Card>
      {/if}
      {#if report.by_month.length > 1}
        <ListGroup title="By month">
          {#each report.by_month as m (m.month)}
            <ListRow
              title={m.label}
              subtitle="{m.mine.gigs} {m.mine.gigs === 1 ? 'gig' : 'gigs'} · paid {m.mine.paid
                .amount_display}"
            >
              {#snippet trailing()}
                <span class="right">
                  <span class="amt num">{m.mine.share.amount_display}</span>
                  {#if m.managed}<span class="small num">Net {m.managed.net.amount_display}</span>{/if}
                </span>
              {/snippet}
            </ListRow>
          {/each}
        </ListGroup>
      {/if}
    </div>
    <div class="col">
      <ListGroup title="Gigs">
        {#each report.gigs as g (g.gig_id)}
          <ListRow
            href="/gigs/{g.gig_id}"
            title={g.gig_title}
            subtitle={[g.first_start_display, g.client_name, g.collective_name, ...g.tags]
              .filter(Boolean)
              .join(" · ")}
          >
            {#snippet trailing()}
              <span class="right">
                {#if g.role === "manager" && g.net}
                  <span class="amt num">{g.fee?.amount_display}</span>
                  <span class="small num">Net {g.net.amount_display}</span>
                {:else}
                  <span class="amt num">{g.share.amount_display}</span>
                  {#if g.owed.amount_paise > 0}<span class="small num">{g.owed.amount_display} owed</span
                    >{/if}
                {/if}
                {#if g.status === "cancelled"}<Pill tone={statusTone(g.status)}>{statusLabel(g.status)}</Pill
                  >{/if}
              </span>
            {/snippet}
          </ListRow>
        {/each}
      </ListGroup>
    </div>
  </div>
{/if}

<style>
  .filters {
    display: grid;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  .two,
  .three {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  @media (max-width: 480px) {
    .three {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .three :global(.field:first-child) {
      grid-column: 1 / -1;
    }
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
  }
  .col {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    align-content: start;
    min-width: 0;
  }
  @media (min-width: 1100px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  .block {
    display: grid;
    gap: var(--space-3);
  }
  .eyebrow {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
    gap: var(--space-4) var(--space-3);
  }
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .amt {
    font-weight: 650;
    color: var(--text);
  }
  .small {
    font-size: var(--text-xs);
    color: var(--text-2);
  }
</style>
