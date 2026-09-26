// Money is always integer paise (architecture rule 5). These helpers are the only
// place rupee strings are produced or parsed.

export type Paise = number;

export function assertPaise(value: number): asserts value is Paise {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Paise must be a safe integer, got ${value}`);
}

// Indian digit grouping: last three digits, then groups of two (1,00,00,000).
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+$)/g, ",")},${tail}`;
}

/** 1000000 → "₹10,000"; 1000050 → "₹10,000.50"; -50000 → "-₹500". */
export function formatINR(paise: Paise): string {
  assertPaise(paise);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = groupIndian(String(Math.floor(abs / 100)));
  const rest = abs % 100;
  return `${sign}₹${rupees}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * Parses what a person types into paise: "10000", "10,000", "₹1,00,000.5", "-500".
 * Rejects more than two decimals and anything else ambiguous.
 */
export function parseINR(input: string): Paise {
  const cleaned = input
    .trim()
    .replace(/^(-?)\s*(₹|rs\.?|inr)\s*/i, "$1")
    .replace(/,/g, "");
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) throw new RangeError(`Not an amount: "${input}"`);
  const paise = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  assertPaise(paise);
  return m[1] ? -paise : paise;
}

/** `{ amount_paise, amount_display }`, the API's money shape. */
export function money(paise: Paise) {
  return { amount_paise: paise, amount_display: formatINR(paise) };
}

export type PaymentStatus = "unpaid" | "partial" | "paid" | "overpaid";

/**
 * Derived, never stored (architecture rule 6). Works for client payments against a
 * fee and for payouts against a musician's share.
 */
export function paymentStatus(due: Paise, paid: Paise): PaymentStatus {
  assertPaise(due);
  assertPaise(paid);
  if (paid > due) return "overpaid";
  if (paid === due) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}

/** Splits `total` into `n` shares; leftover paise go to the first share, so they add up exactly. */
export function splitEqual(total: Paise, n: number): Paise[] {
  assertPaise(total);
  if (!Number.isInteger(n) || n < 1) throw new RangeError("Need at least one share");
  if (total < 0) throw new RangeError("Can't split a negative amount");
  const base = Math.floor(total / n);
  const shares = Array.from({ length: n }, () => base);
  shares[0]! += total - base * n;
  return shares;
}

/**
 * Splits `total` by percentages (each 0–100, together ≤ 100). Each share is rounded
 * down to whole paise; when the percentages add up to 100 the leftover goes to the
 * first share so the shares equal `total` exactly.
 */
export function splitPercent(total: Paise, percents: number[]): Paise[] {
  assertPaise(total);
  if (total < 0) throw new RangeError("Can't split a negative amount");
  if (!percents.length) return [];
  if (percents.some((p) => !Number.isFinite(p) || p < 0 || p > 100))
    throw new RangeError("Percentages must be 0–100");
  const sum = percents.reduce((a, b) => a + b, 0);
  if (sum > 100 + 1e-9) throw new RangeError(`Percentages add up to ${sum}%, more than 100%`);
  const shares = percents.map((p) => Math.floor((total * p) / 100 + 1e-9));
  if (Math.abs(sum - 100) < 1e-9) shares[0]! += total - shares.reduce((a, b) => a + b, 0);
  return shares;
}
