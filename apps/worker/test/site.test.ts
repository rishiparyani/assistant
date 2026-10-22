// The website is the app (decision 2026-10-22): the app lived under /app before, so those
// links redirect to the same screen at the root.
import { describe, expect, it } from "vitest";
import { call } from "./http.ts";

describe("the site's paths", () => {
  it("redirects the app's old /app links to the root", async () => {
    const res = await call("/app/chat?ask=hi", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(
      new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search,
    ).toBe("/chat?ask=hi");
    const root = await call("/app", { redirect: "manual" });
    expect(root.status).toBe(301);
    expect(new URL(root.headers.get("location")!).pathname).toBe("/");
  });
});
