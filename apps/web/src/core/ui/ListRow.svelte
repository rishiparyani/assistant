<script lang="ts">
  import type { Snippet } from "svelte";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";

  // One row: [leading] title / subtitle … [trailing] [chevron]. A link if `href`,
  // a button if `onclick`, otherwise static.
  let {
    title,
    subtitle,
    href,
    onclick,
    leading,
    trailing,
    chevron,
    destructive = false,
    children,
  }: {
    title?: string;
    subtitle?: string;
    href?: string;
    onclick?: () => void;
    leading?: Snippet;
    trailing?: Snippet;
    chevron?: boolean;
    destructive?: boolean;
    children?: Snippet;
  } = $props();
  const showChevron = $derived(chevron ?? !!href);
</script>

{#snippet body()}
  {#if leading}<span class="leading">{@render leading()}</span>{/if}
  <span class="main">
    {#if title}<span class="title" class:destructive>{title}</span>{/if}
    {#if subtitle}<span class="subtitle">{subtitle}</span>{/if}
    {#if children}{@render children()}{/if}
  </span>
  {#if trailing}<span class="trailing">{@render trailing()}</span>{/if}
  {#if showChevron}<span class="chev"><ChevronRight size={18} /></span>{/if}
{/snippet}

{#if href}
  <a class="row interactive" {href}>{@render body()}</a>
{:else if onclick}
  <button class="row interactive" type="button" {onclick}>{@render body()}</button>
{:else}
  <div class="row">{@render body()}</div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: 10px var(--space-4);
    background: none;
    border: 0;
    text-align: left;
    color: var(--text);
    position: relative;
  }
  .row:not(:first-child)::before {
    content: "";
    position: absolute;
    top: 0;
    left: var(--space-4);
    right: 0;
    border-top: 1px solid var(--separator);
  }
  .interactive {
    cursor: pointer;
    transition: background 0.12s;
  }
  .interactive:hover {
    background: var(--surface-hover);
  }
  .interactive:active {
    background: var(--surface-pressed);
  }
  .leading {
    display: flex;
    flex-shrink: 0;
  }
  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 1px;
  }
  .title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title.destructive {
    color: var(--red);
  }
  .subtitle {
    font-size: var(--text-sm);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trailing {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .chev {
    display: flex;
    color: var(--text-3);
    margin-right: -4px;
  }
</style>
