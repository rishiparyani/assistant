<script lang="ts" generics="T extends string">
  // Horizontally scrolling choice chips (one selected).
  let {
    options,
    value = $bindable(),
    label,
  }: { options: { value: T; label: string }[]; value: T; label: string } = $props();
</script>

<div class="field">
  <span class="label">{label}</span>
  <div class="chips" role="radiogroup" aria-label={label}>
    {#each options as o (o.value)}
      <button
        type="button"
        role="radio"
        aria-checked={value === o.value}
        class:active={value === o.value}
        onclick={() => (value = o.value)}>{o.label}</button
      >
    {/each}
  </div>
</div>

<style>
  .field {
    display: grid;
    gap: 6px;
  }
  .label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  button {
    min-height: 36px;
    padding: 0 14px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    font-weight: 600;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-on-accent);
  }
</style>
