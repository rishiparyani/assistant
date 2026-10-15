// A CSV into the chat (decision 2026-10-15 "Toward Excel", 3): the file goes to the server
// as it is (never into a message), and the assistant is told its columns and row count, so
// it can propose where the rows go; the person confirms the card. On the website a file is
// picked; anywhere, its text can be pasted.
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import type { ImportView } from "@assistant/shared";
import { Text, TextInput } from "@assistant/cards/native";
import { ApiError, request } from "../api.ts";
import { useTheme } from "../theme.ts";

/** What the chat says once a file is up: enough for the assistant, none of the rows. */
export function uploadedWords(f: ImportView): string {
  const cols = f.columns
    .map(
      (c) =>
        `${c.name} (${c.guess.replace("_", " ")}${c.sample.length ? `, e.g. ${c.sample.slice(0, 2).join(" / ")}` : ""})`,
    )
    .join("; ");
  return `I uploaded a CSV “${f.name}” (import ${f.id}): ${f.rows} row${f.rows === 1 ? "" : "s"}. Columns: ${cols}. Where should these go? Propose the import (a list that exists, or a new one); I'll confirm.`;
}

export function ImportSheet({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (file: ImportView) => void;
}) {
  const { t } = useTheme();
  const [name, setName] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setName("");
    setCsv("");
    setError("");
  };
  // online-only: the file is kept and read on the server; nothing to queue.
  const upload = async (fileName: string, text: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const file = await request<ImportView>("POST", "/api/imports", { name: fileName, csv: text });
      reset();
      onUploaded(file);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // The website: a real file picker (the browser reads the file; the app never keeps it).
  const pick = () => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.tsv,text/csv,text/tab-separated-values,text/plain";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      f.text()
        .then((text) => upload(f.name, text))
        .catch(() => setError("Couldn't read that file"));
    };
    input.click();
  };

  return (
    <Sheet open={open} onClose={onClose} tone="cell" keyboard accessibilityLabel="Add a CSV">
      <Text style={[s.label, { color: t.fg2 }]}>Add a CSV</Text>
      <Text style={[s.small, { color: t.fg }]}>
        A sheet saved as CSV, the first line naming the columns. The assistant reads the column names and a
        few cells, says where the rows would go, and nothing is added until you confirm.
      </Text>
      {Platform.OS === "web" ? (
        <Pressable
          accessibilityRole="button"
          onPress={pick}
          disabled={busy}
          style={[s.primary, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[s.primaryText, { color: t.onAccent }]}>Choose a file</Text>
        </Pressable>
      ) : null}
      <Text style={[s.small, { color: t.fg2 }]}>
        {Platform.OS === "web" ? "Or paste it:" : "Paste it here:"}
      </Text>
      <TextInput
        accessibilityLabel="File name"
        placeholder="Name, e.g. expenses.csv"
        placeholderTextColor={t.fg2}
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
        style={[s.input, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
      />
      <TextInput
        accessibilityLabel="CSV text"
        placeholder={"Date,Item,Amount\n12/10/2026,Strings,450"}
        placeholderTextColor={t.fg2}
        value={csv}
        onChangeText={setCsv}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.input, s.area, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
      />
      {error ? <Text style={[s.small, { color: t.danger }]}>{error}</Text> : null}
      <View style={s.row}>
        <Pressable accessibilityRole="button" onPress={onClose} style={[s.secondary, { borderColor: t.sep }]}>
          <Text style={[s.primaryText, { color: t.fg }]}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => upload(name.trim() || "pasted.csv", csv)}
          disabled={busy || !csv.trim()}
          style={[s.primary, s.grow, { backgroundColor: t.accent, opacity: busy || !csv.trim() ? 0.5 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator color={t.onAccent} />
          ) : (
            <Text style={[s.primaryText, { color: t.onAccent }]}>Upload</Text>
          )}
        </Pressable>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  small: { fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  area: { minHeight: 120, maxHeight: 220, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 8 },
  grow: { flex: 1 },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondary: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryText: { fontSize: 15, fontWeight: "800" },
});
