<script lang="ts">
  import { parseChart, transposeChart } from "@assistant/shared";

  // A chord chart: chords above the syllables they fall on, section labels, comments.
  // `steps` transposes (semitones) and `toKey` picks sharps or flats to suit the key.
  let {
    chart,
    steps = 0,
    toKey = null,
    size = "md",
  }: { chart: string; steps?: number; toKey?: string | null; size?: "md" | "stage" } = $props();

  const lines = $derived(transposeChart(parseChart(chart), steps, toKey));
</script>

<div class="chart {size}">
  {#each lines as line, i (i)}
    {#if line.type === "blank"}
      <div class="blank"></div>
    {:else if line.type === "section"}
      <div class="section">{line.text}</div>
    {:else if line.type === "comment"}
      <div class="comment">{line.text}</div>
    {:else}
      <div class="line" class:chords-only={line.parts.every((p) => !p.text.trim())}>
        {#each line.parts as part, j (j)}
          <span class="part"
            >{#if line.parts.some((p) => p.chord)}<span class="chord">{part.chord ?? " "}</span>{/if}<span
              class="lyric">{part.text || " "}</span
            ></span
          >
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  .chart {
    font-size: var(--text-md);
    line-height: 1.25;
  }
  .chart.stage {
    font-size: clamp(22px, 5.2vw, 40px);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    margin-bottom: 0.35em;
  }
  .part {
    display: inline-flex;
    flex-direction: column;
    white-space: pre;
  }
  .chord {
    color: var(--accent-text);
    font-weight: 700;
    font-size: 0.92em;
    padding-right: 0.35em;
    min-height: 1.2em;
  }
  .chords-only .chord {
    padding-right: 0.9em;
  }
  .chords-only .lyric {
    display: none;
  }
  .lyric {
    white-space: pre-wrap;
  }
  .section {
    font-weight: 750;
    font-size: 0.8em;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-2);
    margin: 0.9em 0 0.35em;
  }
  .comment {
    font-style: italic;
    color: var(--text-2);
    margin: 0.5em 0 0.35em;
  }
  .blank {
    height: 0.8em;
  }
</style>
