<script lang="ts">
  import { navigate, router } from "./router.svelte.ts";
  import { refreshSession, session } from "./session.svelte.ts";
  import { setLive } from "./live.ts";
  import { saveAheadWith, startOffline } from "./offline.svelte.ts";
  import { startSync } from "./outbox.svelte.ts";
  import { saveSpacesAhead } from "./spaces/spaces-api.ts";
  import { saveSharedAhead } from "./spaces/shares-api.ts";
  import RecordPage from "./spaces/RecordPage.svelte";
  import HelpPage from "./spaces/HelpPage.svelte";
  import JoinPage from "./spaces/JoinPage.svelte";
  import OpenViewPage from "./spaces/OpenViewPage.svelte";
  import SharedPage from "./spaces/SharedPage.svelte";
  import SharedCardPage from "./spaces/SharedCardPage.svelte";
  import PublicSharePage from "./spaces/PublicSharePage.svelte";
  import ChatPage from "./assistant/ChatPage.svelte";
  import { ConfirmHost, Spinner, Toaster, TopProgress, toast } from "./ui/index.ts";
  import AppShell from "./shell/AppShell.svelte";
  import Login from "./pages/Login.svelte";
  import Consent from "./pages/Consent.svelte";
  import Settings from "./pages/Settings.svelte";
  import Admin from "./pages/Admin.svelte";
  import NotFound from "./pages/NotFound.svelte";

  const PUBLIC = new Set(["login", "consent", "public_share"]);
  // Opens at once with the user saved on this device; the server check runs alongside.
  void refreshSession();

  // Live updates while signed in.
  $effect(() => setLive(!!session.me));

  // Offline first (docs/design/offline.md): save the space and shared cards ahead.
  saveAheadWith(saveSpacesAhead);
  saveAheadWith(saveSharedAhead);
  const signedIn = startOffline(() => !!session.me);
  $effect(() => signedIn(!!session.me));
  // Send changes made offline whenever there's a chance.
  startSync();
  const route = $derived(router.route);

  // Old gig links (notifications, calendar feed) open the chat with a note until gigs are
  // rebuilt (docs/design/chat-first.md step 8).
  $effect(() => {
    if (route.name !== "old_gig" || !session.me) return;
    navigate("/", { replace: true });
    toast.info("Gig pages are being rebuilt. Ask the assistant about this gig for now.");
  });

  // Signed-out users go to sign-in (and come back afterwards).
  $effect(() => {
    if (!session.loaded || session.me || PUBLIC.has(route.name)) return;
    // The hash too: a join link keeps its token there.
    const next = window.location.pathname + window.location.search + window.location.hash;
    navigate(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`, { replace: true });
  });
</script>

{#if !session.loaded}
  <div class="boot-screen">
    <span class="mark" aria-hidden="true"></span>
    <Spinner size={22} label="Loading…" />
  </div>
{:else if session.error}
  <p class="boot">Can't reach the server: {session.error}</p>
{:else}
  {#if route.name === "login"}
    <Login query={route.query} />
  {:else if route.name === "consent"}
    <Consent query={route.query} />
  {:else if route.name === "public_share"}
    <PublicSharePage />
  {:else if session.me}
    <AppShell>
      {#if route.name === "settings"}
        <Settings />
      {:else if route.name === "admin"}
        <Admin />
      {:else if route.name === "root"}
        <ChatPage />
      {:else if route.name === "record"}
        {#key route.params.recordId}
          <RecordPage collectionId={route.params.collectionId!} recordId={route.params.recordId!} />
        {/key}
      {:else if route.name === "help"}
        <HelpPage />
      {:else if route.name === "open_view"}
        <OpenViewPage />
      {:else if route.name === "join"}
        <JoinPage />
      {:else if route.name === "shared"}
        <SharedPage />
      {:else if route.name === "shared_card"}
        {#key route.params.shareId}
          <SharedCardPage shareId={route.params.shareId!} />
        {/key}
      {:else if route.name === "old_gig"}
        <Spinner size={22} label="Opening the chat…" />
      {:else}
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
    width: 64px;
    height: 64px;
    background: var(--logo) center / contain no-repeat;
  }
  .boot {
    max-width: 420px;
    margin: 20vh auto;
    padding: 0 var(--space-4);
  }
</style>
