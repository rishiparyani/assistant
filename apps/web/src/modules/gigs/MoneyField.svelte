<script lang="ts">
  import { TextField } from "../../core/ui/index.ts";

  // Rupees as typed ("50000", "50,000.50"); the API parses and validates.
  let {
    label,
    value = $bindable(""),
    hint,
    required = false,
    placeholder = "0",
    id,
  }: {
    label: string;
    value?: string;
    hint?: string;
    required?: boolean;
    placeholder?: string;
    id?: string;
  } = $props();
  // Unique per instance: the same form can be on a page twice (payment and payout sheets).
  const uid = $props.id();
</script>

<TextField
  {label}
  id={id ?? `money-${uid}`}
  bind:value
  prefix="₹"
  inputmode="decimal"
  autocomplete="off"
  {placeholder}
  {hint}
  {required}
/>
