<script lang="ts">
  // Initials on a colour picked from the name, so each person keeps their colour.
  let { name, size = 36, square = false }: { name: string; size?: number; square?: boolean } = $props();
  const HUES = [245, 200, 160, 30, 330, 280, 15, 190];
  const initials = $derived(
    name
      .replace(/\(.*\)/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?",
  );
  const hue = $derived(HUES[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]);
</script>

<span class="avatar" class:square style="--size:{size}px; --hue:{hue}" aria-hidden="true">{initials}</span>

<style>
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    flex-shrink: 0;
    font-size: calc(var(--size) * 0.38);
    font-weight: 650;
    letter-spacing: 0.02em;
    color: hsl(var(--hue) 55% 32%);
    background: hsl(var(--hue) 70% 92%);
  }
  .square {
    border-radius: 28%;
  }
  @media (prefers-color-scheme: dark) {
    .avatar {
      color: hsl(var(--hue) 70% 80%);
      background: hsl(var(--hue) 35% 22%);
    }
  }
</style>
