<script lang="ts">
  import type { ChatItem, ChatView } from "@assistant/shared";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Plus from "@lucide/svelte/icons/plus";
  import type { CollectionView } from "@assistant/shared";
  import ActionSheet from "../ui/ActionSheet.svelte";
  import RecordSheet from "../spaces/RecordSheet.svelte";
  import LiveCard from "../spaces/LiveCard.svelte";
  import QuestionCard from "../spaces/QuestionCard.svelte";
  import AskSheet from "../spaces/AskSheet.svelte";
  import { COLLECTIONS_KEY, spacesApi } from "../spaces/spaces-api.ts";
  import { fly } from "svelte/transition";
  import { backOut } from "svelte/easing";
  import { AssistantMark, Button, Pill, calm, toast } from "../ui/index.ts";
  import { createQuery, publish, refreshAll } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import { router } from "../router.svelte.ts";
  import { CHATS_KEY, MAIN_CHAT, chatApi, chatKey, SUGGESTIONS } from "./chat-api.ts";

  // The app's home: the chat with the assistant (docs/design/chat-first.md). Pinned views are
  // in the side menu.
  let { chatId = MAIN_CHAT }: { chatId?: string } = $props();
  const chat = createQuery<ChatView>(
    () => chatKey(chatId),
    () => chatApi.get(chatId),
  );
  let text = $state(router.route.query.get("ask") ?? "");
  let thinkHarder = $state(false);
  let sending = $state<string | null>(null);
  let busyCard = $state<string | null>(null);
  let list = $state<HTMLElement | null>(null);

  const items = $derived<ChatItem[]>(chat.data?.items ?? []);

  // "+": add to any list by tapping, without the assistant (and offline).
  const collections = createQuery<CollectionView[]>(() => COLLECTIONS_KEY, spacesApi.collections);
  let picking = $state(false);
  let adding = $state(false);
  let addTo = $state<CollectionView | null>(null);
  // Ask people a question (step 4); its card goes into this chat.
  let asking = $state(false);
  // The question's card is already in the chat (same request); show it.
  async function asked() {
    try {
      chat.set(await chatApi.get(chatId));
    } catch (e) {
      toast.error(e);
    }
  }

  const addActions = $derived([
    { label: "Ask people…", onclick: () => (asking = true) },
    ...(collections.data ?? []).map((c) => ({
      label: c.name,
      onclick: () => {
        addTo = c;
        adding = true;
      },
    })),
  ]);
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
      chat.set(await chatApi.send(chatId, t, thinkHarder));
      // A chat is named by its first message; the menu's list catches up a moment later.
      if (chatId !== MAIN_CHAT)
        setTimeout(
          () =>
            void chatApi.list().then(
              (l) => publish(CHATS_KEY, l),
              () => {},
            ),
          1500,
        );
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
  if (router.route.query.get("ask")) history.replaceState(null, "", window.location.pathname);

  async function answer(actionId: string, yes: boolean) {
    busyCard = actionId;
    try {
      chat.set(yes ? await chatApi.confirm(chatId, actionId) : await chatApi.cancel(chatId, actionId));
      if (yes) refreshAll();
    } catch (e) {
      toast.error(e);
      void chat.refresh();
    } finally {
      busyCard = null;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  }
</script>

<div class="chat">
  {#if !items.length && !sending}
    <div class="empty">
      <AssistantMark size={56} />
      <p class="hello">What would you like to do?</p>
      <p class="sub">Notes, money, reminders, plans with people. Ask in English or Hinglish.</p>
    </div>
  {/if}

  <ol class="messages" bind:this={list} aria-live="polite">
    {#each items as m (m.id)}
      {#if m.role === "user"}
        <li class="msg mine" in:fly={calm(fromMe)}>{m.text}</li>
      {:else if m.role === "card" && m.card}
        <li class="card" class:closed={m.card.status !== "waiting"} in:fly={calm(fromThem)}>
          <div class="card-head">
            <span class="kind"><ShieldCheck size={17} /></span>
            <span class="card-title">{m.card.title}</span>
          </div>
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
      {:else if m.role === "live" && m.live}
        <li class="live" in:fly={calm(fromThem)}>
          {#if m.live.kind === "question"}
            <QuestionCard id={m.live.question_id} />
          {:else}
            <LiveCard live={m.live} collections={collections.data} />
          {/if}
        </li>
      {:else if m.role === "note"}
        <li class="note" in:fly={calm({ y: 8, duration: 250 })}>{m.text}</li>
      {:else}
        <li class="msg theirs" in:fly={calm(fromThem)}>{m.text}</li>
      {/if}
    {/each}
    {#if sending}
      <li class="msg mine" in:fly={calm(fromMe)}>{sending}</li>
      <li class="msg theirs typing" aria-label="The assistant is thinking" in:fly={calm(fromThem)}>
        <span></span><span></span><span></span>
      </li>
    {/if}
  </ol>
</div>

<div class="dock">
  <div class="suggest" aria-label="Try one">
    {#each SUGGESTIONS as s (s)}
      <button type="button" class="suggestion" onclick={() => send(s)}>{s}</button>
    {/each}
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
      <button
        type="button"
        class="plus"
        aria-label="Add to a list or ask people"
        onclick={() => (picking = true)}
      >
        <Plus size={20} />
      </button>
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
</div>

<ActionSheet bind:open={picking} title="Add or ask" actions={addActions} />
<AskSheet bind:open={asking} {chatId} onasked={asked} />
{#if addTo}
  {#key addTo.id}
    <RecordSheet
      bind:open={adding}
      collection={addTo}
      onsaved={() => toast.success(`Added to ${addTo?.name}`)}
    />
  {/key}
{/if}

<style>
  .chat {
    max-width: var(--content-max);
    padding-bottom: 190px;
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    padding: var(--space-10) 0 var(--space-6);
    text-align: center;
  }
  .empty :global(.mark) {
    animation: pop-in var(--dur-slow) var(--ease-spring) backwards;
    margin-bottom: var(--space-2);
  }
  .hello {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 750;
    letter-spacing: -0.03em;
    text-wrap: balance;
    animation: rise-in var(--dur) var(--ease) backwards;
    animation-delay: 60ms;
  }
  .sub {
    margin: 0;
    max-width: 34ch;
    color: var(--text-2);
    animation: rise-in var(--dur) var(--ease) backwards;
    animation-delay: 110ms;
  }
  .messages {
    list-style: none;
    margin: 0;
    padding: var(--space-2) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .messages > li {
    flex-shrink: 0;
  }
  .msg {
    max-width: 84%;
    padding: 10px 14px;
    border-radius: 20px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.45;
  }
  .mine {
    align-self: flex-end;
    background: var(--accent);
    color: var(--text-on-accent);
    border-bottom-right-radius: 6px;
  }
  .theirs {
    align-self: flex-start;
    background: var(--surface);
    border: 1px solid var(--border);
    border-bottom-left-radius: 6px;
  }
  .live {
    align-self: stretch;
    display: grid;
  }
  .note {
    align-self: center;
    color: var(--text-3);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
  }
  /* A card the assistant wants confirmed (money, deletes, new setups). */
  .card {
    align-self: stretch;
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    display: grid;
    gap: var(--space-3);
  }
  .card.closed {
    box-shadow: none;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .kind {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--kind-flow-soft);
    color: var(--kind-flow);
  }
  .card-title {
    font-weight: 650;
    letter-spacing: -0.01em;
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
  .card:not(.closed) {
    animation: glow 2.4s ease-in-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .card:not(.closed) {
      animation: none;
    }
  }
  @keyframes glow {
    50% {
      box-shadow:
        var(--shadow-card),
        0 0 0 4px var(--kind-flow-soft);
    }
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

  /* Suggestions and the message box, fixed at the bottom. */
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    padding: var(--space-6) 0 calc(var(--safe-bottom) + var(--space-3));
    background: linear-gradient(to top, var(--bg) 72%, transparent);
  }
  @media (min-width: 900px) {
    .dock {
      left: var(--sidebar-w);
    }
  }
  .suggest,
  .composer {
    max-width: var(--content-max);
    margin: 0 auto;
  }
  .suggest {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding: 0 var(--space-4) var(--space-2);
    scrollbar-width: none;
  }
  .suggest::-webkit-scrollbar {
    display: none;
  }
  .suggestion {
    flex: none;
    min-height: 44px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
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
  }
  .suggestion:active {
    transform: scale(0.96);
  }
  .composer {
    padding: 0 var(--space-3);
  }
  .box {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: 6px;
    border-radius: 26px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    transition: border-color var(--dur-fast);
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
  textarea:focus,
  textarea:focus-visible {
    outline: none;
    box-shadow: none;
  }
  .plus {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: var(--surface-hover);
    color: var(--text-2);
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: transform var(--dur) var(--ease-spring);
  }
  .plus:active {
    transform: scale(0.9);
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
    opacity: 0.35;
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
