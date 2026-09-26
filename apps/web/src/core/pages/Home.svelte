<script lang="ts">
  import RequireSignIn from "../components/RequireSignIn.svelte";
  import { api } from "../api.ts";
  import { navigate } from "../router.svelte.ts";
  import { refreshSession, session } from "../session.svelte.ts";

  let name = $state("");
  let busy = $state(false);
  let error = $state("");

  async function create(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      const ws = await api.createWorkspace(name);
      await refreshSession();
      navigate(`/w/${ws.id}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<RequireSignIn>
  <h1>Your workspaces</h1>
  <ul class="list">
    {#each session.me?.workspaces ?? [] as ws (ws.id)}
      <li>
        <a class="row" href={`/w/${ws.id}`}>
          <span class="grow">{ws.name}</span>
          <span class="badge">{ws.kind === "personal" ? "personal" : ws.role}</span>
        </a>
      </li>
    {/each}
  </ul>

  <h2>New band</h2>
  <form class="inline" onsubmit={create}>
    <input placeholder="Band name" bind:value={name} required maxlength="80" />
    <button class="primary" disabled={busy}>Create</button>
  </form>
  {#if error}<p class="error">{error}</p>{/if}
  <p class="muted">Gigs arrive soon. For now: workspaces and members.</p>
</RequireSignIn>
