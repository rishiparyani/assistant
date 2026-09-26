<script lang="ts">
  let { query }: { query: URLSearchParams } = $props();

  let clientName = $state("An app");
  let error = $state("");
  let busy = $state(false);

  $effect(() => {
    const id = query.get("client_id");
    if (!id) return;
    fetch(`/auth/oauth2/public-client?client_id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c?.client_name && (clientName = c.client_name))
      .catch(() => {});
  });

  async function decide(accept: boolean) {
    busy = true;
    error = "";
    const res = await fetch("/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, oauth_query: query.toString() }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      error = data?.message ?? data?.error_description ?? "Something went wrong";
      busy = false;
      return;
    }
    window.location.href = data.url ?? data.redirect_uri;
  }
</script>

<h1>Allow access?</h1>
<div class="card stack">
  <p>
    <strong>{clientName}</strong> wants to use your Assistant account: read and record gigs on your behalf.
  </p>
  <p class="muted">Scopes: {query.get("scope") ?? "default"}</p>
  <div style="display: flex; gap: 0.5rem">
    <button class="primary" onclick={() => decide(true)} disabled={busy}>Allow</button>
    <button onclick={() => decide(false)} disabled={busy}>Deny</button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
</div>
