<script lang="ts">
  // A calendar tile: "DEC / 12 / Sat", in India time. Rehearsals get their own colour.
  let { iso, muted = false, soft = false }: { iso: string; muted?: boolean; soft?: boolean } = $props();
  const d = $derived(new Date(Date.parse(iso) + 330 * 60_000));
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
</script>

<span class="tile" class:muted class:soft={soft && !muted} aria-hidden="true">
  <span class="m">{MONTHS[d.getUTCMonth()]}</span>
  <span class="d">{d.getUTCDate()}</span>
  <span class="w">{DAYS[d.getUTCDay()]}</span>
</span>

<style>
  .tile {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 50px;
    border-radius: 11px;
    background: var(--accent-soft);
    color: var(--accent-text);
    line-height: 1;
    flex-shrink: 0;
  }
  .soft {
    background: var(--violet-soft);
    color: var(--violet);
  }
  .muted {
    background: var(--grey-soft);
    color: var(--text-2);
  }
  .m {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .d {
    font-size: 19px;
    font-weight: 750;
    letter-spacing: -0.03em;
    margin: 2px 0 1px;
  }
  .w {
    font-size: 9.5px;
    font-weight: 600;
    opacity: 0.8;
  }
</style>
