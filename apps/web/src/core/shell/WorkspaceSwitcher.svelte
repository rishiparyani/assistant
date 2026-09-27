<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Plus from "@lucide/svelte/icons/plus";
  import { Avatar, Button, ListGroup, ListRow, Sheet, TextField, toast } from "../ui/index.ts";
  import { api } from "../api.ts";
  import { navigate } from "../router.svelte.ts";
  import { refreshSession, session } from "../session.svelte.ts";
  import { current } from "../workspace.svelte.ts";

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let creating = $state(false);
  let name = $state("");
  let busy = $state(false);

  function go(id: string) {
    open = false;
    navigate(`/w/${id}`);
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const ws = await api.createWorkspace(name);
      await refreshSession();
      toast.success(`${ws.name} created`);
      name = "";
      creating = false;
      go(ws.id);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Workspaces" onclose={() => (creating = false)}>
  <ListGroup>
    {#each session.me?.workspaces ?? [] as ws (ws.id)}
      <ListRow
        title={ws.name}
        subtitle={ws.kind === "personal"
          ? "Personal"
          : ws.role === "owner"
            ? "Collective · owner"
            : "Collective · member"}
        onclick={() => go(ws.id)}
        chevron={false}
      >
        {#snippet leading()}<Avatar name={ws.name} square />{/snippet}
        {#snippet trailing()}
          {#if current.workspace?.id === ws.id}<span class="check"><Check size={20} /></span>{/if}
        {/snippet}
      </ListRow>
    {/each}
  </ListGroup>

  {#if creating}
    <form class="create" onsubmit={create}>
      <TextField
        label="Collective name"
        bind:value={name}
        placeholder="e.g. The Monsoon Project"
        required
        maxlength={80}
      />
      <Button variant="primary" type="submit" loading={busy} full>Create collective</Button>
    </form>
  {:else}
    <Button variant="tinted" full onclick={() => (creating = true)}>
      {#snippet icon()}<Plus />{/snippet}
      New collective
    </Button>
  {/if}
</Sheet>

<style>
  .check {
    color: var(--accent);
    display: flex;
  }
  .create {
    display: grid;
    gap: var(--space-3);
  }
</style>
