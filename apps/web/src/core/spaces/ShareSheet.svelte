<script lang="ts">
  import type {
    CollectionView,
    CreatedShare,
    Person,
    RecordView,
    SavedView,
    ShareAccess,
    ShareView,
  } from "@assistant/shared";
  import Copy from "@lucide/svelte/icons/copy";
  import Share from "@lucide/svelte/icons/share";
  import Link from "@lucide/svelte/icons/link";
  import Users from "@lucide/svelte/icons/users";
  import {
    ActionSheet,
    Button,
    ListGroup,
    ListRow,
    Segmented,
    Sheet,
    Spinner,
    confirm,
    toast,
  } from "../ui/index.ts";
  import RuleSheet from "./RuleSheet.svelte";
  import { filterLabel } from "./spaces-api.ts";
  import { savedCollections } from "./spaces-api.ts";
  import { sharesApi } from "./shares-api.ts";

  // Share (design §11) one record as a card (with the linked parts to include), a saved view
  // (live), or the collection as a form people fill in. View or edit, fields to hide; views and
  // forms can be link-only (no sign-in). Others see only what's shared.
  type Target = { kind: "card"; record: RecordView } | { kind: "view"; view: SavedView } | { kind: "form" };
  let {
    open = $bindable(false),
    collection,
    target,
  }: { open?: boolean; collection: CollectionView; target: Target } = $props();

  const title = $derived(
    target.kind === "card"
      ? target.record.title
      : target.kind === "view"
        ? target.view.name
        : collection.name,
  );
  const targetId = $derived(
    target.kind === "card" ? target.record.id : target.kind === "view" ? target.view.id : collection.id,
  );
  const sheetTitle = $derived(target.kind === "form" ? `Share “${title}” as a form` : `Share “${title}”`);

  let shares = $state<ShareView[] | null>(null);
  let made = $state<CreatedShare | null>(null);
  let making = $state(false);
  let busy = $state(false);

  // The new share's settings.
  let include = $state<string[]>([]);
  let access = $state<ShareAccess>("view");
  let hide = $state<string[]>([]);
  let linkOnly = $state(false);
  // People I already know (in something I shared): share with them without a link.
  let known = $state<Person[]>([]);
  let picked = $state<string[]>([]);
  let adding = $state<ShareView | null>(null);
  let addOpen = $state(false);

  // Parts to include: the record's link fields, and collections that link to it.
  const parts = $derived(
    target.kind !== "card"
      ? []
      : [
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
        ],
  );
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
    sharesApi.people().then(
      (p) => (known = p),
      () => (known = []),
    );
    try {
      shares = await sharesApi.list(targetId);
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
    hide = moneyOf(collection);
    linkOnly = false;
    picked = [];
    making = true;
  }

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const moneyOf = (c: CollectionView | undefined) =>
    c?.fields.filter((f) => f.type === "money").map((f) => f.name) ?? [];
  /** Including a part hides its money fields too, unless the owner shows them. */
  function togglePart(p: { ref: string; collectionId: string | null }) {
    const on = !include.includes(p.ref);
    include = toggle(include, p.ref);
    if (on) hide = [...new Set([...hide, ...moneyOf(all.find((c) => c.id === p.collectionId))])];
  }

  async function create() {
    busy = true;
    try {
      made = await sharesApi.create({
        ...(target.kind === "card"
          ? { record_id: target.record.id }
          : target.kind === "view"
            ? { view: target.view.id }
            : { form: collection.id }),
        include,
        access,
        public: target.kind !== "card" && linkOnly,
        hide_fields: hide.filter((h) => hideable.includes(h)),
      });
      making = false;
      shares = await sharesApi.list(targetId);
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }

  /** Shares with the people picked, no link (they find it under Shared with you). */
  async function shareWithPicked() {
    busy = true;
    try {
      const share = await sharesApi.shareWith({
        ...(target.kind === "card"
          ? { record_id: target.record.id }
          : target.kind === "view"
            ? { view: target.view.id }
            : { form: collection.id }),
        include,
        access,
        hide_fields: hide.filter((h) => hideable.includes(h)),
        people: picked,
      });
      making = false;
      shares = await sharesApi.list(targetId);
      toast.success(`Shared with ${share.people.map((p) => p.name).join(", ")}`);
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
  const notIn = (s: ShareView) => known.filter((k) => !s.people.some((p) => p.user_id === k.user_id));
  async function addPerson(s: ShareView, p: Person) {
    try {
      await sharesApi.addPeople(s.id, [p.user_id]);
      shares = await sharesApi.list(targetId);
      toast.success(`Shared with ${p.name}`);
    } catch (e) {
      toast.error(e);
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
      await navigator.share({ title, url });
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
      shares = await sharesApi.list(targetId);
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
      shares = await sharesApi.list(targetId);
    } catch (e) {
      toast.error(e);
    }
  }

  // Row rules on a shared list: for everyone ("*") or one person.
  let ruleFor = $state<{ share: ShareView; userId: string; who: string; rule: ShareView["rule_all"] } | null>(
    null,
  );
  let ruleOpen = $state(false);
  let personFor = $state<{ share: ShareView; person: ShareView["people"][number] } | null>(null);
  let personOpen = $state(false);
  function editRule(share: ShareView, userId: string, who: string, rule: ShareView["rule_all"]) {
    ruleFor = { share, userId, who, rule };
    ruleOpen = true;
  }
  async function saveRule(filters: Parameters<typeof sharesApi.setRule>[2]) {
    if (!ruleFor) return;
    await sharesApi.setRule(ruleFor.share.id, ruleFor.userId, filters);
    shares = await sharesApi.list(targetId);
  }
  const ruleText = (rule: ShareView["rule_all"]) => rule.map((f) => filterLabel(collection, f)).join(" · ");
</script>

<Sheet bind:open title={sheetTitle}>
  <div class="body">
    {#if made}
      <p>
        {made.share.public
          ? "Send this link. Anyone who has it can open it, without signing in."
          : "Send this link. People sign in once, then find it in Shared with you."}
      </p>
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
                onclick={() => togglePart(p)}>{p.label}</button
              >
            {/each}
          </div>
        </fieldset>
      {/if}
      {#if target.kind !== "card"}
        <label class="toggle">
          <span class="toggle-text"
            ><span>Anyone with the link</span><span class="muted"
              >{target.kind === "view"
                ? "No sign-in; they can only look."
                : "No sign-in; they fill it in and that's it."}</span
            ></span
          >
          <input type="checkbox" role="switch" bind:checked={linkOnly} />
        </label>
      {/if}
      {#if !(linkOnly && target.kind !== "card")}
        <div class="group">
          <span class="legend">They can</span>
          <Segmented
            label="Access"
            bind:value={access}
            options={target.kind === "form"
              ? [
                  { value: "view", label: "Fill in" },
                  { value: "edit", label: "Fill in and fix" },
                ]
              : [
                  { value: "view", label: "View" },
                  { value: "edit", label: "Edit" },
                ]}
          />
        </div>
      {/if}
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
      {#if known.length && !(linkOnly && target.kind !== "card")}
        <fieldset class="group">
          <legend>People you know</legend>
          <div class="chips">
            {#each known as k (k.user_id)}
              <button
                type="button"
                class="chip"
                class:on={picked.includes(k.user_id)}
                aria-pressed={picked.includes(k.user_id)}
                onclick={() => (picked = toggle(picked, k.user_id))}>{k.name}</button
              >
            {/each}
          </div>
        </fieldset>
      {/if}
      <div class="actions">
        {#if picked.length && !(linkOnly && target.kind !== "card")}
          <Button variant="primary" loading={busy} onclick={shareWithPicked}>
            {#snippet icon()}<Users />{/snippet}
            Share with {picked.length === 1 ? "1 person" : `${picked.length} people`}
          </Button>
        {:else}
          <Button variant="primary" loading={busy} onclick={create}>
            {#snippet icon()}<Link />{/snippet}
            Make a link
          </Button>
        {/if}
        {#if shares.length}<Button variant="ghost" onclick={() => (making = false)}>Cancel</Button>{/if}
      </div>
    {:else}
      {#each shares as s (s.id)}
        <ListGroup
          title="{s.public ? 'Anyone with the link' : s.access === 'edit' ? 'Can edit' : 'View only'}{s
            .include.length
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
          {#if s.kind === "view"}
            <ListRow
              title="Rows everyone sees"
              subtitle={s.rule_all.length ? ruleText(s.rule_all) : "Every row in the list"}
              onclick={() => editRule(s, "*", "everyone", s.rule_all)}
            />
          {/if}
          {#each s.people as p (p.user_id)}
            <ListRow
              title={p.name}
              subtitle={s.kind === "view" && p.rule.length ? `Sees only: ${ruleText(p.rule)}` : "Joined"}
              onclick={() => {
                personFor = { share: s, person: p };
                personOpen = true;
              }}
            />
          {:else}
            <ListRow title="No one has joined yet" chevron={false} />
          {/each}
        </ListGroup>
        <div class="actions">
          {#if !s.public && notIn(s).length}
            <Button
              size="sm"
              onclick={() => {
                adding = s;
                addOpen = true;
              }}>Add people</Button
            >
          {/if}
          <Button size="sm" onclick={() => reset(s)}>New link</Button>
          <Button size="sm" variant="ghost" onclick={() => revoke(s)}>Stop sharing</Button>
        </div>
      {/each}
      <Button onclick={startNew}>Share another way</Button>
    {/if}
  </div>
</Sheet>

{#if adding}
  <ActionSheet
    bind:open={addOpen}
    title="Add someone you know"
    actions={notIn(adding).map((p) => ({ label: p.name, onclick: () => addPerson(adding!, p) }))}
  />
{/if}
{#if ruleFor}
  <RuleSheet bind:open={ruleOpen} {collection} who={ruleFor.who} rule={ruleFor.rule} onsave={saveRule} />
{/if}
{#if personFor}
  <ActionSheet
    bind:open={personOpen}
    title={personFor.person.name}
    actions={[
      ...(personFor.share.kind === "view"
        ? [
            {
              label: "Limit their rows",
              onclick: () =>
                editRule(
                  personFor!.share,
                  personFor!.person.user_id,
                  personFor!.person.name,
                  personFor!.person.rule,
                ),
            },
          ]
        : []),
      {
        label: "Remove from this share",
        destructive: true,
        onclick: () => removePerson(personFor!.share, personFor!.person),
      },
    ]}
  />
{/if}

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
  .chip.on {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-text);
    font-weight: 600;
  }
</style>
