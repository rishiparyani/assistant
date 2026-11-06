// Something shared with me, opened in the app (owner, 2026-11-05, rehearsing as the guard: "there
// is no way I can add a visitor"): a card, a list (with an add form when the link lets me), a
// form to fill in, or a question. Shared things used to open the website, which is outside a
// rehearsal; here the app's calls carry the person played, so it is exactly their page.
// online-only: what's shared lives with its owner's space; reading and changing it needs a
// connection.
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tap, Text } from "@assistant/cards/native";
import { ulid, type SharedOpened, type StoredValue } from "@assistant/shared";
import { ApiError, isOffline, request } from "@/api";
import { SharedComments } from "@/components/SharedComments";
import { SharedPage } from "@/components/SharedPage";
import { BackIcon } from "@/components/HeaderIcons";
import { homeChanged } from "@/home";
import { useTheme } from "@/theme";

const enc = encodeURIComponent;
/** The share was taken back, or what it showed is gone (not a connection problem). */
const gone = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 403);
const GONE = "This isn't shared with you any more.";

export default function Shared() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const [opened, setOpened] = useState<SharedOpened | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pulls, setPulls] = useState(0);
  const [more, setMore] = useState(false);
  // Leave was tapped once (a second tap leaves).
  const [leaving, setLeaving] = useState(false);
  const base = `/api/cards/${enc(id)}`;

  // Each load is numbered: an older one that answers late (a slow pull to refresh, then an
  // edit's reload) never overwrites what a newer one showed (Codex on PR 230).
  const gen = useRef(0);
  const load = useCallback(async () => {
    const mine = ++gen.current;
    try {
      const v = await request<SharedOpened>("GET", base);
      if (mine !== gen.current) return;
      setOpened(v);
      setNote("");
    } catch (e) {
      if (mine !== gen.current) return;
      // Taken back or gone: what it showed goes too, as on the website (Codex on PR 230). A
      // dropped connection keeps it.
      if (gone(e)) setOpened(null);
      setNote(
        gone(e)
          ? GONE
          : isOffline(e)
            ? "This needs a connection."
            : e instanceof Error
              ? e.message
              : String(e),
      );
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = (key: string, go: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    void (async () => {
      try {
        await go();
        setNote("");
        homeChanged();
        await load();
      } catch (e) {
        if (gone(e)) setOpened(null);
        setNote(
          gone(e)
            ? GONE
            : isOffline(e)
              ? "That needs a connection."
              : e instanceof Error
                ? e.message
                : String(e),
        );
      } finally {
        setBusy(null);
      }
    })();
  };
  // Off my Shared with you list (Codex on PR 230: the website's Leave was lost). Coming back
  // takes the link again.
  const leave = () => {
    if (!leaving) return setLeaving(true);
    setLeaving(false);
    run("leave", async () => {
      await request("DELETE", base);
      homeChanged();
      if (router.canGoBack()) router.back();
      else router.replace("/");
    });
  };

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 6 }]}>
      <View style={s.column}>
        <View style={s.top}>
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            scale={0.9}
            style={[s.back, { backgroundColor: t.fill }]}
          >
            <BackIcon color={t.fg} />
          </Tap>
        </View>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                setPulls((n) => n + 1);
                await load();
                setRefreshing(false);
              }}
            />
          }
        >
          {note ? <Text style={{ color: t.danger, fontSize: 14 }}>{note}</Text> : null}
          {opened ? (
            <SharedPage
              opened={opened}
              busy={busy}
              run={run}
              onSet={(recordId: string, fieldId: string, value: StoredValue) =>
                request("PATCH", `${base}/records/${enc(recordId)}`, {
                  // Money is held in paise; the write reads rupees (Codex on PR 230: ₹10 saved
                  // as ₹1,000), as the website's sendValues does.
                  values: {
                    [fieldId]:
                      typeof value === "number" && typeOf(opened, recordId, fieldId) === "money"
                        ? String(value / 100)
                        : value,
                  },
                })
              }
              onAdd={async (section: string, values: Record<string, unknown>) => {
                await request("POST", `${base}/records`, { section, id: ulid(), values });
                // Shown at once: the add forms don't go through run (Codex on PR 230).
                homeChanged();
                await load();
              }}
              onAnswer={(answer: string) => request("POST", `${base}/answer`, { answer })}
            />
          ) : null}
          {opened && "record" in opened && "sections" in opened ? (
            // A card's comments, as on the website (Codex on PR 230).
            <SharedComments shareId={id} recordId={opened.record.id} refresh={pulls} />
          ) : null}
          {opened && "next_cursor" in opened && opened.next_cursor ? (
            // A long shared list comes a page at a time (Codex on PR 230).
            <Tap
              accessibilityRole="button"
              disabled={more}
              onPress={() =>
                void (async () => {
                  if (!("next_cursor" in opened) || !opened.next_cursor) return;
                  setMore(true);
                  const mine = gen.current;
                  try {
                    const next = await request<SharedOpened>(
                      "GET",
                      `${base}?cursor=${enc(opened.next_cursor)}`,
                    );
                    if (mine === gen.current && "records" in next && "records" in opened)
                      setOpened({
                        ...opened,
                        records: [...opened.records, ...next.records],
                        next_cursor: next.next_cursor,
                      });
                  } catch (e) {
                    setNote(
                      isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e),
                    );
                  } finally {
                    setMore(false);
                  }
                })()
              }
              style={[s.more, { backgroundColor: t.fill, opacity: more ? 0.6 : 1 }]}
            >
              <Text style={{ color: t.fg, fontSize: 15, fontWeight: "700" }}>
                {more ? "Loading…" : "Show more"}
              </Text>
            </Tap>
          ) : null}
          {opened && opened.share.kind !== "question" ? (
            <Tap
              accessibilityRole="button"
              accessibilityLabel={leaving ? "Leave: tap again to leave" : "Leave"}
              disabled={busy === "leave"}
              onPress={leave}
              style={[s.more, { backgroundColor: t.fill }]}
            >
              <Text style={{ color: t.danger, fontSize: 15, fontWeight: "700" }}>
                {leaving ? "Tap again to leave" : "Leave"}
              </Text>
            </Tap>
          ) : null}
          {leaving ? (
            <Text style={{ color: t.fg2, fontSize: 13, textAlign: "center" }}>
              It goes from your Shared with you list. You'd need the link again to come back.
            </Text>
          ) : null}
          {opened || note ? null : <Text style={{ color: t.fg2, fontSize: 15 }}>Loading…</Text>}
        </ScrollView>
      </View>
    </View>
  );
}

/** A field's type, from the record that has it in what's open. */
function typeOf(opened: SharedOpened, recordId: string, fieldId: string): string | undefined {
  const records = [
    ...("records" in opened ? opened.records : []),
    ...("record" in opened ? [opened.record] : []),
    ...("sections" in opened ? opened.sections.flatMap((x) => x.records) : []),
  ] as { id: string; fields: { id: string; type: string }[] }[];
  return records.find((r) => r.id === recordId)?.fields.find((f) => f.id === fieldId)?.type;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  top: { paddingHorizontal: 16, paddingBottom: 4 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  more: { minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
