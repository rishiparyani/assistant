// Full tasks (decision 2026-11-04 "Test whole tasks with the real models"): a request carried
// through like a person would, Confirm tapped on every card and the first answer picked when
// asked, and graded by what exists at the end and whether it works, not by what was said.
// Fake data only. Run from the Scorecard workflow with suite "tasks".
import type { CollectionView, PracticeView, RecordView, SpaceView, WorkflowView } from "@assistant/shared";
import { json } from "../test/http.ts";
import { api, type User } from "./cases.ts";

export interface TaskCase {
  id: string;
  about: string;
  /** What the person says, once. */
  text: string;
  /** Most taps (Confirm or an answer) before giving up: a person won't keep going for ever. */
  maxSteps: number;
  /** What's wrong with what exists at the end (empty: it works). */
  check: (u: User) => Promise<string[]>;
}

interface Made {
  space: SpaceView;
  cols: CollectionView[];
  flows: WorkflowView[];
}

/** Everything the person has, in every space (practice copies aside). */
async function everything(u: User): Promise<Made[]> {
  const spaces = await json<SpaceView[]>(await api(u)("/spaces"));
  const out: Made[] = [];
  for (const space of spaces.filter((s) => !s.practice_of)) {
    const q = `?space=${encodeURIComponent(space.id)}`;
    const cols = await json<CollectionView[]>(await api(u)(`/collections${q}`));
    const flows = await json<WorkflowView[]>(await api(u)(`/workflows${q}`));
    out.push({ space, cols, flows });
  }
  return out;
}

const until = async <T>(f: () => Promise<T | null>, ms = 30_000): Promise<T | null> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f().catch(() => null);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
};

/**
 * The flow really works: in a practice copy of its space, a sample record on its list sets it
 * off, its question reaches someone, and answering it carries on (the answer saved where the
 * flow says). Returns what went wrong, or nothing.
 */
async function works(u: User, space: SpaceView, flow: WorkflowView): Promise<string[]> {
  const started = await api(u)(`/spaces/${encodeURIComponent(space.id)}/practice`, { body: {} });
  if (started.status !== 201 && started.status !== 200) return [`practice copy: HTTP ${started.status}`];
  const copy = await json<SpaceView>(started);
  const base = `/spaces/${encodeURIComponent(copy.id)}/practice`;
  try {
    const ran = await api(u)(`${base}/run`, { body: { workflow_id: flow.id } });
    if (ran.status !== 200)
      return [`starting the flow: HTTP ${ran.status} ${(await ran.text()).slice(0, 160)}`];
    const { record } = await json<{ record: { id: string } | null }>(ran);
    if (!record) return ["starting the flow added no record"];
    const wait = await until(async () => {
      const v = await json<PracticeView>(await api(u)(base));
      return v.waiting.find((w) => w.record_id === record.id && w.on.length > 0) ?? null;
    });
    if (!wait) return ["the flow's question reached nobody (a sample visitor was added)"];
    const answer = wait.choices?.[0] ?? "Yes";
    const answered = await api(u)(`${base}/answer`, {
      body: { wait_id: wait.id, as_user_id: wait.on[0]!.user_id, answer },
    });
    if (answered.status !== 200) return [`answering: HTTP ${answered.status}`];
    const ask = flow.then.find((s) => s.do === "ask") as { save_to_id?: string | null } | undefined;
    if (ask?.save_to_id) {
      const saved = await until(async () => {
        const r = await json<RecordView>(
          await api(u)(`/records/${encodeURIComponent(record.id)}?space=${encodeURIComponent(copy.id)}`),
        );
        return String(r.values[ask.save_to_id!] ?? "") === answer ? r : null;
      }, 15_000);
      if (!saved) return [`the answer "${answer}" wasn't saved on the visitor`];
    }
    return [];
  } finally {
    await api(u)(base, { method: "DELETE" }).catch(() => undefined);
  }
}

export const TASKS: TaskCase[] = [
  {
    id: "society-gate",
    about: "gate approvals for a housing society (guards add visitors, the flat approves)",
    text:
      "Set up visitor approvals for our housing society, like MyGate. The security guards add each visitor at the gate, " +
      "the residents of that flat get asked to allow or deny them, and the guard sees the answer.",
    maxSteps: 8,
    check: async (u) => {
      const all = await everything(u);
      const problems: string[] = [];
      const visitors = all.flatMap((m) =>
        m.cols.filter((c) => /visit|guest/i.test(c.name)).map((c) => ({ m, c })),
      );
      if (!visitors.length) problems.push("no visitors list");
      const flats = all.flatMap((m) =>
        m.cols.filter((c) => /flat|unit|apartment|resident|home/i.test(c.name)),
      );
      if (!flats.length) problems.push("no flats (or residents) list");
      const flow = visitors
        .flatMap(({ m, c }) => m.flows.filter((f) => f.when.collection_id === c.id).map((f) => ({ m, f })))
        .find(({ f }) => f.then.some((s) => s.do === "ask"));
      if (!flow) {
        const any = all.flatMap((m) => m.flows.map((f) => `${f.name} (on ${f.when.collection})`));
        problems.push(`no flow on the visitors list that asks someone; flows: ${any.join(", ") || "none"}`);
        return problems;
      }
      return [...problems, ...(await works(u, flow.m.space, flow.f))];
    },
  },
];
