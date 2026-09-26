<script lang="ts">
  import type { Snippet } from "svelte";
  // Standalone pages (sign-in, consent, invitations): a centred card with the brand.
  let { children }: { children: Snippet } = $props();
</script>

<div class="centered">
  <div class="inner">
    <div class="brand"><span class="mark">A</span> Assistant</div>
    {@render children()}
  </div>
</div>

<style>
  .centered {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(var(--safe-top) + var(--space-6)) var(--space-4) calc(var(--safe-bottom) + var(--space-6));
    background: radial-gradient(1200px 600px at 50% -10%, var(--accent-soft), transparent 70%), var(--bg);
  }
  .inner {
    width: min(420px, 100%);
    display: grid;
    gap: var(--space-5);
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-weight: 750;
    font-size: var(--text-lg);
    letter-spacing: -0.02em;
  }
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: linear-gradient(135deg, #6366f1, #4338ca);
    color: #fff;
    box-shadow: 0 6px 18px rgb(79 70 229 / 0.35);
  }
</style>
