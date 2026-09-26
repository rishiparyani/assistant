<script lang="ts">
  import { getHealth } from "./api.ts";

  const health = getHealth();
</script>

<main>
  <h1>Assistant</h1>
  <p class="muted">Gig management, coming soon.</p>

  {#await health}
    <p>Checking the server…</p>
  {:then h}
    <p>
      Server OK · <strong>{h.environment}</strong> · modules:
      {h.modules.length ? h.modules.join(", ") : "none yet"} · database: {h.migrations} migration{h.migrations ===
      1
        ? ""
        : "s"}
    </p>
  {:catch err}
    <p class="error">Can't reach the server: {err.message}</p>
  {/await}
</main>
