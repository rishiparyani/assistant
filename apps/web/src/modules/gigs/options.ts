import type { PaymentMethod } from "@assistant/shared";

export const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];
export const methodLabel = (m: PaymentMethod) => METHODS.find((x) => x.value === m)?.label ?? m;

export const EXPENSE_CATEGORIES = ["Travel", "Food", "Equipment", "Sound", "Rehearsal", "Strings", "Other"];
export type PersonKind = "clients" | "venues" | "roster";
