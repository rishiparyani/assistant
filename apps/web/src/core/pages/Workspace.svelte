<script lang="ts">
  import type { InvitationView, WorkspaceDetail } from "@assistant/shared";
  import RequireSignIn from "../components/RequireSignIn.svelte";
  import { api } from "../api.ts";
  import { session } from "../session.svelte.ts";

  let { workspaceId }: { workspaceId: string } = $props();

  let ws = $state<WorkspaceDetail | null>(null);
  let loadError = $state("");
  let email = $state("");
  let busy = $state(false);
  let error = $state("");
  let lastInvite = $state<InvitationView | null>(null);
  let copied = $state("");

  async function load() {
    try {
      ws = await api.workspace(workspaceId);
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
  }
  load();

  async function act(fn: () => Promise<void>) {
    busy = true;
    error = "";
    try {
      await fn();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const invite = (e: SubmitEvent) => {
    e.preventDefault();
    return act(async () => {
      lastInvite = await api.invite(workspaceId, email);
      email = "";
    });
  };

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    copied = url;
    setTimeout(() => (copied = ""), 2000);
  }

  const whatsapp = (inv: InvitationView) =>
    `https://wa.me/?text=${encodeURIComponent(`Join ${inv.workspace_name} on Assistant: ${inv.url}`)}`;
</script>

<RequireSignIn>
  {#if loadError}
    <p class="error">{loadError}</p>
    <p><a href="/">Back to workspaces</a></p>
  {:else if !ws}
    <p class="muted">Loading…</p>
  {:else}
    <p><a href="/">← Workspaces</a></p>
    <h1>{ws.name}</h1>
    <p class="muted">
      {ws.kind === "personal" ? "Personal workspace" : "Band"} · you're {ws.role === "owner"
        ? "an owner"
        : "a member"}
    </p>

    <h2>Members</h2>
    <ul class="list">
      {#each ws.members as m (m.id)}
        <li>
          <span class="grow">{m.name}<br /><span class="muted">{m.email}</span></span>
          <span class="badge">{m.role}</span>
          {#if ws.role === "owner" && ws.kind === "band" && m.user_id !== session.me?.user.id}
            <button
              class="small"
              disabled={busy}
              onclick={() =>
                confirm(`Remove ${m.name} from ${ws!.name}?`) &&
                act(() => api.removeMember(workspaceId, m.id))}>Remove</button
            >
          {/if}
        </li>
      {/each}
    </ul>

    {#if ws.role === "owner" && ws.kind === "band"}
      <h2>Invite a bandmate</h2>
      <form class="inline" onsubmit={invite}>
        <input type="email" placeholder="Their Google email" bind:value={email} required />
        <button class="primary" disabled={busy}>Invite</button>
      </form>
      <p class="muted">No email is sent: share the link below. It works for 7 days, for that email only.</p>

      {#if lastInvite}
        <div class="card stack">
          <p class="ok">Invitation created for {lastInvite.email}. Send them this link:</p>
          <code class="link">{lastInvite.url}</code>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap">
            <button class="small" onclick={() => copy(lastInvite!.url)}>
              {copied === lastInvite.url ? "Copied" : "Copy link"}
            </button>
            <a class="button small" href={whatsapp(lastInvite)} target="_blank" rel="noopener"
              >Share on WhatsApp</a
            >
          </div>
        </div>
      {/if}

      {#if ws.invitations.length}
        <h2>Pending invitations</h2>
        <ul class="list">
          {#each ws.invitations as inv (inv.id)}
            <li>
              <span class="grow">{inv.email}</span>
              <button class="small" onclick={() => copy(inv.url)}
                >{copied === inv.url ? "Copied" : "Copy link"}</button
              >
              <button
                class="small"
                disabled={busy}
                onclick={() => act(() => api.cancelInvitation(workspaceId, inv.id))}>Cancel</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
  {/if}
</RequireSignIn>
