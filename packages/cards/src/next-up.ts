// "Next up" (decision 2026-10-13 "A warmer home"): the one thing coming soonest across the
// cards on the home, shown big at the top of Now. Worked out from the records the cards
// already have; nothing is guessed: a record needs a date, and a ticked one isn't next.
import type { RecordView } from "@assistant/shared";
import type { HomeCard } from "./native/model.ts";

const IST = 330 * 60_000;
const DAY = 86_400_000;
/** Further out than this, nothing is "next up". */
export const NEXT_UP_DAYS = 14;

export interface NextUp {
  card: HomeCard;
  record: RecordView;
  /** The date field it's dated by. */
  field: string;
  /** When (ms): the moment for a date and time, the start of the India-time day for a date. */
  at: number;
  allDay: boolean;
}

/** The India-time day (ms at UTC midnight) a moment falls on. */
const istDay = (ms: number) => Math.floor((ms + IST) / DAY) * DAY;

export function nextUp(cards: HomeCard[], now = Date.now()): NextUp | null {
  const today = istDay(now);
  let best: NextUp | null = null;
  for (const card of cards) {
    const c = card.collection;
    if (!c || card.answer || card.waiting || card.memory) continue;
    const src = card.spec.sources[0];
    const field =
      card.spec.row?.date ??
      src?.date_field ??
      c.fields.find((f) => f.type === "datetime" || f.type === "date")?.id;
    const type = c.fields.find((f) => f.id === field)?.type;
    if (!field || (type !== "date" && type !== "datetime")) continue;
    const done = src?.answer_field;
    for (const record of [...(card.upcoming ?? []), ...card.records]) {
      if (done && record.values[done] === true) continue;
      const v = record.values[field];
      if (typeof v !== "string" || !v) continue;
      const allDay = !v.includes("T");
      const at = allDay ? Date.parse(`${v.slice(0, 10)}T00:00:00Z`) - IST : Date.parse(v);
      if (Number.isNaN(at)) continue;
      // Still to come: a day from today on, a time from now on, within the next two weeks.
      if (allDay ? istDay(at) < today : at < now) continue;
      if (at - now > NEXT_UP_DAYS * DAY) continue;
      if (!best || at < best.at) best = { card, record, field, at, allDay };
    }
  }
  return best;
}

/** "in 2 h 40 min", "today", "tomorrow, 8:30 pm", "Sat, 6 pm", "in 9 days". */
export function countdown(n: Pick<NextUp, "at" | "allDay">, now = Date.now()): string {
  const days = Math.round((istDay(n.at) - istDay(now)) / DAY);
  const ist = new Date(n.at + IST);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const clock = `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][ist.getUTCDay()]!;
  if (n.allDay) return days === 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? dow : `in ${days} days`;
  const mins = Math.max(0, Math.round((n.at - now) / 60_000));
  if (days === 0)
    return mins < 60
      ? `in ${mins} min`
      : `in ${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
  if (days === 1) return `tomorrow, ${clock}`;
  return days < 7 ? `${dow}, ${clock}` : `in ${days} days`;
}
