<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import X from "@lucide/svelte/icons/x";

  // Looks like a form field; opens a Picker when tapped.
  let {
    label,
    value,
    placeholder = "Choose",
    onopen,
    onclear,
  }: {
    label: string;
    value: string | null | undefined;
    placeholder?: string;
    onopen: () => void;
    onclear?: () => void;
  } = $props();
</script>

<div class="field">
  <span class="label">{label}</span>
  <div class="box">
    <button class="control" type="button" onclick={onopen}>
      <span class:placeholder={!value}>{value || placeholder}</span>
      <ChevronDown size={18} />
    </button>
    {#if value && onclear}
      <button class="clear" type="button" aria-label="Clear {label}" onclick={onclear}><X size={16} /></button
      >
    {/if}
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
  .box {
    display: flex;
    gap: var(--space-2);
  }
  .control {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 46px;
    padding: 10px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 16px;
  }
  .control :global(svg) {
    color: var(--text-3);
    flex-shrink: 0;
  }
  .placeholder {
    color: var(--text-3);
  }
  .clear {
    width: 46px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
</style>
