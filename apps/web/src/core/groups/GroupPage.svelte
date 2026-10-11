<script lang="ts">
  import { mentionsAssistant, type GroupView } from "@assistant/shared";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import type { Person } from "@assistant/shared";
  import { Button, EmptyState, PageHeader, Sheet, Skeleton, Spinner, toast, confirm } from "../ui/index.ts";
  import { sharesApi } from "../spaces/shares-api.ts";
  import { createQuery, refreshAll } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import { navigate } from "../router.svelte.ts";
  import { session } from "../session.svelte.ts";
  import { groupKey, groupsApi } from "./groups-api.ts";

  // A group chat (chat-first step 7): people talk; @assistant asks the assistant, for people
  // who have it (it answers from their data and allowance, for everyone in the group to read).
  let { id }: { id: string } = $props();
  const group = createQuery<GroupView>(
    () => groupKey(id),
    () => groupsApi.get(id),
  );

  let text = $state("");
  let sending = $state<string | null>(null);
  const asks = $derived(mentionsAssistant(text));
  const blocked = $derived(asks && group.data?.can_ask === false);

  // online-only: messages are delivered by the server (and @assistant answers there).
  async function send() {
    const t = text.trim();
    if (!t || sending || blocked) return;
    if (!connection.online) {
      toast.error("Sending needs a connection.");
      return;
    }
    sending = t;
    text = "";
    try {
      group.set(await groupsApi.post(id, t));
    } catch (e) {
      text = t;
      toast.error(e);
    } finally {
      sending = null;
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }
  // online-only: leaving is done on the server.
  async function leave() {
    const ok = await confirm({
      title: `Leave “${group.data?.name}”?`,
      message: "You stop getting its messages. Someone in it can add you again.",
      confirmLabel: "Leave",
      destructive: true,
    });
    if (!ok) return;
    try {
      await groupsApi.leave(id);
      refreshAll();
      navigate("/");
    } catch (e) {
      toast.error(e);
    }
  }
  // The owner adds people they know (from their shares).
  let adding = $state(false);
  let known = $state<Person[] | null>(null);
  let picked = $state<string[]>([]);
  let busyAdd = $state(false);
  $effect(() => {
    if (!adding) return;
    picked = [];
    known = null;
    sharesApi
      .people()
      .then((p) => (known = p.filter((x) => !group.data?.members.some((m) => m.user_id === x.user_id))))
      .catch(() => (known = []));
  });
  // online-only: the server checks who may be added and tells them.
  async function addPicked() {
    if (!connection.online) {
      toast.error("Adding people needs a connection.");
      return;
    }
    busyAdd = true;
    try {
      group.set(await groupsApi.add(id, picked));
      adding = false;
    } catch (e) {
      toast.error(e);
    } finally {
      busyAdd = false;
    }
  }

  const me = $derived(session.me?.user.id);
  const isOwner = $derived(group.data?.owner_id === me);

  // Keep the newest message in view.
  let list: HTMLOListElement | undefined = $state();
  $effect(() => {
    void group.data?.messages.length;
    void sending;
    queueMicrotask(() => list?.lastElementChild?.scrollIntoView({ block: "end" }));
  });
</script>

{#if group.data}
  <PageHeader title={group.data.name} subtitle={group.data.members.map((m) => m.name).join(", ")}>
    {#snippet actions()}
      {#if isOwner}
        <button type="button" class="head-btn" onclick={() => (adding = true)}>Add people</button>
      {:else}
        <button type="button" class="head-btn leave" onclick={leave}>Leave</button>
      {/if}
    {/snippet}
  </PageHeader>
  <div class="wrap">
    <ol class="messages" bind:this={list} aria-live="polite">
      {#each group.data.messages as m (m.id)}
        {#if m.kind === "note"}
          <li class="note">{m.text}</li>
        {:else}
          <li
            class="msg"
            class:mine={m.kind === "person" && m.author_id === me}
            class:ai={m.kind === "assistant"}
          >
            {#if !(m.kind === "person" && m.author_id === me)}<span class="who">{m.author}</span>{/if}
            <span class="text">{m.text}</span>
          </li>
        {/if}
      {/each}
      {#if sending}
        <li class="msg mine pending"><span class="text">{sending}</span></li>
      {/if}
    </ol>
  </div>
  <div class="dock">
    {#if blocked}
      <p class="off">
        The assistant isn't on for you, so it can't answer here. Ask the group's owner to switch it on, or
        send without @assistant.
      </p>
    {:else if asks}
      <p class="hint">The assistant will answer from your own lists, for everyone here to read.</p>
    {/if}
    <form
      class="box"
      onsubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        bind:value={text}
        onkeydown={onKey}
        rows="1"
        maxlength="2000"
        placeholder={connection.online
          ? "Message the group (@assistant to ask)"
          : "Offline: sending needs a connection"}
        aria-label="Message the group"></textarea>
      <button type="submit" class="send" aria-label="Send" disabled={!text.trim() || !!sending || blocked}>
        <ArrowUp size={20} />
      </button>
    </form>
  </div>
  <Sheet bind:open={adding} title="Add people">
    <div class="add">
      {#if known === null}
        <Spinner size={20} label="Loading…" />
      {:else if !known.length}
        <p class="hint">
          Everyone you know is already here. People show up once they join something you shared.
        </p>
      {:else}
        <div class="chips">
          {#each known as p (p.user_id)}
            <button
              type="button"
              class="chip"
              class:on={picked.includes(p.user_id)}
              aria-pressed={picked.includes(p.user_id)}
              onclick={() =>
                (picked = picked.includes(p.user_id)
                  ? picked.filter((x) => x !== p.user_id)
                  : [...picked, p.user_id])}>{p.name}</button
            >
          {/each}
        </div>
        <Button variant="primary" loading={busyAdd} disabled={!picked.length} onclick={addPicked}>Add</Button>
      {/if}
    </div>
  </Sheet>
{:else if group.error}
  <EmptyState title="Can't open this group" text="You may have left it, or you're offline." />
{:else}
  <Skeleton rows={4} label="Loading" />
{/if}

<style>
  .wrap {
    margin: 0 auto;
    max-width: var(--content-max);
    padding-bottom: 170px;
  }
  .messages {
    list-style: none;
    margin: 0;
    padding: var(--space-2) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .msg {
    display: grid;
    gap: 2px;
    max-width: 84%;
    align-self: flex-start;
    padding: 8px 14px 10px;
    border-radius: 20px;
    border-bottom-left-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    overflow-wrap: anywhere;
    line-height: 1.45;
  }
  .text {
    white-space: pre-wrap;
  }
  .who {
    font-size: var(--text-sm);
    font-weight: 650;
    color: var(--kind-people);
  }
  .msg.ai {
    background: var(--kind-flow-soft);
    border-color: transparent;
  }
  .msg.ai .who {
    color: var(--kind-flow);
  }
  .msg.mine {
    align-self: flex-end;
    background: var(--accent);
    color: var(--text-on-accent);
    border: 0;
    border-bottom-left-radius: 20px;
    border-bottom-right-radius: 6px;
  }
  .pending {
    opacity: 0.7;
  }
  .note {
    align-self: center;
    color: var(--text-3);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
  }
  .head-btn {
    min-height: 44px;
    padding: 0 var(--space-3);
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .head-btn.leave {
    color: var(--red);
  }
  .add {
    display: grid;
    gap: var(--space-4);
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
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    padding: var(--space-6) var(--space-3) calc(var(--safe-bottom) + var(--space-3));
    background: linear-gradient(to top, var(--bg) 72%, transparent);
  }
  @media (min-width: 900px) {
    .dock {
      left: var(--sidebar-w);
    }
  }
  .off,
  .hint {
    max-width: var(--content-max);
    margin: 0 auto var(--space-2);
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-2);
  }
  .box {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    max-width: var(--content-max);
    margin: 0 auto;
    padding: 6px 6px 6px 14px;
    border-radius: 26px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
  }
  .box:focus-within {
    border-color: var(--accent);
  }
  textarea {
    flex: 1;
    min-width: 0;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 16px;
    line-height: 1.35;
    padding: 9px 4px;
    max-height: 160px;
    field-sizing: content;
  }
  textarea:focus-visible {
    outline: none;
    box-shadow: none;
  }
  .send {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: var(--accent);
    color: var(--text-on-accent);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
