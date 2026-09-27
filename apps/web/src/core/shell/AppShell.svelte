<script lang="ts">
  import type { Snippet } from "svelte";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import { Avatar } from "../ui/index.ts";
  import { router } from "../router.svelte.ts";
  import { session } from "../session.svelte.ts";
  import { current, navFor } from "../workspace.svelte.ts";
  import NavIcon from "./NavIcon.svelte";
  import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";

  let { children }: { children: Snippet } = $props();
  let switcherOpen = $state(false);

  const ws = $derived(current.workspace);
  const nav = $derived(ws ? navFor(ws) : []);
  // Depend on the route so "active" updates on navigation.
  const path = $derived((router.route, window.location.pathname));
  const active = (href: string, exact = false) =>
    exact ? path === href : path === href || path.startsWith(`${href}/`);
</script>

<div class="shell">
  <!-- Tablet/laptop: sidebar -->
  <aside class="sidebar">
    <div class="brand">
      <span class="mark">A</span>
      <span>Assistant</span>
    </div>
    {#if ws}
      <button class="ws-button" type="button" onclick={() => (switcherOpen = true)}>
        <Avatar name={ws.name} size={32} square />
        <span class="ws-text">
          <span class="ws-name">{ws.name}</span>
          <span class="ws-kind">{ws.kind === "personal" ? "Personal" : "Collective"}</span>
        </span>
        <ChevronsUpDown size={16} />
      </button>
    {/if}
    <nav aria-label="Main">
      {#each nav as item (item.href)}
        <a class="side-link" class:active={active(item.href, item.exact)} href={item.href}>
          <NavIcon icon={item.icon} size={20} active={active(item.href, item.exact)} />
          {item.label}
        </a>
      {/each}
    </nav>
    {#if session.me}
      <a class="me" href="/settings">
        <Avatar name={session.me.user.name} size={32} />
        <span class="ws-text">
          <span class="ws-name">{session.me.user.name}</span>
          <span class="ws-kind">{session.me.user.email}</span>
        </span>
      </a>
    {/if}
  </aside>

  <!-- Phone: top bar -->
  <header class="topbar">
    {#if ws}
      <button class="ws-chip" type="button" onclick={() => (switcherOpen = true)}>
        <Avatar name={ws.name} size={26} square />
        <span class="ws-name">{ws.name}</span>
        <ChevronsUpDown size={15} />
      </button>
    {/if}
    {#if session.me}
      <a href="/settings" aria-label="Settings"><Avatar name={session.me.user.name} size={32} /></a>
    {/if}
  </header>

  <main class="content">
    <div class="page">{@render children()}</div>
  </main>

  <!-- Phone: tab bar -->
  <nav class="tabbar" aria-label="Main">
    {#each nav as item (item.href)}
      <a class="tab" class:active={active(item.href, item.exact)} href={item.href}>
        <NavIcon icon={item.icon} active={active(item.href, item.exact)} />
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
</div>

<WorkspaceSwitcher bind:open={switcherOpen} />

<style>
  .shell {
    min-height: 100dvh;
  }
  .content {
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--space-2) var(--space-4) calc(var(--tabbar-h) + var(--safe-bottom) + var(--space-8));
  }

  /* Phone chrome */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    height: calc(var(--topbar-h) + var(--safe-top));
    padding: var(--safe-top) var(--space-4) 0;
    background: var(--chrome);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid var(--separator);
  }
  .ws-chip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    height: 36px;
    padding: 0 10px 0 5px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
  }
  .ws-chip .ws-name {
    color: var(--text);
    font-weight: 600;
    font-size: var(--text-sm);
    max-width: 52vw;
  }
  .ws-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tabbar {
    position: fixed;
    z-index: 20;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    height: calc(var(--tabbar-h) + var(--safe-bottom));
    padding-bottom: var(--safe-bottom);
    background: var(--chrome);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-top: 1px solid var(--separator);
  }
  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--text-3);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .tab.active {
    color: var(--accent);
  }

  /* Sidebar (hidden on phones) */
  .sidebar {
    display: none;
  }

  @media (min-width: 768px) {
    .topbar,
    .tabbar {
      display: none;
    }
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      position: fixed;
      inset: 0 auto 0 0;
      width: var(--sidebar-w);
      padding: var(--space-5) var(--space-3);
      background: var(--surface-2);
      border-right: 1px solid var(--border);
    }
    .content {
      margin-left: var(--sidebar-w);
      max-width: none;
      padding: var(--space-4) var(--space-8) var(--space-10);
    }
    .page {
      max-width: var(--content-wide);
      margin: 0 auto;
    }
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-3);
    font-weight: 750;
    font-size: var(--text-md);
    letter-spacing: -0.02em;
  }
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, #6366f1, #4338ca);
    color: #fff;
    font-size: 15px;
  }
  .ws-button,
  .me {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    text-align: left;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
  }
  .me {
    margin-top: auto;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }
  .me:hover {
    background: var(--surface-hover);
  }
  .ws-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .ws-button .ws-name,
  .me .ws-name {
    color: var(--text);
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .ws-kind {
    font-size: var(--text-xs);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  nav[aria-label="Main"]:not(.tabbar) {
    display: grid;
    gap: 2px;
    margin-top: var(--space-3);
  }
  .side-link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 40px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-weight: 500;
  }
  .side-link:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .side-link.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }
</style>
