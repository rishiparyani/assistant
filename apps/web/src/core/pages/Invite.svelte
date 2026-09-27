<script lang="ts">
  import type { InvitationView } from "@assistant/shared";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import { Button, Card, Skeleton, toast } from "../ui/index.ts";
  import Centered from "../shell/Centered.svelte";
  import { api } from "../api.ts";
  import { authClient } from "../auth.ts";
  import { navigate } from "../router.svelte.ts";
  import { refreshSession, session } from "../session.svelte.ts";

  let { invitationId }: { invitationId: string } = $props();

  let inv = $state<InvitationView | null>(null);
  let loadError = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!session.me) {
      navigate(`/login?next=${encodeURIComponent(`/invite/${invitationId}`)}`, { replace: true });
      return;
    }
    api.invitation(invitationId).then(
      (v) => (inv = v),
      (e) => (loadError = e instanceof Error ? e.message : String(e)),
    );
  });

  async function accept() {
    busy = true;
    try {
      const ws = await api.acceptInvitation(invitationId);
      await refreshSession();
      toast.success(`Welcome to ${ws.name}`);
      navigate(`/w/${ws.id}/gigs`, { replace: true });
    } catch (e) {
      toast.error(e);
      busy = false;
    }
  }

  async function switchAccount() {
    await authClient.signOut();
    await refreshSession();
  }
</script>

<Centered>
  <Card>
    <div class="stack">
      <div class="icon"><UserPlus size={26} /></div>
      {#if loadError}
        <h1>Invitation not available</h1>
        <p>{loadError}</p>
        <p class="fine">Signed in as {session.me?.user.email}</p>
        <Button full onclick={switchAccount}>Use a different account</Button>
      {:else if !inv}
        <Skeleton rows={1} />
      {:else if inv.status !== "pending"}
        <h1>This invitation is {inv.status}</h1>
        <p>
          Ask the collective's owner for a new link if you still need to join <strong
            >{inv.workspace_name}</strong
          >.
        </p>
        <Button href="/" full>Go to your workspaces</Button>
      {:else}
        <h1>Join {inv.workspace_name}</h1>
        <p>You've been invited as a {inv.role}. You'll see its gigs and your own share of the money.</p>
        <Button variant="primary" size="lg" full loading={busy} onclick={accept}>Join collective</Button>
        <p class="fine">Signed in as {session.me?.user.email}</p>
      {/if}
    </div>
  </Card>
</Centered>

<style>
  .stack {
    display: grid;
    gap: var(--space-3);
    text-align: center;
  }
  .icon {
    width: 52px;
    height: 52px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft);
    color: var(--accent-text);
    margin: var(--space-2) auto;
  }
  h1 {
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  p {
    color: var(--text-2);
  }
  .fine {
    font-size: var(--text-sm);
    color: var(--text-3);
  }
</style>
