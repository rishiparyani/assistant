<script lang="ts">
  import KeyRound from "@lucide/svelte/icons/key-round";
  import { Button, Card, TextField, toast } from "../ui/index.ts";
  import Centered from "../shell/Centered.svelte";
  import { authClient, oauthQuery, signInWithGoogle } from "../auth.ts";
  import { navigate } from "../router.svelte.ts";
  import { refreshSession, session } from "../session.svelte.ts";
  import { inApp } from "../native.ts";

  let { query }: { query: URLSearchParams } = $props();

  const oauth = $derived(oauthQuery(query));
  const next = $derived.by(() => {
    const n = query.get("next");
    return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
  });
  const isLocal = window.location.hostname === "localhost";
  // Google doesn't allow its sign-in inside apps' web views, so the iPhone app uses passkeys.
  const app = inApp();

  let busy = $state<"" | "google" | "passkey" | "email">("");
  let email = $state("");
  let password = $state("");

  $effect(() => {
    if (session.me && !oauth) navigate(next, { replace: true });
  });

  async function run(kind: typeof busy, fn: () => Promise<void>) {
    busy = kind;
    try {
      await fn();
    } catch (e) {
      toast.error(e);
      busy = "";
    }
  }

  // After passkey/email sign-in during a connector flow, resume the authorization
  // request; Better Auth now sees the session and continues to consent.
  async function afterSignIn() {
    if (oauth) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
      const q = new URLSearchParams(oauth);
      for (const k of ["sig", "exp", "ba_iat", "ba_pl"]) q.delete(k);
      window.location.href = `/auth/oauth2/authorize?${q}`;
      return;
    }
    await refreshSession();
    navigate(next, { replace: true });
  }

  const google = () => run("google", () => signInWithGoogle(oauth ? "/" : next, oauth));
  const withPasskey = () =>
    run("passkey", async () => {
      const res = await authClient.signIn.passkey();
      if (res?.error) throw new Error(res.error.message ?? "Passkey sign-in failed");
      await afterSignIn();
    });
  const withPassword = (e: SubmitEvent) => {
    e.preventDefault();
    return run("email", async () => {
      let res = await authClient.signIn.email({ email, password });
      if (res.error?.status === 401) {
        res = (await authClient.signUp.email({ email, password, name: email.split("@")[0]! })) as typeof res;
      }
      if (res.error) throw new Error(res.error.message ?? "Sign-in failed");
      await afterSignIn();
    });
  };
</script>

<Centered>
  <Card>
    <div class="stack">
      <div class="head">
        <h1>{oauth ? "Connect your account" : "Welcome"}</h1>
        <p>
          {oauth
            ? "An app wants to connect to your Assistant account. Sign in to continue."
            : "Your gigs, clients and payments, in one place."}
        </p>
      </div>
      {#if !app}
        <Button
          variant="primary"
          size="lg"
          full
          onclick={google}
          loading={busy === "google"}
          disabled={!!busy}
        >
          {#snippet icon()}
            <svg viewBox="0 0 24 24" aria-hidden="true"
              ><path
                fill="#fff"
                d="M21.35 11.1H12v3.2h5.35c-.23 1.4-1.65 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.5 12 6.5c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.94 14.55 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.6-.07-1.05-.29-1.1Z"
              /></svg
            >
          {/snippet}
          Continue with Google
        </Button>
      {/if}
      <Button
        variant={app ? "primary" : "secondary"}
        size="lg"
        full
        onclick={withPasskey}
        loading={busy === "passkey"}
        disabled={!!busy}
      >
        {#snippet icon()}<KeyRound />{/snippet}
        Sign in with a passkey
      </Button>
      <p class="fine">
        {#if app}
          No passkey yet? Sign in on the website with Google, then add one in Settings → Passkeys. It works
          here straight away.
        {:else}
          Passkeys use Face ID, Touch ID or your device PIN. Add one in Settings after signing in.
        {/if}
      </p>
    </div>
  </Card>

  {#if isLocal}
    <Card>
      <form class="stack" onsubmit={withPassword}>
        <p class="fine">
          <strong>Local testing only:</strong> email + password (creates the account if new).
        </p>
        <TextField label="Email" type="email" bind:value={email} placeholder="test@example.com" required />
        <TextField label="Password" type="password" bind:value={password} minlength={8} required />
        <Button type="submit" full loading={busy === "email"} disabled={!!busy}>Sign in</Button>
      </form>
    </Card>
  {/if}
</Centered>

<style>
  .stack {
    display: grid;
    gap: var(--space-3);
  }
  .head {
    text-align: center;
    padding: var(--space-2) 0 var(--space-3);
  }
  h1 {
    font-size: var(--text-xl);
    font-weight: 750;
    letter-spacing: -0.03em;
  }
  .head p {
    color: var(--text-2);
    margin-top: 6px;
  }
  .fine {
    font-size: var(--text-sm);
    color: var(--text-3);
    text-align: center;
  }
</style>
