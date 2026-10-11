<script lang="ts">
  import { ValueError, type CollectionView, type StoredValue } from "@assistant/shared";
  import { Button, Pill, toast } from "../ui/index.ts";
  import { connection } from "../offline.svelte.ts";
  import { outbox } from "../outbox.svelte.ts";
  import ValueField from "./ValueField.svelte";
  import { addRecord, formValue, readForm } from "./spaces-api.ts";

  // A quick add the person asked the chat for (decision "Chat makes, screens use"): an add
  // box with just the fields they chose, on their saved view. Works offline (the new record
  // waits in the outbox and syncs later).
  let { collection, fieldIds }: { collection: CollectionView; fieldIds: string[] } = $props();

  const uid = $props.id();
  const fields = $derived(
    fieldIds.map((id) => collection.fields.find((f) => f.id === id)).filter((f) => f !== undefined),
  );
  const blank = () => Object.fromEntries(fields.map((f) => [f.id, formValue(f.type, undefined)]));
  let form = $state<Record<string, unknown>>({});
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  // What this box added that hasn't reached the server yet (offline): shown here at once.
  let added = $state<{ id: string; title: string }[]>([]);
  const waiting = $derived(
    added.filter((a) => outbox.waiting.some((c) => (c.args as { id?: string } | undefined)?.id === a.id)),
  );
  $effect(() => {
    void fieldIds;
    form = blank();
  });

  async function add(ev: SubmitEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    let values: Record<string, StoredValue> = {};
    for (const f of fields) {
      try {
        values = { ...values, ...readForm([f], { [f.id]: form[f.id] }) };
      } catch (err) {
        e[f.id] = err instanceof ValueError ? err.message.replace(`${f.name}: `, "") : String(err);
      }
      if (!e[f.id] && f.required && (values[f.id] === null || values[f.id] === undefined)) e[f.id] = "Needed";
    }
    errors = e;
    if (Object.keys(e).length) return;
    busy = true;
    try {
      const title = String(values[collection.title_field_id] ?? "New record");
      const id = await addRecord(collection, { values, links: {} });
      added = [...added, { id, title }];
      toast.success(connection.online ? "Added" : "Saved on this device; it syncs when you're back online");
      form = blank();
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<form
  id="quick-add-{uid}"
  class="quick"
  onsubmit={add}
  novalidate
  aria-label="Quick add to {collection.name}"
>
  {#each fields as f (f.id)}
    {#if f.id in form}<ValueField field={f} bind:value={form[f.id]} error={errors[f.id]} />{/if}
  {/each}
  <Button variant="primary" type="submit" loading={busy}>Add</Button>
  {#if waiting.length}
    <ul class="waiting" aria-label="Waiting to sync">
      {#each waiting as w (w.id)}
        <li><span>{w.title}</span><Pill tone="amber">Waiting</Pill></li>
      {/each}
    </ul>
  {/if}
</form>

<style>
  .waiting {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .waiting li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-2);
  }
  .quick {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    margin-bottom: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--border);
  }
</style>
