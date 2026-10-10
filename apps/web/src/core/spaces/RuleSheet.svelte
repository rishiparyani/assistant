<script lang="ts">
  import type { CollectionView, Filter, RuleFilter } from "@assistant/shared";
  import X from "@lucide/svelte/icons/x";
  import { Button, Sheet, toast } from "../ui/index.ts";
  import FilterSheet from "./FilterSheet.svelte";
  import { filterLabel } from "./spaces-api.ts";

  // Which rows of a shared list someone sees (design §11 "which rows"): filters on top of the
  // view's own, for one person or for everyone in the share.
  let {
    open = $bindable(false),
    collection,
    who,
    rule,
    onsave,
  }: {
    open?: boolean;
    collection: CollectionView;
    who: string;
    rule: RuleFilter[];
    onsave: (filters: Filter[]) => Promise<void>;
  } = $props();

  let filters = $state<Filter[]>([]);
  let adding = $state(false);
  let busy = $state(false);
  $effect(() => {
    if (open) filters = rule.map((f) => ({ ...f }));
  });

  async function save() {
    busy = true;
    try {
      await onsave(filters);
      toast.success(filters.length ? "Rows limited" : "Shows every row in the list");
      open = false;
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Rows {who} sees">
  <div class="body">
    <p class="muted">
      On top of the list's own filters. With none, {who === "everyone" ? "everyone sees" : "they see"} every row
      in the list.
    </p>
    {#if filters.length}
      <div class="chips">
        {#each filters as f, i (i)}
          <span class="chip">
            {filterLabel(collection, f)}
            <button
              type="button"
              aria-label="Remove {filterLabel(collection, f)}"
              onclick={() => (filters = filters.filter((_, j) => j !== i))}><X size={14} /></button
            >
          </span>
        {/each}
      </div>
    {/if}
    <div class="actions">
      <Button onclick={() => (adding = true)}>Add a filter</Button>
    </div>
  </div>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" loading={busy} onclick={save}>Save</Button>
  {/snippet}
</Sheet>
<FilterSheet bind:open={adding} {collection} onadd={(f) => (filters = [...filters, f])} />

<style>
  .body {
    display: grid;
    gap: var(--space-4);
  }
  .muted {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 44px;
    padding: 0 var(--space-1) 0 var(--space-4);
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }
  .chip button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
