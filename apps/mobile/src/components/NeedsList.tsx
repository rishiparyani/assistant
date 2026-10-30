// Needs you (docs/design/chats-base.md, "The bell: one inbox"): every question, approval and
// form waiting on me, each with its buttons, at the top of the Inbox. Reads what Today keeps on
// the device first (offline-first rule 17).
import { useCallback, useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { Boundary, Card, Text, type } from "@assistant/cards/native";
import { useRouter } from "expo-router";
import { API_URL } from "@/config";
import { isOffline } from "@/api";
import { answerWaiting, nudgeWaiting, onHomeChanged, type HomeCard } from "@/home";
import { loadToday, savedToday, type Today } from "@/today";
import { useLive } from "@/live-socket";
import { useSession } from "@/session";
import { useTheme } from "@/theme";

export { onMe } from "@/home-list";

/** What's waiting on me, kept fresh; `reload` for the screen's pull-to-refresh. */
export function useNeeds() {
  const { me } = useSession();
  const userId = me?.user.id ?? null;
  const [today, setToday] = useState<Today | null>(() => (userId ? savedToday(userId) : null));
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      setToday(await loadToday(userId));
      setError("");
    } catch (e) {
      if (!isOffline(e)) setError(e instanceof Error ? e.message : String(e));
    }
  }, [userId]);
  useEffect(() => void reload(), [reload]);
  useEffect(() => onHomeChanged(() => void reload()), [reload]);
  useLive((m) => {
    if (m.type === "space_changed" || m.type === "reconnected") void reload();
  });
  return { needs: today?.needs ?? null, error, setError, reload };
}

/** The cards waiting on me, each answerable in place. */
export function NeedsList({
  needs,
  reload,
  onError,
  empty,
}: {
  needs: HomeCard[];
  reload: () => Promise<void>;
  onError: (message: string) => void;
  /** Said when there is nothing (none: show nothing). */
  empty?: string;
}) {
  const { t } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  // online-only: the website's shared pages (a form to fill in) open in the browser.
  const openOnWeb = (card: HomeCard) =>
    card.shared && void Linking.openURL(`${API_URL}/shared/${encodeURIComponent(card.shared.share_id)}`);
  // online-only: answering a step runs it on the server, which moves the workflow on.
  const act = (card: HomeCard, go: () => Promise<unknown>) => async () => {
    setBusy(card.id);
    try {
      await go();
      await reload();
      setTimeout(() => void reload(), 1500);
    } catch (e) {
      onError(isOffline(e) ? "Answering needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!needs.length)
    return empty ? (
      <View style={{ paddingVertical: 4, paddingHorizontal: 4 }}>
        <Text style={[type.small, { color: t.fg2 }]}>{empty}</Text>
      </View>
    ) : null;
  return (
    <>
      {needs.map((card) => (
        <Boundary key={card.id} where="needs you">
          <Card
            card={card}
            natural
            onOpen={() =>
              card.waiting
                ? router.push({
                    pathname: "/process",
                    params: { id: card.waiting.workflow_id, waiting: JSON.stringify(card.waiting) },
                  })
                : card.shared?.kind === "form"
                  ? openOnWeb(card)
                  : undefined
            }
            onAnswer={
              card.waiting
                ? (answer) => void act(card, () => answerWaiting(card.waiting!, answer))()
                : undefined
            }
            onNudge={
              card.waiting?.share_id
                ? undefined
                : card.waiting
                  ? act(card, () => nudgeWaiting(card.waiting!))
                  : undefined
            }
            busy={busy === card.id}
          />
        </Boundary>
      ))}
    </>
  );
}
