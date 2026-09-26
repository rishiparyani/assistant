<script lang="ts">
  import { navigate, router } from "./router.svelte.ts";
  import { refreshSession, session } from "./session.svelte.ts";
  import { current, lastWorkspaceId, loadWorkspace } from "./workspace.svelte.ts";
  import { Skeleton, Toaster } from "./ui/index.ts";
  import AppShell from "./shell/AppShell.svelte";
  import Login from "./pages/Login.svelte";
  import Consent from "./pages/Consent.svelte";
  import Invite from "./pages/Invite.svelte";
  import Home from "./pages/Home.svelte";
  import Members from "./pages/Members.svelte";
  import Settings from "./pages/Settings.svelte";
  import Placeholder from "./pages/Placeholder.svelte";
  import NotFound from "./pages/NotFound.svelte";

  const PUBLIC = new Set(["login", "consent", "invite"]);
  const loading = refreshSession();
  const route = $derived(router.route);

  // Signed-out users go to sign-in (and come back afterwards).
  $effect(() => {
    if (!session.loaded || session.me || PUBLIC.has(route.name)) return;
    const next = window.location.pathname + window.location.search;
    navigate(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`, { replace: true });
  });

  // "/" opens the last workspace used on this device, else the personal one.
  $effect(() => {
    if (route.name !== "root" || !session.me) return;
    const ids = session.me.workspaces.map((w) => w.id);
    const last = lastWorkspaceId();
    navigate(`/w/${last && ids.includes(last) ? last : ids[0]}`, { replace: true });
  });

  // Keep the current workspace in step with the URL (Settings keeps the last one).
  $effect(() => {
    if (!session.me) return;
    const id =
      route.params.workspaceId ?? current.workspace?.id ?? lastWorkspaceId() ?? session.me.workspaces[0]?.id;
    if (id) loadWorkspace(id);
  });
</script>

{#await loading}
  <div class="boot"><Skeleton rows={3} /></div>
{:then}
  {#if route.name === "login"}
    <Login query={route.query} />
  {:else if route.name === "consent"}
    <Consent query={route.query} />
  {:else if route.name === "invite"}
    <Invite invitationId={route.params.invitationId!} />
  {:else if session.me}
    <AppShell>
      {#if route.name === "settings"}
        <Settings />
      {:else if route.params.workspaceId && current.error}
        <NotFound
          title="Workspace not available"
          text="It may have been removed, or you're no longer a member. Ask its owner for a new invitation if you should have access."
        />
      {:else if route.params.workspaceId && current.workspace?.id !== route.params.workspaceId}
        <div class="loading"><Skeleton rows={4} /></div>
      {:else if current.workspace && route.name === "home"}
        <Home workspace={current.workspace} />
      {:else if current.workspace && route.name === "members"}
        <Members workspace={current.workspace} />
      {:else if route.name === "gigs" || route.name === "gig"}
        <Placeholder
          title="Gigs"
          text="Add gigs, track payments and set who plays: the gig screens arrive next."
        />
      {:else if route.name === "people"}
        <Placeholder title="People" text="Clients, venues and your band roster will live here." />
      {:else if route.name !== "root"}
        <NotFound />
      {/if}
    </AppShell>
  {/if}
{:catch err}
  <p class="boot">Can't reach the server: {err.message}</p>
{/await}

<Toaster />

<style>
  .boot {
    max-width: 420px;
    margin: 20vh auto;
    padding: 0 var(--space-4);
  }
  .loading {
    padding-top: var(--space-10);
  }
</style>
