<script lang="ts" generics="T extends string">
  import { tick } from "svelte";
  import { revealTabs } from "./swipe.ts";

  // Tabs that own the content under them (a gig's Details · Money · People): an underline
  // slides to the open tab, and the bar stays under the top bar while that tab's content
  // scrolls, so it's always clear which tab you're in. For a choice or a filter inside a
  // page (All · Clients · Venues), use Segmented.
  let {
    options,
    value = $bindable(),
    label,
  }: { options: { value: T; label: string }[]; value: T; label: string } = $props();

  const at = $derived(
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
  let buttons: HTMLButtonElement[] = $state([]);

  // The bar can be tapped from far down a long tab: the new tab starts at its top.
  async function pick(v: T) {
    if (v === value) return;
    value = v;
    await tick();
    revealTabs(label);
  }

  // Arrow keys move between tabs (the tab pattern: one tab stop for the whole bar).
  function onkey(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (at + step + options.length) % options.length;
    void pick(options[next]!.value);
    buttons[next]?.focus();
  }
</script>

<div
  class="tabs"
  data-sticky-tabs
  role="tablist"
  aria-label={label}
  tabindex="-1"
  style:--n={options.length}
  onkeydown={onkey}
>
  {#each options as o, i (o.value)}
    <button
      bind:this={buttons[i]}
      type="button"
      role="tab"
      aria-selected={value === o.value}
      tabindex={value === o.value ? 0 : -1}
      class:active={value === o.value}
      onclick={() => pick(o.value)}>{o.label}</button
    >
  {/each}
  <span class="ink" aria-hidden="true" style:transform="translateX({at * 100}%)"></span>
</div>

<style>
  .tabs {
    --pad: var(--space-4);
    position: sticky;
    top: calc(var(--topbar-h) + var(--safe-top));
    z-index: 10;
    display: flex;
    /* Edge to edge on phones, like the top bar it sits under. */
    margin: 0 calc(-1 * var(--pad));
    padding: 0 var(--pad);
    background: var(--chrome);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid var(--separator);
    outline: none;
  }
  button {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0 var(--space-2);
    border: 0;
    background: transparent;
    font: inherit;
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-2);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s;
  }
  button:hover {
    color: var(--text);
  }
  .active {
    color: var(--accent-text);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -4px;
    border-radius: var(--radius);
  }
  /* The underline: its own track across the bar, sliding to the open tab. */
  .ink {
    position: absolute;
    left: var(--pad);
    bottom: -1px;
    width: calc((100% - 2 * var(--pad)) / var(--n));
    height: 3px;
    pointer-events: none;
    transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .ink::after {
    content: "";
    display: block;
    height: 100%;
    margin: 0 var(--space-4);
    border-radius: 3px 3px 0 0;
    background: var(--accent);
  }
  @media (min-width: 768px) {
    .tabs {
      --pad: 0px;
      top: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ink {
      transition: none;
    }
  }
</style>
