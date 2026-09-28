<script lang="ts">
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { Button, Card } from "../ui/index.ts";
  import Centered from "../shell/Centered.svelte";
  import { session } from "../session.svelte.ts";

  let { query }: { query: URLSearchParams } = $props();

  let clientName = $state("An app");
  let error = $state("");
  let busy = $state<"" | "allow" | "deny">("");

  $effect(() => {
    const id = query.get("client_id");
    if (!id) return;
    fetch(`/auth/oauth2/public-client?client_id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c?.client_name && (clientName = c.client_name))
      .catch(() => {});
  });

  async function decide(accept: boolean) {
    busy = accept ? "allow" : "deny";
    error = "";
    const res = await fetch("/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, oauth_query: query.toString() }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      error = data?.message ?? data?.error_description ?? "Something went wrong";
      busy = "";
      return;
    }
    window.location.href = data.url ?? data.redirect_uri;
  }
</script>

<Centered>
  <Card>
    <div class="stack">
      <div class="icon"><ShieldCheck size={28} /></div>
      <h1><strong>{clientName}</strong> wants access to your Assistant account</h1>
      <ul>
        <li>See your gigs, the people on them and their money</li>
        <li>Add and update gigs and record payments for you (money changes ask you to confirm)</li>
      </ul>
      {#if session.me}<p class="fine">Signed in as {session.me.user.email}</p>{/if}
      {#if error}<p class="error">{error}</p>{/if}
      <div class="actions">
        <Button size="lg" onclick={() => decide(false)} loading={busy === "deny"} disabled={!!busy}
          >Deny</Button
        >
        <Button
          variant="primary"
          size="lg"
          onclick={() => decide(true)}
          loading={busy === "allow"}
          disabled={!!busy}>Allow</Button
        >
      </div>
    </div>
  </Card>
</Centered>

<style>
  .stack {
    display: grid;
    gap: var(--space-4);
  }
  .icon {
    width: 52px;
    height: 52px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft);
    color: var(--accent-text);
    margin: var(--space-2) auto 0;
  }
  h1 {
    text-align: center;
    font-size: var(--text-md);
    font-weight: 500;
  }
  ul {
    margin: 0;
    padding-left: 1.2em;
    color: var(--text-2);
    display: grid;
    gap: 6px;
  }
  .fine {
    text-align: center;
    font-size: var(--text-sm);
    color: var(--text-3);
  }
  .error {
    color: var(--red);
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
</style>
