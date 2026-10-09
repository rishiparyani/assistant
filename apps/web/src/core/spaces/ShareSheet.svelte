<script lang="ts">
  import type { CollectionView, CreatedShare, RecordView, ShareAccess, ShareView } from "@assistant/shared";
  import Copy from "@lucide/svelte/icons/copy";
  import Share from "@lucide/svelte/icons/share";
  import Link from "@lucide/svelte/icons/link";
  import { Button, ListGroup, ListRow, Segmented, Sheet, Spinner, confirm, toast } from "../ui/index.ts";
  import { savedCollections } from "./spaces-api.ts";
  import { sharesApi } from "./shares-api.ts";

  // Share one record as a card (design §11): pick the linked parts to include, view or edit,
  // fields to hide; get a join link. Others sign in once and see only this card.
  let {
    open = $bindable(false),
    collection,
    record,
  }: { open?: boolean; collection: CollectionView; record: RecordView } = $props();

  let shares = $state<ShareView[] | null>(null);
  let made = $state<CreatedShare | null>(null);
  let making = $state(false);
  let busy = $state(false);

  // The new share's settings.
  let include = $state<string[]>([]);
  let access = $state<ShareAccess>("view");
  let hide = $state<string[]>([]);

  // Parts to include: the record's link fields, and collections that link to it.
  const parts = $derived([
    ...collection.fields
      .filter((f) => f.type === "link")
      .map((f) => ({ ref: f.id, label: f.name, collectionId: f.options.target ?? null })),
    ...collection.linked_from.map((l) => ({
      ref: l.field_id,
      label:
        collection.linked_from.filter((x) => x.collection_id === l.collection_id).length > 1
          ? `${l.collection} (${l.field})`
          : l.collection,
      collectionId: l.collection_id,
    })),
  ]);
  const all = $derived(savedCollections() ?? []);
  // Fields that may be hidden: in this collection and in the parts included (not titles, not links).
  const hideable = $derived.by(() => {
    const ids = new Set([
      collection.id,
      ...parts.filter((p) => include.includes(p.ref)).map((p) => p.collectionId),
    ]);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
    const out = new Map<string, string>();
    for (const c of [collection, ...all.filter((x) => x.id !== collection.id)])
      if (ids.has(c.id))
        for (const f of c.fields)
          if (f.id !== c.title_field_id && f.type !== "link") out.set(f.name.toLowerCase(), f.name);
    return [...out.values()];
  });

  $effect(() => {
    if (!open) return;
    made = null;
    making = false;
    shares = null;
    load();
  });

  async function load() {
    try {
      shares = await sharesApi.list(record.id);
      if (!shares.length) startNew();
    } catch (e) {
      toast.error(e);
      shares = [];
    }
  }

  function startNew() {
    include = [];
    access = "view";
    // Money stays private unless the owner chooses otherwise.
    hide = collection.fields.filter((f) => f.type === "money").map((f) => f.name);
    making = true;
  }

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  async function create() {
    busy = true;
    try {
      made = await sharesApi.create({
        record_id: record.id,
        include,
        access,
        hide_fields: hide.filter((h) => hideable.includes(h)),
      });
      making = false;
      shares = await sharesApi.list(record.id);
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy; select it and copy by hand");
    }
  }
  async function shareLink(url: string) {
    try {
      await navigator.share({ title: record.title, url });
    } catch {
      // cancelled
    }
  }
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  async function reset(s: ShareView) {
    const ok = await confirm({
      title: "Make a new link?",
      message: "The old link stops working. People who already joined keep their access.",
      confirmLabel: "New link",
    });
    if (!ok) return;
    try {
      made = await sharesApi.reset(s.id);
    } catch (e) {
      toast.error(e);
    }
  }
  async function revoke(s: ShareView) {
    const ok = await confirm({
      title: "Stop sharing?",
      message: "The link stops working and everyone in it loses access to this card.",
      confirmLabel: "Stop sharing",
      destructive: true,
    });
    if (!ok) return;
    try {
      await sharesApi.revoke(s.id);
      made = null;
      shares = await sharesApi.list(record.id);
      toast.success("Stopped sharing");
    } catch (e) {
      toast.error(e);
    }
  }
  async function removePerson(s: ShareView, p: ShareView["people"][number]) {
    const ok = await confirm({
      title: `Remove ${p.name}?`,
      message:
        "They lose access to this card. Anyone with the link can still join; make a new link if needed.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await sharesApi.removePerson(s.id, p.user_id);
      shares = await sharesApi.list(record.id);
    } catch (e) {
      toast.error(e);
    }
  }
</script>

<Sheet bind:open title="Share “{record.title}”">
  <div class="body">
    {#if made}
      <p>Send this link. People sign in once, then see this card in Shared with me.</p>
      <input
        class="url"
        readonly
        value={made.link}
        aria-label="Join link"
        onfocus={(e) => e.currentTarget.select()}
      />
      <div class="actions">
        <Button variant="primary" onclick={() => copy(made!.link)}>
          {#snippet icon()}<Copy />{/snippet}
          Copy link
        </Button>
        {#if canShare}
          <Button onclick={() => shareLink(made!.link)}>
            {#snippet icon()}<Share />{/snippet}
            Share…
          </Button>
        {/if}
      </div>
      <p class="muted">For safety the link shows only now. Lost it? Make a new one below.</p>
      <hr />
    {/if}

    {#if shares === null}
      <Spinner size={20} label="Loading…" />
    {:else if making}
      {#if parts.length}
        <fieldset class="group">
          <legend>Include</legend>
          <div class="chips">
            {#each parts as p (p.ref)}
              <button
                type="button"
                class="chip"
                class:on={include.includes(p.ref)}
                aria-pressed={include.includes(p.ref)}
                onclick={() => (include = toggle(include, p.ref))}>{p.label}</button
              >
            {/each}
          </div>
        </fieldset>
      {/if}
      <div class="group">
        <span class="legend">They can</span>
        <Segmented
          label="Access"
          bind:value={access}
          options={[
            { value: "view", label: "View" },
            { value: "edit", label: "Edit" },
          ]}
        />
      </div>
      {#if hideable.length}
        <fieldset class="group">
          <legend>Hide these fields</legend>
          <div class="chips">
            {#each hideable as h (h)}
              <button
                type="button"
                class="chip"
                class:on={hide.includes(h)}
                aria-pressed={hide.includes(h)}
                onclick={() => (hide = toggle(hide, h))}>{h}</button
              >
            {/each}
          </div>
        </fieldset>
      {/if}
      <div class="actions">
        <Button variant="primary" loading={busy} onclick={create}>
          {#snippet icon()}<Link />{/snippet}
          Make a link
        </Button>
        {#if shares.length}<Button variant="ghost" onclick={() => (making = false)}>Cancel</Button>{/if}
      </div>
    {:else}
      {#each shares as s (s.id)}
        <ListGroup
          title="{s.access === 'edit' ? 'Can edit' : 'View only'}{s.include.length
            ? ` · with ${s.include.map((i) => i.title).join(', ')}`
            : ''}"
        >
          {#if s.hidden_fields.length}
            <ListRow
              title="Hidden"
              subtitle={s.hidden_fields.map((f) => f.name).join(", ")}
              chevron={false}
            />
          {/if}
          {#each s.people as p (p.user_id)}
            <ListRow
              title={p.name}
              subtitle="Joined · tap to remove"
              onclick={() => removePerson(s, p)}
              chevron={false}
            />
          {:else}
            <ListRow title="No one has joined yet" chevron={false} />
          {/each}
        </ListGroup>
        <div class="actions">
          <Button size="sm" onclick={() => reset(s)}>New link</Button>
          <Button size="sm" variant="ghost" onclick={() => revoke(s)}>Stop sharing</Button>
        </div>
      {/each}
      <Button onclick={startNew}>Share another way</Button>
    {/if}
  </div>
</Sheet>

<style>
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
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
  p {
    margin: 0;
  }
  .muted {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--separator);
    width: 100%;
    margin: 0;
  }
  .group {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  legend,
  .legend {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
    padding: 0;
    margin-bottom: var(--space-2);
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
    font-size: var(--text-base);
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-text);
    font-weight: 600;
  }
</style>
