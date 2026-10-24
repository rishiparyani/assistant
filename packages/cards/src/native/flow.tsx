// A workflow drawn, not listed (owner, 2026-10-24, on a workflow's page: "not very presentable…
// better formatting and diagrams wherever necessary"): one node per part down a rail (when, only
// if, wait, set, ask, tell, add, total, for each, loop), and a branch (if, decide) opens into
// lanes, one per outcome, each with its own steps. Field names in a message ({Visitor}) are
// marked. The same definition the app runs, so it can't drift from what happens.
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  condWords,
  durationWords,
  workflowWords,
  type CondView,
  type SimpleStepView,
  type WorkflowView,
} from "@assistant/shared";
import { Text } from "./text.tsx";
import { useTheme, type Theme } from "./theme.ts";

type Def = Pick<WorkflowView, "when" | "check" | "wait_minutes" | "then">;

type Kind =
  "when" | "only" | "wait" | "set" | "ask" | "tell" | "add" | "total" | "each" | "if" | "decide" | "loop";

const TAG: Record<Kind, string> = {
  when: "When",
  only: "Only if",
  wait: "Wait",
  set: "Set",
  ask: "Ask",
  tell: "Tell",
  add: "Add",
  total: "Total",
  each: "For each",
  if: "If",
  decide: "Decide",
  loop: "Loop",
};

/** A kind's colour: the trigger and people steps in the accent, changes in green, branches in the warm tone. */
function colourOf(kind: Kind, t: Theme): string {
  switch (kind) {
    case "when":
    case "ask":
    case "tell":
      return t.accent;
    case "set":
    case "add":
      return t.good;
    case "if":
    case "decide":
    case "loop":
    case "only":
      return t.warn;
    default:
      return t.fg2;
  }
}

