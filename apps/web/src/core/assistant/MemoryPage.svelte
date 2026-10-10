<script lang="ts">
  import type { Memory } from "@assistant/shared";
  import Brain from "@lucide/svelte/icons/brain";
  import X from "@lucide/svelte/icons/x";
  import { EmptyState, PageHeader, Skeleton, confirm, toast } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { chatApi, MEMORIES_KEY } from "./chat-api.ts";

  // What the assistant remembers (docs/design/chat-first.md): every chat uses it; each item
  // says where it came from and can be forgotten.
  const memories = createQuery<Memory[]>(() => MEMORIES_KEY, chatApi.memories);

  async function forget(m: Memory) {
    const ok = await confirm({
      title: "Forget this?",
      message: m.text,
      confirmLabel: "Forget",
      destructive: true,
    });
    if (!ok) return;
    try {
      await chatApi.forget(m.id);
      memories.set((memories.data ?? []).filter((x) => x.id !== m.id));
      toast.success("Forgotten");
    } catch (e) {
      toast.error(e);
    }
  }
</script>

<PageHeader
  title="What it remembers"
  subtitle="Things you asked the assistant to keep. Every chat uses them."
  back="/"
  backLabel="Chat"
/>

{#if memories.data}
  {#if memories.data.length}
    <ul class="list">
      {#each memories.data as m (m.id)}
        <li class="item">
          <span class="ic"><Brain size={16} /></span>
          <span class="text">
            {m.text}
            <small>{m.source}</small>
          </span>
          <button type="button" class="forget" aria-label="Forget: {m.text}" onclick={() => forget(m)}>
            <X size={18} />
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <EmptyState
      title="Nothing yet"
      text="Tell the assistant “remember …” and it keeps it for every chat, like your rates or how you file things."
    >
      {#snippet icon()}<Brain />{/snippet}
    </EmptyState>
  {/if}
{:else if memories.error}
  <EmptyState title="Can't load this" text="It needs a connection." />
{:else}
  <Skeleton rows={3} label="Loading" />
{/if}

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-2) var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--border);
    animation: rise-in var(--dur) var(--ease) backwards;
  }
  .ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--kind-flow-soft);
    color: var(--kind-flow);
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    padding-top: 4px;
  }
  .text small {
    display: block;
    margin-top: 2px;
    font-size: var(--text-xs);
    color: var(--text-3);
  }
  .forget {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .forget:hover {
    background: var(--surface-hover);
    color: var(--red);
  }
</style>
