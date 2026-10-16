// One bad card, row or message must never take the whole app down (the owner's phone, 2026-10-15:
// a list that crashed the app). A boundary around each catches a drawing error, shows a quiet
// line in its place, and reports it as a count (never the data) for the app team.
import { Component, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "./text.tsx";

let report: ((where: string, message: string) => void) | null = null;
/** Where a caught drawing error goes (the app sets this once; the message is the error's own). */
export function onDrawError(fn: (where: string, message: string) => void) {
  report = fn;
}

export class Boundary extends Component<
  { where: string; children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(e: unknown) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn("draw failed", this.props.where, message);
    report?.(this.props.where, message);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? <Fallback />;
  }
}

function Fallback() {
  return (
    <View style={s.box}>
      <Text style={s.text}>Can't show this one.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { paddingHorizontal: 14, paddingVertical: 10, opacity: 0.6 },
  text: { fontSize: 13, fontWeight: "600" },
});
