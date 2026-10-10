<script lang="ts">
  import type { ChatItem, ChatView } from "@assistant/shared";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import { fly } from "svelte/transition";
  import { backOut } from "svelte/easing";
  import { Button, PageHeader, Pill, confirm, toast } from "../ui/index.ts";
  import { createQuery, refreshAll } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import { router } from "../router.svelte.ts";
  import PinnedBar from "../spaces/PinnedBar.svelte";
  import { CHAT_KEY, chatApi, SUGGESTIONS } from "./chat-api.ts";

  // Home: the chat with the assistant (design §10). Pinned views are one tap away above it;
  // everything the assistant does can also be done by tapping in Collections.
  const chat = createQuery<ChatView>(() => CHAT_KEY, chatApi.get);
  let text = $state(router.route.query.get("ask") ?? "");
  let thinkHarder = $state(false);
  let sending = $state<string | null>(null);
  let busyCard = $state<string | null>(null);
  let list = $state<HTMLElement | null>(null);

  const items = $derived<ChatItem[]>(chat.data?.items ?? []);
  // New messages float up from the side they come from.
  const fromMe = { y: 12, x: 12, duration: 320, easing: backOut };
  const fromThem = { y: 12, x: -12, duration: 320, easing: backOut };

  // Keep the newest message in view.
  $effect(() => {
    void items.length;
    void sending;
    queueMicrotask(() => list?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" }));
  });

  async function send(message = text) {
    const t = message.trim();
    if (!t || sending) return;
    if (!connection.online) {
      toast.error("The assistant needs a connection. Collections work offline.");
      return;
    }
    sending = t;
    text = "";
    try {
      chat.set(await chatApi.send(t, thinkHarder));
      thinkHarder = false;
      // Records it added show up on the other screens.
      refreshAll();
    } catch (e) {
      text = t;
      toast.error(e);
    } finally {
      sending = null;
    }
  }

  // Siri, Shortcuts and the Action button open "/?ask=…" (the iPhone app's intents): the
  // message waits in the box for a tap on Send. A link never sends anything by itself.
  if (router.route.query.get("ask")) history.replaceState(null, "", "/");

  async function answer(actionId: string, yes: boolean) {
    busyCard = actionId;
    try {
      chat.set(yes ? await chatApi.confirm(actionId) : await chatApi.cancel(actionId));
      if (yes) refreshAll();
    } catch (e) {
      toast.error(e);
      void chat.refresh();
    } finally {
      busyCard = null;
    }
  }

  async function clear() {
    const ok = await confirm({
      title: "Start a new chat?",
      message: "The messages go; everything saved in your collections stays.",
      confirmLabel: "New chat",
    });
    if (!ok) return;
    try {
      chat.set(await chatApi.clear());
    } catch (e) {
      toast.error(e);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  }
</script>

<PageHeader title="Gigspree">
  {#snippet actions()}
    <Button variant="ghost" href="/help" aria-label="Help">
      {#snippet icon()}<CircleHelp />{/snippet}
    </Button>
    {#if items.length}
      <Button variant="ghost" onclick={clear} aria-label="New chat">
        {#snippet icon()}<RotateCcw />{/snippet}
      </Button>
    {/if}
  {/snippet}
</PageHeader>

<PinnedBar />

<div class="chat">
  {#if !items.length && !sending}
    <div class="empty">
      <p class="hello">What would you like to do?</p>
      <p class="sub">Ask in English or Hinglish. Try one:</p>
      <div class="suggestions">
        {#each SUGGESTIONS as s (s)}
          <button type="button" class="suggestion" onclick={() => send(s)}>{s}</button>
        {/each}
      </div>
    </div>
  {/if}

  <ol class="messages" bind:this={list} aria-live="polite">
    {#each items as m (m.id)}
      {#if m.role === "user"}
        <li class="msg mine" in:fly={fromMe}>{m.text}</li>
      {:else if m.role === "card" && m.card}
        <li class="card" class:closed={m.card.status !== "waiting"} in:fly={fromThem}>
          <div class="card-title">{m.card.title}</div>
          {#if m.card.details.length}
            <ul class="details">
              {#each m.card.details as d, i (i)}<li>{d}</li>{/each}
            </ul>
          {/if}
          {#if m.card.status === "waiting"}
            <div class="card-actions">
              <Button size="sm" onclick={() => answer(m.card!.action_id, false)} disabled={busyCard !== null}
                >Cancel</Button
              >
              <Button
                size="sm"
                variant="primary"
                onclick={() => answer(m.card!.action_id, true)}
                loading={busyCard === m.card.action_id}>Confirm</Button
              >
            </div>
          {:else}
            <Pill tone={m.card.status === "done" ? "green" : m.card.status === "failed" ? "red" : "grey"}
              >{{
                done: "Done",
                failed: "Didn't work",
                cancelled: "Cancelled",
                expired: "Expired",
                waiting: "",
              }[m.card.status]}</Pill
            >
          {/if}
        </li>
      {:else if m.role === "note"}
        <li class="note" in:fly={{ y: 8, duration: 250 }}>{m.text}</li>
      {:else}
        <li class="msg theirs" in:fly={fromThem}>{m.text}</li>
      {/if}
    {/each}
    {#if sending}
      <li class="msg mine" in:fly={fromMe}>{sending}</li>
      <li class="msg theirs typing" aria-label="The assistant is thinking" in:fly={fromThem}>
        <span></span><span></span><span></span>
      </li>
    {/if}
  </ol>
</div>

<form
  class="composer"
  onsubmit={(e) => {
    e.preventDefault();
    void send();
  }}
>
  {#if chat.data?.setup_in_progress}
    <p class="mode"><Sparkles size={14} /> Setting something up with the smart model</p>
  {:else if chat.data?.smart_available}
    <label class="think">
      <input type="checkbox" bind:checked={thinkHarder} />
      <Sparkles size={14} /> Think harder
    </label>
  {/if}
  <div class="box">
    <textarea
      bind:value={text}
      onkeydown={onKey}
      rows="1"
      maxlength="2000"
      placeholder={connection.online ? "Message Gigspree" : "Offline: the assistant needs a connection"}
      aria-label="Message the assistant"></textarea>
    <button type="submit" class="send" aria-label="Send" disabled={!text.trim() || !!sending}>
      <ArrowUp size={20} />
    </button>
  </div>
</form>

<style>
  .chat {
    max-width: var(--content-max);
    padding-bottom: 140px;
  }
  .empty {
    padding: var(--space-6) 0;
  }
  .hello {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 650;
  }
  .sub {
    margin: var(--space-1) 0 var(--space-4);
    color: var(--text-2);
  }
  .suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .suggestion {
    min-height: 44px;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--text-base);
    text-align: left;
    cursor: pointer;
  }
  .suggestion {
    animation: pop-in var(--dur) var(--ease-spring) backwards;
    transition:
      background var(--dur-fast),
      transform var(--dur) var(--ease-spring);
  }
  .suggestion:nth-child(2) {
    animation-delay: 50ms;
  }
  .suggestion:nth-child(3) {
    animation-delay: 100ms;
  }
  .suggestion:nth-child(n + 4) {
    animation-delay: 150ms;
  }
  .suggestion:hover {
    background: var(--surface-hover);
    transform: translateY(-2px);
  }
  .suggestion:active {
    transform: scale(0.97);
  }
  .hello,
  .sub {
    animation: rise-in var(--dur) var(--ease) backwards;
  }
  .card:not(.closed) {
    animation: glow 2.4s ease-in-out infinite;
  }
  @keyframes glow {
    50% {
      box-shadow: 0 0 0 4px var(--accent-soft);
    }
  }
  .messages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .msg {
    max-width: 85%;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-xl);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.45;
  }
  .mine {
    align-self: flex-end;
    background: var(--accent);
    color: var(--text-on-accent);
    border-bottom-right-radius: var(--radius-sm);
  }
  .theirs {
    align-self: flex-start;
    background: var(--surface);
    border: 1px solid var(--border);
    border-bottom-left-radius: var(--radius-sm);
  }
  .note {
    align-self: center;
    color: var(--text-3);
    font-size: var(--text-sm);
    text-align: center;
  }
  .card {
    align-self: flex-start;
    width: min(100%, 420px);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--accent);
    box-shadow: var(--shadow-sm);
    display: grid;
    gap: var(--space-3);
  }
  .card.closed {
    border-color: var(--border);
    box-shadow: none;
  }
  .card-title {
    font-weight: 650;
  }
  .details {
    margin: 0;
    padding-left: var(--space-4);
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .card-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .typing {
    display: flex;
    gap: 4px;
    padding: var(--space-4);
  }
  .typing span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-3);
    animation: blink 1.2s infinite ease-in-out;
  }
  .typing span:nth-child(2) {
    animation-delay: 0.15s;
  }
  .typing span:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .typing span {
      animation: none;
    }
  }
  .composer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(var(--tabbar-h) + var(--safe-bottom));
    padding: var(--space-2) var(--space-4) var(--space-3);
    background: linear-gradient(to top, var(--bg) 70%, transparent);
    z-index: 5;
  }
  @media (min-width: 768px) {
    .composer {
      left: var(--sidebar-w);
      bottom: 0;
      padding-bottom: var(--space-5);
    }
  }
  .box {
    max-width: var(--content-max);
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-xl);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow);
  }
  .box:focus-within {
    border-color: var(--accent);
    box-shadow: var(--focus);
  }
  textarea:focus,
  textarea:focus-visible {
    outline: none;
    box-shadow: none;
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
    line-height: 1.4;
    padding: 10px var(--space-2);
    max-height: 160px;
    field-sizing: content;
  }
  .send {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    border: 0;
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .send {
    transition:
      opacity var(--dur-fast),
      transform var(--dur) var(--ease-spring);
  }
  .send:not(:disabled):hover {
    transform: scale(1.06);
  }
  .send:not(:disabled):active {
    transform: scale(0.9);
    transition-duration: 0.08s;
  }
  .send:disabled {
    opacity: 0.4;
    cursor: default;
    transform: scale(0.92);
  }
  .think,
  .mode {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0 0 var(--space-2) var(--space-2);
    min-height: 32px;
    font-size: var(--text-sm);
    color: var(--accent-text);
  }
  .think input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
</style>
