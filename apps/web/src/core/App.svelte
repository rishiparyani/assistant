<script lang="ts">
  import { navigate, router } from "./router.svelte.ts";
  import { refreshSession, session } from "./session.svelte.ts";
  import { setLive } from "./live.ts";
  import { saveAheadWith, startOffline } from "./offline.svelte.ts";
  import { startSync } from "./outbox.svelte.ts";
  import { saveGigsAhead } from "../modules/gigs/offline.ts";
  import { ConfirmHost, Spinner, Toaster, TopProgress } from "./ui/index.ts";
  import AppShell from "./shell/AppShell.svelte";
  import Login from "./pages/Login.svelte";
  import Consent from "./pages/Consent.svelte";
  import Home from "../modules/gigs/booking/Home.svelte";
  import MyGigs from "../modules/gigs/booking/MyGigs.svelte";
  import GigPage from "../modules/gigs/booking/GigPage.svelte";
  import GigTogether from "../modules/gigs/booking/GigTogether.svelte";
  import Reports from "../modules/gigs/booking/Reports.svelte";
  import Contacts from "../modules/gigs/booking/Contacts.svelte";
  import Settings from "./pages/Settings.svelte";
  import Admin from "./pages/Admin.svelte";
  import NotFound from "./pages/NotFound.svelte";
  import SharedGuests from "../modules/gigs/booking/SharedGuests.svelte";
  import GigTypesSettings from "../modules/gigs/booking/GigTypesSettings.svelte";

  const PUBLIC = new Set(["login", "consent", "guest_link"]);
  // Opens at once with the user saved on this device; the server check runs alongside.
  void refreshSession();

  // Live updates while signed in.
  $effect(() => setLive(!!session.me));

  // Offline first (docs/design/offline.md): save upcoming gigs and lists ahead.
  saveAheadWith(saveGigsAhead);
  const signedIn = startOffline(() => !!session.me);
  $effect(() => signedIn(!!session.me));
  // Send changes made offline whenever there's a chance.
  startSync();
  const route = $derived(router.route);

  // Signed-out users go to sign-in (and come back afterwards).
  $effect(() => {
    if (!session.loaded || session.me || PUBLIC.has(route.name)) return;
    const next = window.location.pathname + window.location.search;
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
  {:else if route.name === "guest_link"}
    <SharedGuests token={route.params.token!} />
  {:else if session.me}
    <AppShell>
      {#if route.name === "settings"}
        <Settings>
          {#snippet modules()}<GigTypesSettings />{/snippet}
        </Settings>
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
      {:else if route.name === "gig_together"}
        {#key route.params.gigId}
          <GigTogether
            gigId={route.params.gigId!}
            section={route.params.section as "guests" | "lists" | "notes"}
          />
        {/key}
      {:else if route.name === "reports"}
        <Reports />
      {:else if route.name === "contacts"}
        <Contacts />
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
