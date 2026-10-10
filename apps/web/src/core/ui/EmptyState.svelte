<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, text, icon, action }: { title: string; text?: string; icon?: Snippet; action?: Snippet } =
    $props();
</script>

<div class="empty">
  {#if icon}<div class="icon">{@render icon()}</div>{/if}
  <h3>{title}</h3>
  {#if text}<p>{text}</p>{/if}
  {#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
  .empty {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: var(--space-2);
    padding: var(--space-10) var(--space-6);
  }
  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 18px;
    background: var(--accent-soft);
    color: var(--accent-text);
    margin-bottom: var(--space-2);
    animation: pop-in var(--dur-slow) var(--ease-spring) backwards;
  }
  h3,
  p,
  .action {
    animation: rise-in var(--dur) var(--ease) backwards;
  }
  h3 {
    animation-delay: 60ms;
  }
  p {
    animation-delay: 110ms;
  }
  .action {
    animation-delay: 160ms;
  }
  h3 {
    font-size: var(--text-md);
    font-weight: 650;
  }
  p {
    color: var(--text-2);
    max-width: 32ch;
  }
  .action {
    margin-top: var(--space-3);
  }
</style>
