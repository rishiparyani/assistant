<script lang="ts">
  import CloudOff from "@lucide/svelte/icons/cloud-off";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { connection } from "../offline.svelte.ts";
  import { dismissFailed, flush, outbox } from "../outbox.svelte.ts";

  // Where things stand (docs/design/offline.md): offline, changes waiting to sync, and any
  // change the server refused later (with why), to read and dismiss.
  const waiting = $derived(outbox.waiting.length);
  const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;
  let open = $state(false);
</script>

{#if !connection.online}
  <div class="bar offline" role="status">
    <CloudOff size={16} />
    <span
      >Offline · {waiting
        ? `${changes(waiting)} saved on this device, will sync when you're back online`
        : "showing what's saved on this device"}</span
    >
  </div>
{:else if waiting && outbox.showWaiting}
  <div class="bar syncing" role="status">
    <RefreshCw size={16} />
    <span>Syncing {changes(waiting)}…</span>
    {#if !outbox.sending}<button class="link" type="button" onclick={() => void flush()}>Try now</button>{/if}
  </div>
{/if}

{#if outbox.failed.length}
  <div class="bar failed" role="alert">
    <TriangleAlert size={16} />
    <span>{changes(outbox.failed.length)} couldn't sync</span>
    <button class="link" type="button" onclick={() => (open = !open)}>{open ? "Hide" : "See why"}</button>
  </div>
  {#if open}
    <ul class="failed-list">
      {#each outbox.failed as f (f.id)}
        <li>
          <div>
            <strong>{f.label}</strong>
            <span>{f.reason}</span>
          </div>
          <button class="link" type="button" onclick={() => dismissFailed(f.id)}>Dismiss</button>
        </li>
      {/each}
      {#if outbox.failed.length > 1}
        <li class="all">
          <button class="link" type="button" onclick={() => dismissFailed()}>Dismiss all</button>
        </li>
      {/if}
    </ul>
  {/if}
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
  }
  .offline {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .syncing {
    background: var(--blue-soft);
    color: var(--blue);
  }
  .failed {
    background: var(--red-soft);
    color: var(--red);
  }
  .link {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    min-height: 32px;
    padding: 0 var(--space-1);
    cursor: pointer;
  }
  .failed-list {
    list-style: none;
    margin: calc(-1 * var(--space-2)) 0 var(--space-3);
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .failed-list li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--separator);
  }
  .failed-list li:first-child {
    border-top: 0;
  }
  .failed-list div {
    flex: 1;
    display: grid;
    gap: 2px;
    min-width: 0;
    font-size: var(--text-sm);
  }
  .failed-list span {
    color: var(--text-2);
  }
  .failed-list .link {
    color: var(--accent-text);
    min-height: 44px;
  }
  .all {
    justify-content: flex-end;
  }
</style>
