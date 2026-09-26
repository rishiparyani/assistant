<script lang="ts">
  import type { InvitationView } from "@assistant/shared";
  import RequireSignIn from "../components/RequireSignIn.svelte";
  import { api } from "../api.ts";
  import { navigate } from "../router.svelte.ts";
  import { refreshSession, session } from "../session.svelte.ts";
  import { authClient } from "../auth.ts";

  let { invitationId }: { invitationId: string } = $props();

  let inv = $state<InvitationView | null>(null);
  let loadError = $state("");
  let error = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!session.me) return;
    api.invitation(invitationId).then(
      (v) => (inv = v),
      (e) => (loadError = e instanceof Error ? e.message : String(e)),
    );
  });

  async function accept() {
    busy = true;
    error = "";
    try {
      const ws = await api.acceptInvitation(invitationId);
      await refreshSession();
      navigate(`/w/${ws.id}`, { replace: true });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      busy = false;
    }
  }

  async function switchAccount() {
    await authClient.signOut();
    await refreshSession();
  }
</script>

<RequireSignIn>
  <h1>Invitation</h1>
  {#if loadError}
    <div class="card stack">
      <p class="error">{loadError}</p>
      <p class="muted">You're signed in as {session.me?.user.email}.</p>
      <button onclick={switchAccount}>Sign in with a different account</button>
    </div>
  {:else if !inv}
    <p class="muted">Loading…</p>
  {:else if inv.status !== "pending"}
    <p>This invitation to <strong>{inv.workspace_name}</strong> is {inv.status}.</p>
    <p><a href="/">Go to your workspaces</a></p>
  {:else}
    <div class="card stack">
      <p>You've been invited to join <strong>{inv.workspace_name}</strong> as a {inv.role}.</p>
      <button class="primary wide" onclick={accept} disabled={busy}>Join {inv.workspace_name}</button>
      {#if error}<p class="error">{error}</p>{/if}
    </div>
  {/if}
</RequireSignIn>
