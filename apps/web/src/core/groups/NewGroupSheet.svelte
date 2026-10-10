<script lang="ts">
  import type { Person } from "@assistant/shared";
  import { Button, Sheet, Spinner, TextField, toast } from "../ui/index.ts";
  import { sharesApi } from "../spaces/shares-api.ts";
  import { connection } from "../offline.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import { refreshAll } from "../query.svelte.ts";
  import { groupsApi } from "./groups-api.ts";

  // A new group chat (chat-first step 7): a name and people I know (from my shares).
  let { open = $bindable(false) }: { open?: boolean } = $props();

  let name = $state("");
  let picked = $state<string[]>([]);
  let people = $state<Person[] | null>(null);
  let busy = $state(false);
  $effect(() => {
    if (!open) return;
    name = "";
    picked = [];
    people = null;
    sharesApi
      .people()
      .then((p) => (people = p))
      .catch(() => (people = []));
  });
  const toggle = (id: string) =>
    (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  // online-only: a group lives on the server, which tells its members.
  async function make() {
    if (!connection.online) {
      toast.error("Making a group needs a connection.");
      return;
    }
    busy = true;
    try {
      const g = await groupsApi.create(name.trim(), picked);
      open = false;
      refreshAll();
      navigate(`/g/${g.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="New group">
  <div class="body">
    <TextField label="Name" id="group-name" bind:value={name} maxlength={60} placeholder="Band" />
    <fieldset class="group">
      <legend>People</legend>
      {#if people === null}
        <Spinner size={20} label="Loading…" />
      {:else if !people.length}
        <p class="hint">
          People you know show here once they've joined something you shared. You can add them later.
        </p>
      {:else}
        <div class="chips">
          {#each people as p (p.user_id)}
            <button
              type="button"
              class="chip"
              class:on={picked.includes(p.user_id)}
              aria-pressed={picked.includes(p.user_id)}
              onclick={() => toggle(p.user_id)}>{p.name}</button
            >
          {/each}
        </div>
      {/if}
    </fieldset>
    <Button variant="primary" loading={busy} disabled={!name.trim()} onclick={make}>Make the group</Button>
  </div>
</Sheet>

<style>
  .body {
    display: grid;
    gap: var(--space-4);
  }
  .group {
    display: grid;
    gap: var(--space-2);
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  legend {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
    padding: 0;
    margin-bottom: var(--space-2);
  }
  .hint {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    min-height: 44px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .chip.on {
    background: var(--kind-people-soft);
    border-color: var(--kind-people);
    color: var(--kind-people);
    font-weight: 600;
  }
</style>
