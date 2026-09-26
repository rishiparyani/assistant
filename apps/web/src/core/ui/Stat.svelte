<script lang="ts">
  import type { Tone } from "./tones.ts";
  // A labelled number: "Received / ₹20,000".
  let { label, value, tone, hint }: { label: string; value: string; tone?: Tone; hint?: string } = $props();
</script>

<div class="stat">
  <span class="label">{label}</span>
  <span class="value num {tone ?? ''}">{value}</span>
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>

<style>
  .stat {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .value {
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    font-size: var(--text-xs);
    color: var(--text-3);
  }
  .green {
    color: var(--green);
  }
  .red {
    color: var(--red);
  }
  .amber {
    color: var(--amber);
  }
  .violet {
    color: var(--violet);
  }
</style>
