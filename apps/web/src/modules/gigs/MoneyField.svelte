<script lang="ts">
  import { TextField } from "../../core/ui/index.ts";

  // Rupees as typed ("50000", "50,000.50"); the API parses and validates.
  let {
    label,
    value = $bindable(""),
    hint,
    required = false,
    placeholder = "0",
  }: { label: string; value?: string; hint?: string; required?: boolean; placeholder?: string } = $props();
</script>

<TextField
  {label}
  bind:value
  prefix="₹"
  inputmode="decimal"
  autocomplete="off"
  {placeholder}
  {hint}
  {required}
/>
