// The day, at the top of the home (decision 2026-11-09 "A calmer look, and a home that shows your
// day"): what needs me, answered here; what's coming up, ticked here; and each list with a tick
// box as it stands (what's left, what it adds up to), ticked here too. The things themselves,
// not the folders they're in. A tick shows at once and goes through the outbox (rule 17).
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Tap, Text, type } from "@assistant/cards/native";
import { formatINR, type CollectionView, type RecordView } from "@assistant/shared";
import { writeValue, type HomeCard } from "@/home";
import { outboxState } from "@/outbox";
import { tickField, whenWords, type Glance, type UpNextItem } from "@/today";
import { radius, useTheme } from "@/theme";
import { NeedsList } from "./NeedsList";

/** How many coming-up rows show before "more". */
const COMING = 5;

export function DayHome({
  needs,
  coming,
  glance,
  fresh,
  now,
  loading,
  assistant,
  reload,
  onError,
  onOpenRecord,
  onOpenList,
  onAsk,
}: {
  /** What's waiting on me. */
  needs: HomeCard[];
  coming: UpNextItem[];
  glance: Glance[];
  /** Changes with every read (the ticks kept here are dropped then: the read has them). */
  fresh: unknown;
  now: number;
  loading: boolean;
  assistant: boolean;
  reload: () => Promise<void>;
  onError: (message: string) => void;
  onOpenRecord: (item: UpNextItem) => void;
  onOpenList: (collection: string, space?: string) => void;
  onAsk: () => void;
}) {
  const { t } = useTheme();
  // Ticks made here, by record: shown at once, and kept until the next read brings them back.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  // A fresh read has the ticks in it, so what was kept here would only go stale; unless changes
  // are still waiting to be sent (offline), when the read is older than the ticks.
  useEffect(() => {
    if (!outboxState().waiting.length) setTicked({});
  }, [fresh]);

  const done = (r: RecordView, field: string) => ticked[r.id] ?? r.values[field] === true;
  const tick = (c: CollectionView, r: RecordView, field: string, space?: string) => {
    const next = !done(r, field);
    writeValue(c, r, field, next, space ?? null);
    setTicked((m) => ({ ...m, [r.id]: next }));
  };

  // Done things aren't coming up (ones ticked just now stay, struck, until the next read).
  const upcoming = coming.filter((u) => {
    const f = u.shared ? null : tickField(u.collection);
    return !f || u.record.values[f] !== true;
  });
  const shownComing = all ? upcoming : upcoming.slice(0, COMING);
  const nothing = !needs.length && !upcoming.length && !glance.length;

  const card = [s.card, { backgroundColor: t.cell, borderColor: t.hair }];
  return (
    <View style={{ gap: 12 }}>
      {needs.length ? (
        <View style={{ gap: 8 }} accessibilityLabel="Needs you">
          <Text style={[type.eyebrow, s.label, { color: t.warn }]}>Needs you</Text>
          <NeedsList needs={needs} reload={reload} onError={onError} />
        </View>
      ) : null}

      {upcoming.length ? (
        <View style={card} accessibilityLabel="Coming up">
          <View style={s.head}>
            <Text style={[type.eyebrow, { color: t.fg2, flex: 1 }]}>Coming up</Text>
            <Text style={[type.caption, { color: t.fg2 }]}>
              {upcoming.length === 1 ? "1 this week" : `${upcoming.length} this week`}
            </Text>
          </View>
          {shownComing.map((u) => {
            const f = u.shared ? null : tickField(u.collection);
            const isDone = f ? done(u.record, f) : false;
            return (
              <View key={u.key} style={[s.row, { borderTopColor: t.sep }]}>
                {f ? (
                  <Check
                    on={isDone}
                    label={`${isDone ? "Not done" : "Done"}: ${u.title}`}
                    onPress={() => tick(u.collection, u.record, f, u.space)}
                  />
                ) : null}
                <Tap
                  accessibilityRole="button"
                  accessibilityLabel={`${u.title}, ${whenWords(u, now)}`}
                  onPress={() => onOpenRecord(u)}
                  scale={0.99}
                  style={[s.rowMain, !f && { paddingLeft: 14 }]}
                >
                  <View style={s.words}>
                    <Text
                      style={[
                        type.body,
                        isDone ? { color: t.fg3, textDecorationLine: "line-through" } : { color: t.fg },
                      ]}
                      numberOfLines={1}
                    >
                      {u.title}
                    </Text>
                    <Text style={[type.caption, { color: t.fg2, fontWeight: "500" }]} numberOfLines={1}>
                      {u.sub}
                    </Text>
                  </View>
                  <Text style={[type.caption, { color: t.fg2 }]}>{whenWords(u, now)}</Text>
                </Tap>
              </View>
            );
          })}
          {upcoming.length > COMING && !all ? (
            <Tap
              accessibilityRole="button"
              onPress={() => setAll(true)}
              style={[s.more, { borderTopColor: t.sep }]}
            >
              <Text style={[type.label, { color: t.accent }]}>{upcoming.length - COMING} more</Text>
            </Tap>
          ) : null}
        </View>
      ) : null}

      {glance.map((g) => {
        // What's left, with the ticks made here taken off.
        const gone = g.open.filter((r) => done(r, g.tick));
        const left = g.left - gone.length;
        const money = g.collection.fields.find((f) => f.type === "money")?.id;
        const sum =
          g.sum === null || !money
            ? null
            : g.sum -
              gone.reduce(
                (n, r) => n + (typeof r.values[money] === "number" ? (r.values[money] as number) : 0),
                0,
              );
        const rest = g.left - g.open.length;
        const open = () => onOpenList(g.collection.id, g.space);
        return (
          <View key={g.key} style={card} accessibilityLabel={g.collection.name}>
            <Tap
              accessibilityRole="button"
              accessibilityLabel={`Open ${g.collection.name}`}
              onPress={open}
              style={s.head}
            >
              <Text style={[type.eyebrow, { color: t.fg2, flex: 1 }]} numberOfLines={1}>
                {g.collection.name}
                {g.space ? ` · ${g.spaceName}` : ""}
              </Text>
              <Chevron colour={t.fg2} />
            </Tap>
            <View style={s.hero}>
              <Text style={[type.num, s.figure, { color: t.fg }]}>
                {left === 0
                  ? "Done"
                  : sum !== null && sum > 0
                    ? formatINR(sum)
                    : `${left}${g.more ? "+" : ""}`}
              </Text>
              <Text style={[type.small, { color: t.fg2 }]}>
                {left === 0
                  ? "nothing left"
                  : sum !== null && sum > 0
                    ? `left · ${left}${g.more ? "+" : ""} to do`
                    : "left to do"}
              </Text>
            </View>
            {g.open.map((r) => {
              const isDone = done(r, g.tick);
              const amount =
                money && typeof r.values[money] === "number" ? (r.values[money] as number) : null;
              return (
                <View key={r.id} style={[s.row, { borderTopColor: t.sep }]}>
                  <Check
                    on={isDone}
                    label={`${isDone ? "Not done" : "Done"}: ${r.title}`}
                    onPress={() => tick(g.collection, r, g.tick, g.space)}
                  />
                  <View style={[s.rowMain, { paddingRight: 14 }]}>
                    <Text
                      style={[
                        type.body,
                        { flex: 1 },
                        isDone ? { color: t.fg3, textDecorationLine: "line-through" } : { color: t.fg },
                      ]}
                      numberOfLines={1}
                    >
                      {r.title}
                    </Text>
                    {amount !== null ? (
                      <Text
                        style={[type.small, type.num, { color: isDone ? t.fg3 : t.fg, letterSpacing: 0 }]}
                      >
                        {formatINR(amount)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
            {rest > 0 ? (
              <Tap accessibilityRole="button" onPress={open} style={[s.more, { borderTopColor: t.sep }]}>
                <Text style={[type.label, { color: t.accent }]}>
                  {rest}
                  {g.more ? "+" : ""} more
                </Text>
              </Tap>
            ) : null}
          </View>
        );
      })}

      {nothing && !loading ? (
        <View style={[card, s.calm]}>
          <Text style={[type.heading, { color: t.fg }]}>Nothing needs you today</Text>
          <Text style={[type.small, { color: t.fg2, textAlign: "center" }]}>
            {assistant
              ? "Things with a date or a tick box show here as they come up. Tell the assistant what you keep track of."
              : "Things with a date or a tick box show here as they come up."}
          </Text>
          {assistant ? (
            <Tap accessibilityRole="button" onPress={onAsk} style={[s.cta, { backgroundColor: t.accent }]}>
              <Text style={[type.label, { color: t.onAccent }]}>Ask the assistant</Text>
            </Tap>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A tick box with a full-size place to tap. */
function Check({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <Tap
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onPress}
      haptic="light"
      scale={0.9}
      style={s.check}
    >
      <View
        style={[s.box, on ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.fg3 }]}
      >
        {on ? (
          <Svg width={14} height={14} viewBox="0 0 24 24">
            <Path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke={t.onAccent}
              strokeWidth={3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        ) : null}
      </View>
    </Tap>
  );
}

function Chevron({ colour }: { colour: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Path
        d="M9 5l7 7-7 7"
        stroke={colour}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

const s = StyleSheet.create({
  label: { paddingHorizontal: 4 },
  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 13,
    minHeight: 40,
  },
  hero: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  figure: { fontSize: 34, lineHeight: 38, letterSpacing: -1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingRight: 14,
  },
  words: { flex: 1, minWidth: 0 },
  check: { width: 50, height: 52, alignItems: "center", justifyContent: "center" },
  box: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  more: {
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  calm: { alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 24 },
  cta: {
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
});
