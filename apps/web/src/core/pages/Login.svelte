<script lang="ts">
  import { authClient, oauthQuery, signInWithGoogle } from "../auth.ts";
  import { navigate } from "../router.svelte.ts";
  import { refreshSession, session } from "../session.svelte.ts";

  let { query }: { query: URLSearchParams } = $props();

  const oauth = $derived(oauthQuery(query));
  // Only allow same-site relative redirects.
  const next = $derived.by(() => {
    const n = query.get("next");
    return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
  });
  const isLocal = window.location.hostname === "localhost";

  let busy = $state(false);
  let error = $state("");
  let email = $state("");
  let password = $state("");

  $effect(() => {
    if (session.me && !oauth) navigate(next, { replace: true });
  });

  async function run(fn: () => Promise<void>) {
    busy = true;
    error = "";
    try {
      await fn();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      busy = false;
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

  const google = () => run(() => signInWithGoogle(oauth ? "/" : next, oauth));
  const withPasskey = () =>
    run(async () => {
      const res = await authClient.signIn.passkey();
      if (res?.error) throw new Error(res.error.message ?? "Passkey sign-in failed");
      await afterSignIn();
    });
  const withPassword = (e: SubmitEvent) => {
    e.preventDefault();
    return run(async () => {
      let res = await authClient.signIn.email({ email, password });
      if (res.error?.status === 401) {
        res = (await authClient.signUp.email({ email, password, name: email.split("@")[0]! })) as typeof res;
      }
      if (res.error) throw new Error(res.error.message ?? "Sign-in failed");
      await afterSignIn();
    });
  };
</script>

<h1>Sign in</h1>
{#if oauth}
  <p>An app wants to connect to your Assistant account. Sign in to continue.</p>
{/if}

<div class="card stack">
  <button class="primary wide" onclick={google} disabled={busy}>Continue with Google</button>
  <button class="wide" onclick={withPasskey} disabled={busy}>Sign in with a passkey</button>
  <p class="muted">
    Passkeys use Face ID, Touch ID or your device PIN. Add one in Settings after signing in.
  </p>
  {#if error}<p class="error">{error}</p>{/if}
</div>

{#if isLocal}
  <h2>Local testing</h2>
  <form class="card stack" onsubmit={withPassword}>
    <p class="muted">Only on localhost: email + password (creates the account if new).</p>
    <input type="email" placeholder="test@example.com" bind:value={email} required />
    <input
      type="password"
      placeholder="Password (8+ characters)"
      bind:value={password}
      required
      minlength="8"
    />
    <button class="wide" disabled={busy}>Sign in</button>
  </form>
{/if}
