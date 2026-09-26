<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Props = HTMLButtonAttributes & {
    variant?: "primary" | "secondary" | "tinted" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    full?: boolean;
    loading?: boolean;
    href?: string;
    icon?: Snippet;
    children?: Snippet;
  };
  let {
    variant = "secondary",
    size = "md",
    full = false,
    loading = false,
    href,
    icon,
    children,
    disabled,
    type = "button",
    ...rest
  }: Props = $props();
</script>

{#if href}
  <a class="btn {variant} {size}" class:full {href}>
    {#if icon}<span class="icon">{@render icon()}</span>{/if}
    {#if children}<span>{@render children()}</span>{/if}
  </a>
{:else}
  <button
    class="btn {variant} {size}"
    class:full
    {type}
    disabled={disabled || loading}
    aria-busy={loading}
    {...rest}
  >
    {#if loading}
      <span class="spinner" aria-hidden="true"></span>
    {:else if icon}
      <span class="icon">{@render icon()}</span>
    {/if}
    {#if children}<span>{@render children()}</span>{/if}
  </button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: 0 var(--space-4);
    border-radius: var(--radius);
    border: 1px solid transparent;
    font-weight: 600;
    font-size: var(--text-base);
    letter-spacing: -0.01em;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    transition:
      background 0.15s var(--ease),
      transform 0.1s var(--ease),
      opacity 0.15s;
  }
  .btn:active:not(:disabled) {
    transform: scale(0.98);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .sm {
    min-height: 34px;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-sm);
  }
  .lg {
    min-height: 52px;
    font-size: var(--text-md);
    border-radius: var(--radius-lg);
  }
  .full {
    width: 100%;
  }
  .primary {
    background: var(--accent);
    color: var(--text-on-accent);
    box-shadow: var(--shadow-sm);
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .secondary {
    background: var(--surface);
    border-color: var(--border);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .secondary:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .tinted {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ghost {
    background: transparent;
    color: var(--accent-text);
  }
  .ghost:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .danger {
    background: var(--red-soft);
    color: var(--red);
  }
  .icon {
    display: inline-flex;
  }
  .icon :global(svg) {
    width: 18px;
    height: 18px;
  }
  .spinner {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
