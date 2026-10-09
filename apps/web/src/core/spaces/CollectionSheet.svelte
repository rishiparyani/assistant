<script lang="ts">
  import type { CollectionView, FieldType } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash from "@lucide/svelte/icons/trash-2";
  import { untrack } from "svelte";
  import { Button, Sheet, TextField, toast } from "../ui/index.ts";
  import { savedCollections, spacesApi, type FieldSpec } from "./spaces-api.ts";
  import FieldEditor from "./FieldEditor.svelte";

  // Make a collection by tapping (the assistant does the same by chat): a name and fields.
  let { open = $bindable(false), onsaved }: { open?: boolean; onsaved: (c: CollectionView) => void } =
    $props();

  const uid = $props.id();
  let name = $state("");
  let description = $state("");
  let fields = $state<FieldSpec[]>([]);
  // A stable key per field row, so removing one doesn't hand its editor to the next.
  let keys = $state<number[]>([]);
  let nextKey = 0;
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = "";
      description = "";
      fields = [{ name: "Title", type: "text", required: true }];
      keys = [nextKey++];
    });
  });

  const others = $derived(savedCollections() ?? []);

  async function save(ev: SubmitEvent) {
    ev.preventDefault();
    const named = fields.filter((f) => f.name.trim());
    if (!name.trim() || !named.length) return;
    busy = true;
    try {
      const c = await spacesApi.createCollection({
        name: name.trim(),
        description: description.trim() || null,
        fields: named.map((f) => ({ ...f, name: f.name.trim() })),
      });
      toast.success(`Made ${c.name}`);
      open = false;
      onsaved(c);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  const blank = (): FieldSpec => ({ name: "", type: "text" as FieldType });
</script>

<Sheet bind:open title="New collection">
  <form id="collection-form-{uid}" class="form" onsubmit={save}>
    <TextField
      label="Name"
      id="{uid}-name"
      bind:value={name}
      required
      maxlength={80}
      placeholder="Expenses, Gigs, Fam jam sign-ups…"
    />
    <TextField label="What it's for" id="{uid}-desc" bind:value={description} maxlength={300} />
    <div class="fields">
      <h3>Fields</h3>
      <p class="fine">The first text field is each record's title.</p>
      {#each fields as f, i (keys[i])}
        <div class="field">
          <FieldEditor bind:field={fields[i]!} collections={others} />
          {#if i > 0}
            <button
              type="button"
              class="remove"
              aria-label="Remove {f.name || 'field'}"
              onclick={() => {
                fields = fields.filter((_, j) => j !== i);
                keys = keys.filter((_, j) => j !== i);
              }}><Trash size={16} /></button
            >
          {/if}
        </div>
      {/each}
      <Button
        variant="tinted"
        onclick={() => {
          fields = [...fields, blank()];
          keys = [...keys, nextKey++];
        }}
      >
        {#snippet icon()}<Plus />{/snippet}
        Add a field
      </Button>
    </div>
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="collection-form-{uid}" loading={busy}>Make it</Button>
  {/snippet}
</Sheet>

<style>
  .form,
  .fields {
    display: grid;
    gap: var(--space-4);
  }
  h3 {
    margin: 0;
    font-size: var(--text-md);
  }
  .fine {
    margin: calc(-1 * var(--space-3)) 0 0;
    color: var(--text-3);
    font-size: var(--text-sm);
  }
  .field {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-2);
    align-items: start;
    padding: var(--space-3);
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--separator);
  }
  .remove {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }
</style>
