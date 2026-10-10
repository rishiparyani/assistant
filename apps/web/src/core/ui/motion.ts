// Svelte's transitions run as Web Animations, which the reduced-motion rule in theme.css
// can't reach: pass their settings through `calm` so they take no time when the person
// asked their device for less motion.
const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

export function reducedMotion(): boolean {
  return reduced?.matches ?? false;
}

export function calm<T extends { duration?: number; delay?: number }>(params: T): T {
  return reducedMotion() ? { ...params, duration: 0, delay: 0 } : params;
}
