<script lang="ts">
  import type { BookingView, GuestLinkView } from "@assistant/shared";
  import Copy from "@lucide/svelte/icons/copy";
  import Share from "@lucide/svelte/icons/share";
  import Link from "@lucide/svelte/icons/link";
  import { Button, Sheet, Spinner, confirm, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { guestListText } from "./guest-text.ts";

  // Share the guest list with the venue: a secret link that opens without signing in (and,
  // if allowed, lets door staff tick arrivals), or the list as text for WhatsApp (managers).
  let {
    open = $bindable(false),
    gig,
    onsaved,
  }: { open?: boolean; gig: BookingView; onsaved: (g: BookingView) => void } = $props();

  let link = $state<GuestLinkView | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    link = null;
    bookingsApi.guestLink(gig.id).then(
      (l) => (link = l),
      (e) => toast.error(e),
    );
  });

  async function run(fn: () => Promise<GuestLinkView>, done?: string) {
    busy = true;
    try {
      link = await fn();
      if (done) toast.success(done);
      onsaved(await bookingsApi.get(gig.id));
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Couldn't copy; select it and copy by hand");
    }
  }

  async function share() {
    if (!link?.url) return;
    try {
      await navigator.share({ title: `Guest list · ${gig.title}`, url: link.url });
    } catch {
      // cancelled
    }
  }

  async function reset() {
    const ok = await confirm({
      title: "Make a new link?",
      message: "The old link stops working. Send the new one to the venue.",
      confirmLabel: "New link",
    });
    if (ok) await run(() => bookingsApi.enableGuestLink(gig.id, { reset: true }), "New link made");
  }

  async function off() {
    const ok = await confirm({
      title: "Turn off the link?",
      message: "Anyone who has it can't open the guest list any more.",
      confirmLabel: "Turn off",
      destructive: true,
    });
    if (ok) await run(() => bookingsApi.disableGuestLink(gig.id), "Link turned off");
  }

  const canShare = typeof navigator !== "undefined" && "share" in navigator;
</script>

<Sheet bind:open title="Share with the venue">
  <div class="body">
    {#if link === null}
      <Spinner size={20} label="Loading…" />
    {:else if !link.enabled}
      <p>
        A private link for the venue: they see the names on the list, how many each brings, and whose guest
        they are. No fees, no phone numbers, no sign-in.
      </p>
      <Button
        variant="primary"
        loading={busy}
        onclick={() => run(() => bookingsApi.enableGuestLink(gig.id, { check_in: true }), "Link made")}
      >
        {#snippet icon()}<Link />{/snippet}
        Make a link
      </Button>
    {:else}
      <input
        class="url"
        readonly
        value={link.url}
        aria-label="Guest list link"
        onfocus={(e) => e.currentTarget.select()}
      />
      <div class="actions">
        <Button variant="primary" onclick={() => copy(link!.url!, "Link")}>
          {#snippet icon()}<Copy />{/snippet}
          Copy link
        </Button>
        {#if canShare}
          <Button onclick={share}>
            {#snippet icon()}<Share />{/snippet}
            Share…
          </Button>
        {/if}
      </div>
      <label class="toggle">
        <span class="toggle-text"
          ><span>Door staff can tick arrivals</span><span class="muted"
            >Otherwise the link only shows the list.</span
          ></span
        >
        <input
          type="checkbox"
          role="switch"
          checked={link.check_in}
          disabled={busy}
          onchange={(e) =>
            run(() => bookingsApi.enableGuestLink(gig.id, { check_in: e.currentTarget.checked }), "Saved")}
        />
      </label>
      <p class="muted">
        Anyone with the link can see the list. Make a new one if it goes to the wrong person.
      </p>
      <div class="actions">
        <Button size="sm" onclick={reset} disabled={busy}>New link</Button>
        <Button size="sm" variant="ghost" onclick={off} disabled={busy}>Turn off</Button>
      </div>
    {/if}
    <hr />
    <p class="muted">Or send the list as text (WhatsApp, email):</p>
    <Button onclick={() => copy(guestListText(gig), "Guest list")} disabled={!gig.guest_list.guests.length}>
      {#snippet icon()}<Copy />{/snippet}
      Copy the list as text
    </Button>
  </div>
</Sheet>

<style>
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    justify-items: start;
  }
  .body > p,
  .url,
  .toggle,
  hr {
    justify-self: stretch;
  }
  .url {
    width: 100%;
    min-width: 0;
    height: 44px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 16px;
    text-overflow: ellipsis;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .muted {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--separator);
    width: 100%;
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 52px;
    cursor: pointer;
  }
  .toggle-text {
    display: grid;
    gap: 2px;
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
