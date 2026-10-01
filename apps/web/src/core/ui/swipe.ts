// Swipe sideways to move between a page's tabs (Details · Money · People and the like).
// Use: <div use:swipeTabs={(dir) => step(dir)}>; dir is 1 for the next tab (swipe left)
// and -1 for the previous one. It only reads touches, never blocks scrolling, and stays out
// of the way of: the screen edges (iOS "back"), form fields, drag handles, sheets, anything
// that scrolls sideways itself, and anything marked data-no-swipe (e.g. the calendar).

const EDGE = 24; // px from either side where iOS gestures win
const MIN_DX = 60; // px sideways
const MAX_MS = 700; // a flick, not a slow drag

const SKIP = "input, textarea, select, [contenteditable], [data-no-swipe], .grip, dialog";

function scrollsSideways(from: Element | null, stop: Element): boolean {
  for (let el = from; el && el !== stop; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowX;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

export function swipeTabs(node: HTMLElement, onswipe: (dir: 1 | -1) => void) {
  let handler = onswipe;
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let tracking = false;

  function start(e: TouchEvent) {
    tracking = false;
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const target = e.target instanceof Element ? e.target : null;
    if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    if (target?.closest(SKIP) || scrollsSideways(target, node)) return;
    x0 = t.clientX;
    y0 = t.clientY;
    t0 = Date.now();
    tracking = true;
  }
  function end(e: TouchEvent) {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    if (!t || Date.now() - t0 > MAX_MS) return;
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    // Clearly sideways: long enough and at least twice as wide as tall.
    if (Math.abs(dx) >= MIN_DX && Math.abs(dx) > 2 * Math.abs(dy)) handler(dx < 0 ? 1 : -1);
  }
  const cancel = () => (tracking = false);

  node.addEventListener("touchstart", start, { passive: true });
  node.addEventListener("touchend", end, { passive: true });
  node.addEventListener("touchcancel", cancel, { passive: true });
  return {
    update(next: (dir: 1 | -1) => void) {
      handler = next;
    },
    destroy() {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", cancel);
    },
  };
}

/** Steps through `order` from `current`; null at either end. */
export function nextTab<T>(order: readonly T[], current: T, dir: 1 | -1): T | null {
  const i = order.indexOf(current) + dir;
  return i >= 0 && i < order.length ? order[i]! : null;
}

/** Slide distance for a tab change (0 when the person prefers less motion). */
export const slide = (dir: number) =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 32 * dir;

/**
 * After a swipe from far down a long tab, the next tab would open at the same scroll
 * position, hiding its top: bring the page's tab bar back into view, just under the
 * phone's sticky top bar. Call after the new tab has rendered.
 */
export function revealTabs(label: string) {
  const tabs = document.querySelector(`[role="tablist"][aria-label="${CSS.escape(label)}"]`);
  if (!tabs) return;
  const bar = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
  const top = tabs.getBoundingClientRect().top;
  if (top < bar) window.scrollTo({ top: window.scrollY + top - bar - 8 });
}
