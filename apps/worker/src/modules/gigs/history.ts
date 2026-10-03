// A gig's history in plain words (owner: "who changed what"): turns the gig's audit log
// rows (architecture rule 11) into a sentence and the before → after of what changed.
// Pure: the booking object passes the rows and the names it knows, including people,
// events, lists and guests that were removed since.
import { GIG_SETTINGS_DEFAULTS, formatDateIST, formatDateTimeIST, formatINR } from "@assistant/shared";

export type AuditRow = {
  id: number;
  at: string;
  actor_user_id: string | null;
  source: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json: string | null;
  after_json: string | null;
};

/** Everything a row may refer to, by id (removed ones too). */
export interface HistoryNames {
  /** user id → name */
  users: Map<string, string>;
  /** person id → name */
  people: Map<string, string>;
  /** user id → their person id on this gig */
  personOfUser: Map<string, string>;
  events: Map<string, { title: string | null; start_at: string; kind: string }>;
  lists: Map<string, string>;
  /** list item id → its list id and text */
  items: Map<string, { list_id: string; text: string }>;
  guests: Map<string, string>;
  /** "rehearsal" for a rehearsal that isn't for a gig, so sentences say so. */
  gigKind: string;
}

export interface Described {
  summary: string;
  details: string[];
}

type Obj = Record<string, unknown>;
const parse = (json: string | null): Obj => {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" ? (v as Obj) : {};
  } catch {
    return {};
  }
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const rupees = (v: unknown) => (num(v) !== null ? formatINR(num(v)!) : "—");
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const quoted = (s: string | null) => (s ? `“${short(s, 60)}”` : "an item");
const when = (iso: unknown) => (str(iso) ? formatDateTimeIST(iso as string).replace(/ IST$/, "") : "—");
const day = (iso: string) => formatDateIST(iso).replace(/ \d{4}$/, "");

const METHODS: Record<string, string> = {
  cash: "cash",
  upi: "UPI",
  bank: "bank transfer",
  cheque: "cheque",
  other: "other",
};
const SETTING_LABELS: Record<string, string> = {
  players_see_lineup: "Players see who's playing",
  players_see_fee: "Players see the fee",
  players_see_shares: "Players see everyone's shares",
  players_edit_lists: "Players can change lists and notes",
};
const GIG_FIELDS: Record<string, { label: string; show: (v: unknown) => string }> = {
  title: { label: "Name", show: (v) => str(v) ?? "—" },
  event_type: { label: "Type", show: (v) => str(v) ?? "—" },
  client_name: { label: "Client", show: (v) => str(v) ?? "—" },
  client_phone: { label: "Client's phone", show: (v) => str(v) ?? "—" },
  client_organisation: { label: "Client's company", show: (v) => str(v) ?? "—" },
  notes: { label: "Notes", show: (v) => (str(v) ? short(v as string, 80) : "—") },
  fee_paise: { label: "Fee", show: rupees },
  collective_name: { label: "Band", show: (v) => str(v) ?? "—" },
};
const EVENT_FIELDS: Record<string, { label: string; show: (v: unknown) => string }> = {
  title: { label: "Name", show: (v) => str(v) ?? "—" },
  start_at: { label: "Starts", show: when },
  end_at: { label: "Ends", show: when },
  venue_name: { label: "Venue", show: (v) => str(v) ?? "—" },
  venue_city: { label: "City", show: (v) => str(v) ?? "—" },
  notes: { label: "Notes", show: (v) => (str(v) ? short(v as string, 80) : "—") },
};

/** "Fee: ₹15,000 → ₹20,000" for each field that changed. */
function changes(
  before: Obj,
  after: Obj,
  fields: Record<string, { label: string; show: (v: unknown) => string }>,
): string[] {
  const out: string[] = [];
  for (const [key, f] of Object.entries(fields)) {
    if (!(key in after)) continue;
    const a = f.show(before[key]);
    const b = f.show(after[key]);
    if (a !== b) out.push(`${f.label}: ${a} → ${b}`);
  }
  return out;
}

