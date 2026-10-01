// Swipe sideways to move between a page's tabs (Details · Money · People and the like),
// like iPhone apps: the page follows the finger, then slides away and the next tab slides
// in; a short or slow swipe springs back. Use:
//   <div use:swipeTabs={{ go: (dir) => step(dir), can: (dir) => hasTab(dir) }}>
// dir is 1 for the next tab (swipe left) and -1 for the previous one. Vertical scrolling is
// left to the browser (touch-action: pan-y). It stays out of the way of the screen edges
// (iOS back), form fields, drag handles, sheets, anything that scrolls sideways itself and
// anything marked data-no-swipe.

export interface SwipeTabs {
  go: (dir: 1 | -1) => void;
  can: (dir: 1 | -1) => boolean;
}

const EDGE = 24; // px from either side where iOS gestures win
const LOCK = 10; // px of movement before deciding sideways or up/down
const SKIP = "input, textarea, select, [contenteditable], [data-no-swipe], .grip, dialog";

function scrollsSideways(from: Element | null, stop: Element): boolean {
  for (let el = from; el && el !== stop; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowX;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

const reduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function swipeTabs(node: HTMLElement, options: SwipeTabs) {
  let opts = options;
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let dx = 0;
  let state: "idle" | "deciding" | "dragging" = "idle";
  node.style.touchAction = "pan-y";

  const place = (x: number, animate: boolean) => {
    node.style.transition = animate ? "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
    node.style.transform = x ? `translateX(${x}px)` : "";
  };

  function start(e: TouchEvent) {
    state = "idle";
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const target = e.target instanceof Element ? e.target : null;
    if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    if (target?.closest(SKIP) || scrollsSideways(target, node)) return;
    x0 = t.clientX;
    y0 = t.clientY;
    t0 = Date.now();
    dx = 0;
    state = "deciding";
  }
  function move(e: TouchEvent) {
    if (state === "idle") return;
    const t = e.touches[0]!;
    const mx = t.clientX - x0;
    const my = t.clientY - y0;
    if (state === "deciding") {
      if (Math.hypot(mx, my) < LOCK) return;
      // Clearly sideways, or it's a scroll and we stay out of it.
      if (Math.abs(mx) < 1.5 * Math.abs(my)) {
        state = "idle";
        return;
      }
      state = "dragging";
    }
    dx = mx;
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    // At the first or last tab it only gives a little, like a rubber band.
    place(opts.can(dir) ? dx : dx * 0.25, false);
  }
  function end() {
    if (state !== "dragging") {
      state = "idle";
      return;
    }
    state = "idle";
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    const width = node.getBoundingClientRect().width || window.innerWidth;
    const fast = Math.abs(dx) > 40 && Math.abs(dx) / Math.max(1, Date.now() - t0) > 0.35;
    if (opts.can(dir) && (fast || Math.abs(dx) > width * 0.25)) {
      if (reduced()) {
        place(0, false);
        opts.go(dir);
        return;
      }
      // Slide this tab away, then show the next one (it slides in from the other side).
      place(-dir * width, true);
      setTimeout(() => {
        place(0, false);
        opts.go(dir);
      }, 180);
    } else {
      place(0, true); // spring back
    }
  }

  node.addEventListener("touchstart", start, { passive: true });
  node.addEventListener("touchmove", move, { passive: true });
  node.addEventListener("touchend", end, { passive: true });
  node.addEventListener("touchcancel", end, { passive: true });
  return {
    update(next: SwipeTabs) {
      opts = next;
    },
    destroy() {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
    },
  };
}

/** Steps through `order` from `current`; null at either end. */
export function nextTab<T>(order: readonly T[], current: T, dir: 1 | -1): T | null {
  const i = order.indexOf(current) + dir;
  return i >= 0 && i < order.length ? order[i]! : null;
}

/** Where a newly shown tab slides in from (0 when the person prefers less motion). */
export const slide = (dir: number) =>
  reduced() ? 0 : dir * Math.min(typeof window === "undefined" ? 390 : window.innerWidth, 600) * 0.6;

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
