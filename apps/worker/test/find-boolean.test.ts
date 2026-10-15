// A yes/no field that was never set counts as no when filtering: "Done = false" finds the
// reminders never ticked, not only the ones someone unticked. Fake data only.
import { describe, expect, it } from "vitest";
import type { RecordView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("yes/no filters", () => {
  it("treats a yes/no never set as no", async () => {
    const me = await signUp("Test Owner");
    const add = async (values: Record<string, unknown>) =>
      json<RecordView>(await api(me)("/collections/Reminders/records", { body: { values } }));
    await add({ Title: "Test buy strings", Done: true });
    await add({ Title: "Test call the venue" });
    await add({ Title: "Test tune the amp", Done: false });
    const titles = async (filters: unknown[]) => {
      const r = await json<{ items: { title: string }[] }>(
        await api(me)("/collections/Reminders/find", { body: { filters } }),
      );
      return r.items.map((i) => i.title).sort();
    };
    expect(await titles([{ field: "Done", op: "eq", value: false }])).toEqual([
      "Test call the venue",
      "Test tune the amp",
    ]);
    expect(await titles([{ field: "Done", op: "ne", value: true }])).toEqual([
      "Test call the venue",
      "Test tune the amp",
    ]);
    expect(await titles([{ field: "Done", op: "eq", value: true }])).toEqual(["Test buy strings"]);
    expect(await titles([{ field: "Done", op: "ne", value: false }])).toEqual(["Test buy strings"]);
  });
});
