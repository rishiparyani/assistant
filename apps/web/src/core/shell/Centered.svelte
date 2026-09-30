<script lang="ts">
  import type { Snippet } from "svelte";
  // Standalone pages (sign-in, consent, invitations): a centred card with the brand.
  let { children }: { children: Snippet } = $props();
</script>

<div class="centered">
  <div class="inner">
    <div class="brand"><span class="mark" aria-hidden="true"></span> Gigspree</div>
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
    flex: none;
    width: 44px;
    height: 44px;
    background: var(--logo) center / contain no-repeat;
  }
</style>
