<script lang="ts">
  import type { Component } from "svelte";
  import Sheet from "./Sheet.svelte";

  // A list of less-used actions behind a "More" button (iOS action sheet): keeps pages to
  // their main buttons. Picking one closes the sheet first.
  export interface Action {
    label: string;
    icon?: Component<{ size?: number }>;
    destructive?: boolean;
    onclick: () => void;
  }
  let {
    open = $bindable(false),
    title,
    actions,
  }: { open?: boolean; title: string; actions: Action[] } = $props();

  function pick(a: Action) {
    open = false;
    a.onclick();
  }
</script>

<Sheet bind:open {title}>
  <div class="actions">
    {#each actions as a (a.label)}
      <button type="button" class="action" class:destructive={a.destructive} onclick={() => pick(a)}>
        {#if a.icon}<a.icon size={20} />{/if}
        <span>{a.label}</span>
      </button>
    {/each}
  </div>
</Sheet>

<style>
  .actions {
    display: grid;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .action {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 52px;
    padding: 0 var(--space-4);
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  .action + .action {
    border-top: 1px solid var(--separator);
  }
  .action:hover {
    background: var(--surface-hover);
  }
  .action :global(svg) {
    color: var(--text-3);
  }
  .destructive,
  .destructive :global(svg) {
    color: var(--red);
  }
</style>
