<script lang="ts">
  import type { MyEventView } from "@assistant/shared";
  import { ListRow, Pill } from "../../../core/ui/index.ts";
  import GigDate from "../GigDate.svelte";
  import { statusLabel, statusTone } from "../status.ts";
  import { time12 } from "../time.ts";

  // One event of one of my gigs, as the gigs list and the calendar show it.
  let { e }: { e: MyEventView } = $props();

  const subtitle = $derived(
    [time12(e.start_at), e.venue_name, e.client_name, e.collective_name].filter(Boolean).join(" · "),
  );
</script>

<ListRow
  href="/gigs/{e.gig_id}"
  title={e.event_title ? `${e.gig_title} · ${e.event_title}` : e.gig_title}
  {subtitle}
>
  {#snippet leading()}<GigDate iso={e.start_at} muted={e.status === "cancelled"} />{/snippet}
  {#snippet trailing()}
    <span class="right">
      {#if e.share.amount_paise > 0}
        <span class="fee num" class:struck={e.status === "cancelled"}>{e.share.amount_display}</span>
      {:else if e.role === "manager"}
        <span class="role">Managing</span>
      {/if}
      <Pill tone={statusTone(e.status)}>{statusLabel(e.status)}</Pill>
    </span>
  {/snippet}
</ListRow>

<style>
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .fee {
    font-weight: 600;
    color: var(--text);
  }
  .role {
    font-size: var(--text-xs);
    color: var(--text-3);
    font-weight: 600;
  }
  .struck {
    text-decoration: line-through;
    color: var(--text-3);
  }
</style>
