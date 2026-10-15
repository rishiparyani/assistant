// CSV in and out (decision 2026-10-15 "Toward Excel", 3): an uploaded file's columns go to
// fields (new ones too), previewed with every row checked, imported all or nothing; a list
// or a view comes out as CSV. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  ExportResult,
  FindResult,
  ImportPreview,
  ImportResult,
  ImportView,
  RecordView,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

const FILE = [
  "Date,Item,Amount,Paid by,Done",
  "12/10/2026,Test strings,450,Rishi,yes",
  '13/10/2026,"Test cable, long",₹1200,Band,no',
  "2026-10-14,Test amp,30000,Client,yes",
].join("\n");

describe("csv import", () => {
  it("uploads, previews with new fields and a new list, imports, and refuses bad rows unless skipped", async () => {
    const me = await signUp("Test Owner");
    const up = await api(me)("/imports", { body: { name: "spend.csv", csv: FILE } });
    expect(up.status).toBe(201);
    const file = await json<ImportView>(up);
    expect(file.rows).toBe(3);
    expect(file.columns.map((c) => `${c.name}:${c.guess}`)).toEqual([
      "Date:date",
      "Item:text",
      "Amount:money",
      "Paid by:text",
      "Done:boolean",
    ]);
    // Into the starter Expenses list: Item → What, Amount → Amount, a new choice field, Date → Date.
    const spec = {
      import_id: file.id,
      collection: "Expenses",
      columns: [
        { column: "Item", field: "What" },
        { column: "Amount", field: "Amount" },
        { column: "Date", field: "Date" },
        {
          column: "Paid by",
          add: { name: "Paid by", type: "choice", options: { choices: ["Rishi", "Band", "Client"] } },
        },
      ],
    };
    const preview = await json<ImportPreview>(await api(me)("/imports/preview", { body: spec }));
    expect(preview).toMatchObject({ rows: 3, into: "Expenses", bad: 0, problems: [] });
    expect(preview.words).toEqual([
      "New field Paid by (choice) ← Paid by",
      "What ← Item",
      "Amount ← Amount",
      "Date ← Date",
      "Left out: Done",
    ]);
    expect(preview.sample[1]).toBe("What: Test cable, long, Amount: ₹1,200, Date: 2026-10-13, Paid by: Band");
    // The preview made nothing.
    const fields = async () =>
      (await json<{ fields: { name: string }[] }>(await api(me)("/collections/Expenses"))).fields.map(
        (f) => f.name,
      );
    expect(await fields()).not.toContain("Paid by");
    expect(
      (await json<FindResult>(await api(me)("/collections/Expenses/find", { body: {} }))).items,
    ).toHaveLength(0);

    const done = await json<ImportResult>(await api(me)("/imports/run", { body: spec }));
    expect(done).toMatchObject({ added: 3, skipped: 0 });
    expect(await fields()).toContain("Paid by");
    const items = (
      await json<FindResult>(
        await api(me)("/collections/Expenses/find", { body: { sort: { field: "Date", dir: "asc" } } }),
      )
    ).items;
    expect(items.map((r) => [r.title, r.named.Amount, r.named.Date, r.named["Paid by"]])).toEqual([
      ["Test strings", "₹450", "2026-10-12", "Rishi"],
      ["Test cable, long", "₹1,200", "2026-10-13", "Band"],
      ["Test amp", "₹30,000", "2026-10-14", "Client"],
    ]);
    // Used up: the upload is gone.
    expect((await api(me)("/imports/preview", { body: spec })).status).toBe(404);

    // A new list from a file, made with the fields named.
    const up2 = await json<ImportView>(
      await api(me)("/imports", {
        body: { name: "venues.csv", csv: "Name,City,Capacity\nTest Hall,Pune,300\nTest Bar,Mumbai,x\n" },
      }),
    );
    const spec2 = {
      import_id: up2.id,
      collection: "Venues",
      columns: [
        { column: "Name", add: { name: "Name", type: "text" } },
        { column: "City", add: { name: "City", type: "text" } },
        { column: "Capacity", add: { name: "Capacity", type: "number" } },
      ],
    };
    const p2 = await json<ImportPreview>(await api(me)("/imports/preview", { body: spec2 }));
    expect(p2.into).toBe("Venues (new list)");
    expect(p2.bad).toBe(1);
    expect(p2.problems[0]).toMatch(/^row 3: Capacity/);
    // Refused whole, unless the bad rows are skipped.
    expect((await api(me)("/imports/run", { body: spec2 })).status).toBe(400);
    expect((await api(me)("/collections/Venues")).status).toBe(404);
    const r2 = await json<ImportResult>(
      await api(me)("/imports/run", { body: { ...spec2, skip_bad: true } }),
    );
    expect(r2).toMatchObject({ added: 1, skipped: 1 });
    expect(r2.collection.name).toBe("Venues");

    // A file too wide or wrong is refused up front.
    expect((await api(me)("/imports", { body: { name: "x.csv", csv: "only a header\n" } })).status).toBe(400);
    expect(
      (
        await api(me)("/imports/preview", {
          body: {
            import_id: "01J00000000000000000000000",
            collection: "Expenses",
            columns: [{ column: "A", field: "What" }],
          },
        })
      ).status,
    ).toBe(404);
  });
});

describe("csv export", () => {
  it("writes a list or a view as CSV, as a tool and as a file", async () => {
    const me = await signUp("Test Owner");
    for (const [What, Amount, Date] of [
      ["Test strings", "450", "2026-10-12"],
      ["Test, amp", "30000", "2026-10-14"],
    ])
      await json<RecordView>(
        await api(me)("/collections/Expenses/records", { body: { values: { What, Amount, Date } } }),
      );
    const out = await json<ExportResult>(await api(me)("/collections/Expenses/export", { body: {} }));
    expect(out.name).toBe("Expenses.csv");
    expect(out.rows).toBe(2);
    const lines = out.csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^What,Amount,/);
    expect(lines.some((l) => l.startsWith('"Test, amp",30000.00,'))).toBe(true);
    // A saved view narrows it.
    await api(me)("/views", {
      body: {
        name: "Big spends",
        collection: "Expenses",
        filters: [{ field: "Amount", op: "gt", value: 1000 }],
      },
    });
    const big = await json<ExportResult>(
      await api(me)("/collections/Expenses/export", { body: { view: "Big spends" } }),
    );
    expect(big.name).toBe("Big spends.csv");
    expect(big.rows).toBe(1);
    // The file route for browsers.
    const res = await api(me)("/export/Expenses.csv?view=Big%20spends");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/Big spends\.csv/);
    // Excel wants a byte-order mark first (the text decoder would hide it).
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toMatch(/^What,Amount/);
    // Someone else can't.
    const other = await signUp("Test Other");
    expect((await api(other)("/collections/Expenses/export", { body: {} })).status).toBe(200);
    expect(
      (await json<ExportResult>(await api(other)("/collections/Expenses/export", { body: {} }))).rows,
    ).toBe(0);
  });
});
