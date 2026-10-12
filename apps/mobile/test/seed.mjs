// Fake data for the app's screenshots (local test server only): a fake person with a Reminders
// list (three to tick), an Expenses list (a few amounts), and both pinned as views, so the home
// shows a list-with-ticks card and a number card. Prints `cookie=…`, `email=…` and `password=…` (the app's /test route signs in with them on localhost). Never point at a real server.
const BASE = process.env.BASE ?? "http://localhost:8787";
if (!BASE.startsWith("http://localhost")) throw new Error("seed.mjs only runs against localhost");

const origin = { origin: BASE };
// The owner's address from apps/worker/.dev.vars.example, so the assistant is on for this
// person (the chat is part of the screenshots). A second run signs in instead.
const EMAIL = "admin@example.com";
const PASSWORD = "test-password-123";
let up = await fetch(`${BASE}/auth/sign-up/email`, {
  method: "POST",
  headers: { ...origin, "content-type": "application/json" },
  body: JSON.stringify({ name: "Test Person", email: EMAIL, password: PASSWORD }),
});
if (!up.ok) {
  up = await fetch(`${BASE}/auth/sign-in/email`, {
    method: "POST",
    headers: { ...origin, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!up.ok) throw new Error(`sign-in failed: ${up.status}`);
}
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
  return res.status === 204 ? undefined : res.json();
}

const reminders = await api("POST", "/api/lists/start", { kind: "reminders" });
const done = reminders.fields.find((f) => f.type === "boolean");
const title = reminders.fields.find((f) => f.id === reminders.title_field_id);
for (const t of ["Call the venue", "Restring the Strat", "Send the set list to Dev"])
  await api("POST", `/api/collections/${reminders.id}/records`, {
    values: { [title.id]: t, ...(done ? { [done.id]: false } : {}) },
  });

const expenses = await api("POST", "/api/lists/start", { kind: "expenses" });
const what = expenses.fields.find((f) => f.id === expenses.title_field_id);
const amount = expenses.fields.find((f) => f.type === "money");
for (const [t, n] of [
  ["Amp repair", 6000],
  ["Uber to rehearsal", 340],
  ["Strings, 3 sets", 1350],
])
  await api("POST", `/api/collections/${expenses.id}/records`, { values: { [what.id]: t, [amount.id]: n } });

await api("POST", "/api/views", {
  name: "Today",
  collection: reminders.id,
  pinned: true,
  filters: [],
  mode: "list",
});
await api("POST", "/api/views", {
  name: "Spent this month",
  collection: expenses.id,
  pinned: true,
  filters: [],
  mode: "list",
});

console.log(`cookie=${cookie}`);
console.log(`email=${EMAIL}`);
console.log(`password=${PASSWORD}`);
