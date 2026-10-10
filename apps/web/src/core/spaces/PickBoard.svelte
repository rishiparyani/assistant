<script lang="ts">
  import { untrack } from "svelte";
  import type { CollectionView, FindResult, RecordView } from "@assistant/shared";
  import Check from "@lucide/svelte/icons/check";
  import { Button, EmptyState, Pill, SelectField, Sheet, Skeleton, confirm, toast } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { listKey, spacesApi, updateRecords } from "./spaces-api.ts";

  // A pick board (chat-first step 6; universal.md §5 "Consolidating"): records grouped by a
  // link or choice (Song), then by a choice (Instrument). Tapping one sets the pick field to
  // the picked value (Status → Selected); if someone already has that place, it asks to
  // replace them. Plain record writes, so it works offline and the list's rules still apply
  // when they sync. The board's settings are this device's own.
  let { open = $bindable(false), collection }: { open?: boolean; collection: CollectionView } = $props();

  const fields = $derived(collection.fields.filter((f) => !f.options.personal));
  const groupable = $derived(
    fields.filter((f) => (f.type === "link" && !f.options.many) || f.type === "choice"),
  );
  const choices = $derived(fields.filter((f) => f.type === "choice"));

  type Settings = { group: string; then: string; pick: string; picked: string; rest: string };
  const storeKey = () => `board:${collection.id}`;
  let s = $state<Settings>({ group: "", then: "", pick: "", picked: "", rest: "" });
  // Sensible first guesses: group by the first link, pick with the last choice field.
  function guess(): Settings {
    const pick = choices.at(-1);
    const group = groupable.find((f) => f.type === "link") ?? groupable.find((f) => f.id !== pick?.id);
    const then = choices.find((f) => f.id !== pick?.id && f.id !== group?.id);
    const opts = pick?.options.choices ?? [];
    return {
      group: group?.id ?? "",
      then: then?.id ?? "",
      pick: pick?.id ?? "",
      picked: opts[1] ?? opts[0] ?? "",
      rest: opts[2] ?? "",
    };
  }
  $effect(() => {
    if (!open) return;
    let saved: Settings | null;
    try {
      saved = JSON.parse(localStorage.getItem(storeKey()) ?? "null") as Settings | null;
    } catch {
      saved = null;
    }
    const ok = (id: string) => !id || fields.some((f) => f.id === id);
    s = saved && ok(saved.group) && ok(saved.then) && ok(saved.pick) ? saved : guess();
  });
  $effect(() => {
    const value = JSON.stringify(s);
    if (!open) return;
    try {
      localStorage.setItem(storeKey(), value);
    } catch {
      // Private mode: the board still works, it just won't remember.
    }
  });
  const pickChoices = $derived(choices.find((f) => f.id === s.pick)?.options.choices ?? []);
  // Another pick field: its own values, not the old field's.
  $effect(() => {
    const opts = pickChoices;
    untrack(() => {
      if (s.picked && !opts.includes(s.picked)) s.picked = opts[1] ?? opts[0] ?? "";
      if (s.rest && !opts.includes(s.rest)) s.rest = "";
    });
  });

  // The whole list (up to 500), in one cached result the record appliers keep current (a
  // list key of its own, which the offline appliers can read).
  const query = { limit: 100 };
  const list = createQuery<FindResult>(
    () => listKey(collection.id, { limit: 500 }),
    async () => {
      let page = await spacesApi.find(collection.id, query);
      const items = [...page.items];
      for (let i = 0; i < 4 && page.next_cursor; i++) {
        page = await spacesApi.find(collection.id, { ...query, cursor: page.next_cursor });
        items.push(...page.items);
      }
      return { ...page, items, next_cursor: page.next_cursor };
    },
  );

  /** What a cell is keyed by: a linked record's id (titles can repeat), else the value. */
  const keyOf = (r: RecordView, fid: string): string => {
    if (!fid) return "";
    const f = fields.find((x) => x.id === fid);
    if (f?.type === "link") return r.links[fid]?.[0]?.id ?? "";
    const v = r.values[fid];
    return typeof v === "string" ? v : "";
  };
  const labelOf = (r: RecordView, fid: string): string => {
    if (!fid) return "";
    const f = fields.find((x) => x.id === fid);
    if (f?.type === "link") return r.links[fid]?.[0]?.title ?? "Not linked";
    const v = r.values[fid];
    return typeof v === "string" && v ? v : "Not set";
  };
  type Cell = { key: string; group: string; then: string; items: RecordView[] };
  const cells = $derived.by(() => {
    // A plain map, built fresh on each run (not state).
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const out = new Map<string, Cell>();
    for (const r of list.data?.items ?? []) {
      const group = labelOf(r, s.group);
      const then = labelOf(r, s.then);
      const key = `${keyOf(r, s.group)}\u0000${keyOf(r, s.then)}`;
      const cell = out.get(key) ?? { key, group, then, items: [] };
      cell.items.push(r);
      out.set(key, cell);
    }
    return [...out.values()].sort((a, b) => a.group.localeCompare(b.group) || a.then.localeCompare(b.then));
  });
  const isPicked = (r: RecordView) => !!s.pick && r.values[s.pick] === s.picked;
  const isRest = (r: RecordView) => !!s.rest && r.values[s.pick] === s.rest;
  const filled = $derived(cells.filter((c) => c.items.some(isPicked)).length);
  const ready = $derived(!!s.group && !!s.pick && pickChoices.includes(s.picked));

  // One write for all of them: a replacement happens whole, or not at all.
  const setPicks = (list: { r: RecordView; value: string }[]) =>
    updateRecords(
      collection,
      list.map(({ r, value }) => ({ record: r, values: { [s.pick]: value } })),
    );

  async function tap(cell: Cell, r: RecordView) {
    if (!ready || isPicked(r)) return;
    const holders = cell.items.filter((x) => x.id !== r.id && isPicked(x));
    const back = s.rest || pickChoices.find((c) => c !== s.picked) || "";
    if (holders.length) {
      const ok = await confirm({
        title: `Replace ${holders.map((h) => h.title).join(", ")} with ${r.title}?`,
        message: back ? `${holders.length === 1 ? "They" : "They all"} become ${back}.` : undefined,
        confirmLabel: "Replace",
      });
      if (!ok || !back) return;
    }
    try {
      await setPicks([...holders.map((h) => ({ r: h, value: back })), { r, value: s.picked }]);
    } catch (e) {
      toast.error(e);
    }
  }

  // Everyone not picked in a place that's filled gets the "rest" value ("Not this time").
  async function closeRest() {
    const todo = cells
      .filter((c) => c.items.some(isPicked))
      .flatMap((c) => c.items.filter((r) => !isPicked(r) && !isRest(r)));
    if (!todo.length) {
      toast.success("Nothing left to mark");
      return;
    }
    const ok = await confirm({
      title: `Mark ${todo.length} ${todo.length === 1 ? "other" : "others"} ${s.rest}?`,
      message: "Only in places someone is picked for.",
      confirmLabel: "Mark them",
    });
    if (!ok) return;
    try {
      // In writes of up to 50 (the most one write takes).
      for (let i = 0; i < todo.length; i += 50)
        await setPicks(todo.slice(i, i + 50).map((r) => ({ r, value: s.rest })));
    } catch (e) {
      toast.error(e);
    }
  }
