<script lang="ts">
  import type { Snippet } from "svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";

  // Large title (iOS style) with optional back link, subtitle and actions.
  let {
    title,
    subtitle,
    back,
    backLabel = "Back",
    actions,
  }: { title: string; subtitle?: string; back?: string; backLabel?: string; actions?: Snippet } = $props();
</script>

<header class="page-header">
  {#if back}
    <a class="back" href={back}><ChevronLeft size={20} />{backLabel}</a>
  {/if}
  <div class="row">
    <div class="titles">
      <h1>{title}</h1>
      {#if subtitle}<p>{subtitle}</p>{/if}
    </div>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
</header>

<style>
  .page-header {
    padding: var(--space-2) 0 var(--space-5);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin: 0 0 var(--space-2) -6px;
    font-weight: 500;
    min-height: 32px;
  }
  .row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .titles {
    min-width: 0;
  }
  h1 {
    font-size: var(--text-2xl);
    font-weight: 750;
    letter-spacing: -0.035em;
    line-height: 1.1;
    overflow-wrap: anywhere;
  }
  p {
    margin-top: 4px;
    color: var(--text-2);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  @media (min-width: 768px) {
    .page-header {
      padding-top: var(--space-6);
    }
  }
</style>
