// T00 spike: bare HTML pages. All dynamic text is set with textContent (no HTML injection).

const style = `
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; padding: 0 1rem; color: #111; background: #fff; }
  button { font: inherit; padding: .5rem 1rem; margin: .25rem 0; cursor: pointer; }
  input, select { font: inherit; padding: .4rem; margin: .25rem 0; }
  li { margin: .25rem 0; }
  .muted { color: #666; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #111; } .muted { color: #999; } }
`;

function page(title: string, body: string, script: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${style}</style></head>
<body>${body}<script type="module">
async function api(path, body) {
  const res = await fetch("/auth" + path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.message || data.error_description || data.error)) || res.statusText);
  return data;
}
function show(id, text) { document.getElementById(id).textContent = text; }
${script}
</script></body></html>`;
}

export function homePage() {
  return page(
    "Assistant spike",
    `<h1>Assistant spike (T00)</h1>
<p class="muted">Throwaway test page: Google sign-in, workspaces, and the MCP connector.</p>
<div id="out"><p>Loading…</p></div>
<div id="signed-out" hidden><button id="google">Sign in with Google</button></div>
<div id="signed-in" hidden>
  <p>Signed in as <strong id="who"></strong></p>
  <h2>Workspaces</h2><ul id="orgs"></ul>
  <h3>Create workspace</h3>
  <input id="org-name" placeholder="Name, e.g. Test Band">
  <select id="org-kind"><option value="band">band</option><option value="personal">personal</option></select>
  <button id="create">Create</button>
  <h3>Invite a member (to the first workspace)</h3>
  <input id="invite-email" type="email" placeholder="bandmate@example.com">
  <button id="invite">Invite</button>
  <h3>Invitations for me</h3><ul id="invites"></ul>
  <p>MCP connector URL: <code id="mcp"></code></p>
  <button id="signout">Sign out</button>
</div>
<p id="err" style="color:#c00"></p>`,
    `
const $ = (id) => document.getElementById(id);
$("mcp").textContent = location.origin + "/mcp";
async function load() {
  const session = await api("/get-session");
  $("out").hidden = true;
  if (!session) { $("signed-out").hidden = false; return; }
  $("signed-in").hidden = false;
  show("who", session.user.name + " <" + session.user.email + ">");
  const orgs = await api("/organization/list");
  $("orgs").replaceChildren(...orgs.map((o) => {
    const li = document.createElement("li"); li.textContent = o.name + " (" + (o.kind ?? "?") + ")"; li.dataset.id = o.id; return li;
  }));
  if (!orgs.length) { const li = document.createElement("li"); li.textContent = "None yet"; $("orgs").append(li); }
  const invites = await api("/organization/list-user-invitations").catch(() => []);
  $("invites").replaceChildren(...invites.filter((i) => i.status === "pending").map((i) => {
    const li = document.createElement("li"); const b = document.createElement("button");
    li.textContent = "Invitation to " + (i.organizationName ?? i.organizationId) + " ";
    b.textContent = "Accept";
    b.onclick = () => api("/organization/accept-invitation", { invitationId: i.id }).then(load, fail);
    li.append(b); return li;
  }));
}
function fail(e) { show("err", e.message); }
$("google").onclick = () => api("/sign-in/social", { provider: "google", callbackURL: "/" }).then((r) => location.href = r.url, fail);
$("create").onclick = () => {
  const name = $("org-name").value.trim(); if (!name) return;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
  api("/organization/create", { name, slug, kind: $("org-kind").value }).then(load, fail);
};
$("invite").onclick = () => {
  const first = $("orgs").querySelector("li[data-id]"); if (!first) return fail(new Error("Create a workspace first"));
  api("/organization/invite-member", { email: $("invite-email").value.trim(), role: "member", organizationId: first.dataset.id })
    .then(() => show("err", "Invitation created. The invitee signs in here and accepts it."), fail);
};
$("signout").onclick = () => api("/sign-out", {}).then(() => location.reload(), fail);
load().catch(fail);
`,
  );
}

export function loginPage() {
  return page(
    "Sign in",
    `<h1>Sign in to Assistant</h1>
<p>An app wants to connect to your Assistant account. Sign in to continue.</p>
<button id="google">Continue with Google</button>
<p id="err" style="color:#c00"></p>`,
    `
document.getElementById("google").onclick = () =>
  api("/sign-in/social", { provider: "google", callbackURL: "/", oauth_query: location.search.slice(1) })
    .then((r) => location.href = r.url, (e) => show("err", e.message));
`,
  );
}

export function consentPage() {
  return page(
    "Allow access",
    `<h1>Allow access?</h1>
<p><strong id="client">An app</strong> wants to access your Assistant account.</p>
<p class="muted">Scopes: <span id="scopes"></span></p>
<button id="allow">Allow</button> <button id="deny">Deny</button>
<p id="err" style="color:#c00"></p>`,
    `
const q = new URLSearchParams(location.search);
show("scopes", q.get("scope") || "(default)");
api("/oauth2/public-client?client_id=" + encodeURIComponent(q.get("client_id") || ""))
  .then((c) => c && c.client_name && show("client", c.client_name), () => {});
const decide = (accept) => api("/oauth2/consent", { accept, oauth_query: location.search.slice(1) })
  .then((r) => location.href = r.redirect_uri || r.url, (e) => show("err", e.message));
document.getElementById("allow").onclick = () => decide(true);
document.getElementById("deny").onclick = () => decide(false);
`,
  );
}
