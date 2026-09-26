<script lang="ts">
  import RequireSignIn from "../components/RequireSignIn.svelte";
  import { authClient, passkeys, type PasskeyInfo } from "../auth.ts";
  import { navigate } from "../router.svelte.ts";
  import { refreshSession, session } from "../session.svelte.ts";

  let list = $state<PasskeyInfo[]>([]);
  let error = $state("");
  let busy = $state(false);

  async function load() {
    try {
      list = await passkeys.list();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    if (session.me) load();
  });

  async function act(fn: () => Promise<unknown>) {
    busy = true;
    error = "";
    try {
      await fn();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const add = () =>
    act(async () => {
      const res = await authClient.passkey.addPasskey({ name: navigator.platform || "This device" });
      if (res?.error) throw new Error(res.error.message ?? "Couldn't add the passkey");
    });

  async function signOut() {
    await authClient.signOut();
    await refreshSession();
    navigate("/login", { replace: true });
  }
</script>

<RequireSignIn>
  <h1>Settings</h1>
  <div class="card">
    <strong>{session.me?.user.name}</strong><br />
    <span class="muted">{session.me?.user.email}</span>
  </div>

  <h2>Passkeys</h2>
  <p class="muted">Sign in with Face ID, Touch ID or your device PIN instead of Google.</p>
  {#if list.length}
    <ul class="list">
      {#each list as p (p.id)}
        <li>
          <span class="grow">{p.name ?? "Passkey"}</span>
          <button class="small" disabled={busy} onclick={() => act(() => passkeys.remove(p.id))}
            >Remove</button
          >
        </li>
      {/each}
    </ul>
  {/if}
  <p><button onclick={add} disabled={busy}>Add a passkey on this device</button></p>
  {#if error}<p class="error">{error}</p>{/if}

  <h2>Account</h2>
  <button onclick={signOut}>Sign out</button>
</RequireSignIn>
