<script lang="ts">
  import { navigate, router } from "./router.svelte.ts";
  import { refreshSession, session } from "./session.svelte.ts";
  import { current, lastWorkspaceId, loadWorkspace } from "./workspace.svelte.ts";
  import { ConfirmHost, Skeleton, Spinner, Toaster, TopProgress } from "./ui/index.ts";
  import AppShell from "./shell/AppShell.svelte";
  import Login from "./pages/Login.svelte";
  import Consent from "./pages/Consent.svelte";
  import Invite from "./pages/Invite.svelte";
  import Home from "../modules/gigs/booking/Home.svelte";
  import MyGigs from "../modules/gigs/booking/MyGigs.svelte";
  import GigPage from "../modules/gigs/booking/GigPage.svelte";
  import Reports from "../modules/gigs/booking/Reports.svelte";
  import Members from "./pages/Members.svelte";
  import Settings from "./pages/Settings.svelte";
  import Admin from "./pages/Admin.svelte";
  import Gigs from "../modules/gigs/pages/Gigs.svelte";
  import Gig from "../modules/gigs/pages/Gig.svelte";
  import People from "../modules/gigs/pages/People.svelte";
  import NotFound from "./pages/NotFound.svelte";

  const PUBLIC = new Set(["login", "consent", "invite"]);
  // Opens at once with the user saved on this device; the server check runs alongside.
  void refreshSession();
  const route = $derived(router.route);

  // Signed-out users go to sign-in (and come back afterwards).
  $effect(() => {
    if (!session.loaded || session.me || PUBLIC.has(route.name)) return;
    const next = window.location.pathname + window.location.search;
    navigate(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`, { replace: true });
  });

  // A workspace's own address opens its gigs; Home ("/") is about me, across workspaces.
  $effect(() => {
    if (route.name === "home" && route.params.workspaceId)
      navigate(`/w/${route.params.workspaceId}/gigs`, { replace: true });
  });

  // Old workspace pages (kept until workspaces are retired) load their workspace.
  $effect(() => {
    if (!session.me) return;
    const id =
      route.params.workspaceId ??
      (route.name === "settings" ? (current.workspace?.id ?? lastWorkspaceId()) : null);
    if (id) loadWorkspace(id);
  });
</script>

{#if !session.loaded}
  <div class="boot-screen">
    <span class="mark" aria-hidden="true">A</span>
    <Spinner size={22} label="Loading…" />
  </div>
{:else if session.error}
  <p class="boot">Can't reach the server: {session.error}</p>
{:else}
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
      {:else if route.name === "admin"}
        <Admin />
      {:else if route.name === "root"}
        <Home />
      {:else if route.name === "my_gigs"}
        <MyGigs />
      {:else if route.name === "booking"}
        {#key route.params.gigId}
          <GigPage gigId={route.params.gigId!} />
        {/key}
      {:else if route.name === "reports"}
        <Reports />
      {:else if route.params.workspaceId && current.error}
        <NotFound
          title="Workspace not available"
          text="It may have been removed, or you're no longer a member. Ask its owner for a new invitation if you should have access."
        />
      {:else if route.params.workspaceId && current.workspace?.id !== route.params.workspaceId}
        <div class="loading"><Skeleton rows={4} /></div>
      {:else if current.workspace && route.name === "members"}
        <Members workspace={current.workspace} />
      {:else if current.workspace && route.name === "gigs"}
        <Gigs workspace={current.workspace} />
      {:else if current.workspace && route.name === "gig"}
        {#key route.params.gigId}
          <Gig workspace={current.workspace} gigId={route.params.gigId!} />
        {/key}
      {:else if current.workspace && route.name === "people"}
        <People workspace={current.workspace} />
      {:else if route.name !== "home"}
        <NotFound />
      {/if}
    </AppShell>
  {/if}
{/if}

<TopProgress />
<Toaster />
<ConfirmHost />

<style>
  .boot-screen {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: linear-gradient(135deg, #6366f1, #4338ca);
    color: #fff;
    font-size: 26px;
    font-weight: 750;
  }
  .boot {
    max-width: 420px;
    margin: 20vh auto;
    padding: 0 var(--space-4);
  }
  .loading {
    padding-top: var(--space-10);
  }
</style>
