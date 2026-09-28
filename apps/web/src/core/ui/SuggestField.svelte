<script lang="ts" generics="T extends { id: string; name: string }">
  import type { HTMLInputAttributes } from "svelte/elements";
  import TextField from "./TextField.svelte";

  // A text field that offers matches while typing (e.g. from the address book). Typing
  // anything is still allowed; picking a match calls `onpick` so the caller can fill in
  // related fields (phone, city, email).
  type Props = Omit<HTMLInputAttributes, "value" | "prefix"> & {
    label: string;
    id: string;
    value?: string;
    hint?: string;
    load: (query: string) => Promise<T[]>;
    onpick: (item: T) => void;
    detail?: (item: T) => string | null | undefined;
  };
  let { label, id, value = $bindable(""), hint, load, onpick, detail, ...rest }: Props = $props();

  let items = $state<T[]>([]);
  let open = $state(false);
  let active = $state(-1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = 0;
  const listId = $derived(`${id}-suggestions`);

  function lookup() {
    clearTimeout(timer);
    const text = value.trim();
    const n = ++asked;
    timer = setTimeout(() => {
      load(text).then(
        (found) => {
          if (n !== asked) return; // a newer lookup is on its way
          // Nothing to offer when the only match is what's already typed.
          items = found
            .filter((i) => !(found.length === 1 && i.name.toLowerCase() === text.toLowerCase()))
            .slice(0, 6);
          active = -1;
        },
        () => (items = []),
      );
    }, 150);
  }

  function pick(item: T) {
    value = item.name;
    onpick(item);
    open = false;
    items = [];
  }

  function onkeydown(e: KeyboardEvent) {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + items.length) % items.length;
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(items[active]!);
    } else if (e.key === "Escape") {
      open = false;
    }
  }
</script>

<div class="suggest">
  <TextField
    {label}
    {id}
    {hint}
    bind:value
    autocomplete="off"
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={open && items.length > 0}
    aria-controls={listId}
    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
    onfocus={() => {
      open = true;
      lookup();
    }}
    oninput={() => {
      open = true;
      lookup();
    }}
    onblur={() => setTimeout(() => (open = false), 120)}
    {onkeydown}
    {...rest}
  />
  {#if open && items.length}
    <ul class="list" id={listId} role="listbox" aria-label="Suggestions for {label}">
      {#each items as item, i (item.id)}
        <!-- Keyboard choice happens in the text field (arrows, Enter), as in a combobox. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{listId}-{i}"
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => pick(item)}
        >
          <span class="name">{item.name}</span>
          {#if detail?.(item)}<span class="detail">{detail(item)}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .suggest {
    position: relative;
    min-width: 0;
  }
  .list {
    position: absolute;
    z-index: 20;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    max-height: 280px;
    overflow-y: auto;
  }
  li {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 44px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  li:hover,
  li.active {
    background: var(--surface-2);
  }
  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    color: var(--text-3);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
