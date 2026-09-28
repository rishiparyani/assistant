<script lang="ts">
  import type { CalendarFeedView } from "@assistant/shared";
  import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
  import Copy from "@lucide/svelte/icons/copy";
  import { Button, Card, Skeleton, confirm, toast } from "../ui/index.ts";
  import { calendarApi } from "../api.ts";

  // My private calendar feed: my gigs in Apple or Google Calendar, kept up to date.
  let feed = $state<CalendarFeedView | null>(null);
  let busy = $state(false);

  calendarApi.get().then(
    (f) => (feed = f),
    (e) => {
      toast.error(e);
      feed = { enabled: false, url: null, webcal_url: null, created_at: null, last_used_at: null };
    },
  );

  async function run(fn: () => Promise<CalendarFeedView>, done?: string) {
    busy = true;
    try {
      feed = await fn();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }

  async function copy() {
    if (!feed?.url) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy; press and hold the link to copy it");
    }
  }

  async function reset() {
    const ok = await confirm({
      title: "Make a new link?",
      message: "The old link stops working. Calendars using it need the new one.",
      confirmLabel: "New link",
    });
    if (ok) await run(() => calendarApi.enable(true), "New link made");
  }

  async function off() {
    const ok = await confirm({
      title: "Turn off the calendar feed?",
      message: "The link stops working and your gigs leave calendars that use it.",
      confirmLabel: "Turn off",
      destructive: true,
    });
    if (ok) await run(() => calendarApi.disable(), "Calendar feed off");
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
</script>

<Card>
  <div class="head">
    <span class="icon"><CalendarPlus size={20} /></span>
    <div>
      <h2>Calendar</h2>
      <p>Your gigs in Apple or Google Calendar, kept up to date. No money is shown there.</p>
    </div>
  </div>

  {#if feed === null}
    <Skeleton rows={1} label="Loading" />
  {:else if !feed.enabled}
    <Button
      variant="primary"
      loading={busy}
      onclick={() => run(() => calendarApi.enable(), "Calendar feed on")}
    >
      Turn on
    </Button>
  {:else}
    <div class="actions">
      <Button variant="primary" href={feed.webcal_url ?? undefined}>Add to Apple Calendar</Button>
      <Button onclick={copy}>
        {#snippet icon()}<Copy />{/snippet}
        Copy link
      </Button>
    </div>
    <p class="link" aria-label="Calendar link">{feed.url}</p>
    <p class="help">
      <strong>Google Calendar:</strong> on a computer, open calendar.google.com → Other calendars → + → From URL
      → paste the link. Google checks for changes every few hours.
    </p>
    <p class="help">
      Keep the link private: anyone with it can see your gigs.
      {#if feed.last_used_at}Last read by a calendar {when(feed.last_used_at)}.{/if}
    </p>
    <div class="actions">
      <Button size="sm" variant="ghost" onclick={reset} disabled={busy}>New link</Button>
      <Button size="sm" variant="ghost" onclick={off} disabled={busy}>Turn off</Button>
    </div>
  {/if}
</Card>

<style>
  .head {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    margin-bottom: var(--space-4);
  }
  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
  }
  .head p,
  .help {
    margin: 2px 0 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .help {
    margin-top: var(--space-3);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .actions:first-of-type {
    margin-top: 0;
  }
  .link {
    margin: var(--space-3) 0 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    color: var(--text-2);
    word-break: break-all;
    user-select: all;
  }
</style>
