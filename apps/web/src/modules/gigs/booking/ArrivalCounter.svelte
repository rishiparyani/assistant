<script lang="ts">
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";

  // How many of a group are in (Rahul +2: one may come first, the others later). Tap +
  // as each one comes in; − corrects a mistake.
  let {
    name,
    count,
    heads,
    disabled = false,
    onchange,
  }: {
    name: string;
    count: number;
    heads: number;
    disabled?: boolean;
    onchange: (n: number) => void;
  } = $props();
  const all = $derived(count >= heads);
</script>

<div class="counter" class:all role="group" aria-label="Arrived: {name}">
  <button
    type="button"
    aria-label="One less arrived: {name}"
    disabled={disabled || count <= 0}
    onclick={() => onchange(count - 1)}><Minus size={16} /></button
  >
  <span class="num" aria-live="polite">{all ? "All in" : `${count} of ${heads}`}</span>
  <button
    type="button"
    aria-label="One more arrived: {name}"
    disabled={disabled || all}
    onclick={() => onchange(count + 1)}><Plus size={16} /></button
  >
</div>

<style>
  .counter {
    display: inline-flex;
    align-items: center;
    flex: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface);
  }
  .counter.all {
    border-color: var(--green);
    background: var(--green-soft);
  }
  button {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text);
    cursor: pointer;
  }
  button:disabled {
    color: var(--text-3);
    cursor: default;
  }
  span {
    min-width: 3.4em;
    text-align: center;
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
  }
  .all span {
    color: var(--green);
  }
  /* The printed door list has an empty box to tick by hand instead. */
  @media print {
    .counter {
      display: none;
    }
  }
</style>
