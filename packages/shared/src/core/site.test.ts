import { describe, expect, it } from "vitest";
import { CLASSIC_PATH_SOURCE, isClassicPath } from "./site.ts";

describe("isClassicPath", () => {
  it("keeps the old site's pages and the links people were sent", () => {
    for (const p of [
      "/login",
      "/consent",
      "/admin",
      "/join",
      "/s",
      "/shared",
      "/shared/01ABC",
      "/songs",
      "/songs/01ABC",
      "/workflows",
      "/workflows/01ABC",
      "/c/01A/01B",
      "/g/01ABC",
      "/chat/01ABC",
      "/gigs/01ABC",
      "/guests/tok",
      "/open-view",
      "/settings",
      "/help",
    ])
      expect(isClassicPath(p), p).toBe(true);
  });
  it("gives everything else to the app", () => {
    for (const p of [
      "/",
      "/chat",
      "/list",
      "/library",
      "/memory",
      "/practice",
      "/sharedx",
      "/songsbook",
      "/app",
    ])
      expect(isClassicPath(p), p).toBe(false);
  });
  it("works as plain source too (the service worker)", () => {
    expect(new RegExp(CLASSIC_PATH_SOURCE).test("/admin")).toBe(true);
    expect(new RegExp(CLASSIC_PATH_SOURCE).test("/chat")).toBe(false);
  });
});
