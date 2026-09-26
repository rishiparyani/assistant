<script lang="ts">
  import type { HTMLSelectAttributes } from "svelte/elements";
  import Field from "./Field.svelte";

  type Props = Omit<HTMLSelectAttributes, "value"> & {
    label: string;
    value?: string;
    options: { value: string; label: string }[];
    hint?: string;
    error?: string;
  };
  let { label, value = $bindable(""), options, hint, error, id, ...rest }: Props = $props();
  const fieldId = $derived(id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`);
</script>

<Field {label} id={fieldId} {hint} {error}>
  <div class="wrap">
    <select class="control" id={fieldId} bind:value {...rest}>
      {#each options as o (o.value)}
        <option value={o.value}>{o.label}</option>
      {/each}
    </select>
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
  </div>
</Field>

<style>
  .wrap {
    position: relative;
  }
  .wrap :global(select.control) {
    padding-right: 40px;
  }
  .chev {
    position: absolute;
    right: 14px;
    top: 50%;
    width: 18px;
    height: 18px;
    transform: translateY(-50%);
    fill: none;
    stroke: var(--text-3);
    stroke-width: 2;
    pointer-events: none;
  }
</style>
