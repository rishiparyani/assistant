// Moving browsers from old addresses to gigspree.in without losing changes saved offline there.
import { describe, expect, it, vi } from "vitest";
import { domainTarget, moveToDomain } from "../src/core/domain.ts";
import { OUTBOX_PREFIX, hasSavedChanges } from "../src/core/outbox-key.ts";

function storage(items: Record<string, string>): Storage {
  const keys = Object.keys(items);
  return {
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => items[k] ?? null,
  } as Storage;
}
const at = (href: string) => {
  const u = new URL(href);
  return { hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash, replace: vi.fn() };
};

describe("moving to gigspree.in", () => {
  it("maps old addresses and www to the domain, keeping the path", () => {
    expect(domainTarget(at("https://assistant.rishiparyani.workers.dev/gigs/1?x=1#y"))).toBe(
      "https://gigspree.in/gigs/1?x=1#y",
    );
    expect(domainTarget(at("https://www.gigspree.in/"))).toBe("https://gigspree.in/");
    expect(domainTarget(at("https://assistant-dev.rishiparyani.workers.dev/"))).toBe(
      "https://dev.gigspree.in/",
    );
    expect(domainTarget(at("https://gigspree.in/"))).toBeNull();
  });

  it("only counts outbox entries with waiting or failed changes", () => {
    expect(hasSavedChanges(storage({}))).toBe(false);
    expect(hasSavedChanges(storage({ [`${OUTBOX_PREFIX}u1`]: '{"waiting":[],"failed":[]}' }))).toBe(false);
    expect(hasSavedChanges(storage({ "assistant:cache:u1": '{"waiting":[1]}' }))).toBe(false);
    expect(hasSavedChanges(storage({ [`${OUTBOX_PREFIX}u1`]: '{"waiting":[{"id":"a"}]}' }))).toBe(true);
    expect(hasSavedChanges(storage({ [`${OUTBOX_PREFIX}u1`]: '{"failed":[{"id":"a"}]}' }))).toBe(true);
    expect(hasSavedChanges(storage({ [`${OUTBOX_PREFIX}u1`]: "not json" }))).toBe(false);
  });

  it("moves at once with nothing waiting, and after syncing when changes wait", () => {
    vi.useFakeTimers();
    const clean = at("https://assistant.rishiparyani.workers.dev/gigs");
    expect(moveToDomain(clean as unknown as Location, storage({}))).toEqual({ now: true });
    expect(clean.replace).toHaveBeenCalledWith("https://gigspree.in/gigs");

    const items: Record<string, string> = { [`${OUTBOX_PREFIX}u1`]: '{"waiting":[{"id":"a"}]}' };
    const live = {
      get length() {
        return Object.keys(items).length;
      },
      key: (i: number) => Object.keys(items)[i] ?? null,
      getItem: (k: string) => items[k] ?? null,
    } as Storage;
    const pending = at("https://assistant.rishiparyani.workers.dev/");
    expect(moveToDomain(pending as unknown as Location, live)).toEqual({ now: false });
    vi.advanceTimersByTime(6000);
    expect(pending.replace).not.toHaveBeenCalled();
    items[`${OUTBOX_PREFIX}u1`] = '{"waiting":[],"failed":[]}'; // synced
    vi.advanceTimersByTime(3000);
    expect(pending.replace).toHaveBeenCalledWith("https://gigspree.in/");
    vi.useRealTimers();
  });
});
