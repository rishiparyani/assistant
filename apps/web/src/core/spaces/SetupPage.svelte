<script lang="ts">
  import type { CollectionView, FieldView } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import { untrack } from "svelte";
  import {
    Button,
    Card,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Sheet,
    Skeleton,
    TextField,
    confirm,
    toast,
  } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import { COLLECTIONS_KEY, spacesApi, TYPE_LABELS, type FieldSpec } from "./spaces-api.ts";
  import FieldEditor from "./FieldEditor.svelte";

  // A collection's setup: its name and fields. Changing a setup needs a connection.
  let { collectionId }: { collectionId: string } = $props();

  const col = createQuery<CollectionView>(
    () => `spaces:collection:${collectionId}`,
    () => spacesApi.collection(collectionId),
  );
  const all = createQuery<CollectionView[]>(() => COLLECTIONS_KEY, spacesApi.collections);
  const collection = $derived(col.data);

  let name = $state("");
  let description = $state("");
  $effect(() => {
    const c = collection;
    if (c)
      untrack(() => {
        name = c.name;
        description = c.description ?? "";
      });
  });

  let busy = $state(false);
  /** Runs a setup change and shows the new setup. */
  async function change(fn: () => Promise<CollectionView>, done: string) {
    if (!connection.online) {
      toast.error("Changing a setup needs a connection.");
      return false;
    }
    busy = true;
    try {
      const c = await fn();
      col.set(c);
      void all.refresh();
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      busy = false;
    }
  }

  const saveNames = (ev: SubmitEvent) => {
    ev.preventDefault();
    if (!collection) return;
    void change(
      () =>
        spacesApi.updateCollection(collection.id, {
          name: name.trim(),
          description: description.trim() || null,
        }),
      "Saved",
    );
  };

  // One field in a sheet: a new one, or changes to an existing one (its type stays).
  let editing = $state<{ field: FieldSpec; existing: FieldView | null } | null>(null);
  let sheetOpen = $state(false);
  function open(f: FieldView | null) {
    editing = {
      existing: f,
      field: f
        ? { name: f.name, type: f.type, options: { ...f.options }, required: f.required, aliases: f.aliases }
        : { name: "", type: "text" },
    };
    sheetOpen = true;
  }
  async function saveField(ev: SubmitEvent) {
    ev.preventDefault();
    if (!collection || !editing || !editing.field.name.trim()) return;
    const { field, existing } = editing;
    const spec = { ...field, name: field.name.trim() };
    const ok = existing
      ? await change(
          () =>
            spacesApi.updateField(collection.id, existing.id, {
              name: spec.name,
              required: spec.required ?? false,
              ...(existing.type === "choice" || existing.type === "multi_choice" || existing.type === "link"
                ? { options: spec.options }
                : {}),
            }),
          "Field saved",
        )
      : await change(() => spacesApi.addField(collection.id, spec), "Field added");
    if (ok) sheetOpen = false;
  }
  async function removeField() {
    if (!collection || !editing?.existing) return;
    const f = editing.existing;
    const yes = await confirm({
      title: `Hide “${f.name}”?`,
      message: "Its values are kept, so it can come back. Reports can still use them.",
      confirmLabel: "Hide",
      destructive: true,
    });
    if (yes && (await change(() => spacesApi.removeField(collection.id, f.id), "Field hidden")))
      sheetOpen = false;
  }
  const others = $derived((all.data ?? []).filter((c) => c.id !== collectionId));
</script>

<PageHeader
  title={collection ? `${collection.name}: setup` : "Setup"}
  back="/c/{collectionId}"
  backLabel={collection?.name ?? "Back"}
/>

{#if !collection}
  {#if col.error}
    <EmptyState title="Can't open this" text="It may have been removed, or you're offline." />
  {:else}
    <Skeleton rows={5} label="Loading" />
  {/if}
{:else}
  <div class="stack">
    <Card>
      <form class="form" onsubmit={saveNames}>
        <TextField label="Name" id="setup-name" bind:value={name} required maxlength={80} />
        <TextField label="What it's for" id="setup-desc" bind:value={description} maxlength={300} />
        <div><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Card>

    <ListGroup title="Fields" footer="The title field names each record. Hidden fields keep their values.">
      {#each collection.fields as f (f.id)}
        <ListRow
          title={f.name}
          subtitle={[
            TYPE_LABELS[f.type],
            f.id === collection.title_field_id ? "title" : null,
            f.required ? "must be filled in" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          onclick={() => open(f)}
          chevron
        />
      {/each}
      <ListRow title="Add a field" onclick={() => open(null)} chevron={false}>
        {#snippet leading()}<span class="add"><Plus size={18} /></span>{/snippet}
      </ListRow>
    </ListGroup>

    {#if collection.linked_from.length}
      <ListGroup title="Linked from">
        {#each collection.linked_from as l (l.field_id)}
          <ListRow title={l.collection} subtitle="through {l.field}" href="/c/{l.collection_id}" chevron />
        {/each}
      </ListGroup>
    {/if}
  </div>

  <Sheet bind:open={sheetOpen} title={editing?.existing ? `Field: ${editing.existing.name}` : "New field"}>
    {#if editing}
      <form id="field-form" class="form" onsubmit={saveField}>
        <FieldEditor bind:field={editing.field} collections={others} lockType={!!editing.existing} />
        {#if editing.existing}<p class="fine">A field's type can't change; add a new field instead.</p>{/if}
      </form>
    {/if}
    {#snippet footer()}
      {#if editing?.existing && editing.existing.id !== collection?.title_field_id}
        <Button variant="danger" onclick={removeField} disabled={busy}>Hide</Button>
      {:else}
        <Button onclick={() => (sheetOpen = false)}>Cancel</Button>
      {/if}
      <Button variant="primary" type="submit" form="field-form" loading={busy}
        >{editing?.existing ? "Save" : "Add"}</Button
      >
    {/snippet}
  </Sheet>
{/if}

<style>
  .stack {
    display: grid;
    gap: var(--space-6);
    max-width: 640px;
  }
  .form {
    display: grid;
    gap: var(--space-4);
  }
  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .fine {
    margin: 0;
    color: var(--text-3);
    font-size: var(--text-sm);
  }
</style>
