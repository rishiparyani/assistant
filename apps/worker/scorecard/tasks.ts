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
 * off, its question reaches the right person (not the owner, and not whoever `wrong` matches),
 * answering it carries on, and the answer gets back: saved on the record (where the people who
 * added it see it) or told to someone other than who answered (Codex on PR 226: a flow that
 * asked the owner, or kept the answer to itself, passed). Returns what went wrong, or nothing.
 */
async function works(
  u: User,
  space: SpaceView,
  flow: WorkflowView,
  wrong: { asked: RegExp; label: string; ownerOk?: boolean; ownerDecides?: boolean },
): Promise<string[]> {
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
    if (!wait) return ["the flow's question reached nobody (a sample record was added)"];
    const asked = wait.on.map((p) => p.name).join(", ");
    if (wrong.ownerDecides && !wait.on.some((p) => p.user_id === u.id))
      return [`the question went to someone else, not the one who decides (asked: ${asked})`];
    if (!wrong.ownerOk && wait.on.some((p) => p.user_id === u.id))
      return [`the question went to the owner (asked: ${asked})`];
    if (wait.on.some((p) => wrong.asked.test(p.name)))
      return [`the question went to ${wrong.label} (asked: ${asked})`];
    const answer = wait.choices?.[0] ?? "Yes";
    const at = new Date().toISOString();
    const answered = await api(u)(`${base}/answer`, {
      body: { wait_id: wait.id, as_user_id: wait.on[0]!.user_id, answer },
    });
    if (answered.status !== 200) return [`answering: HTTP ${answered.status}`];
    const ask = flow.then.find((s) => s.do === "ask") as { save_to_id?: string | null } | undefined;
    const saved = ask?.save_to_id
      ? await until(async () => {
          const r = await json<RecordView>(
            await api(u)(`/records/${encodeURIComponent(record.id)}?space=${encodeURIComponent(copy.id)}`),
          );
          return String(r.values[ask.save_to_id!] ?? "") === answer ? r : null;
        }, 15_000)
      : null;
    if (ask?.save_to_id && !saved) return [`the answer "${answer}" wasn't saved on the record`];
    if (saved) return [];
    const askedIds = new Set(wait.on.map((p) => p.user_id));
    const told = await until(async () => {
      const v = await json<PracticeView>(await api(u)(base));
      return v.log.find((l) => l.kind === "message" && l.at >= at && !askedIds.has(l.user_id)) ?? null;
    }, 15_000);
    return told ? [] : [`the answer "${answer}" goes nowhere: not saved on the record, nobody else told`];
  } finally {
    await api(u)(base, { method: "DELETE" }).catch(() => undefined);
  }
}

/**
 * An approval task: someone adds a request, the right person is asked to decide, and whoever
 * added it sees the answer. Graded the same way for every kind of place (decision 2026-11-04
 * "Test whole tasks with the real models": several kinds, so nothing passes by being tuned to one).
 */
function approval(t: {
  id: string;
  about: string;
  text: string;
  /** The list requests are added to (its name). */
  requests: { name: RegExp; label: string };
  /** Other lists it needs (each by name), and whether a request must link to it. */
  needs?: { name: RegExp; label: string; linked?: boolean; orField?: boolean }[];
  /** Who must not be asked; and whether the owner (the person setting it up) may be. */
  /** ownerDecides: the person setting it up is the one who must be asked. */
  wrong: { asked: RegExp; label: string; ownerOk?: boolean; ownerDecides?: boolean };
}): TaskCase {
  return {
    id: t.id,
    about: t.about,
    text: t.text,
    maxSteps: 8,
    check: async (u) => {
      const all = await everything(u);
      const problems: string[] = [];
      const reqs = all.flatMap((m) =>
        m.cols.filter((c) => t.requests.name.test(c.name)).map((c) => ({ m, c })),
      );
      if (!reqs.length) problems.push(`no ${t.requests.label} list`);
      for (const n of t.needs ?? []) {
        const found = all.flatMap((m) => m.cols.filter((c) => n.name.test(c.name)));
        // A person or link field on the requests list does as well (a Doctor field naming who).
        const asField =
          n.orField &&
          reqs.some(({ c }) =>
            c.fields.some((f) => (f.type === "person" || f.type === "link") && n.name.test(f.name)),
          );
        if (asField) continue;
        if (!found.length) problems.push(`no ${n.label} list`);
        else if (
          n.linked &&
          !reqs.some(({ c }) =>
            c.fields.some((f) => f.type === "link" && found.some((x) => x.id === f.options.target)),
          )
        )
          problems.push(`the ${t.requests.label} list doesn't link each one to its ${n.label}`);
      }
      const flow = reqs
        .flatMap(({ m, c }) => m.flows.filter((f) => f.when.collection_id === c.id).map((f) => ({ m, f })))
        .find(({ f }) => f.then.some((s) => s.do === "ask"));
      if (!flow) {
        const any = all.flatMap((m) => m.flows.map((f) => `${f.name} (on ${f.when.collection})`));
        const lists = all.flatMap((m) => m.cols.map((c) => c.name));
        problems.push(
          `no flow on the ${t.requests.label} list that asks someone; flows: ${any.join(", ") || "none"}; lists: ${lists.join(", ")}`,
        );
        return problems;
      }
      return [...problems, ...(await works(u, flow.m.space, flow.f, t.wrong))];
    },
  };
}

export const TASKS: TaskCase[] = [
  approval({
    id: "society-gate",
    about: "gate approvals for a housing society (guards add visitors, the flat approves)",
    text:
      "Set up visitor approvals for our housing society, like MyGate. The security guards add each visitor at the gate, " +
      "the residents of that flat get asked to allow or deny them, and the guard sees the answer.",
    requests: { name: /visit|guest/i, label: "visitors" },
    needs: [{ name: /flat|unit|apartment|resident|home/i, label: "flat", linked: true }],
    wrong: { asked: /guard|security|gate/i, label: "the guard, not the flat" },
  }),
  approval({
    id: "clinic-appointments",
    about: "appointment requests at a small clinic (the doctor on duty accepts)",
    text:
      "Set up appointment requests for my small clinic. Patients ask for a time slot with one of our doctors, " +
      "that doctor gets asked to accept or decline it, and the patient sees the answer.",
    requests: { name: /appoint|booking|request|slot/i, label: "appointments" },
    needs: [{ name: /doctor|staff|physician/i, label: "doctor", linked: true, orField: true }],
    wrong: { asked: /patient/i, label: "the patient, not the doctor" },
  }),
  approval({
    id: "family-car",
    about: "booking a shared family car (the owner approves)",
    text:
      "Our family shares one car. Set it up so anyone in the family can book it for a time, " +
      "I approve or reject each booking, and the person who booked sees the answer.",
    requests: { name: /book|request|trip|car|reserv/i, label: "bookings" },
    wrong: { asked: /^$/, label: "", ownerOk: true, ownerDecides: true },
  }),
  approval({
    id: "school-leave",
    about: "leave requests for a class (parents ask, the class teacher decides)",
    text:
      "Set up leave requests for my class at school. Parents send a leave request for their child, " +
      "I'm the class teacher and approve or reject it, and the parent sees the answer.",
    requests: { name: /leave|absen|request/i, label: "leave requests" },
    wrong: {
      asked: /parent|student|child|guardian/i,
      label: "the parent, not the teacher",
      ownerOk: true,
      ownerDecides: true,
    },
  }),
];
