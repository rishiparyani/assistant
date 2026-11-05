// Something shared with me, opened in the app (owner, 2026-11-05, rehearsing as the guard: "there
// is no way I can add a visitor"): a card, a list (with an add form when the link lets me), a
// form to fill in, or a question. Shared things used to open the website, which is outside a
// rehearsal; here the app's calls carry the person played, so it is exactly their page.
// online-only: what's shared lives with its owner's space; reading and changing it needs a
// connection.
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tap, Text } from "@assistant/cards/native";
import { ulid, type SharedOpened, type StoredValue } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { SharedPage } from "@/components/SharedPage";
import { BackIcon } from "@/components/HeaderIcons";
import { homeChanged } from "@/home";
import { useTheme } from "@/theme";

const enc = encodeURIComponent;

export default function Shared() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const [opened, setOpened] = useState<SharedOpened | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const base = `/api/cards/${enc(id)}`;

  const load = useCallback(async () => {
    try {
      setOpened(await request<SharedOpened>("GET", base));
      setNote("");
    } catch (e) {
      setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
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
        setNote(isOffline(e) ? "That needs a connection." : e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    })();
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
                request("PATCH", `${base}/records/${enc(recordId)}`, { values: { [fieldId]: value } })
              }
              onAdd={(section: string, values: Record<string, unknown>) =>
                request("POST", `${base}/records`, { section, id: ulid(), values })
              }
              onAnswer={(answer: string) => request("POST", `${base}/answer`, { answer })}
            />
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
                  try {
                    const next = await request<SharedOpened>(
                      "GET",
                      `${base}?cursor=${enc(opened.next_cursor)}`,
                    );
                    if ("records" in next && "records" in opened)
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
          {opened || note ? null : <Text style={{ color: t.fg2, fontSize: 15 }}>Loading…</Text>}
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  top: { paddingHorizontal: 16, paddingBottom: 4 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  more: { minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
