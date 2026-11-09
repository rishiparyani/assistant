// The chat header's icons, drawn (owner, 2026-11-05: the top bar "doesn't look that good… things
// are not neatly placed"): text glyphs (‹ ☰ ✎ ▾) came out at different sizes and heights on each
// phone's font. One stroke, one box, centred the same way everywhere.
import Svg, { Path } from "react-native-svg";

type Props = { color: string; size?: number };

const stroke = (color: string) => ({
  stroke: color,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
});

export function BackIcon({ color, size = 22 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 5l-7 7 7 7" {...stroke(color)} />
    </Svg>
  );
}

export function ChatsIcon({ color, size = 22 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 7h16M4 12h16M4 17h10" {...stroke(color)} />
    </Svg>
  );
}

export function NewChatIcon({ color, size = 22 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" {...stroke(color)} />
      <Path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 8.5-8.5z" {...stroke(color)} />
    </Svg>
  );
}

export function ChevronDownIcon({ color, size = 14 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 9l6 6 6-6" {...stroke(color)} strokeWidth={2.5} />
    </Svg>
  );
}

export function MoreIcon({ color, size = 22 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12h.01M12 12h.01M19 12h.01" {...stroke(color)} strokeWidth={2.8} />
    </Svg>
  );
}

export function CloseIcon({ color, size = 20 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 6l12 12M18 6L6 18" {...stroke(color)} />
    </Svg>
  );
}

/** Settings, as two sliders (a gear this small read as a sun). */
export function GearIcon({ color, size = 22 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 8h9M19 8h1M4 16h1M11 16h9" {...stroke(color)} />
      <Path
        d="M16 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
        {...stroke(color)}
      />
    </Svg>
  );
}

export function SendIcon({ color, size = 20 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 19V5M6 11l6-6 6 6" {...stroke(color)} strokeWidth={2.4} />
    </Svg>
  );
}
