// Fake data for the simulator screenshots (Mac runner, local test server only).
// Signs up a fake user, adds a few gigs, and prints `cookie=…` and `gig=…` lines for the
// workflow. Never point this at a real server.
const BASE = process.env.BASE ?? "http://localhost:8787";
if (!BASE.startsWith("http://localhost")) throw new Error("seed.mjs only runs against localhost");

const origin = { origin: BASE };
const up = await fetch(`${BASE}/auth/sign-up/email`, {
  method: "POST",
  headers: { ...origin, "content-type": "application/json" },
  body: JSON.stringify({
    name: "Test Guitarist",
    email: `ios-${Date.now()}@example.com`,
    password: "test-password-123",
  }),
});
if (!up.ok) throw new Error(`sign-up failed: ${up.status}`);
const cookie = up.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .find((c) => c.includes("session_token"));
if (!cookie) throw new Error("no session cookie");

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...origin,
      cookie,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const day = (n, time) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.toISOString().slice(0, 10)}T${time}`;
};

const wedding = await api("POST", "/api/gigs", {
  title: "Test Wedding Reception",
  event_type: "Private",
  status: "confirmed",
  fee: "45000",
  client: { name: "Test Client" },
  events: [
    { title: "Soundcheck", start_at: day(3, "17:00"), venue_name: "Test Lawns", venue_city: "Pune" },
    { title: "Reception", start_at: day(3, "20:00"), venue_name: "Test Lawns", venue_city: "Pune" },
  ],
});
await api("POST", `/api/gigs/${wedding.id}/payments`, {
  amount: "15000",
  paid_on: new Date().toISOString().slice(0, 10),
  method: "upi",
});
await api("POST", `/api/gigs/${wedding.id}/notes`, { body: "Bring the spare pedalboard cable." });
await api("POST", `/api/gigs/${wedding.id}/lists`, {
  title: "Set 1",
  checkable: true,
  items: [{ text: "Opening song" }, { text: "Second song" }, { text: "Third song" }],
});
await api("POST", `/api/gigs/${wedding.id}/guests`, { guests: [{ name: "Test Guest", plus_ones: 2 }] });

await api("POST", "/api/gigs", {
  title: "Test Cafe Night",
  event_type: "Public",
  status: "confirmed",
  fee: "12000",
  events: [{ start_at: day(6, "21:00"), venue_name: "Test Cafe", venue_city: "Pune" }],
});
await api("POST", "/api/gigs", {
  title: "Test Corporate Event",
  event_type: "Private",
  fee: "30000",
  events: [{ start_at: day(12, "19:30"), venue_name: "Test Hotel", venue_city: "Mumbai" }],
});

console.log(`cookie=${cookie}`);
console.log(`gig=${wedding.id}`);