</script>

<Sheet bind:open title="Pick from {collection.name}">
  <div class="body">
    <div class="settings">
      <SelectField
        label="Group by"
        id="board-group"
        bind:value={s.group}
        options={[
          { value: "", label: "Pick one" },
          ...groupable.map((f) => ({ value: f.id, label: f.name })),
        ]}
      />
      <SelectField
        label="Then by"
        id="board-then"
        bind:value={s.then}
        options={[
          { value: "", label: "Nothing" },
          ...choices.filter((f) => f.id !== s.group).map((f) => ({ value: f.id, label: f.name })),
        ]}
      />
      <SelectField
        label="Picking sets"
        id="board-pick"
        bind:value={s.pick}
        options={[{ value: "", label: "Pick one" }, ...choices.map((f) => ({ value: f.id, label: f.name }))]}
      />
      {#if s.pick}
        <SelectField
          label="To"
          id="board-picked"
          bind:value={s.picked}
          options={pickChoices.map((c) => ({ value: c, label: c }))}
        />
        <SelectField
          label="The rest become"
          id="board-rest"
          bind:value={s.rest}
          options={[
            { value: "", label: "Leave them" },
            ...pickChoices.filter((c) => c !== s.picked).map((c) => ({ value: c, label: c })),
          ]}
        />
      {/if}
    </div>

    {#if !ready}
      <EmptyState
        title="Choose how to group and pick"
        text="For example: group by Song, then by Instrument; picking sets Status to Selected."
      />
    {:else if list.data}
      {#if cells.length}
        <p class="summary">{filled} of {cells.length} {cells.length === 1 ? "place" : "places"} filled</p>
        <div class="cells">
          {#each cells as cell (cell.key)}
            <section class="cell" aria-label="{cell.group}{cell.then ? `, ${cell.then}` : ''}">
              <header>
                <span class="group">{cell.group}</span>
                {#if cell.then}<span class="then">{cell.then}</span>{/if}
                {#if !cell.items.some(isPicked)}<Pill tone="amber">No one yet</Pill>{/if}
              </header>
              <div class="people">
                {#each cell.items as r (r.id)}
                  <button
                    type="button"
                    class="person"
                    class:picked={isPicked(r)}
                    class:rest={isRest(r)}
                    aria-pressed={isPicked(r)}
                    onclick={() => tap(cell, r)}
                  >
                    {#if isPicked(r)}<Check size={16} aria-hidden="true" />{/if}
                    {r.title}
                  </button>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {:else}
        <EmptyState title="Nothing here yet" text="Records show here as people add them." />
      {/if}
    {:else if list.error}
      <EmptyState title="Can't open this" text="You may be offline and it isn't saved on this device yet." />
    {:else}
      <Skeleton rows={4} label="Loading" />
    {/if}
  </div>
  {#snippet footer()}
    {#if ready && s.rest}
      <Button onclick={closeRest}>Mark the rest {s.rest}</Button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .body {
    display: grid;
    gap: var(--space-4);
  }
  .settings {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
  }
  .summary {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .cells {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }
  .cell {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .group {
    font-weight: 600;
  }
  .then {
    color: var(--text-2);
  }
  .people {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .person {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 44px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .person.picked {
    background: var(--kind-form-soft);
    border-color: var(--kind-form);
    color: var(--kind-form);
    font-weight: 600;
  }
  .person.rest {
    color: var(--text-3);
    text-decoration: line-through;
  }
</style>
