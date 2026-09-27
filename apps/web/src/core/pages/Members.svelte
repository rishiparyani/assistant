<script lang="ts">
  import type { InvitationView, WorkspaceDetail } from "@assistant/shared";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import MessageCircle from "@lucide/svelte/icons/message-circle";
  import X from "@lucide/svelte/icons/x";
  import {
    Avatar,
    Button,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    Sheet,
    TextField,
    toast,
  } from "../ui/index.ts";
  import { api } from "../api.ts";
  import { session } from "../session.svelte.ts";
  import { loadWorkspace } from "../workspace.svelte.ts";
  import CollectiveSettings from "../../modules/gigs/CollectiveSettings.svelte";

  let { workspace }: { workspace: WorkspaceDetail } = $props();

  const isOwner = $derived(workspace.role === "owner");
  const isBand = $derived(workspace.kind === "band");

  let inviteOpen = $state(false);
  let email = $state("");
  let busy = $state(false);
  let created = $state<InvitationView | null>(null);
  let copied = $state("");

  const refresh = () => loadWorkspace(workspace.id, { force: true });

  async function invite(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      created = await api.invite(workspace.id, email);
      email = "";
      await refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      copied = url;
      toast.success("Link copied");
      setTimeout(() => (copied = ""), 2000);
    } catch {
      toast.error("Couldn't copy; select the link instead");
    }
  }

  const whatsapp = (inv: InvitationView) =>
    `https://wa.me/?text=${encodeURIComponent(`Join ${inv.workspace_name} on Assistant: ${inv.url}`)}`;

  async function remove(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from ${workspace.name}?`)) return;
    try {
      await api.removeMember(workspace.id, memberId);
      toast.success(`${name} removed`);
      await refresh();
    } catch (err) {
      toast.error(err);
    }
  }

  async function cancel(inv: InvitationView) {
    try {
      await api.cancelInvitation(workspace.id, inv.id);
      toast.success("Invitation cancelled");
      await refresh();
    } catch (err) {
      toast.error(err);
    }
  }
</script>

<PageHeader
  title={isBand ? "Collective" : "Workspace"}
  subtitle={isBand
    ? `${workspace.members.length} member${workspace.members.length === 1 ? "" : "s"}`
    : "Just you"}
>
  {#snippet actions()}
    {#if isOwner && isBand}
      <Button
        variant="primary"
        onclick={() => {
          created = null;
          inviteOpen = true;
        }}
      >
        {#snippet icon()}<UserPlus />{/snippet}
        Invite
      </Button>
    {/if}
  {/snippet}
</PageHeader>

<div class="cols">
  <ListGroup title="Members">
    {#each workspace.members as m (m.id)}
      <ListRow title={m.user_id === session.me?.user.id ? `${m.name} (you)` : m.name} subtitle={m.email}>
        {#snippet leading()}<Avatar name={m.name} />{/snippet}
        {#snippet trailing()}
          <Pill tone={m.role === "owner" ? "accent" : "grey"}>{m.role === "owner" ? "Owner" : "Member"}</Pill>
          {#if isOwner && isBand && m.user_id !== session.me?.user.id}
            <button
              class="icon-btn"
              type="button"
              aria-label="Remove {m.name}"
              onclick={() => remove(m.id, m.name)}
            >
              <X size={16} />
            </button>
          {/if}
        {/snippet}
      </ListRow>
    {/each}
  </ListGroup>

  {#if isOwner && workspace.invitations.length}
    <ListGroup
      title="Pending invitations"
      footer="Links work for 7 days, only for the email they were sent to."
    >
      {#each workspace.invitations as inv (inv.id)}
        <ListRow title={inv.email} subtitle="Invited as {inv.role}">
          {#snippet leading()}<Avatar name={inv.email} />{/snippet}
          {#snippet trailing()}
            <button class="icon-btn" type="button" aria-label="Copy link" onclick={() => copy(inv.url)}>
              {#if copied === inv.url}<Check size={16} />{:else}<Copy size={16} />{/if}
            </button>
            <button class="icon-btn" type="button" aria-label="Cancel invitation" onclick={() => cancel(inv)}>
              <X size={16} />
            </button>
          {/snippet}
        </ListRow>
      {/each}
    </ListGroup>
  {/if}

  {#if isBand && workspace.modules.includes("gigs")}
    <CollectiveSettings {workspace} />
  {/if}

  {#if !isBand}
    <ListGroup
      footer="Personal workspaces are just for you. Create a collective from the workspace switcher to invite others."
    >
      <ListRow title="Your personal workspace" subtitle="Solo gigs, clients and payments" />
    </ListGroup>
  {/if}
</div>

<Sheet bind:open={inviteOpen} title={created ? "Invitation ready" : "Invite a member"}>
  {#if created}
    <p class="lead">
      Send this link to <strong>{created.email}</strong>. They sign in with that email to join.
    </p>
    <div class="link">{created.url}</div>
    <div class="row">
      <Button full onclick={() => copy(created!.url)}>
        {#snippet icon()}{#if copied === created!.url}<Check />{:else}<Copy />{/if}{/snippet}
        Copy link
      </Button>
      <Button variant="primary" full href={whatsapp(created)}>
        {#snippet icon()}<MessageCircle />{/snippet}
        WhatsApp
      </Button>
    </div>
    <Button variant="ghost" full onclick={() => (created = null)}>Invite someone else</Button>
  {:else}
    <form class="form" onsubmit={invite}>
      <TextField
        label="Their email"
        type="email"
        bind:value={email}
        placeholder="name@gmail.com"
        hint="Use the email they sign in with (their Google account). No email is sent: you'll get a link to share."
        required
        autocomplete="off"
      />
      <Button variant="primary" size="lg" type="submit" full loading={busy}>Create invitation link</Button>
    </form>
  {/if}
</Sheet>

<style>
  .cols {
    display: grid;
    gap: var(--space-6);
  }
  @media (min-width: 1100px) {
    .cols {
      grid-template-columns: 1fr 1fr;
      align-items: start;
    }
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 0;
    background: var(--grey-soft);
    color: var(--text-2);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--surface-pressed);
  }
  .form {
    display: grid;
    gap: var(--space-4);
  }
  .lead {
    color: var(--text-2);
  }
  .link {
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px dashed var(--border-strong);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
</style>
