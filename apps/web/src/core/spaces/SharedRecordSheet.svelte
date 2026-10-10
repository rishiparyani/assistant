<script lang="ts">
  import {
    ValueError,
    ulid,
    type FieldOptions,
    type FieldType,
    type SharedOpened,
    type SharedRecord,
    type StoredValue,
  } from "@assistant/shared";
  import { untrack } from "svelte";
  import { Button, Sheet, toast } from "../ui/index.ts";
  import ValueField from "./ValueField.svelte";
  import { formValue, readForm, sendValues } from "./spaces-api.ts";
  import { sharesApi } from "./shares-api.ts";

  // Edit a record on a card shared with me, or add one to a section (a guest, say). Only the
  // fields shared with me show; the owner's space checks every change.
  type Field = { id: string; name: string; type: FieldType; options: FieldOptions };
  let {
    open = $bindable(false),
    shareId,
    fields,
    record = null,
    section = null,
    title,
    onsaved,
  }: {
    open?: boolean;
    shareId: string;
    fields: Field[];
    record?: SharedRecord | null;
    /** Adding: the section's key. */
    section?: string | null;
    title: string;
    onsaved: (card: SharedOpened) => void;
  } = $props();

  const uid = $props.id();
  let form = $state<Record<string, unknown>>({});
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  const full = $derived(fields.map((f) => ({ ...f, required: false, aliases: [] })));

  $effect(() => {
    if (!open) return;
    untrack(() => {
      form = Object.fromEntries(
        fields.map((f) => [f.id, formValue(f.type, record?.fields.find((x) => x.id === f.id)?.value)]),
      );
      errors = {};
    });
  });

  async function save(ev: SubmitEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    let values: Record<string, StoredValue> = {};
    for (const f of full) {
      try {
        values = { ...values, ...readForm([f], { [f.id]: form[f.id] }) };
      } catch (err) {
        e[f.id] = err instanceof ValueError ? err.message.replace(`${f.name}: `, "") : String(err);
      }
    }
    errors = e;
    if (Object.keys(e).length) return;
    if (record)
      for (const f of record.fields)
        if (JSON.stringify(values[f.id] ?? null) === JSON.stringify(f.value ?? null)) delete values[f.id];
    if (record && !Object.keys(values).length) {
      open = false;
      return;
    }
    busy = true;
    try {
      const body = sendValues(fields, values);
      const card = record
        ? await sharesApi.update(shareId, record.id, body)
        : await sharesApi.add(shareId, section!, ulid(), body);
      toast.success(record ? "Saved" : "Added");
      open = false;
      onsaved(card);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open {title}>
  <form id="shared-form-{uid}" class="form" onsubmit={save} novalidate>
    {#each full as f (f.id)}
      {#if f.id in form}<ValueField field={f} bind:value={form[f.id]} error={errors[f.id]} />{/if}
    {/each}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="shared-form-{uid}" loading={busy}
      >{record ? "Save" : "Add"}</Button
    >
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
  }
</style>
