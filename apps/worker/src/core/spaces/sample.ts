// Made-up values for a practice run's sample record (owner, 2026-10-24: "the sample visitor,
// sample test and all those things, it shouldn't be named that way. Just give like proper
// names"). The field's name hints at what fits (a person's name, a flat, a phone); the rest get
// an everyday phrase. Nothing here is a real person: the names are invented.
const PEOPLE = ["Asha Rao", "Kabir Mehta", "Priya Nair", "Rahul Iyer", "Meera Shah", "Dev Kulkarni"];
const PHRASES = [
  "Parcel at the gate",
  "Water leak in the kitchen",
  "Lift stuck on the third floor",
  "Cab waiting outside",
];
const LONG = [
  "Came by around five; needs a signature at the door.",
  "Started this morning, worse after the rain. Nothing damaged yet.",
  "Second time this week. The caretaker has been told.",
];

const HINTS: [RegExp, string | string[]][] = [
  [
    /\b(name|visitor|guest|who|person|resident|tenant|owner|customer|client|member|contact|sender|caller|driver|vendor|employee|student|patient|payee|payer)\b/,
    PEOPLE,
  ],
  [/\b(flat|unit|apartment|house|room|door|wing|block|plot|floor)\b/, "B-204"],
  [/\b(purpose|reason|why|about|category|kind)\b/, "Delivery"],
  [/\b(phone|mobile|whatsapp|contact number|tel)\b/, "98765 43210"],
  [/\b(e-?mail)\b/, "asha.rao@example.com"],
  [/\b(address|location|place|where|site)\b/, "12 Lake Road, Pune"],
  [/\b(city|town)\b/, "Pune"],
  [/\b(vehicle|car|bike|plate|registration|number plate)\b/, "MH 12 AB 1234"],
  [/\b(company|organisation|organization|firm|shop|store|supplier|business)\b/, "Lakeview Traders"],
  [/\b(id|code|ref|reference|token|receipt|invoice|order)\b/, "A-1042"],
];

const pick = <T>(list: T[], seed: string): T => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length]!;
};

/** A made-up value for a text field, from what its name suggests. */
export function sampleText(fieldName: string, long = false): string {
  const key = fieldName.toLowerCase().replace(/[_-]+/g, " ");
  for (const [re, value] of HINTS) {
    if (!re.test(key)) continue;
    return Array.isArray(value) ? pick(value, key) : value;
  }
  if (/\b(description|details?|notes?|body|comment|remarks?|message|summary|text)\b/.test(key) || long)
    return pick(LONG, key);
  return pick(PHRASES, key);
}
