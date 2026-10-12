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

// A second run against the local server (which keeps its data) adds nothing twice.
const seeded = (await api("GET", "/api/views")).some((v) => v.name === "Today");
const reminders = await api("POST", "/api/lists/start", { kind: "reminders" });
const done = reminders.fields.find((f) => f.type === "boolean");
const title = reminders.fields.find((f) => f.id === reminders.title_field_id);
for (const t of seeded ? [] : ["Call the venue", "Restring the Strat", "Send the set list to Dev"])
  await api("POST", `/api/collections/${reminders.id}/records`, {
    values: { [title.id]: t, ...(done ? { [done.id]: false } : {}) },
  });

const expenses = await api("POST", "/api/lists/start", { kind: "expenses" });
const what = expenses.fields.find((f) => f.id === expenses.title_field_id);
const amount = expenses.fields.find((f) => f.type === "money");
for (const [t, n] of seeded
  ? []
  : [
      ["Amp repair", 6000],
      ["Uber to rehearsal", 340],
      ["Strings, 3 sets", 1350],
    ])
  await api("POST", `/api/collections/${expenses.id}/records`, { values: { [what.id]: t, [amount.id]: n } });

// The lists come with their cards (Today, Spent this month) when started.

// A process waiting on someone (home-first.md §2 point 9): Rahul, who joined a shared note,
// is asked about a booking; the home's Now page shows it as a process card.
const rahulUp = await fetch(`${BASE}/auth/sign-up/email`, {
  method: "POST",
  headers: { ...origin, "content-type": "application/json" },
  body: JSON.stringify({ name: "Rahul Test", email: "rahul@example.com", password: PASSWORD }),
});
const rahulIn = rahulUp.ok
  ? rahulUp
  : await fetch(`${BASE}/auth/sign-in/email`, {
      method: "POST",
      headers: { ...origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "rahul@example.com", password: PASSWORD }),
    });
const rahulCookie = rahulIn.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .find((c) => c.includes("session_token"));
// By account id, not name: the local server may know an older "Rahul Test" from another run.
const rahulId = (
  await (await fetch(`${BASE}/api/me`, { headers: { ...origin, cookie: rahulCookie } })).json()
).user.id;
const notes = await api("POST", "/api/lists/start", { kind: "notes" });
const noteTitle = notes.fields.find((f) => f.id === notes.title_field_id);
const note = await api("POST", `/api/collections/${notes.id}/records`, {
  values: { [noteTitle.id]: "Band notes" },
});
const { link } = await api("POST", "/api/shares", { record_id: note.id, access: "view" });
await fetch(`${BASE}/api/cards/join`, {
  method: "POST",
  headers: {
    ...origin,
    cookie: rahulCookie,
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
  },
  body: JSON.stringify({ token: link.slice(link.indexOf("#") + 1) }),
});
// A second run (the local server keeps its data) reuses the list and the workflow.
const bookings =
  (await api("GET", "/api/collections")).find((c) => c.name === "Bookings") ??
  (await api("POST", "/api/collections", {
    name: "Bookings",
    fields: [
      { name: "Title", type: "text" },
      { name: "Date", type: "date" },
      { name: "Reply", type: "text" },
    ],
  }));
if (!(await api("GET", "/api/workflows")).some((w) => w.name === "Confirm with Rahul"))
  await api("POST", "/api/workflows", {
    name: "Confirm with Rahul",
    when: { event: "added", collection: bookings.id },
    then: [
      {
        do: "ask",
        who: [rahulId],
        text: "Can you play {Title} on {Date}?",
        choices: ["Yes", "No"],
        save_to: "Reply",
        nudge_minutes: 1440,
      },
      { do: "notify", text: "Rahul said {Reply} to {Title}", to: ["me"] },
    ],
    enabled: true,
  });
const bTitle = bookings.fields.find((f) => f.name === "Title");
const bDate = bookings.fields.find((f) => f.name === "Date");
// Rahul's own home (collaborator homes): the Today list to tick (editor) and the band note.
const todayView = (await api("GET", "/api/views")).find((v) => v.name === "Today");
const shares = await api("GET", "/api/shares");
if (todayView && !shares.some((x) => x.kind === "view" && x.target_id === todayView.id))
  await api("POST", "/api/shares/with", { view: todayView.id, people: [rahulId], access: "edit" });
if (!(await api("GET", "/api/waiting")).length)
  await api("POST", `/api/collections/${bookings.id}/records`, {
    values: { [bTitle.id]: "Test wedding", [bDate.id]: "2026-12-12" },
  });

// Something captured (the Inbox card on the home).
if (!(await api("GET", "/api/views")).some((v) => v.name === "Inbox"))
  await api("POST", "/api/inbox", { text: "Strings ₹450 at Furtados", source: "siri" });

console.log(`cookie=${cookie}`);
console.log(`email=${EMAIL}`);
console.log(`password=${PASSWORD}`);
