import type { ReactNode } from "react";
// Draws a card from its spec (docs/design/home-first.md §2.3): the arrangement decides the
// layout, the size how much shows, the collection the colour. The model never positions
// anything; this file does.
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeOutRight, LinearTransition, ZoomIn } from "react-native-reanimated";
import { Text } from "./text.tsx";
import * as Haptics from "expo-haptics";
import type { RecordView, StoredValue } from "@assistant/shared";
import { emptyWords, type HomeCard } from "./model.ts";
import { Tick } from "./tick.tsx";
import { radius, useTheme } from "./theme.ts";
import { Control, INLINE } from "./controls.tsx";
import { RichRows, richRows, shown, tint } from "./rows.tsx";
import { AnswerBars, AnswerTable, answerTag } from "./answer.tsx";
import { EditableGrid } from "./Grid.tsx";
import { FIT_ROWS, FitContext, UNFLEX } from "./fit.ts";

const ROWS = { xs: 0, s: 3, bar: 0, m: 3, l: 8 } as const;

export function Card({
  card,
  onTick,
  onSet,
  onOpen,
  onOpenRecord,
  onAnswer,
  onNudge,
  onSeeAll,
  busy,
  fit = false,
  natural = false,
  footer,
}: {
  card: HomeCard;
  /** Drawn at its natural height with every row (the chat, the full view), not a home cell's. */
  fit?: boolean;
  /** As tall as what it shows, with the rows its size allows (a full-width card on the home). */
  natural?: boolean;
  /** The card's title opens its whole list (with "›" after it). */
  onSeeAll?: () => void;
  onTick?: (record: RecordView, value: boolean) => void;
  /** A control on a row changed a field (switches, chips, steppers, stars, sliders, buttons). */
  onSet?: (record: RecordView, fieldId: string, value: StoredValue) => void;
  onOpen?: () => void;
  /** A row was tapped: open that record (the home, the full card); none: rows aren't tappable. */
  onOpenRecord?: (record: RecordView) => void;
  /** Process cards: my answer to what it waits on me for, or a nudge to the others. */
  onAnswer?: (answer: string) => void;
  onNudge?: () => void;
  busy?: boolean;
  /** Under the rows, inside the card (an add box); drawn only when the card fits its content. */
  footer?: ReactNode;
}) {
  const { t, dark, colour, cardTint } = useTheme();
  const c = colour(card.colour);
  const size = card.spec.size;
  const field = card.spec.sources[0]?.answer_field;
  // Half-height sizes: one line of title and one figure, nothing else (no empty space).
  if (size === "xs" || size === "bar") return <Compact card={card} onOpen={onOpen} onSeeAll={onSeeAll} />;
  // How many rows: what fits the cell, or all of them when the card fits its content.
  const upTo = (n: number) => (fit ? FIT_ROWS : n);
  const un = fit || natural ? UNFLEX : null;

  // A plain bold title on the white card, and what's going on as a tag in the list's colour
  // (decision 2026-10-13 "A warmer home", from the mock-up the owner chose).
  const tag = field
    ? `${card.records.filter((r) => r.values[field] !== true).length} left`
    : fit
      ? null
      : answerTag(card.answer, size, card.spec.arrangement === "bars");
  const header = (
    <View style={s.head}>
      {onSeeAll ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`See all of ${card.spec.title}`}
          hitSlop={8}
          onPress={onSeeAll}
          style={s.titleLink}
        >
          <Text style={[s.title, { color: t.fg }]} numberOfLines={size === "s" ? 2 : 1}>
            {card.spec.title}
            <Text style={[s.chev, { color: t.fg3 }]}> ›</Text>
          </Text>
        </Pressable>
      ) : (
        <Text style={[s.title, { color: t.fg }]} numberOfLines={size === "s" ? 2 : 1}>
          {card.spec.title}
        </Text>
      )}
      {tag ? (
        // Keyed by its words: a new count pops in ("8 left" → "7 left").
        <Animated.View key={tag} entering={ZoomIn.springify().damping(12)} style={s.tagWrap}>
          <Text style={[s.tag, { color: c, backgroundColor: tint(c, dark ? 0.2 : 0.12) }]}>{tag}</Text>
        </Animated.View>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  // A list with controls: each row is its title and the controls bound to its fields.
  const controls = (card.spec.controls ?? []).flatMap((ctl) => {
    const f = card.collection?.fields.find((x) => x.id === ctl.field);
    return f ? [{ ctl, f }] : [];
  });
  const listy = ["list-plain", "list-ticks", "next"].includes(card.spec.arrangement);
  if (card.spec.row && listy)
    // Rich rows: a date tile, details, pills, a callout and a button (inline controls too).
    body = (
      <RichRows
        card={card}
        colour={c}
        limit={upTo(
          richRows(
            size,
            card.spec.row,
            controls.some((x) => !INLINE.has(x.ctl.as)),
          ),
        )}
        onTick={onTick}
        onSet={onSet}
      />
    );
  else if (controls.length && listy) {
    const inline = controls.filter((x) => INLINE.has(x.ctl.as));
    const below = controls.filter((x) => !INLINE.has(x.ctl.as));
    // What fits under the title: a row with its controls on one line is about 41 points, one
    // with a line of chips or a slider under it about 75.
    const rows = upTo(size === "l" ? (below.length ? 3 : 6) : below.length ? 1 : 2);
    body = (
      <View style={[s.ctlList, un]}>
        {card.records.slice(0, rows).map((r) => (
          <View key={r.id} style={[s.ctlRow, { borderBottomColor: t.sep }]}>
            <View style={s.ctlLine}>
              <Text style={[s.rowText, { color: t.fg }]} numberOfLines={1}>
                {r.title}
              </Text>
              {inline.map(({ ctl, f }) => (
                <Control
                  key={`${ctl.field}:${ctl.as}:${ctl.label ?? ""}`}
                  control={ctl}
                  field={f}
                  value={r.values[f.id]}
                  colour={c}
                  label={`${r.title} · ${f.name}`}
                  onSet={(v) => onSet?.(r, f.id, v)}
                />
              ))}
            </View>
            {below.map(({ ctl, f }) => (
              <Control
                key={`${ctl.field}:${ctl.as}`}
                control={ctl}
                field={f}
                value={r.values[f.id]}
                colour={c}
                label={`${r.title} · ${f.name}`}
                onSet={(v) => onSet?.(r, f.id, v)}
              />
            ))}
          </View>
        ))}
        {card.records.length === 0 ? <Text style={[s.sub, { color: t.fg2 }]}>Nothing here yet.</Text> : null}
      </View>
    );
  } else
    switch (card.spec.arrangement) {
      case "grid": {
        // A sheet of the list: the chosen columns, cells typed over in place.
        const cols = (card.spec.grid?.fields ?? []).flatMap((id) => {
          const f = card.collection?.fields.find((x) => x.id === id);
          return f ? [f] : [];
        });
        body = (
          <EditableGrid
            fields={cols}
            records={card.records}
            colour={c}
            rows={upTo(size === "l" ? 8 : 3)}
            onSet={onSet}
          />
        );
        break;
      }
      case "table":
        body = card.answer ? (
          <AnswerTable answer={card.answer} size={size} all={fit} />
        ) : (
          <Text style={[s.sub, { color: t.fg2 }]}>Working it out…</Text>
        );
        break;
      case "bars":
        body = card.answer ? (
          <AnswerBars answer={card.answer} size={size} colour={c} all={fit} />
        ) : (
          <Text style={[s.sub, { color: t.fg2 }]}>Working it out…</Text>
        );
        break;
      case "memory": {
        const kept = card.memory ?? [];
        // A small card has room under its title for one thing kept and one short line; more
        // would run up over the title.
        const small = size === "s";
        const shown = kept.slice(0, upTo(small ? 1 : 3));
        body = (
          <View style={[s.grow, un]}>
            {shown.map((m) => (
              <View key={m.id} style={[s.row, { borderBottomColor: t.sep }]}>
                <View style={[s.dot, { backgroundColor: c, opacity: 0.6 }]} />
                <Text style={[s.rowText, { color: t.fg }]} numberOfLines={small ? 1 : 2}>
                  {m.text}
                </Text>
              </View>
            ))}
            <Text style={[s.sub, { color: t.fg2 }]} numberOfLines={small ? 1 : 2}>
              {kept.length
                ? small
                  ? `${kept.length} kept · tap to see all`
                  : `${kept.length} thing${kept.length === 1 ? "" : "s"} kept · tap to see them all, or forget one`
                : small
                  ? "Nothing kept yet"
                  : "Nothing kept yet. Say “remember …” in the chat and it's used in every chat."}
            </Text>
          </View>
        );
        break;
      }
      case "process": {
        const w = card.waiting!;
        const open = w.on.filter((p) => p.answer === null);
        const answered = w.on.filter((p) => p.answer !== null);
        const askedMe = !!w.share_id && w.mine === null;
        body = (
          <View style={[s.grow, un]}>
            {/* At M the question (which names the record) is the headline: everything else has
                to fit beside a 44-point button. */}
            {size === "l" ? (
              <Text style={[s.rowText, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
                {w.record}
              </Text>
            ) : null}
            <Text
              style={[
                s.sub,
                { color: t.fg, fontWeight: size === "l" ? "500" : "700", fontSize: size === "l" ? 12.5 : 14 },
              ]}
              numberOfLines={size === "l" ? 3 : 1}
            >
              {w.text}
            </Text>
            <Text style={[s.sub, { color: t.fg2 }]} numberOfLines={1}>
              {askedMe
                ? `Waiting on you · asked ${ago(w.asked_at)}`
                : open.length
                  ? `Waiting on ${open.map((p) => p.name.split(/\s+/)[0]).join(", ")} · asked ${ago(w.asked_at)}`
                  : "Everyone has answered"}
              {answered.length && !askedMe
                ? ` · ${answered.map((p) => `${p.name.split(/\s+/)[0]}: ${p.answer}`).join(", ")}`
                : ""}
            </Text>
            {askedMe && w.choices ? (
              <View style={s.answers}>
                {w.choices.map((choice) => (
                  <Pressable
                    key={choice}
                    accessibilityRole="button"
                    accessibilityLabel={`Answer ${choice}`}
                    disabled={busy}
                    onPress={() => {
                      void Haptics.selectionAsync().catch(() => undefined);
                      onAnswer?.(choice);
                    }}
                    style={[s.answer, { backgroundColor: c, opacity: busy ? 0.6 : 1 }]}
                  >
                    <Text style={[s.answerText, { color: t.onAccent }]}>{choice}</Text>
                  </Pressable>
                ))}
              </View>
            ) : askedMe ? (
              <Text style={[s.sub, { color: t.accent }]}>Tap to answer in the chat</Text>
            ) : open.length && onNudge ? (
              <View style={s.answers}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Nudge"
                  disabled={busy}
                  onPress={onNudge}
                  style={[s.answer, { backgroundColor: t.fill, opacity: busy ? 0.6 : 1 }]}
                >
                  <Text style={[s.answerText, { color: t.accent }]}>
                    {w.nudges ? `Nudge again (${w.nudges})` : "Nudge"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
        break;
      }
      case "number": {
        // The total, then the latest two items that make it up: no empty middle.
        const sumField = card.collection?.fields.find((f) => f.id === card.spec.sources[0]?.sum_field);
        const latest = card.records.slice(0, 2);
        body = (
          <View style={[s.fill, un]}>
            <View>
              <Text
                style={[s.num, { color: t.fg }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {formatTotal(card)}
              </Text>
              <Text style={[s.sub, { color: t.fg2 }]}>
                {card.records.length} record{card.records.length === 1 ? "" : "s"}
              </Text>
            </View>
            <View>
              {latest.map((r) => (
                <View key={r.id} style={[s.mini, { borderTopColor: t.sep }]}>
                  <Text style={[s.miniText, { color: t.fg }]} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text style={[s.miniEnd, { color: t.fg2 }]} numberOfLines={1}>
                    {sumField ? (r.named[sumField.name] ?? "") : ""}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        );
        break;
      }
      case "countdown": {
        // Days to the soonest item still ahead (by the source's date field).
        const df = card.spec.sources[0]?.date_field;
        const today = istDay(new Date().toISOString());
        const ahead = card.records
          .map((r) => ({ r, d: df ? istDay(r.values[df]) : "" }))
          .filter((x) => x.d >= today)
          .sort((a, b) => a.d.localeCompare(b.d))[0];
        const days = ahead ? Math.round((Date.parse(ahead.d) - Date.parse(today)) / 86_400_000) : null;
        body = (
          <View style={[s.grow, un]}>
            <Text
              style={[s.num, { color: t.fg }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {days === null ? "–" : days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}
            </Text>
            <Text style={[s.sub, { color: t.fg2 }]} numberOfLines={size === "s" ? 1 : 2}>
              {ahead ? ahead.r.title : "Nothing coming up"}
            </Text>
          </View>
        );
        break;
      }
      case "progress": {
        // Done out of all (by the source's yes/no field).
        const done = field ? card.records.filter((r) => r.values[field] === true).length : 0;
        const all = card.records.length;
        body = (
          <View style={[s.grow, un]}>
            <Text style={[s.num, { color: t.fg }]} numberOfLines={1}>
              {done}
              <Text style={[s.of, { color: t.fg2 }]}> / {all}</Text>
            </Text>
            <View style={[s.bar, { backgroundColor: t.fill }]}>
              <View
                style={[
                  s.barIn,
                  { backgroundColor: c, width: `${all ? Math.round((done / all) * 100) : 0}%` },
                ]}
              />
            </View>
            <Text style={[s.sub, { color: t.fg2 }]}>
              {all - done ? `${all - done} to go` : all ? "All done" : "Nothing yet"}
            </Text>
          </View>
        );
        break;
      }
      case "list-ticks":
        body = (
          <View style={[s.list, un]}>
            {card.records.slice(0, upTo(ROWS[size])).map((r) => {
              const done = field ? r.values[field] === true : false;
              return (
                // A ticked row that leaves the card slides away; the rest close up.
                <Animated.View
                  key={r.id}
                  style={s.row}
                  exiting={FadeOutRight.duration(260)}
                  layout={LinearTransition.springify().damping(18)}
                >
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                    accessibilityLabel={r.title}
                    hitSlop={10}
                    onPress={() => {
                      void Haptics.selectionAsync().catch(() => undefined);
                      onTick?.(r, !done);
                    }}
                    style={s.tickHit}
                  >
                    <Tick done={done} />
                  </Pressable>
                  <Text
                    style={[
                      s.rowText,
                      { color: done ? t.fg2 : t.fg, textDecorationLine: done ? "line-through" : "none" },
                    ]}
                    numberOfLines={1}
                  >
                    {r.title}
                  </Text>
                </Animated.View>
              );
            })}
            {card.records.length === 0 ? (
              <Text style={[s.sub, { color: t.fg2 }]}>Nothing here. Nice.</Text>
            ) : null}
          </View>
        );
        break;
      default:
        body = card.shared?.fields ? (
          // A record shared with me: its fields as rows ("Fee: ₹15,000").
          <View style={[s.list, un]}>
            {card.shared.fields.slice(0, upTo(ROWS[size])).map((f) => (
              <View key={f.name} style={[s.row, { borderBottomColor: t.sep }]}>
                <Text style={[s.rowText, { color: t.fg2 }]} numberOfLines={1}>
                  {f.name}
                </Text>
                <Text style={[s.end, { color: t.fg }]} numberOfLines={1}>
                  {f.display}
                </Text>
              </View>
            ))}
            <Text style={[s.sub, { color: t.fg3 }]} numberOfLines={1}>
              From {card.shared.owner}
            </Text>
          </View>
        ) : (
          <View style={[s.list, un]}>
            {card.records.slice(0, upTo(ROWS[size])).map((r) => {
              const second = secondLine(card, r);
              // A long second value (a description) goes under the title, never beside it: beside,
              // it squeezed the title to "Sam…" (owner, 2026-10-24). A short one keeps the end.
              const under = second.length > 24;
              return (
                <Pressable
                  key={r.id}
                  accessibilityRole={onOpenRecord ? "button" : undefined}
                  accessibilityLabel={onOpenRecord ? `Open ${r.title}` : undefined}
                  disabled={!onOpenRecord}
                  onPress={() => onOpenRecord?.(r)}
                  style={({ pressed }) => [
                    s.row,
                    under && s.rowStack,
                    { borderBottomColor: t.sep },
                    pressed && onOpenRecord ? { opacity: 0.6 } : null,
                  ]}
                >
                  <Text style={[under ? s.rowTitleStack : s.rowText, { color: t.fg }]} numberOfLines={1}>
                    {r.title}
                  </Text>
                  {second ? (
                    <Text
                      style={[under ? s.rowUnder : s.end, { color: t.fg2 }]}
                      numberOfLines={under ? (fit ? 3 : 1) : 1}
                    >
                      {second}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            {card.records.length === 0 ? (
              <Text style={[s.sub, { color: t.fg2 }]}>{emptyWords(card)}</Text>
            ) : null}
            {card.shared ? (
              <Text style={[s.sub, { color: t.fg3 }]} numberOfLines={1}>
                From {card.shared.owner}
              </Text>
            ) : null}
          </View>
        );
    }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={card.spec.title}
      onPress={onOpen}
      style={({ pressed }) => [
        s.card,
        un,
        // The whole card in a soft wash of its list's colour (decision 2026-10-16 "Soft coloured
        // cards"); the edge is the same colour, a little stronger.
        {
          backgroundColor: cardTint(card.colour),
          shadowColor: t.shadow,
          borderColor: c + (dark ? "33" : "26"),
        },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <FitContext.Provider value={fit || natural}>
        {header}
        {body}
        {fit || natural ? footer : null}
      </FitContext.Provider>
    </Pressable>
  );
}

/** What a half-height card shows: the figure, a word under or beside it, and a share done. */
function figureOf(card: HomeCard): { big: string; small: string; ratio: number | null } {
  const src = card.spec.sources[0];
  switch (card.spec.arrangement) {
    case "number":
      return { big: formatTotal(card), small: `${card.records.length} records`, ratio: null };
    case "countdown": {
      const df = src?.date_field;
      const today = istDay(new Date().toISOString());
      const ahead = card.records
        .map((r) => ({ r, d: df ? istDay(r.values[df]) : "" }))
        .filter((x) => x.d >= today)
        .sort((a, b) => a.d.localeCompare(b.d))[0];
      if (!ahead) return { big: "–", small: "Nothing coming up", ratio: null };
      const days = Math.round((Date.parse(ahead.d) - Date.parse(today)) / 86_400_000);
      return {
        big: days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`,
        small: ahead.r.title,
        ratio: null,
      };
    }
    case "progress": {
      const f = src?.answer_field;
      const done = f ? card.records.filter((r) => r.values[f] === true).length : 0;
      const all = card.records.length;
      return {
        big: `${done}/${all}`,
        small: all - done ? `${all - done} to go` : "All done",
        ratio: all ? done / all : 0,
      };
    }
    default: {
      const r = card.records[0];
      return { big: r ? r.title : "Nothing yet", small: r ? secondLine(card, r) : "", ratio: null };
    }
  }
}

function Compact({ card, onOpen, onSeeAll }: { card: HomeCard; onOpen?: () => void; onSeeAll?: () => void }) {
  const { t, dark, colour, cardTint } = useTheme();
  const c = colour(card.colour);
  const wide = card.spec.size === "bar";
  const f = figureOf(card);
  const text = card.spec.arrangement === "next" || card.spec.arrangement === "list-plain";
  const bar =
    f.ratio !== null ? (
      <View style={[s.bar, s.barWide, { backgroundColor: t.fill }]}>
        <View style={[s.barIn, { backgroundColor: c, width: `${Math.round(f.ratio * 100)}%` }]} />
      </View>
    ) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.spec.title}: ${f.big}`}
      onPress={onOpen}
      style={({ pressed }) => [
        s.card,
        s.compact,
        wide && s.compactWide,
        {
          backgroundColor: cardTint(card.colour),
          shadowColor: t.shadow,
          borderColor: c + (dark ? "33" : "26"),
        },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <View style={wide ? s.compactLeft : undefined}>
        <View style={s.head}>
          {/* Half-height cards: a small coloured label over the figure ("SPENT THIS MONTH"). */}
          {onSeeAll ? (
            // The label opens the whole list, like a full card's title; the rest asks the chat.
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`See all of ${card.spec.title}`}
              hitSlop={12}
              onPress={onSeeAll}
              style={s.titleLink}
            >
              <Text style={[s.eyebrow, { color: c }]} numberOfLines={1}>
                {card.spec.title} ›
              </Text>
            </Pressable>
          ) : (
            <Text style={[s.eyebrow, { color: c }]} numberOfLines={1}>
              {card.spec.title}
            </Text>
          )}
        </View>
        {wide && f.small ? (
          <Text style={[s.sub, { color: t.fg2 }]} numberOfLines={1}>
            {f.small}
          </Text>
        ) : null}
      </View>
      {wide ? bar : null}
      <View style={!wide && bar ? s.compactRow : undefined}>
        <Text
          style={[
            text ? s.compactText : s.compactNum,
            { color: t.fg },
            wide && s.compactRight,
            wide && text ? s.compactRightText : null,
            !wide && bar ? s.compactSmallNum : null,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {f.big}
        </Text>
        {!wide ? bar : null}
      </View>
    </Pressable>
  );
}

/** The India-time calendar day of a date ("2026-10-14") or a stored date-time (UTC ISO). */
function istDay(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  if (!v.includes("T")) return v.slice(0, 10);
  const t = Date.parse(v);
  return Number.isNaN(t) ? "" : new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

/** "just now", "2 h ago", "3 days ago". */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatTotal(card: HomeCard) {
  const f = card.spec.sources[0]?.sum_field;
  const field = card.collection?.fields.find((x) => x.id === f);
  if (field?.type === "money") return "₹" + Math.round((card.total ?? 0) / 100).toLocaleString("en-IN");
  return String(card.total ?? 0);
}

function secondLine(card: HomeCard, r: RecordView): string {
  // The first readable value that isn't the title: "₹450", "Sat 14 Dec".
  if (!card.collection) return "";
  // A card ordered by date shows the date.
  // Values as people read them (dates in words, money in rupees), not as stored.
  const dated = card.collection.fields.find((f) => f.id === card.spec.sources[0]?.date_field);
  const when = dated ? shown(dated, r, null) : "";
  if (when) return when;
  for (const f of card.collection.fields) {
    if (f.id === card.collection.title_field_id || f.type === "boolean") continue;
    const v = shown(f, r, null);
    if (v) return v;
  }
  return "";
}

const s = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.card,
    padding: 14,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    overflow: "hidden",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  eyebrow: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  dot: { width: 9, height: 9, borderRadius: 3 },
  title: { fontSize: 17, fontWeight: "800", letterSpacing: -0.4, flexShrink: 1 },
  tagWrap: { marginLeft: "auto" },
  titleLink: { flexShrink: 1 },
  chev: { fontSize: 19, fontWeight: "700" },
  tag: {
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 11,
    overflow: "hidden",
  },
  grow: { flex: 1, justifyContent: "flex-end" },
  // Lists read from the top, right under the title (a short list leaves room below, not above).
  list: { flex: 1, justifyContent: "flex-start" },
  ctlList: { flex: 1, overflow: "hidden" },
  ctlRow: { gap: 6, paddingVertical: 6 },
  ctlLine: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  fill: { flex: 1, justifyContent: "space-between" },
  mini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  miniText: { flex: 1, fontSize: 12.5 },
  miniEnd: { fontSize: 11.5, fontVariant: ["tabular-nums"] },
  answers: { flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" },
  answer: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  answerText: { fontSize: 14, fontWeight: "700" },
  num: { fontSize: 30, fontWeight: "800", letterSpacing: -1.2, fontVariant: ["tabular-nums"] },
  sub: { fontSize: 12.5, lineHeight: 17, fontWeight: "500" },
  of: { fontSize: 16, fontWeight: "700", letterSpacing: 0 },
  bar: { height: 8, borderRadius: 4, overflow: "hidden", marginVertical: 4 },
  barIn: { height: 8, borderRadius: 4 },
  // List rows: no lines between them (the mock-up's cleaner list); the tick and the spacing
  // keep them apart.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 32,
  },
  rowText: { flex: 1, fontSize: 15 },
  rowStack: { flexDirection: "column", alignItems: "stretch", gap: 2, paddingVertical: 4 },
  rowTitleStack: { fontSize: 15, fontWeight: "600" },
  rowUnder: { fontSize: 12.5, lineHeight: 17 },
  end: { fontSize: 11.5, fontVariant: ["tabular-nums"], flexShrink: 1, maxWidth: "45%" },
  tickHit: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  compact: { padding: 11, gap: 2, justifyContent: "space-between" },
  compactWide: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  compactLeft: { flex: 1, gap: 3, minWidth: 0 },
  compactRight: { flexShrink: 0, textAlign: "right" },
  compactRightText: { flex: 1, flexShrink: 1 },
  compactNum: { fontSize: 23, fontWeight: "800", letterSpacing: -0.8, fontVariant: ["tabular-nums"] },
  compactText: { fontSize: 15, fontWeight: "700" },
  barWide: { flex: 1, marginVertical: 0 },
  compactRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  compactSmallNum: { fontSize: 19, flexShrink: 0 },
});
