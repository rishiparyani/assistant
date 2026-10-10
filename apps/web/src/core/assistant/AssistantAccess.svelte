<script lang="ts">
  import { ListGroup, ListRow, Spinner, toast } from "../ui/index.ts";
  import { request } from "../api.ts";

  type Person = { user_id: string; name: string; on: boolean };

  // Owners only (chat-first step 4): switch the assistant on for people they know. It's off
  // for collaborators by default because their questions cost the owner.
  let people = $state<Person[] | null>(null);
  $effect(() => {
    request<Person[]>("GET", "/api/assistant/people").then(
      (p) => (people = p),
      () => (people = []),
    );
  });

  // online-only: who may use the assistant is decided on the server.
  async function set(p: Person, on: boolean) {
    try {
      const saved = await request<Person>("PUT", `/api/assistant/people/${encodeURIComponent(p.user_id)}`, {
        on,
      });
      people = people?.map((x) => (x.user_id === p.user_id ? saved : x)) ?? null;
      toast.success(on ? `The assistant is on for ${p.name}` : `The assistant is off for ${p.name}`);
    } catch (e) {
      toast.error(e);
      // Put the switch back.
      people = people?.map((x) => ({ ...x })) ?? null;
    }
  }
</script>

<ListGroup
  title="The assistant for others"
  footer="Off by default. When it's on, their questions come out of your AI allowance. Everything shared with them works either way."
>
  {#if people === null}
    <div class="pad"><Spinner size={20} label="Loading…" /></div>
  {:else if !people.length}
    <ListRow
      title="No one yet"
      subtitle="People show here once they join something you shared."
      chevron={false}
    />
  {:else}
    {#each people as p (p.user_id)}
      <label class="toggle">
        <span>{p.name}</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Assistant for {p.name}"
          checked={p.on}
          onchange={(e) => set(p, e.currentTarget.checked)}
        />
      </label>
    {/each}
  {/if}
</ListGroup>

<style>
  .pad {
    padding: var(--space-3) var(--space-4);
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 52px;
    padding: 0 var(--space-4);
    cursor: pointer;
  }
  .toggle + .toggle {
    border-top: 1px solid var(--border);
  }
  .toggle input {
    appearance: none;
    flex-shrink: 0;
    position: relative;
    width: 50px;
    height: 30px;
    border-radius: var(--radius-full);
    background: var(--grey-soft);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.2s;
  }
  .toggle input::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--shadow-sm);
    transition: transform 0.2s;
  }
  .toggle input:checked {
    background: var(--green);
    border-color: var(--green);
  }
  .toggle input:checked::after {
    transform: translateX(20px);
  }
</style>
