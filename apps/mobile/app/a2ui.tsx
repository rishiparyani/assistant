// The A2UI trial screen (decision 2026-10-18 "Try A2UI"): a card written in A2UI, drawn by the
// app's own player and parts, with made-up data. The picker and the ticks write into the
// card's data; the app works out the figures from it (as it will from real lists), so the
// tiles follow. "Build again" sends the card piece by piece, the way an agent's answer
// arrives. Nothing here reads or writes the person's data.
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Catalog, MessageProcessor, type SurfaceModel } from "@a2ui/web_core";
import { Text, type, useTheme } from "@assistant/cards/native";
import { A2uiSurface } from "@/a2ui/player";
import { PARTS } from "@/a2ui/parts";

const CATALOG = "gigspree:cards:trial";
const SURFACE = "expenses";

type Item = { title: string; when: string; month: string; amount: number; paid: boolean };
const ITEMS: Item[] = [
  { title: "Electricity bill", when: "Oct 10", month: "This month", amount: 180000, paid: false },
  { title: "Groceries", when: "Oct 3", month: "This month", amount: 120000, paid: true },
  { title: "Cab", when: "Oct 14", month: "This month", amount: 42000, paid: false },
  { title: "Dinner out", when: "Sep 12", month: "Last month", amount: 90000, paid: true },
  { title: "Phone bill", when: "Sep 5", month: "Last month", amount: 60000, paid: false },
];

/** What an agent would send: the surface, then the parts, then the data. */
function messages(): object[] {
  const v = "v0.9";
  const parts = [
    { id: "root", component: "Card", title: "Expenses", children: ["tabs"] },
    {
      id: "tabs",
      component: "Tabs",
      tabs: [
        { title: "Overview", child: "overview" },
        { title: "Items", child: "items" },
      ],
    },
    { id: "overview", component: "Column", children: ["period", "figures", "summary"] },
    { id: "period", component: "Picker", value: { path: "/period" }, options: ["This month", "Last month"] },
    { id: "figures", component: "Row", children: ["spent", "unpaid"] },
    { id: "spent", component: "Stat", label: "Spent", value: { path: "/spent" }, format: "money" },
    {
      id: "unpaid",
      component: "Stat",
      label: "Still to pay",
      value: { path: "/unpaid" },
      format: "money",
      tone: "warn",
    },
    { id: "summary", component: "Text", style: "caption", text: { path: "/summary" } },
    { id: "items", component: "List", children: { componentId: "row", path: "/items" } },
    {
      id: "row",
      component: "CheckRow",
      label: { path: "title" },
      detail: { path: "when" },
      checked: { path: "paid" },
      amount: { path: "amount" },
    },
  ];
  return [
    { version: v, createSurface: { surfaceId: SURFACE, catalogId: CATALOG } },
    ...parts.map((c) => ({ version: v, updateComponents: { surfaceId: SURFACE, components: [c] } })),
    {
      version: v,
      updateDataModel: { surfaceId: SURFACE, path: "/", value: { period: "This month", items: ITEMS } },
    },
  ];
}

/** The app's side: the figures follow the period and the ticks (from real lists, later). */
function keepFigures(surface: SurfaceModel) {
  const data = surface.dataModel;
  const work = () => {
    const period = data.get<string>("/period") ?? "This month";
    const items = (data.get<Item[]>("/items") ?? []).filter((i) => i.month === period);
    const spent = items.reduce((n, i) => n + i.amount, 0);
    const open = items.filter((i) => !i.paid);
    data.set("/spent", spent);
    data.set(
      "/unpaid",
      open.reduce((n, i) => n + i.amount, 0),
    );
    data.set("/summary", `${items.length} items · ${open.length} still to pay`);
  };
  const subs = [data.subscribe("/period", work), data.subscribe("/items", work)];
  work();
  return () => subs.forEach((s) => s.unsubscribe());
}

export default function A2uiTrial() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [surface, setSurface] = useState<SurfaceModel | null>(null);
  const [run, setRun] = useState(0);
  const stop = useRef<() => void>(() => undefined);

  useEffect(() => {
    // The parts are the core's component shape (name + zod/v3 schema); its types come from its own Zod copy.
    const processor = new MessageProcessor([new Catalog(CATALOG, "v0.9", PARTS as never[])]);
    const all = messages();
    let at = 0;
    let unfollow = () => {};
    let shown = false;
    // The first run shows the finished card; "Build again" sends it a piece at a time.
    const step = () => {
      processor.processMessages(all[at++] as never);
      const s = processor.model.surfacesMap.get(SURFACE);
      if (s && !shown) {
        shown = true;
        setSurface(s);
      }
      if (at === all.length && s) unfollow = keepFigures(s);
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    if (run === 0) while (at < all.length) step();
    else timer = setInterval(() => (at < all.length ? step() : clearInterval(timer)), 220);
    stop.current = () => {
      if (timer) clearInterval(timer);
      unfollow();
    };
    return () => stop.current();
    // A new run is a new processor; the surface is read from it.
  }, [run]);

  return (
    <View style={[s.root, { backgroundColor: t.canvas, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <Text style={[type.title, { color: t.fg }]}>A2UI trial</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={10}
          style={s.done}
        >
          <Text style={[type.label, { color: t.accent }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={[type.small, { color: t.fg2 }]}>
          A card written in A2UI and drawn with the app&apos;s own parts. Pick a month or tick an item: the
          figures follow. Made-up data; nothing is saved.
        </Text>
        <View key={run}>{surface ? <A2uiSurface surface={surface} parts={PARTS} /> : null}</View>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            stop.current();
            setSurface(null);
            setRun((n) => n + 1);
          }}
          style={[s.again, { backgroundColor: t.fill }]}
        >
          <Text style={[type.label, { color: t.accent }]}>Build again, piece by piece</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  done: { minHeight: 44, justifyContent: "center" },
  body: { padding: 16, gap: 16 },
  again: { minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
