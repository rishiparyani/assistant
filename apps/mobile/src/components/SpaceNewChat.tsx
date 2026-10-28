// A new chat inside a space (docs/design/chats-home.md 6): for everyone in it, or some of its
// people (a private chat only they see). Only the space's people can be picked.
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput, type } from "@assistant/cards/native";
import type { SpacePerson } from "@assistant/shared";
import { isOffline } from "@/api";
import { startSpaceChat } from "@/chats";
import { Sheet } from "@/components/Sheet";
import { Avatar } from "@/components/ChatBits";
import { radius, useTheme } from "@/theme";

export function SpaceNewChat({
  open,
  space,
  people,
  onClose,
  onMade,
}: {
  open: boolean;
  space: { id: string; name: string };
  /** The space's people but me. */
  people: SpacePerson[];
  onClose: () => void;
  onMade: (id: string) => void;
}) {
  const { t } = useTheme();
  const [name, setName] = useState("");
  const [everyone, setEveryone] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = !!name.trim() && (everyone || picked.length > 0);
  const reset = () => {
    setName("");
    setEveryone(true);
    setPicked([]);
    setError("");
  };
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const made = await startSpaceChat(space.id, { name, ...(everyone ? {} : { people: picked }) });
      onMade(made.id);
    } catch (e) {
      setError(
        isOffline(e) ? "Starting a chat needs a connection." : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };
  const choice = (on: boolean, label: string, sub: string, pick: () => void) => (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={pick}
      style={[s.choice, { backgroundColor: on ? t.accentSoft : t.cell, borderColor: on ? t.accent : t.hair }]}
    >
      <Text style={[type.heading, { color: t.fg }]}>{label}</Text>
      <Text style={[type.small, { color: t.fg2 }]}>{sub}</Text>
    </Pressable>
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      onShow={reset}
      keyboard
      accessibilityLabel={`New chat in ${space.name}`}
    >
      <Text style={[type.title, { color: t.fg }]}>New chat in {space.name}</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name, e.g. Committee, Repairs"
        placeholderTextColor={t.fg3}
        maxLength={60}
        accessibilityLabel="Chat name"
        style={[s.input, type.body, { backgroundColor: t.cell, color: t.fg }]}
      />
      <View style={{ gap: 8 }}>
        {choice(everyone, "Everyone", `All ${people.length + 1} people in ${space.name}`, () =>
          setEveryone(true),
        )}
        {choice(!everyone, "Some people", "A private chat: only they see it", () => setEveryone(false))}
      </View>
      {!everyone ? (
        <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 6 }}>
          {people.map((p) => {
            const on = picked.includes(p.user_id);
            return (
              <Pressable
                key={p.user_id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setPicked((x) => (on ? x.filter((y) => y !== p.user_id) : [...x, p.user_id]))}
                style={[s.person, { backgroundColor: on ? t.accentSoft : t.cell }]}
              >
                <Avatar name={p.name} size={36} />
                <Text style={[type.body, { color: t.fg, flex: 1, fontWeight: "700" }]} numberOfLines={1}>
                  {p.name}
                </Text>
                <View
                  style={[
                    s.check,
                    { borderColor: on ? t.accent : t.fill2, backgroundColor: on ? t.accent : t.cell },
                  ]}
                >
                  {on ? <Text style={{ color: t.onAccent, fontWeight: "800", fontSize: 13 }}>✓</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {error ? <Text style={[type.small, { color: t.danger }]}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={!ready || busy}
        onPress={() => void go()}
        style={[s.go, { backgroundColor: t.accent, opacity: !ready || busy ? 0.5 : 1 }]}
      >
        <Text style={[type.label, { color: t.onAccent, fontSize: 16 }]}>
          {busy
            ? "Starting…"
            : everyone
              ? "Start the chat"
              : picked.length
                ? `Start the chat (${picked.length + 1} people)`
                : "Pick people"}
        </Text>
      </Pressable>
    </Sheet>
  );
}

const s = StyleSheet.create({
  input: { minHeight: 48, borderRadius: radius.row, paddingHorizontal: 16 },
  choice: { borderRadius: radius.row, borderWidth: 1.5, padding: 12, gap: 2, minHeight: 56 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 16,
    minHeight: 56,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  go: { minHeight: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
});
