<script lang="ts">
  import { router } from "./router.svelte.ts";
  import { refreshSession, session } from "./session.svelte.ts";
  import Home from "./pages/Home.svelte";
  import Login from "./pages/Login.svelte";
  import Consent from "./pages/Consent.svelte";
  import Workspace from "./pages/Workspace.svelte";
  import Invite from "./pages/Invite.svelte";
  import Settings from "./pages/Settings.svelte";
  import NotFound from "./pages/NotFound.svelte";

  const loading = refreshSession();
  const route = $derived(router.route);
</script>

<header class="bar">
  <a class="brand" href="/">Assistant</a>
  {#if session.me}
    <a href="/settings" aria-label="Settings">{session.me.user.name}</a>
  {/if}
</header>

<main>
  {#await loading}
    <p class="muted">Loading…</p>
  {:then}
    {#if route.name === "home"}
      <Home />
    {:else if route.name === "login"}
      <Login query={route.query} />
    {:else if route.name === "consent"}
      <Consent query={route.query} />
    {:else if route.name === "workspace"}
      {#key route.params.workspaceId}
        <Workspace workspaceId={route.params.workspaceId!} />
      {/key}
    {:else if route.name === "invite"}
      <Invite invitationId={route.params.invitationId!} />
    {:else if route.name === "settings"}
      <Settings />
    {:else}
      <NotFound />
    {/if}
  {:catch err}
    <p class="error">Can't reach the server: {err.message}</p>
  {/await}
</main>
