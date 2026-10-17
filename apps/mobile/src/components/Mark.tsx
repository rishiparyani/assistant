// A card's mark (owner, 2026-10-17: the coloured dots didn't go with the app): a small rounded
// tile in the card's own soft colour, with the first letter of its name in the strong one, like
// the cards on the home and the people's initials in the chats.
import { StyleSheet, View } from "react-native";
import { Text } from "@assistant/cards/native";
import { colourFor, useTheme, type CollectionColour } from "@/theme";

export function Mark({
  name,
  tone,
  size = 36,
}: {
  name: string;
  /** The card's colour; by default, the one its name gives. */
  tone?: CollectionColour;
  size?: number;
}) {
  const { colour, cardTint } = useTheme();
  const key = tone ?? colourFor(name);
  const letter = (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "•").toUpperCase();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        s.tile,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          backgroundColor: cardTint(key),
          borderColor: colour(key) + "33",
        },
      ]}
    >
      <Text style={{ color: colour(key), fontWeight: "800", fontSize: Math.round(size * 0.44) }}>
        {letter}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
});
