<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import Field from "./Field.svelte";

  type Props = Omit<HTMLTextareaAttributes, "value"> & {
    label: string;
    value?: string;
    hint?: string;
    error?: string;
  };
  let { label, value = $bindable(""), hint, error, id, ...rest }: Props = $props();
  const fieldId = $derived(id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`);
</script>

<Field {label} id={fieldId} {hint} {error}>
  <textarea class="control" id={fieldId} bind:value aria-invalid={!!error} {...rest}></textarea>
</Field>
