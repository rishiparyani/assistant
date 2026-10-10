<script lang="ts">
  import type { Snippet } from "svelte";
  import Menu from "@lucide/svelte/icons/menu";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import MessageCircle from "@lucide/svelte/icons/message-circle";
  import Inbox from "@lucide/svelte/icons/inbox";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Settings from "@lucide/svelte/icons/settings";
  import Brain from "@lucide/svelte/icons/brain";
  import Trash from "@lucide/svelte/icons/trash-2";
  import type { ChatSummary } from "@assistant/shared";
  import { fade } from "svelte/transition";
  import { AssistantMark, Avatar, calm, confirm, reducedMotion, toast } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { navigate, router } from "../router.svelte.ts";
  import { session } from "../session.svelte.ts";
  import { CHATS_KEY, MAIN_CHAT, chatApi, chatPath, startNewChat } from "../assistant/chat-api.ts";
  import PinnedList from "../spaces/PinnedList.svelte";
  import ListsMenu from "../spaces/ListsMenu.svelte";
  import PullToRefresh from "./PullToRefresh.svelte";
  import OfflineBar from "./OfflineBar.svelte";

  // The chat-first shell (docs/design/chat-first.md): a top bar and a side menu around the
  // page. On phones the menu slides in; on wide screens it stays open beside the page.
  let { children }: { children: Snippet } = $props();

  const route = $derived(router.route);
  // Depend on the route so the path updates on navigation.
  const path = $derived((router.route, window.location.pathname));
  let menuOpen = $state(false);
  // Wide screens keep the menu open beside the page; on phones a closed menu is off screen
  // and out of reach (inert) for the keyboard and screen readers.
  const WIDE = matchMedia("(min-width: 900px)");
  let wide = $state(WIDE.matches);
  $effect(() => {
    const on = () => (wide = WIDE.matches);
    WIDE.addEventListener("change", on);
    return () => WIDE.removeEventListener("change", on);
  });

  // Any navigation closes the phone's menu.
  $effect(() => {
    void path;
    menuOpen = false;
  });

  // A soft fade between pages. Opacity only: a transform would make the page the frame for
  // position: fixed children (the chat composer) while it runs, and they'd jump.
  let page: HTMLElement | undefined = $state();
  let shown = window.location.pathname;
  $effect(() => {
    const p = path;
    if (p === shown || !page) return;
    shown = p;
    if (reducedMotion()) return;
    page.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
  });

  function newChat() {
    menuOpen = false;
    void startNewChat();
  }

  // The person's chats: the main one first, then the newest.
  const chats = createQuery<ChatSummary[]>(() => CHATS_KEY, chatApi.list);
  const chatList = $derived(chats.data ?? [{ id: MAIN_CHAT, title: "Gigspree", updated_at: null }]);
  const openChat = $derived(
    route.name === "root" ? MAIN_CHAT : route.name === "chat" ? (route.params.chatId ?? null) : null,
  );

  async function removeChat(c: ChatSummary) {
    const ok = await confirm({
      title: `Delete “${c.title}”?`,
      message: "Its messages go; everything saved in your lists stays.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await chatApi.remove(c.id);
      chats.set((chats.data ?? []).filter((x) => x.id !== c.id));
      if (openChat === c.id) navigate("/");
    } catch (e) {
      toast.error(e);
    }
  }

  const LINKS = [
    { href: "/shared", label: "Shared with you", icon: Inbox },
    { href: "/help", label: "Help", icon: CircleHelp },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && (menuOpen = false)} />

<PullToRefresh />
<div class="shell" class:menu-open={menuOpen}>
  <header class="topbar">
    <button class="icon-btn menu-btn" type="button" aria-label="Open menu" onclick={() => (menuOpen = true)}>
      <Menu size={22} />
    </button>
    <a class="who" href="/">
      <AssistantMark size={34} />
      <span class="who-text">
        <span class="who-name">Gigspree</span>
        <span class="who-sub"
          >{openChat && openChat !== MAIN_CHAT
            ? (chatList.find((c) => c.id === openChat)?.title ?? "Your assistant")
            : "Your assistant"}</span
        >
      </span>
    </a>
    <button class="icon-btn" type="button" aria-label="New chat" onclick={newChat}>
      <SquarePen size={21} />
    </button>
  </header>

  {#if menuOpen && !wide}
    <!-- Only while the menu is open, so screen readers never find a dead "Close menu". -->
    <button
      class="scrim"
      type="button"
      tabindex="-1"
      aria-label="Close menu"
      onclick={() => (menuOpen = false)}
      transition:fade={calm({ duration: 250 })}
    ></button>
  {/if}
  <nav class="drawer" aria-label="Menu" inert={!menuOpen && !wide}>
    <button class="new" type="button" onclick={newChat}>
      <SquarePen size={18} /> New chat
    </button>

    <h3>Chats</h3>
    <ul class="chats">
      {#each chatList as c (c.id)}
        <li class="chat-row">
          <a class="item" class:active={openChat === c.id} href={chatPath(c.id)}>
            <span class="ic chat"><MessageCircle size={16} /></span>
            <span class="t">{c.title}</span>
          </a>
          {#if c.id !== MAIN_CHAT}
            <button
              class="del"
              type="button"
              aria-label="Delete chat {c.title}"
              onclick={() => removeChat(c)}
            >
              <Trash size={16} />
            </button>
          {/if}
        </li>
      {/each}
    </ul>

    <h3>Pinned</h3>
    <PinnedList onopen={() => (menuOpen = false)} />

    <h3>Your lists</h3>
    <ListsMenu onopen={() => (menuOpen = false)} />

    <h3>The assistant</h3>
    <a class="item" class:active={path === "/memory"} href="/memory">
      <span class="ic flow"><Brain size={16} /></span>
      <span class="t">What it remembers</span>
    </a>

    <h3>More</h3>
    {#each LINKS as l (l.href)}
      <a class="item" class:active={path === l.href || path.startsWith(`${l.href}/`)} href={l.href}>
        <span class="ic"><l.icon size={16} /></span>
        <span class="t">{l.label}</span>
      </a>
    {/each}

    {#if session.me}
      <a class="me" href="/settings">
        <Avatar name={session.me.user.name} size={32} />
        <span class="me-text">
          <span class="me-name">{session.me.user.name}</span>
          <span class="me-mail">{session.me.user.email}</span>
        </span>
      </a>
    {/if}
  </nav>

  <main class="content">
    <div class="page" bind:this={page}><OfflineBar />{@render children()}</div>
  </main>
</div>

<style>
  .shell {
    min-height: 100dvh;
  }

  /* Top bar */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: calc(var(--topbar-h) + var(--safe-top));
    padding: var(--safe-top) var(--space-3) 0 var(--space-2);
    background: var(--chrome);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid var(--separator);
  }
  .icon-btn {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    transition: background var(--dur-fast);
  }
  .icon-btn:hover {
    background: var(--surface-hover);
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--text);
  }
  .who-text {
    display: grid;
    min-width: 0;
    line-height: 1.25;
  }
  .who-name {
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .who-sub {
    font-size: var(--text-xs);
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Side menu */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
    border: 0;
    padding: 0;
    background: var(--backdrop);
  }
  .drawer {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 31;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: min(84vw, var(--sidebar-w));
    padding: calc(var(--safe-top) + var(--space-3)) var(--space-2) calc(var(--safe-bottom) + var(--space-3));
    overflow-y: auto;
    background: var(--surface);
    border-right: 1px solid var(--border);
    transform: translateX(-102%);
    transition: transform 0.34s var(--ease);
  }
  .menu-open .drawer {
    transform: none;
    box-shadow: var(--shadow-lg);
  }
  h3 {
    margin: var(--space-4) var(--space-3) var(--space-1);
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .new {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 44px;
    margin: 0 var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition: transform var(--dur) var(--ease-spring);
  }
  .new:active {
    transform: scale(0.97);
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    color: var(--text);
    transition: background var(--dur-fast);
  }
  .item:hover {
    background: var(--surface-hover);
  }
  .item.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 650;
  }
  .ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--surface-hover);
    color: var(--text-2);
  }
  .chats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .chat-row {
    display: flex;
    align-items: center;
    /* A long title shortens (…) instead of pushing the delete button out of the menu. */
    min-width: 0;
  }
  .chat-row .item {
    flex: 1;
    min-width: 0;
  }
  .del {
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
    opacity: 0.6;
  }
  .del:hover {
    opacity: 1;
    color: var(--red);
    background: var(--surface-hover);
  }
  .ic.flow {
    background: var(--kind-flow-soft);
    color: var(--kind-flow);
  }
  .ic.chat {
    background: var(--kind-people-soft);
    color: var(--kind-people);
  }
  .t {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .me {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: auto;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    color: var(--text-2);
  }
  .me:hover {
    background: var(--surface-hover);
  }
  .me-text {
    display: grid;
    min-width: 0;
  }
  .me-name {
    color: var(--text);
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .me-mail {
    font-size: var(--text-xs);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .content {
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--space-2) var(--space-4) calc(var(--safe-bottom) + var(--space-8));
  }

  /* Wide screens: the menu stays open beside the page. */
  @media (min-width: 900px) {
    .menu-btn {
      display: none;
    }
    .drawer {
      transform: none;
      width: var(--sidebar-w);
      padding-top: var(--space-4);
    }
    .topbar,
    .content {
      margin-left: var(--sidebar-w);
    }
    .topbar {
      padding-left: var(--space-5);
    }
    .content {
      max-width: none;
      padding: var(--space-4) var(--space-8) var(--space-10);
    }
    .page {
      max-width: var(--content-max);
      margin: 0 auto;
    }
  }
</style>
