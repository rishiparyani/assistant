<script lang="ts">
  import { FIELD_TYPES, type CollectionView, type FieldType } from "@assistant/shared";
  import { SelectField, TextField } from "../ui/index.ts";
  import { TYPE_LABELS, type FieldSpec } from "./spaces-api.ts";

  // One field's settings: name, type, and what the type needs (choices, link target).
  let {
    field = $bindable(),
    collections,
    lockType = false,
  }: { field: FieldSpec; collections: CollectionView[]; lockType?: boolean } = $props();

  const uid = $props.id();

  let choicesText = $state((field.options?.choices ?? []).join(", "));
  function setChoices(text: string) {
    choicesText = text;
    const choices = text
      .split(/[,\n]/)
      .map((c) => c.trim())
      .filter(Boolean);
    field = { ...field, options: { ...field.options, choices } };
  }
  const setOption = (k: "target" | "many", v: string | boolean | null) =>
    (field = { ...field, options: { ...field.options, [k]: v } });
</script>

<div class="editor">
  <div class="row">
    <TextField label="Field name" id="{uid}-name" bind:value={field.name} maxlength={80} />
    <SelectField
      label="Type"
      id="{uid}-type"
      value={field.type}
      disabled={lockType}
      onchange={(e: Event) =>
        (field = { ...field, type: (e.target as HTMLSelectElement).value as FieldType })}
      options={FIELD_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
    />
  </div>
  {#if field.type === "choice" || field.type === "multi_choice"}
    <TextField
      label="Choices"
      id="{uid}-choices"
      value={choicesText}
      oninput={(e: Event) => setChoices((e.target as HTMLInputElement).value)}
      hint="Separated by commas: Food, Travel, Gear"
    />
  {:else if field.type === "link"}
    <div class="row">
      <SelectField
        label="Links to"
        id="{uid}-target"
        value={field.options?.target ?? ""}
        onchange={(e: Event) => setOption("target", (e.target as HTMLSelectElement).value || null)}
        options={[
          { value: "", label: "Any collection" },
          ...collections.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <SelectField
        label="How many"
        id="{uid}-many"
        value={field.options?.many ? "many" : "one"}
        onchange={(e: Event) => setOption("many", (e.target as HTMLSelectElement).value === "many")}
        options={[
          { value: "one", label: "One record" },
          { value: "many", label: "Several" },
        ]}
      />
    </div>
  {/if}
  <label class="check">
    <input
      type="checkbox"
      checked={!!field.required}
      onchange={(e) => (field = { ...field, required: (e.target as HTMLInputElement).checked })}
    />
    Must be filled in
  </label>
</div>

<style>
  .editor {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    font-size: var(--text-base);
    color: var(--text-2);
  }
  .check input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
</style>
