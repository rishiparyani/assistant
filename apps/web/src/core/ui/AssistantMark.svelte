<script lang="ts">
  // The assistant's mark: a gradient ring with a gradient centre that turns while it thinks.
  let { size = 34, thinking = false }: { size?: number; thinking?: boolean } = $props();
</script>

<span class="mark" class:thinking style:--size="{size}px" aria-hidden="true"></span>

<style>
  .mark {
    position: relative;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: var(--mark-gradient);
  }
  .mark::after {
    content: "";
    position: absolute;
    inset: calc(var(--size) * 0.09);
    border-radius: 50%;
    background: var(--surface);
  }
  .mark::before {
    content: "";
    position: absolute;
    inset: calc(var(--size) * 0.27);
    border-radius: 50%;
    background: var(--mark-gradient);
    z-index: 1;
  }
  .thinking::before {
    animation: turn 1.2s linear infinite;
  }
  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .thinking::before {
      animation: none;
    }
  }
</style>