/** The words with {Field} names marked. */
function Marked({ text, color, size = 15 }: { text: string; color: string; size?: number }) {
  const { t } = useTheme();
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <Text style={{ fontSize: size, lineHeight: size + 6, color }}>
      {parts.map((p, i) =>
        /^\{[^}]+\}$/.test(p) ? (
          <Text key={i} style={{ fontSize: size, lineHeight: size + 6, color: t.accent, fontWeight: "700" }}>
            {p.slice(1, -1)}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

const showValue = (v: unknown): string =>
  v === null || v === undefined
    ? "empty"
    : typeof v === "boolean"
      ? v
        ? "Yes"
        : "No"
      : typeof v === "string"
        ? v
        : JSON.stringify(v);

/** A condition in the app's own words ("Pinned is Yes"). */
const condText = (c: CondView): string => condWords(c);

/** A simple step (inside a lane or on the rail). */
function simpleNode(a: SimpleStepView, t: Theme): { kind: Kind; title: ReactNode; detail?: string } {
  if (a.do === "notify")
    return {
      kind: "tell",
      title: <Marked text={a.text} color={t.fg} />,
      detail: `to ${a.to.map((p) => p.name).join(", ")}`,
    };
  if (a.do === "set")
    return {
      kind: "set",
      title: (
        <Text style={[s.title, { color: t.fg }]}>
          {a.field} <Text style={{ color: t.fg3 }}>→</Text> {showValue(a.value)}
        </Text>
      ),
      detail: a.via
        ? `on its ${a.via}${a.where?.length ? ` where ${a.where.map(condText).join(" and ")}` : ""}`
        : undefined,
    };
  return {
    kind: "add",
    title: <Text style={[s.title, { color: t.fg }]}>A record to {a.collection}</Text>,
    detail: Object.keys(a.values).length
      ? Object.entries(a.values)
          .map(([k, v]) => `${k}: ${showValue(v)}`)
          .join(", ")
      : undefined,
  };
}

function Node({
  kind,
  title,
  detail,
  children,
  last,
}: {
  kind: Kind;
  title: ReactNode;
  detail?: string | null;
  children?: ReactNode;
  last?: boolean;
}) {
  const { t } = useTheme();
  const c = colourOf(kind, t);
  return (
    <View style={s.node}>
      <View style={s.rail}>
        <View style={[s.dot, { backgroundColor: c }]} />
        {last ? null : <View style={[s.line, { backgroundColor: t.fill2 }]} />}
      </View>
      <View style={[s.body, last && { paddingBottom: 0 }]}>
        <Text style={[s.tag, { color: c }]}>{TAG[kind]}</Text>
        {typeof title === "string" ? <Text style={[s.title, { color: t.fg }]}>{title}</Text> : title}
        {detail ? <Text style={[s.detail, { color: t.fg2 }]}>{detail}</Text> : null}
        {children}
      </View>
    </View>
  );
}

/** One outcome of a branch: its label and the steps that follow it. */
function Lane({
  label,
  steps,
  colour,
  wide,
}: {
  label: string;
  steps: SimpleStepView[];
  colour: string;
  wide: boolean;
}) {
  const { t } = useTheme();
  return (
    <View
      style={[s.lane, { borderLeftColor: colour, backgroundColor: t.fill }, wide && { flex: 1, minWidth: 0 }]}
    >
      <Text style={[s.laneLabel, { color: colour }]}>{label}</Text>
      {steps.length ? (
        steps.map((a, i) => {
          const n = simpleNode(a, t);
          return (
            <Node key={i} kind={n.kind} title={n.title} detail={n.detail} last={i === steps.length - 1} />
          );
        })
      ) : (
        <Text style={[s.detail, { color: t.fg3 }]}>nothing</Text>
      )}
    </View>
  );
}

export function FlowDiagram({ workflow }: { workflow: Def }) {
  const { t } = useTheme();
  // Lanes sit side by side when there's room (a laptop), one under another on a phone.
  const [width, setWidth] = useState(0);
  const wide = width >= 560;
  const base: Def = { when: workflow.when, check: [], wait_minutes: 0, then: [] };
  // The trigger, checks and wait in the same words the app uses everywhere.
  const head = workflowWords({ ...base, check: workflow.check, wait_minutes: workflow.wait_minutes });
  type Item = { kind: Kind; title: ReactNode; detail?: string | null; children?: ReactNode };
  const nodes: Item[] = [];
  const [whenLine, ...rest] = head;
  nodes.push({ kind: "when", title: whenLine ?? "" });
  rest.forEach((line) =>
    nodes.push({
      kind: line.startsWith("Wait") ? "wait" : "only",
      title: line.replace(/^Only if /, "").replace(/^Wait /, ""),
    }),
  );
  workflow.then.forEach((a) => {
    if (a.do === "notify" || a.do === "set" || a.do === "add") {
      const n = simpleNode(a, t);
      nodes.push({ kind: n.kind, title: n.title, detail: n.detail });
    } else if (a.do === "ask") {
      const wait =
        a.who.length > 1 || a.until === "first"
          ? a.until === "first"
            ? "waits for the first answer"
            : "waits for everyone"
          : "waits for the answer";
      const extra = [
        wait,
        a.nudge_minutes ? `nudges every ${durationWords(a.nudge_minutes)}` : "",
        a.save_to ? `kept in ${a.save_to}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      nodes.push({
        kind: "ask",
        title: <Marked text={a.text} color={t.fg} />,
        detail: `${a.who.map((p) => p.name).join(", ")} · ${extra}`,
        children: a.choices ? (
          <View style={s.chips}>
            {a.choices.map((c) => (
              <View key={c} style={[s.chip, { backgroundColor: t.accentSoft }]}>
                <Text style={[s.chipText, { color: t.accent }]}>{c}</Text>
              </View>
            ))}
          </View>
        ) : null,
      });
    } else if (a.do === "if") {
      const colour = colourOf("if", t);
      nodes.push({
        kind: "if",
        title: a.if.map(condText).join(" and "),
        children: (
          <View style={[s.lanes, wide && s.lanesWide]}>
            <Lane label="Yes" steps={a.then} colour={t.good} wide={wide} />
            {a.else.length ? <Lane label="Otherwise" steps={a.else} colour={colour} wide={wide} /> : null}
          </View>
        ),
      });
    } else if (a.do === "choose") {
      nodes.push({
        kind: "decide",
        title: a.question,
        detail: `the app picks${a.save_to ? ` · kept in ${a.save_to}` : ""}`,
        children: (
          <View style={[s.lanes, wide && s.lanesWide]}>
            {a.options.map((o) => (
              <Lane key={o.label} label={o.label} steps={o.then} colour={t.accent} wide={wide} />
            ))}
            <Lane label="Not sure" steps={a.unsure} colour={t.fg3} wide={wide} />
          </View>
        ),
      });
    } else if (a.do === "for_each") {
      nodes.push({
        kind: "each",
        title: `Record in ${a.collection}`,
        detail: a.where.length ? `where ${a.where.map(condText).join(" and ")}` : null,
        children: (
          <View style={s.lanes}>
            <Lane label="Do" steps={a.then} colour={t.fg2} wide={false} />
          </View>
        ),
      });
    } else if (a.do === "repeat") {
      nodes.push({
        kind: "loop",
        title: `Back to step ${a.from}`,
        detail: `while ${a.if.map(condText).join(" and ")} · at most ${a.at_most} time${a.at_most === 1 ? "" : "s"}`,
      });
    } else {
      // A total: the same words the app uses.
      const line = workflowWords({ ...base, then: [a] }).slice(1)[0] ?? "";
      nodes.push({ kind: "total", title: line });
    }
  });
  return (
    <View style={s.root} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {nodes.map((n, i) => (
        <Node key={i} kind={n.kind} title={n.title} detail={n.detail} last={i === nodes.length - 1}>
          {n.children}
        </Node>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 0 },
  node: { flexDirection: "row", gap: 10 },
  rail: { width: 14, alignItems: "center" },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  line: { width: 2, flex: 1, marginTop: 3, borderRadius: 1 },
  body: { flex: 1, minWidth: 0, paddingBottom: 14, gap: 3 },
  tag: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  title: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  detail: { fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  chipText: { fontSize: 13, fontWeight: "700" },
  lanes: { gap: 8, marginTop: 8 },
  lanesWide: { flexDirection: "row" },
  lane: {
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingLeft: 10,
    paddingRight: 10,
    paddingVertical: 8,
    gap: 4,
  },
  laneLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.3, marginBottom: 4 },
});
