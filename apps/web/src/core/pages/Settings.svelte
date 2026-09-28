<script lang="ts">
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash from "@lucide/svelte/icons/trash-2";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Gauge from "@lucide/svelte/icons/gauge";
  import { Avatar, Card, ListGroup, ListRow, PageHeader, toast } from "../ui/index.ts";
  import { authClient, passkeys, type PasskeyInfo } from "../auth.ts";
  import { navigate } from "../router.svelte.ts";
  import { refreshSession, session } from "../session.svelte.ts";
  import { adminApi } from "../api.ts";
  import CalendarFeed from "./CalendarFeed.svelte";

  // Only admins see the admin panel link.
  let isAdmin = $state(false);
  $effect(() => {
    if (session.me)
      adminApi.me().then(
        (r) => (isAdmin = r.is_admin),
        () => (isAdmin = false),
      );
  });

  let list = $state<PasskeyInfo[] | null>(null);
  let busy = $state(false);

  async function load() {
    try {
      list = await passkeys.list();
    } catch (e) {
      toast.error(e);
      list = [];
    }
  }
  $effect(() => {
    if (session.me) load();
  });

  function deviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Macintosh/.test(ua)) return "Mac";
    if (/Android/.test(ua)) return "Android";
    if (/Windows/.test(ua)) return "Windows PC";
    return "This device";
  }

  async function add() {
    busy = true;
    try {
      const res = await authClient.passkey.addPasskey({ name: deviceName() });
      if (res?.error) throw new Error(res.error.message ?? "Couldn't add the passkey");
      toast.success("Passkey added");
      await load();
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }

  async function remove(p: PasskeyInfo) {
    if (!confirm(`Remove the passkey "${p.name ?? "Passkey"}"?`)) return;
    try {
      await passkeys.remove(p.id);
      toast.success("Passkey removed");
      await load();
    } catch (e) {
      toast.error(e);
    }
  }

  async function signOut() {
    await authClient.signOut();
    await refreshSession();
    navigate("/login", { replace: true });
  }
</script>

<PageHeader title="Settings" />

<div class="stack">
  {#if session.me}
    <Card>
      <div class="me">
        <Avatar name={session.me.user.name} size={52} />
        <div>
          <div class="name">{session.me.user.name}</div>
          <div class="email">{session.me.user.email}</div>
        </div>
      </div>
    </Card>
  {/if}

  <CalendarFeed />

  <ListGroup
    title="Passkeys"
    footer="Sign in with Face ID, Touch ID or your device PIN instead of Google. Add one on each device you use."
  >
    {#each list ?? [] as p (p.id)}
      <ListRow
        title={p.name ?? "Passkey"}
        subtitle={p.createdAt
          ? `Added ${new Date(p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
          : undefined}
      >
        {#snippet leading()}<span class="key"><KeyRound size={18} /></span>{/snippet}
        {#snippet trailing()}
          <button class="icon-btn" type="button" aria-label="Remove passkey" onclick={() => remove(p)}>
            <Trash size={16} />
          </button>
        {/snippet}
      </ListRow>
    {/each}
    <ListRow title="Add a passkey on this device" onclick={add} chevron={false}>
      {#snippet leading()}<span class="key add"><Plus size={18} /></span>{/snippet}
    </ListRow>
  </ListGroup>

  {#if isAdmin}
    <ListGroup>
      <ListRow title="Admin panel" subtitle="Health, usage and repair tools" href="/admin">
        {#snippet leading()}<span class="admin-icon"><Gauge size={20} /></span>{/snippet}
      </ListRow>
    </ListGroup>
  {/if}

  <ListGroup>
    <ListRow title="Sign out" destructive onclick={signOut} chevron={false}>
      {#snippet leading()}<span class="key out"><LogOut size={18} /></span>{/snippet}
    </ListRow>
  </ListGroup>
  {#if busy}<p class="fine">Waiting for your device…</p>{/if}
</div>

<style>
  .admin-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .stack {
    display: grid;
    gap: var(--space-6);
    max-width: 640px;
  }
  .me {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .name {
    font-size: var(--text-md);
    font-weight: 650;
  }
  .email {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .key {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .key.add {
    background: var(--green-soft);
    color: var(--green);
  }
  .key.out {
    background: var(--red-soft);
    color: var(--red);
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
  .fine {
    color: var(--text-3);
    font-size: var(--text-sm);
  }
</style>
