<script lang="ts">
  import Bell from "@lucide/svelte/icons/bell";
  import { Button, Card, Spinner, toast } from "../ui/index.ts";
  import { disablePush, enablePush, needsHomeScreen, pushStatus, pushSupported, testPush } from "../push.ts";

  // Notifications on this device: gig added, confirmed, changed, cancelled, and payments.
  type Status = Awaited<ReturnType<typeof pushStatus>>;
  let status = $state<Status | null>(null);
  let busy = $state(false);
  const supported = pushSupported();
  const homeScreenFirst = supported ? false : needsHomeScreen();

  if (supported)
    pushStatus().then(
      (s) => (status = s),
      () => (status = null),
    );

  async function run(fn: () => Promise<unknown>, done: string) {
    busy = true;
    try {
      await fn();
      status = await pushStatus();
      toast.success(done);
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<Card>
  <div class="head">
    <span class="icon"><Bell size={20} /></span>
    <div>
      <h2>Notifications</h2>
      <p>When you're added to a gig, it's confirmed, changed or cancelled, and when you're paid.</p>
    </div>
  </div>
  {#if !supported}
    <p class="help">
      {#if homeScreenFirst || needsHomeScreen()}
        On iPhone, notifications work in the app on your Home Screen: tap Share → Add to Home Screen, open it
        from there, then turn them on here.
      {:else}
        This browser can't show notifications.
      {/if}
    </p>
  {:else if status === null}
    <Spinner size={18} label="Loading…" />
  {:else if status.this_device}
    <p class="help">On for this device{status.devices > 1 ? ` and ${status.devices - 1} more` : ""}.</p>
    <div class="actions">
      <Button onclick={() => run(testPush, "Test sent")} disabled={busy}>Send a test</Button>
      <Button variant="ghost" onclick={() => run(disablePush, "Notifications off")} disabled={busy}
        >Turn off</Button
      >
    </div>
  {:else if status.permission === "denied"}
    <p class="help">
      Notifications are blocked for this app. Allow them in your phone's or browser's settings, then come
      back.
    </p>
  {:else}
    <Button variant="primary" loading={busy} onclick={() => run(enablePush, "Notifications on")}>
      Turn on for this device
    </Button>
  {/if}
</Card>

<style>
  .head {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    margin-bottom: var(--space-4);
  }
  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
  }
  .head p,
  .help {
    margin: 2px 0 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .help {
    margin: 0 0 var(--space-3);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
