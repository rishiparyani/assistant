<script lang="ts">
  import type { Snippet } from "svelte";

  // Label + control + hint/error. The control is passed as children and gets `id`.
  let {
    label,
    id,
    hint,
    error,
    children,
  }: { label: string; id: string; hint?: string; error?: string; children: Snippet } = $props();
</script>

<div class="field" class:invalid={!!error}>
  <label for={id}>{label}</label>
  {@render children()}
  {#if error}
    <p class="msg error" id="{id}-msg">{error}</p>
  {:else if hint}
    <p class="msg" id="{id}-msg">{hint}</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: 6px;
  }
  label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
  }
  .msg {
    font-size: var(--text-sm);
    color: var(--text-3);
  }
  .msg.error {
    color: var(--red);
  }
  .field :global(.control) {
    width: 100%;
    min-height: 46px;
    padding: 10px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
    appearance: none;
  }
  .field :global(textarea.control) {
    min-height: 96px;
    resize: vertical;
  }
  .field :global(.control:focus) {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus);
  }
  .field :global(.control::placeholder) {
    color: var(--text-3);
  }
  .invalid :global(.control) {
    border-color: var(--red);
  }
</style>
