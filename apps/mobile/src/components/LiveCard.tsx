// A live card in the chat: a record (its values), or a list / saved view drawn like a home
// card (ticks work). Loaded when shown; "Open" hands the card to the chat as context.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { CollectionView, LiveRef, RecordView } from "@assistant/shared";
import { isOffline } from "../api.ts";
import { setValue, stillShown, tick, type HomeCard } from "../home.ts";
import { useSession } from "../session.tsx";
import { loadLive, type LiveData } from "../live.ts";
import { colourFor, radius, useTheme } from "../theme.ts";
import { Card, cardHeight } from "@assistant/cards/native";

export function LiveCard({
  live,
  collections,
  onAsk,
}: {
  live: LiveRef;
  collections: () => Promise<CollectionView[]>;
  onAsk?: (title: string) => void;
}) {
  const { t } = useTheme();
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState("");
  const key = JSON.stringify(live);
  useEffect(() => {
    let gone = false;
    setData(null);
    setError("");
    loadLive(live, collections)
      .then((d) => {
        if (!gone) setData(d);
      })
      .catch((e: unknown) => {
        if (gone) return;
        const msg = e instanceof Error ? e.message : String(e);
        // A record the chat showed and that was removed since (deleted, or an add undone).
        setError(
          isOffline(e) ? "Needs a connection." : /not found/i.test(msg) ? "This one is gone now." : msg,
        );
      });
    return () => {
      gone = true;
    };
    // The ref's content is the dependency (a new object each render otherwise).
  }, [key, live, collections]);

  if (error)
    return (
      <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.sub, { color: t.fg2 }]}>{error}</Text>
      </View>
    );
  if (!data)
    return (
      <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair, alignItems: "center" }]}>
        <ActivityIndicator color={t.fg3} />
      </View>
    );
  if (data.kind === "plain")
    return (
      <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.title, { color: t.fg }]}>{data.title}</Text>
        {data.subtitle ? <Text style={[s.sub, { color: t.fg2 }]}>{data.subtitle}</Text> : null}
      </View>
    );
  if (data.kind === "record")
    return <RecordCard record={data.record} collection={data.collection} onAsk={onAsk} />;
  return <ListCard card={data.card} more={data.more} onAsk={onAsk} />;
}

function RecordCard({
  record,
  collection,
  onAsk,
}: {
  record: RecordView;
  collection: CollectionView;
  onAsk?: (title: string) => void;
}) {
  const { t, colour } = useTheme();
  const c = colour(colourFor(collection.name));
  const title = collection.fields.find((f) => f.id === collection.title_field_id)?.name;
  const rows = collection.fields
    .filter((f) => f.name !== title)
    .map((f) => [f.name, record.named[f.name]] as const)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .slice(0, 4);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={record.title}
      onPress={() => onAsk?.(record.title)}
      style={({ pressed }) => [
        s.box,
        { backgroundColor: t.cell, borderColor: t.hair, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <View style={s.head}>
        <View style={[s.dot, { backgroundColor: c }]} />
        <Text style={[s.kicker, { color: c }]}>{collection.name}</Text>
      </View>
      <Text style={[s.title, { color: t.fg }]} numberOfLines={2}>
        {record.title}
      </Text>
      {rows.map(([name, v]) => (
        <View key={name} style={s.row}>
          <Text style={[s.label, { color: t.fg2 }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[s.value, { color: t.fg }]} numberOfLines={1}>
            {Array.isArray(v) ? v.join(", ") : v}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

function ListCard({
  card: given,
  more,
  onAsk,
}: {
  card: HomeCard;
  more: boolean;
  onAsk?: (title: string) => void;
}) {
  const { t } = useTheme();
  const { me } = useSession();
  const [card, setCard] = useState(given);
  useEffect(() => setCard(given), [given]);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ height: cardHeight(card) }}>
        <Card
          card={card}
          onTick={(record, value) =>
            setCard((c) => ({
              ...c,
              records: c.records.map((r) => (r.id === record.id ? tick(c, r, value) : r)),
            }))
          }
          onSet={(record, field, value) =>
            setCard((c) => ({
              ...c,
              records: c.records.flatMap((r) => {
                if (r.id !== record.id) return [r];
                const next = setValue(c, r, field, value);
                return stillShown(c, next, me?.user.id ?? null) ? [next] : [];
              }),
            }))
          }
          onOpen={() => onAsk?.(card.spec.title)}
        />
      </View>
      {more ? <Text style={[s.sub, { color: t.fg3, paddingHorizontal: 6 }]}>and more…</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 6,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 3 },
  kicker: { fontSize: 12, fontWeight: "700" },
  title: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
  sub: { fontSize: 13 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  label: { fontSize: 13, flexShrink: 0 },
  value: { fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" },
});
