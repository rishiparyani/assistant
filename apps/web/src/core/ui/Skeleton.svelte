<script lang="ts">
  let { rows = 3 }: { rows?: number } = $props();
</script>

<div class="sk" aria-busy="true" aria-label="Loading">
  {#each Array.from({ length: rows }, (_, i) => i) as i (i)}
    <div class="row">
      <span class="circle"></span>
      <span class="lines"><span class="l1"></span><span class="l2"></span></span>
    </div>
  {/each}
</div>

<style>
  .sk {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: 14px var(--space-4);
  }
  .row + .row {
    border-top: 1px solid var(--separator);
  }
  .circle,
  .l1,
  .l2 {
    background: linear-gradient(90deg, var(--grey-soft) 25%, var(--surface-hover) 50%, var(--grey-soft) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.3s infinite linear;
  }
  .circle {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .lines {
    display: grid;
    gap: 8px;
    flex: 1;
  }
  .l1 {
    height: 12px;
    width: 55%;
    border-radius: 6px;
  }
  .l2 {
    height: 10px;
    width: 35%;
    border-radius: 6px;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
</style>
