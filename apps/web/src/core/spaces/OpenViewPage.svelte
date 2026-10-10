<script lang="ts">
  import { nameKey, type SavedView } from "@assistant/shared";
  import { Button, EmptyState, PageHeader, Spinner } from "../ui/index.ts";
  import { navigate, router } from "../router.svelte.ts";
  import { readCache } from "../query.svelte.ts";
  import { VIEWS_KEY, spacesApi } from "./spaces-api.ts";

  // /open-view?name=…: Siri's "Show a Gigspree view" (the iPhone app's intents) opens a saved
  // view by its name, the same way the assistant names things (case and spaces ignored).
  const name = router.route.query.get("name")?.trim() ?? "";
  let missing = $state(false);

  $effect(() => {
    // Only while this page is still open: leaving it first cancels the jump.
    let open = true;
    const go = (views: SavedView[]) => {
      if (!open) return;
      const v = views.find((x) => nameKey(x.name) === nameKey(name));
      // The chat opens it as a pop-up.
      if (v) navigate(`/?view=${encodeURIComponent(v.id)}`, { replace: true });
      else missing = true;
    };
    spacesApi.views().then(go, () => go(readCache<SavedView[]>(VIEWS_KEY) ?? []));
    return () => {
      open = false;
    };
  });
</script>

<PageHeader title={name || "Saved view"} />
{#if missing}
  <EmptyState title="No view called that" text="Your pinned views are in the menu.">
    {#snippet action()}<Button href="/">Back to chat</Button>{/snippet}
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
