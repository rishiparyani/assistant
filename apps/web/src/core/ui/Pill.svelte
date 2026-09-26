<script lang="ts">
  import type { Snippet } from "svelte";

  import type { Tone } from "./tones.ts";
  let { tone = "grey", children }: { tone?: Tone; children: Snippet } = $props();
</script>

<span class="pill {tone}">{@render children()}</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .green {
    background: var(--green-soft);
    color: var(--green);
  }
  .amber {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .red {
    background: var(--red-soft);
    color: var(--red);
  }
  .blue {
    background: var(--blue-soft);
    color: var(--blue);
  }
  .violet {
    background: var(--violet-soft);
    color: var(--violet);
  }
  .grey {
    background: var(--grey-soft);
    color: var(--grey);
  }
  .accent {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
</style>