function settingChanges(before: Obj, after: Obj): string[] {
  if (!("settings_json" in after)) return [];
  const was: Obj = { ...GIG_SETTINGS_DEFAULTS, ...parse(str(before.settings_json)) };
  const now: Obj = { ...GIG_SETTINGS_DEFAULTS, ...parse(str(after.settings_json)) };
  return Object.entries(SETTING_LABELS)
    .filter(([key]) => Boolean(was[key]) !== Boolean(now[key]))
    .map(([key, label]) => `${label}: ${now[key] ? "on" : "off"}`);
}

export function describe(row: AuditRow, n: HistoryNames): Described {
  const before = parse(row.before_json);
  const after = parse(row.after_json);
  const thing = n.gigKind === "rehearsal" ? "rehearsal" : "gig";
  const person = (id: unknown) => (str(id) && n.people.get(id as string)) || "someone";
  const event = (id: string) => {
    const e = n.events.get(id);
    if (!e) return "an event";
    if (e.kind === "rehearsal") return `the rehearsal on ${day(e.start_at)}`;
    return e.title ? `${e.title} (${day(e.start_at)})` : `the event on ${day(e.start_at)}`;
  };
  const list = (id: unknown) => quoted(str(id) ? (n.lists.get(id as string) ?? null) : null);
  const one = (summary: string, ...details: (string | null | undefined)[]): Described => ({
    summary,
    details: details.filter((d): d is string => !!d),
  });

  switch (row.action) {
    case "create_gig":
      return one(`Created the ${thing}`);
    case "update_gig": {
      const details = [...changes(before, after, GIG_FIELDS), ...settingChanges(before, after)];
      const tagsBefore = Array.isArray(before.tags) ? (before.tags as string[]) : null;
      const tagsAfter = Array.isArray(after.tags) ? (after.tags as string[]) : null;
      if (tagsAfter && tagsBefore && tagsBefore.join() !== tagsAfter.join())
        details.push(`Tags: ${tagsBefore.join(", ") || "—"} → ${tagsAfter.join(", ") || "—"}`);
      return { summary: `Changed the ${thing}'s details`, details };
    }
    case "confirm_gig": {
      const dates = (v: unknown) =>
        Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string").map(day) : [];
      const picked = dates(after.picked);
      const released = dates(after.released);
      return one(
        `Confirmed the ${thing}`,
        picked.length ? `Client picked ${picked.join(", ")}` : null,
        released.length ? `Released ${released.join(", ")}` : null,
      );
    }
    case "complete_gig":
      return one("Marked it as played");
    case "cancel_gig":
      return one(
        `Cancelled the ${thing}`,
        str(after.reason) && `Reason: ${short(after.reason as string, 100)}`,
        num(after.refund_paise) ? `Refunded ${rupees(after.refund_paise)} to the client` : null,
      );
    case "reopen_gig":
      return one(`Reopened the ${thing}`);
    case "delete_gig":
      return one(`Deleted the ${thing}`);
    case "add_event": {
      const rehearsal = after.kind === "rehearsal";
      return one(
        rehearsal
          ? `Added a rehearsal`
          : after.hold
            ? "Held another date option"
            : `Added an event${str(after.title) ? `: ${after.title}` : ""}`,
        `${when(after.start_at)}${str(after.venue_name) ? ` · ${after.venue_name}` : ""}`,
      );
    }
    case "update_event":
      return { summary: `Changed ${event(row.entity_id)}`, details: changes(before, after, EVENT_FIELDS) };
    case "remove_event":
      return one(
        before.kind === "rehearsal"
          ? "Removed a rehearsal"
          : before.hold
            ? "Released a date option"
            : `Removed an event${str(before.title) ? `: ${before.title}` : ""}`,
        when(before.start_at),
      );
    case "add_person":
      return one(
        `Added ${str(after.name) ?? "someone"} as a ${after.role === "manager" ? "manager" : "player"}`,
      );
    case "update_person": {
      // Only what changed (older entries may record a save without changes).
      const name = str(after.name) ?? str(before.name) ?? person(row.entity_id);
      const details: string[] = [];
      if (str(after.name) && after.name !== before.name) details.push(`Name: ${before.name} → ${after.name}`);
      if (after.phone_changed) details.push("Changed their phone number");
      if (before.role !== after.role)
        return {
          summary: after.role === "manager" ? `Made ${name} a manager` : `Made ${name} a player`,
          details,
        };
      return {
        summary: details.length ? `Changed ${name}'s details` : `Saved ${name}'s details (no changes)`,
        details,
      };
    }
    case "remove_person":
      return one(`Removed ${str(before.name) ?? "someone"} from the ${thing}`);
    case "attach_account":
      return one("Signed up and joined");
    case "set_lineup": {
      const line = (xs: unknown) =>
        Array.isArray(xs) && xs.length
          ? (xs as Obj[])
              .map((x) =>
                [person(x.person_id), str(x.part), num(x.share_paise) ? rupees(x.share_paise) : null]
                  .filter(Boolean)
                  .join(" "),
              )
              .join(", ")
          : "nobody";
      const rows = (json: string | null): unknown => {
        try {
          return json ? (JSON.parse(json) as unknown) : [];
        } catch {
          return [];
        }
      };
      return one(
        `Changed the lineup for ${event(row.entity_id)}`,
        `Was: ${line(rows(row.before_json))}`,
        `Now: ${line(rows(row.after_json))}`,
      );
    }
    case "record_payment":
      return one(
        `Recorded a client payment of ${rupees(after.amount_paise)}`,
        [
          METHODS[str(after.method) ?? ""] ?? null,
          str(after.paid_on) ? formatDateIST(after.paid_on as string) : null,
          str(after.note),
        ]
          .filter(Boolean)
          .join(" · "),
      );
    case "reverse_payment":
      return one(`Reversed a client payment of ${rupees(before.amount_paise)}`);
    case "record_payout":
      return one(
        `Paid ${person(after.person_id)} ${rupees(after.amount_paise)}`,
        [METHODS[str(after.method) ?? ""] ?? null, str(after.note)].filter(Boolean).join(" · "),
      );
    case "reverse_payout":
      return one(`Reversed a payout of ${rupees(before.amount_paise)} to ${person(before.person_id)}`);
    case "record_expense":
      return one(
        `Added an expense: ${str(after.category) ?? "expense"} ${rupees(after.amount_paise)}`,
        str(after.note),
      );
    case "remove_expense":
      return one(`Removed an expense: ${str(before.category) ?? "expense"} ${rupees(before.amount_paise)}`);
    case "set_attendance": {
      const self = row.actor_user_id && n.personOfUser.get(row.actor_user_id) === after.person_id;
      const answer = `${after.going ? "going to" : "not able to make it to"} ${event(row.entity_id)}`;
      return one(self ? `Said they're ${answer}` : `Said ${person(after.person_id)} is ${answer}`);
    }
    case "create_list":
      return one(`Made the list ${quoted(str(after.title))}`);
    case "update_list":
      return one(
        `Changed the list ${quoted(str(after.title) ?? str(before.title))}`,
        str(after.title) && after.title !== before.title ? `Name: ${before.title} → ${after.title}` : null,
      );
    case "remove_list":
      return one(`Removed the list ${quoted(str(before.title))}`);
    case "add_list_items": {
      const items = Array.isArray(after.items) ? (after.items as Obj[]) : [];
      return one(
        `Added ${items.length === 1 ? "an item" : `${items.length} items`} to ${list(row.entity_id)}`,
        items.length
          ? short(
              items
                .map((i) => str(i.text) ?? "")
                .filter(Boolean)
                .join(", "),
            )
          : null,
      );
    }
    case "update_list_item": {
      const item = n.items.get(row.entity_id);
      const text = str(before.text) ?? item?.text ?? null;
      const where = item ? ` in ${list(item.list_id)}` : "";
      if ("done" in after || ("done_at" in after && after.done_at !== before.done_at))
        return one(`${after.done || after.done_at ? "Ticked" : "Unticked"} ${quoted(text)}${where}`);
      return one(
        `Changed ${quoted(text)}${where}`,
        str(after.text) && after.text !== before.text ? `Text: ${before.text} → ${after.text}` : null,
      );
    }
    case "move_list_item": {
      const item = n.items.get(row.entity_id);
      return one(`Moved ${quoted(item?.text ?? null)}${item ? ` in ${list(item.list_id)}` : ""}`);
    }
    case "remove_list_item": {
      const item = n.items.get(row.entity_id);
      return one(`Removed ${quoted(str(before.text))}${item ? ` from ${list(item.list_id)}` : ""}`);
    }
    case "add_note":
      return one("Posted a note", str(after.body) && short(after.body as string));
    case "update_note":
      return one("Edited a note", str(after.body) && short(after.body as string));
    case "remove_note":
      return one("Removed a note", str(before.body) && short(before.body as string));
    case "add_guests": {
      const guests = Array.isArray(after.guests) ? (after.guests as Obj[]) : [];
      const names = guests.map(
        (g) => `${str(g.name) ?? "guest"}${num(g.plus_ones) ? ` +${g.plus_ones}` : ""}`,
      );
      return one(
        `Added ${guests.length === 1 ? "a guest" : `${guests.length} guests`}${str(after.host) ? ` for ${person(after.host)}` : ""}`,
        short(names.join(", ")),
      );
    }
    case "update_guest": {
      const name = str(before.name) ?? n.guests.get(row.entity_id) ?? "a guest";
      const details: string[] = [];
      if (str(after.name) && after.name !== before.name) details.push(`Name: ${before.name} → ${after.name}`);
      if (num(after.plus_ones) !== null && after.plus_ones !== before.plus_ones)
        details.push(`Plus-ones: ${before.plus_ones ?? 0} → ${after.plus_ones}`);
      if ("arrived_at" in after && after.arrived_at !== before.arrived_at)
        return one(after.arrived_at ? `Marked ${name} as arrived` : `Unmarked ${name} as arrived`);
      return { summary: `Changed guest ${name}`, details };
    }
    case "remove_guest":
      return one(`Removed guest ${str(before.name) ?? n.guests.get(row.entity_id) ?? ""}`.trim());
    case "guest_arrived":
      return one(
        `${after.arrived_at ? "Marked" : "Unmarked"} ${n.guests.get(row.entity_id) ?? "a guest"} as arrived`,
      );
    case "set_guest_list": {
      const limit = (v: unknown) => (num(v) !== null ? String(v) : "no limit");
      const details: string[] = [];
      if (before.total_limit !== after.total_limit)
        details.push(`Total: ${limit(before.total_limit)} → ${limit(after.total_limit)}`);
      if (before.per_person_limit !== after.per_person_limit)
        details.push(`Per person: ${limit(before.per_person_limit)} → ${limit(after.per_person_limit)}`);
      if (before.closes_at !== after.closes_at)
        details.push(
          `Closes: ${str(before.closes_at) ? when(before.closes_at) : "never"} → ${str(after.closes_at) ? when(after.closes_at) : "never"}`,
        );
      return { summary: "Changed the guest list's limits", details };
    }
    case "enable_guest_link":
    case "disable_guest_link":
    case "set_guest_link": {
      const checkIn =
        "check_in" in after && after.check_in !== before.check_in
          ? after.check_in
            ? "The venue can now tick off arrivals"
            : "The venue can no longer tick off arrivals"
          : null;
      if (row.action === "disable_guest_link") return one("Turned off the venue's guest list link");
      if (row.action === "enable_guest_link")
        return one(
          before.enabled
            ? "Made a new venue link (the old one stopped working)"
            : "Turned on the venue's guest list link",
          checkIn,
        );
      // Same link; only what the venue may do changed.
      return one("Changed what the venue can do with its link", checkIn);
    }
    default:
      return one(row.action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
  }
}

/** Who did it, as people on the gig know them. */
export function whoDid(row: AuditRow, n: HistoryNames): string {
  if (row.source === "link") return "The venue";
  // Joining after sign-up is made by the system for that person.
  if (row.action === "attach_account") return n.people.get(row.entity_id) ?? "Someone";
  if (!row.actor_user_id) return "Gigspree";
  return n.users.get(row.actor_user_id) ?? "Someone no longer on the gig";
}

const SOURCES: Record<string, string> = {
  web: "app",
  siri: "Siri",
  mcp: "AI assistant",
  system: "automatic",
  link: "venue link",
};
export const sourceLabel = (s: string) => SOURCES[s] ?? s;
