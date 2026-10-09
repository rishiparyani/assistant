<script lang="ts">
  import {
    ValueError,
    type CollectionView,
    type LinkedRef,
    type RecordView,
    type StoredValue,
  } from "@assistant/shared";
  import { untrack } from "svelte";
  import { Button, Sheet, toast } from "../ui/index.ts";
  import { connection } from "../offline.svelte.ts";
  import ValueField from "./ValueField.svelte";
  import { addRecord, readForm, updateRecord } from "./spaces-api.ts";

  // Add a record to a collection, or edit one: a form made from the collection's fields.
  // Works offline: the change waits in the outbox and syncs later.
  let {
    open = $bindable(false),
    collection,
    record = null,
    links: prefill = {},
    onsaved,
  }: {
    open?: boolean;
    collection: CollectionView;
    record?: RecordView | null;
    /** Links to start with (adding from a linked section, e.g. a rehearsal for this gig). */
    links?: Record<string, LinkedRef[]>;
    onsaved?: (id: string) => void;
  } = $props();

  const uid = $props.id();
  let form = $state<Record<string, unknown>>({});
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  const IST = 330 * 60_000;
  /** A stored value as the form shows it. */
  function toForm(type: string, v: StoredValue | undefined): unknown {
    if (v === null || v === undefined) return type === "multi_choice" ? [] : "";
    if (type === "money") return String((v as number) / 100);
    if (type === "datetime") return new Date(Date.parse(v as string) + IST).toISOString().slice(0, 16);
    if (type === "boolean") return v ? "yes" : "no";
    if (type === "person") return (v as { name: string }).name;
    if (type === "multi_choice") return [...(v as string[])];
    return String(v);
  }

  $effect(() => {
    if (!open) return;
    untrack(() => {
      const next: Record<string, unknown> = {};
      for (const f of collection.fields)
        next[f.id] =
          f.type === "link"
            ? [...(record?.links[f.id] ?? prefill[f.id] ?? [])]
            : toForm(f.type, record?.values[f.id]);
      form = next;
      errors = {};
    });
  });

  async function save(ev: SubmitEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    let values: Record<string, StoredValue> = {};
    const fields = collection.fields;
    // Check each field on its own so every problem shows at once.
    for (const f of fields) {
      if (f.type === "link") continue;
      try {
        values = { ...values, ...readForm([f], { [f.id]: form[f.id] }) };
      } catch (err) {
        e[f.id] = err instanceof ValueError ? err.message.replace(`${f.name}: `, "") : String(err);
      }
    }
    const links: Record<string, LinkedRef[]> = {};
    for (const f of fields) if (f.type === "link") links[f.id] = form[f.id] as LinkedRef[];
    for (const f of fields)
      if (f.required && !e[f.id] && (f.type === "link" ? !links[f.id]?.length : values[f.id] === null))
        e[f.id] = "Needed";
    errors = e;
    if (Object.keys(e).length) return;
    // An edit sends only what changed.
    if (record) {
      for (const f of fields) {
        if (f.type === "link") {
          const was = (record.links[f.id] ?? []).map((l) => l.id).join();
          if (links[f.id]!.map((l) => l.id).join() === was) delete links[f.id];
        } else if (JSON.stringify(values[f.id] ?? null) === JSON.stringify(record.values[f.id] ?? null))
          delete values[f.id];
      }
      if (!Object.keys(values).length && !Object.keys(links).length) {
        open = false;
        return;
      }
    }
    busy = true;
    try {
      const id = record
        ? (await updateRecord(collection, record, { values, links }), record.id)
        : await addRecord(collection, { values, links });
      toast.success(
        connection.online
          ? record
            ? "Saved"
            : "Added"
          : "Saved on this device; it syncs when you're back online",
      );
      open = false;
      onsaved?.(id);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={record ? `Edit ${record.title}` : `New in ${collection.name}`}>
  <form id="record-form-{uid}" class="form" onsubmit={save} novalidate>
    {#each collection.fields as f (f.id)}
      {#if f.id in form}<ValueField field={f} bind:value={form[f.id]} error={errors[f.id]} />{/if}
    {/each}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="record-form-{uid}" loading={busy}
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
