<script lang="ts">
  import { PERIODS, type CollectionView, type Filter, type FilterOp } from "@assistant/shared";
  import { PERIOD_LABELS } from "./spaces-api.ts";
  import { untrack } from "svelte";
  import { Button, SelectField, Sheet, TextField } from "../ui/index.ts";

  // Add one filter to a collection's view: a field, how to compare, and a value.
  let {
    open = $bindable(false),
    collection,
    onadd,
  }: { open?: boolean; collection: CollectionView; onadd: (f: Filter) => void } = $props();

  const uid = $props.id();
  let fieldId = $state("");
  let op = $state<FilterOp>("contains");
  let value = $state("");

  const field = $derived(collection.fields.find((f) => f.id === fieldId));
  const ops = $derived.by((): { value: FilterOp; label: string }[] => {
    const empty = [
      { value: "empty" as const, label: "is empty" },
      { value: "not_empty" as const, label: "is filled in" },
    ];
    switch (field?.type) {
      case "number":
      case "money":
        return [
          { value: "eq", label: "is" },
          { value: "gte", label: "at least" },
          { value: "lte", label: "at most" },
          ...empty,
        ];
      case "date":
      case "datetime":
        return [{ value: "period", label: "is in" }, ...empty];
      case "boolean":
      case "choice":
      case "multi_choice":
        return [{ value: "eq", label: "is" }, ...empty];
      case "link":
        return empty;
      default:
        return [{ value: "contains", label: "has" }, { value: "eq", label: "is exactly" }, ...empty];
    }
  });

  $effect(() => {
    if (!open) return;
    untrack(() => {
      fieldId = collection.fields.find((f) => !f.options.personal)?.id ?? "";
      value = "";
    });
  });
  // A new field: its first way of comparing.
  $effect(() => {
    void fieldId;
    untrack(() => {
      op = ops[0]?.value ?? "eq";
      value = field?.type === "date" || field?.type === "datetime" ? "this_month" : "";
    });
  });

  const needsValue = $derived(op !== "empty" && op !== "not_empty");

  function add(ev: SubmitEvent) {
    ev.preventDefault();
    if (!field || (needsValue && !value.trim())) return;
    onadd({ field: field.id, op, ...(needsValue ? { value: value.trim() } : {}) });
    open = false;
  }
</script>

<Sheet bind:open title="Filter">
  <form id="filter-form-{uid}" class="form" onsubmit={add}>
    <SelectField
      label="Field"
      id="{uid}-field"
      bind:value={fieldId}
      options={collection.fields
        .filter((f) => !f.options.personal)
        .map((f) => ({ value: f.id, label: f.name }))}
    />
    <SelectField label="Show records where it" id="{uid}-op" bind:value={op} options={ops} />
    {#if needsValue && field}
      {#if op === "period"}
        <SelectField
          label="When"
          id="{uid}-period"
          bind:value
          options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
        />
      {:else if field.type === "boolean"}
        <SelectField
          label="Value"
          id="{uid}-bool"
          bind:value
          options={[
            { value: "", label: "—" },
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
        />
      {:else if field.type === "choice" || field.type === "multi_choice"}
        <SelectField
          label="Value"
          id="{uid}-choice"
          bind:value
          options={[
            { value: "", label: "—" },
            ...(field.options.choices ?? []).map((c) => ({ value: c, label: c })),
          ]}
        />
      {:else}
        <TextField
          label="Value"
          id="{uid}-value"
          bind:value
          inputmode={field.type === "number" || field.type === "money" ? "decimal" : undefined}
          prefix={field.type === "money" ? "₹" : undefined}
        />
      {/if}
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="filter-form-{uid}">Add filter</Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
  }
</style>
