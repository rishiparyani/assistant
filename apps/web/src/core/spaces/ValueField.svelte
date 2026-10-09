<script lang="ts">
  import type { CollectionView, FieldView, FindResult, LinkedRef } from "@assistant/shared";
  import X from "@lucide/svelte/icons/x";
  import { SelectField, TextArea, TextField } from "../ui/index.ts";
  import { readCache } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import { listKey, savedCollections, spacesApi } from "./spaces-api.ts";

  // One input for one field, by its type. Values are kept as the form types them (text,
  // "yes"/"no", a list of choices, linked records); the shared rules check them on save.
  let { field, value = $bindable(), error }: { field: FieldView; value: unknown; error?: string } = $props();

  const uid = $props.id();
  const id = $derived(`${uid}-${field.id}`);
  const label = $derived(field.required ? `${field.name} *` : field.name);

  // --- Choices
  const choices = $derived(field.options.choices ?? []);
  const picked = $derived(Array.isArray(value) ? (value as string[]) : []);
  function toggle(c: string) {
    value = picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c];
  }

  // --- Links: search the target collection (or saved records offline), tap to add.
  const links = $derived(Array.isArray(value) ? (value as LinkedRef[]) : []);
  const many = $derived(!!field.options.many);
  let target = $state<string>("");
  $effect(() => {
    if (field.type === "link") target = field.options.target ?? target;
  });
  const targets = $derived<CollectionView[]>(savedCollections() ?? []);
  let search = $state("");
  let results = $state<LinkedRef[]>([]);
  $effect(() => {
    if (field.type !== "link" || !target) return;
    const q = search.trim();
    const t = setTimeout(async () => {
      const toRef = (r: FindResult["items"][number]) => ({
        id: r.id,
        collection_id: r.collection_id,
        title: r.title,
      });
      if (!connection.online) {
        const saved = readCache<FindResult>(listKey(target))?.items ?? [];
        results = saved.filter((r) => r.title.toLowerCase().includes(q.toLowerCase())).map(toRef);
        return;
      }
      try {
        const found = await spacesApi.find(target, { search: q || undefined, limit: 20 }, true);
        results = found.items.map(toRef);
      } catch {
        results = [];
      }
    }, 200);
    return () => clearTimeout(t);
  });
  const options = $derived(results.filter((r) => !links.some((l) => l.id === r.id)).slice(0, 8));
  function add(r: LinkedRef) {
    value = many ? [...links, r] : [r];
    search = "";
  }
  const remove = (r: LinkedRef) => (value = links.filter((l) => l.id !== r.id));
</script>

{#if field.type === "long_text"}
  <TextArea {label} {id} bind:value={value as string} rows={4} maxlength={20000} {error} />
{:else if field.type === "number"}
  <TextField {label} {id} bind:value={value as string} inputmode="decimal" {error} />
{:else if field.type === "money"}
  <TextField {label} {id} bind:value={value as string} prefix="₹" inputmode="decimal" {error} />
{:else if field.type === "date"}
  <TextField {label} {id} type="date" bind:value={value as string} {error} />
{:else if field.type === "datetime"}
  <TextField {label} {id} type="datetime-local" bind:value={value as string} hint="India time" {error} />
{:else if field.type === "boolean"}
  <SelectField
    {label}
    {id}
    bind:value={value as string}
    options={[
      { value: "", label: "—" },
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ]}
    {error}
  />
{:else if field.type === "choice"}
  <SelectField
    {label}
    {id}
    bind:value={value as string}
    options={[{ value: "", label: "—" }, ...choices.map((c) => ({ value: c, label: c }))]}
    {error}
  />
{:else if field.type === "multi_choice"}
  <fieldset class="group">
    <legend>{label}</legend>
    <div class="chips">
      {#each choices as c (c)}
        <button
          type="button"
          class="chip"
          class:on={picked.includes(c)}
          aria-pressed={picked.includes(c)}
          onclick={() => toggle(c)}>{c}</button
        >
      {/each}
    </div>
    {#if error}<p class="error">{error}</p>{/if}
  </fieldset>
{:else if field.type === "link"}
  <fieldset class="group">
    <legend>{label}</legend>
    {#if links.length}
      <div class="chips">
        {#each links as l (l.id)}
          <span class="chip on linked">
            {l.title}
            <button type="button" aria-label="Remove {l.title}" onclick={() => remove(l)}
              ><X size={14} /></button
            >
          </span>
        {/each}
      </div>
    {/if}
    {#if !field.options.target}
      <SelectField
        label="Pick from"
        id="{id}-from"
        bind:value={target}
        options={[
          { value: "", label: "Choose a collection" },
          ...targets.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
    {/if}
    {#if target && (many || !links.length)}
      <input
        class="find"
        type="search"
        placeholder="Find a record to link"
        aria-label="Find a record to link to {field.name}"
        bind:value={search}
      />
      {#if options.length}
        <ul class="results">
          {#each options as r (r.id)}
            <li><button type="button" onclick={() => add(r)}>{r.title}</button></li>
          {/each}
        </ul>
      {:else if search.trim()}
        <p class="none">Nothing called that yet.</p>
      {/if}
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
  </fieldset>
{:else if field.type === "person"}
  <TextField {label} {id} bind:value={value as string} autocomplete="off" {error} />
{:else}
  <TextField {label} {id} bind:value={value as string} maxlength={500} {error} />
{/if}

<style>
  .group {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  legend {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
    margin-bottom: var(--space-2);
    padding: 0;
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
    padding: 0 var(--space-4);
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--text-base);
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-text);
    font-weight: 600;
  }
  .chip.linked {
    cursor: default;
    padding-right: var(--space-1);
  }
  .chip.linked button {
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
  .find {
    height: 44px;
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface);
  }
  .results li + li {
    border-top: 1px solid var(--separator);
  }
  .results button {
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-3);
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--text-base);
    text-align: left;
    cursor: pointer;
  }
  .results button:hover {
    background: var(--surface-hover);
  }
  .none,
  .error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-3);
  }
  .error {
    color: var(--red);
  }
</style>
