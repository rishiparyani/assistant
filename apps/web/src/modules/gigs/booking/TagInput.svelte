<script lang="ts">
  import X from "@lucide/svelte/icons/x";

  // Free-form tags as chips: type and press Enter (or comma) to add; suggestions come
  // from tags on my gigs so "Wedding" and "wedding" don't split.
  let {
    label,
    value = $bindable([]),
    suggestions = [],
    max = 10,
  }: { label: string; value?: string[]; suggestions?: string[]; max?: number } = $props();

  const uid = $props.id();
  let text = $state("");
  const key = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();
  const open = $derived(
    suggestions
      .filter((s) => !value.some((v) => key(v) === key(s)) && key(s).includes(key(text)))
      .slice(0, 8),
  );

  function add(raw: string) {
    const t = raw.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!t || value.length >= max || value.some((v) => key(v) === key(t))) return;
    // Prefer the existing spelling of a known tag.
    value = [...value, suggestions.find((s) => key(s) === key(t)) ?? t];
    text = "";
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && !text && value.length) {
      value = value.slice(0, -1);
    }
  }
</script>

<div class="field">
  <label class="label" for="tags-{uid}">{label}</label>
  <div class="box">
    {#each value as t (t)}
      <span class="chip"
        >{t}<button
          type="button"
          aria-label="Remove {t}"
          onclick={() => (value = value.filter((v) => v !== t))}><X size={14} /></button
        ></span
      >
    {/each}
    {#if value.length < max}
      <input
        id="tags-{uid}"
        bind:value={text}
        {onkeydown}
        onblur={() => add(text)}
        placeholder={value.length ? "Add another" : "e.g. Wedding, Out of town"}
        autocomplete="off"
        maxlength={60}
      />
    {/if}
  </div>
  {#if open.length && value.length < max}
    <div class="suggest" aria-label="Suggestions">
      {#each open as s (s)}
        <button type="button" onmousedown={(e) => e.preventDefault()} onclick={() => add(s)}>+ {s}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
  }
  .box {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  input {
    flex: 1;
    min-width: 120px;
    height: 34px;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 16px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 4px 0 12px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .chip button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .suggest {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .suggest button {
    min-height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-full);
    border: 1px dashed var(--border-strong);
    background: none;
    color: var(--text-2);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
  }
</style>
