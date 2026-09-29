<script lang="ts" generics="T extends string">
  let {
    options,
    value = $bindable(),
    label,
  }: { options: { value: T; label: string }[]; value: T; label: string } = $props();
</script>

<div class="seg" role="tablist" aria-label={label}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="tab"
      aria-selected={value === o.value}
      class:active={value === o.value}
      onclick={() => (value = o.value)}>{o.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: flex;
    padding: 3px;
    gap: 2px;
    background: var(--grey-soft);
    border-radius: 10px;
  }
  button {
    flex: 1;
    min-height: 32px;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: 8px;
    background: transparent;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
</style>
