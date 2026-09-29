<script lang="ts">
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";

  // A small stepper for plus-ones (0–20): "– +2 +".
  let { value = $bindable(0), label, max = 20 }: { value?: number; label: string; max?: number } = $props();
</script>

<span class="stepper" role="group" aria-label={label}>
  <button
    type="button"
    aria-label="Fewer"
    disabled={value <= 0}
    onclick={() => (value = Math.max(0, value - 1))}><Minus size={18} /></button
  >
  <span class="value num" aria-live="polite">{value ? `+${value}` : "Just them"}</span>
  <button
    type="button"
    aria-label="More"
    disabled={value >= max}
    onclick={() => (value = Math.min(max, value + 1))}><Plus size={18} /></button
  >
</span>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    flex: none;
  }
  button {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--accent-text);
    cursor: pointer;
  }
  button:disabled {
    color: var(--text-3);
    cursor: default;
  }
  .value {
    min-width: 72px;
    text-align: center;
    font-size: var(--text-sm);
    font-weight: 600;
  }
</style>
