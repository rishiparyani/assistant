import type { GigStatus, PaymentStatus } from "@assistant/shared";
import type { Tone } from "../../core/ui/tones.ts";

const GIG: Record<GigStatus, { label: string; tone: Tone }> = {
  enquiry: { label: "Enquiry", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "blue" },
  completed: { label: "Played", tone: "green" },
  cancelled: { label: "Cancelled", tone: "grey" },
};
const PAYMENT: Record<PaymentStatus, { label: string; tone: Tone }> = {
  unpaid: { label: "Unpaid", tone: "red" },
  partial: { label: "Part paid", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
  overpaid: { label: "Overpaid", tone: "violet" },
};

export const statusLabel = (s: GigStatus | string) => GIG[s as GigStatus]?.label ?? s;
export const statusTone = (s: GigStatus | string): Tone => GIG[s as GigStatus]?.tone ?? "grey";
export const paymentLabel = (s: PaymentStatus) => PAYMENT[s].label;
export const paymentTone = (s: PaymentStatus) => PAYMENT[s].tone;

/** A rehearsal's pill in lists: my answer (or a nudge), unless it's cancelled. */
/** A date option on an enquiry: "Hold" until the client picks. */
export const HOLD_PILL: { label: string; tone: Tone } = { label: "Hold", tone: "amber" };

export function rehearsalPill(e: { status: string; going: boolean | null }): { label: string; tone: Tone } {
  if (e.status === "cancelled") return GIG.cancelled;
  if (e.going === true) return { label: "Going", tone: "green" };
  if (e.going === false) return { label: "Can't go", tone: "grey" };
  return { label: "Coming?", tone: "amber" };
}

/** How a row names an event: "Rehearsal · Test Wedding", "Wedding · Sangeet" or "Wedding". */
export function eventTitle(e: { kind?: string; gig_title: string; event_title: string | null }): string {
  if (e.kind === "rehearsal") return `Rehearsal · ${e.event_title ?? e.gig_title}`;
  return e.event_title ? `${e.gig_title} · ${e.event_title}` : e.gig_title;
}
