<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import Field from "./Field.svelte";

  type Props = Omit<HTMLInputAttributes, "value"> & {
    label: string;
    value?: string;
    hint?: string;
    error?: string;
    prefix?: string;
  };
  let { label, value = $bindable(""), hint, error, prefix, id, ...rest }: Props = $props();
  const fieldId = $derived(id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`);
</script>

<Field {label} id={fieldId} {hint} {error}>
  <div class="wrap" class:has-prefix={!!prefix}>
    {#if prefix}<span class="prefix">{prefix}</span>{/if}
    <input
      class="control"
      id={fieldId}
      bind:value
      aria-invalid={!!error}
      aria-describedby={hint || error ? `${fieldId}-msg` : undefined}
      {...rest}
    />
  </div>
</Field>

<style>
  .wrap {
    position: relative;
  }
  .prefix {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-3);
    font-weight: 500;
    pointer-events: none;
  }
  .has-prefix :global(.control) {
    padding-left: 30px;
  }
</style>
