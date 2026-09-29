<script lang="ts">
  import { DEFAULT_GIG_TYPES } from "@assistant/shared";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash from "@lucide/svelte/icons/trash-2";
  import Plus from "@lucide/svelte/icons/plus";
  import { ListGroup, Spinner, confirm, toast } from "../../../core/ui/index.ts";
  import { createQuery } from "../../../core/query.svelte.ts";
  import { bookingsApi } from "../gigs-api.ts";

  // Settings → Gig types: my own list (Public and Private to start), offered when I make
  // or edit a gig. Every change saves at once. Gigs keep their type's name.
  const q = createQuery(
    () => "me:gig-types",
    () => bookingsApi.gigTypes(),
  );
  const types = $derived(q.data?.types ?? null);
  let draft = $state("");
  let editing = $state<number | null>(null);
  let editText = $state("");
  let busy = $state(false);

  async function save(next: string[], done?: string) {
    busy = true;
    try {
      q.set(await bookingsApi.setGigTypes(next));
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      busy = false;
    }
  }

  const clash = (name: string, except = -1) =>
    (types ?? []).some((t, i) => i !== except && t.toLowerCase() === name.toLowerCase());

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name || !types) return;
    if (clash(name)) return toast.error(`“${name}” is already a type`);
    if (await save([...types, name], "Type added")) draft = "";
  }

  async function rename(i: number) {
    const name = editText.trim().replace(/\s+/g, " ");
    if (!types || !name || name === types[i]) return void (editing = null);
    if (clash(name, i)) return toast.error(`“${name}” is already a type`);
    if (
      await save(
        types.map((t, j) => (j === i ? name : t)),
        "Renamed",
      )
    )
      editing = null;
  }

  const up = (i: number) => {
    if (!types || i === 0) return;
    const next = [...types];
    next.splice(i - 1, 0, ...next.splice(i, 1));
    void save(next);
  };

  async function remove(i: number) {
    if (!types) return;
    const ok = await confirm({
      title: `Remove “${types[i]}”?`,
      message: "Gigs that already have this type keep it.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok)
      await save(
        types.filter((_, j) => j !== i),
        "Type removed",
      );
  }
</script>

<ListGroup
  title="Gig types"
  footer="Offered when you make or edit a gig. Changing a type here doesn't change gigs that already have it."
>
  {#if types === null}
    <div class="row"><Spinner size={18} label="Loading…" /></div>
  {:else}
    {#each types as t, i (t)}
      <div class="row">
        {#if editing === i}
          <form class="edit" onsubmit={(e) => (e.preventDefault(), void rename(i))}>
            <input
              aria-label="Rename {t}"
              maxlength={40}
              bind:value={editText}
              onkeydown={(e) => e.key === "Escape" && (editing = null)}
            />
            <button class="link" type="submit" disabled={busy}>Save</button>
          </form>
        {:else}
          <span class="name">{t}</span>
          <button
            class="icon"
            type="button"
            aria-label="Move {t} up"
            disabled={busy || i === 0}
            onclick={() => up(i)}><ArrowUp size={18} /></button
          >
          <button
            class="icon"
            type="button"
            aria-label="Rename {t}"
            disabled={busy}
            onclick={() => ((editing = i), (editText = t))}><Pencil size={18} /></button
          >
          <button
            class="icon danger"
            type="button"
            aria-label="Remove {t}"
            disabled={busy}
            onclick={() => remove(i)}><Trash size={18} /></button
          >
        {/if}
      </div>
    {:else}
      <div class="row muted">No types. Gigs can still be made without one.</div>
    {/each}
    <form class="row add" onsubmit={add}>
      <Plus size={18} />
      <input
        placeholder="Add a type, e.g. Wedding"
        aria-label="New gig type"
        maxlength={40}
        bind:value={draft}
      />
      {#if draft.trim()}<button class="link" type="submit" disabled={busy}>Add</button>{/if}
    </form>
    {#if types.join() !== DEFAULT_GIG_TYPES.join()}
      <div class="row">
        <button
          class="link"
          type="button"
          disabled={busy}
          onclick={() => save([...DEFAULT_GIG_TYPES], "Back to Public and Private")}
          >Reset to Public and Private</button
        >
      </div>
    {/if}
  {/if}
</ListGroup>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 52px;
    padding: 0 var(--space-2) 0 var(--space-4);
  }
  .row + .row {
    border-top: 1px solid var(--separator);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .icon {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    flex: none;
  }
  .icon:disabled {
    color: var(--text-3);
    cursor: default;
  }
  .icon.danger {
    color: var(--red);
  }
  .edit,
  .add {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .add {
    color: var(--accent-text);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 16px;
    outline: none;
  }
  .edit input {
    border-bottom: 1px solid var(--accent);
  }
  .link {
    border: 0;
    background: transparent;
    color: var(--accent-text);
    font: inherit;
    font-weight: 600;
    min-height: 44px;
    padding: 0 var(--space-2);
    cursor: pointer;
  }
</style>
