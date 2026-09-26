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

export const statusLabel = (s: GigStatus) => GIG[s].label;
export const statusTone = (s: GigStatus) => GIG[s].tone;
export const paymentLabel = (s: PaymentStatus) => PAYMENT[s].label;
export const paymentTone = (s: PaymentStatus) => PAYMENT[s].tone;
