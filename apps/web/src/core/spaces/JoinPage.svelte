<script lang="ts">
  import { Button, EmptyState, PageHeader, Spinner } from "../ui/index.ts";
  import { navigate } from "../router.svelte.ts";
  import { sharesApi } from "./shares-api.ts";

  // /join#<token>: someone shared a card with me. Join it (signed in by now) and open it.
  // The token sits after # so it never reaches the server's logs; it's cleared from the address.
  const token = window.location.hash.slice(1);
  let error = $state<string | null>(token ? null : "This link is incomplete. Ask for it again.");

  $effect(() => {
    if (!token) return;
    history.replaceState(null, "", "/join");
    sharesApi.join(token).then(
      (j) => navigate(`/shared/${j.share_id}`, { replace: true }),
      (e: unknown) => (error = e instanceof Error ? e.message : "This link doesn't work."),
    );
  });
</script>

<PageHeader title="Shared with you" />
{#if error}
  <EmptyState title="Can't open this link" text={error}>
    {#snippet action()}<Button href="/shared">Shared with you</Button>{/snippet}
  </EmptyState>
{:else}
  <div class="wait"><Spinner size={22} label="Opening…" /></div>
{/if}

<style>
  .wait {
    display: flex;
    justify-content: center;
    padding: var(--space-10);
  }
</style>
