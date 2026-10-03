<script lang="ts">
  import type { Snippet } from "svelte";
  import X from "@lucide/svelte/icons/x";

  // Bottom sheet on phones, centred dialog on larger screens. Native <dialog> gives
  // focus trapping, Esc to close and an accessible modal for free.
  let {
    open = $bindable(false),
    title,
    children,
    footer,
    onclose,
  }: { open?: boolean; title: string; children: Snippet; footer?: Snippet; onclose?: () => void } = $props();

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function close() {
    open = false;
    onclose?.();
  }
</script>

<dialog
  bind:this={dialog}
  onclose={close}
  onclick={(e) => e.target === dialog && close()}
  aria-labelledby="sheet-title"
>
  <div class="sheet">
    <div class="grabber" aria-hidden="true"></div>
    <header>
      <h2 id="sheet-title">{title}</h2>
      <button class="close" type="button" onclick={close} aria-label="Close"><X size={20} /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</dialog>

<style>
  dialog {
    padding: 0;
    border: 0;
    background: transparent;
    max-width: 100vw;
    max-height: 100dvh;
    width: 100%;
    margin: auto 0 0;
    color: var(--text);
  }
  dialog::backdrop {
    background: var(--backdrop);
    animation: fade 0.2s var(--ease);
  }
  .sheet {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - var(--safe-top) - 24px);
    background: var(--bg-elevated);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding-bottom: var(--safe-bottom);
    box-shadow: var(--shadow-lg);
    animation: up 0.28s var(--ease);
  }
  .grabber {
    width: 36px;
    height: 5px;
    border-radius: 3px;
    background: var(--border-strong);
    margin: 8px auto 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4) var(--space-2) var(--space-5);
  }
  h2 {
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 0;
    background: var(--grey-soft);
    color: var(--text-2);
    cursor: pointer;
  }
  .body {
    overflow-y: auto;
    overflow-x: hidden;
    grid-template-columns: minmax(0, 1fr);
    /* Rows keep their full height and the sheet scrolls: otherwise a box that clips its
       corners (overflow: hidden) is squeezed to fit the screen and hides what's inside it,
       like the third person on a lineup. */
    grid-auto-rows: max-content;
    align-content: start;
    /* Scrolling inside the sheet never drags the page behind it (iOS). */
    overscroll-behavior: contain;
    padding: var(--space-2) var(--space-5) var(--space-5);
    display: grid;
    gap: var(--space-4);
  }
  footer {
    padding: var(--space-3) var(--space-5) var(--space-4);
    border-top: 1px solid var(--separator);
    display: flex;
    gap: var(--space-2);
  }
  footer :global(> *) {
    flex: 1;
  }
  @media (min-width: 768px) {
    dialog {
      width: min(520px, calc(100vw - 48px));
      margin: auto;
    }
    .sheet {
      border-radius: var(--radius-xl);
      max-height: min(760px, calc(100dvh - 64px));
      padding-bottom: 0;
      animation: pop 0.2s var(--ease);
    }
    .grabber {
      display: none;
    }
    header {
      padding-top: var(--space-5);
    }
  }
  @keyframes up {
    from {
      transform: translateY(100%);
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.97);
      opacity: 0;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
