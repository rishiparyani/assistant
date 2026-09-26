<script lang="ts">
  import Button from "./Button.svelte";
  import Sheet from "./Sheet.svelte";
  import { confirmState } from "./confirm.svelte.ts";

  const req = $derived(confirmState.request);
  // Writable: the sheet closes itself (Esc, backdrop) before `answer` clears the request.
  let open = $derived(!!req);

  function answer(ok: boolean) {
    req?.resolve(ok);
    confirmState.request = null;
  }
</script>

<Sheet bind:open title={req?.title ?? ""} onclose={() => req && answer(false)}>
  {#if req?.message}<p class="msg">{req.message}</p>{/if}
  {#snippet footer()}
    <Button onclick={() => answer(false)}>Cancel</Button>
    <Button variant={req?.destructive ? "danger" : "primary"} onclick={() => answer(true)}>
      {req?.confirmLabel ?? "OK"}
    </Button>
  {/snippet}
</Sheet>

<style>
  .msg {
    color: var(--text-2);
  }
</style>
