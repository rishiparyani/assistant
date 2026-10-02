<script lang="ts">
  import type { BookingView, GigNoteView } from "@assistant/shared";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import { Avatar, Button, EmptyState, confirm, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { outbox } from "../../../core/outbox.svelte.ts";

  // Notes everyone on the gig can post (soundcheck times, what to bring, changes). They
  // appear for the others live. Authors edit their own; authors and managers remove.
  let {
    gig,
    onsaved,
    adding = false,
  }: {
    gig: BookingView;
    onsaved: (g: BookingView) => void;
    /** Opened from the gig page's Add menu: start with the note box ready. */
    adding?: boolean;
  } = $props();
  $effect(() => {
    if (adding) document.getElementById(`${uid}-draft`)?.focus();
  });

  const uid = $props.id();
  const canEdit = $derived(gig.can_edit_lists);
  const manager = $derived(gig.my_role === "manager");
  let draft = $state("");
  let posting = $state(false);
  let editing = $state<string | null>(null);
  let editText = $state("");
  let saving = $state(false);

  const ago = (iso: string) => {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    });
  };

  async function post(e?: SubmitEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    posting = true;
    draft = ""; // cleared at once; given back if the server says no
    try {
      onsaved(await bookingsApi.addNote(gig.id, body));
    } catch (err) {
      draft ||= body;
      toast.error(err);
    } finally {
      posting = false;
    }
  }

  // Ctrl/Cmd + Enter posts.
  const keys = (e: KeyboardEvent, then: () => void) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      then();
    }
  };

  function startEdit(n: GigNoteView) {
    editing = n.id;
    editText = n.body;
  }

  async function saveEdit(n: GigNoteView) {
    const body = editText.trim();
    if (!body) return;
    saving = true;
    try {
      onsaved(await bookingsApi.updateNote(gig.id, n.id, body));
      editing = null;
    } catch (err) {
      toast.error(err);
    } finally {
      saving = false;
    }
  }

  async function remove(n: GigNoteView) {
    const ok = await confirm({
      title: "Remove this note?",
      message: "It disappears for everyone on this gig.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      onsaved(await bookingsApi.removeNote(gig.id, n.id));
      toast.success("Note removed");
    } catch (err) {
      toast.error(err);
    }
  }
</script>

<div class="notes">
  {#if canEdit}
    <form class="composer" onsubmit={post}>
      <label class="sr" for="{uid}-draft">New note</label>
      <textarea
        id="{uid}-draft"
        rows="2"
        maxlength={2000}
        placeholder="Write a note for everyone on this gig"
        bind:value={draft}
        onkeydown={(e) => keys(e, () => void post())}></textarea>
      <div class="composer-bar">
        <span class="hint">Everyone on the gig sees it.</span>
        <Button size="sm" variant="primary" type="submit" loading={posting} disabled={!draft.trim()}
          >Post</Button
        >
      </div>
    </form>
  {/if}

  {#each gig.shared_notes as n (n.id)}
    <article class="note">
      <header>
        <Avatar name={n.author} size={32} />
        <div class="who">
          <span class="name">{n.is_mine ? `${n.author} (you)` : n.author}</span>
          <span class="when"
            ><time datetime={n.created_at}>{ago(n.created_at)}</time>{#if n.edited_at}<span class="edited"
                >· edited</span
              >{/if}{#if n.pending && outbox.showWaiting}<span class="edited pending">· waiting to sync</span
              >{/if}</span
          >
        </div>
        {#if editing !== n.id && ((n.is_mine && canEdit) || manager)}
          <div class="actions">
            {#if n.is_mine && canEdit}<button class="link" type="button" onclick={() => startEdit(n)}
                >Edit</button
              >{/if}
            <button class="link danger" type="button" onclick={() => remove(n)}>Remove</button>
          </div>
        {/if}
      </header>
      {#if editing === n.id}
        <textarea
          class="edit"
          rows="3"
          maxlength={2000}
          aria-label="Edit note"
          bind:value={editText}
          onkeydown={(e) => keys(e, () => void saveEdit(n))}></textarea>
        <div class="composer-bar">
          <span></span>
          <Button size="sm" onclick={() => (editing = null)}>Cancel</Button>
          <Button
            size="sm"
            variant="primary"
            loading={saving}
            disabled={!editText.trim()}
            onclick={() => saveEdit(n)}>Save</Button
          >
        </div>
      {:else}
        <p class="body">{n.body}</p>
      {/if}
    </article>
  {:else}
    <EmptyState
      title="No notes yet"
      text={canEdit
        ? "Soundcheck time, what to bring, last-minute changes: post it here and everyone on the gig sees it."
        : "Notes from the managers show up here."}
    >
      {#snippet icon()}<MessageSquare size={26} />{/snippet}
    </EmptyState>
  {/each}
</div>

<style>
  .notes {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
  }
  .composer,
  .note {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-3) var(--space-4);
    min-width: 0;
  }
  textarea {
    display: block;
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 16px;
    line-height: 1.45;
    resize: vertical;
    outline: none;
  }
  textarea.edit {
    margin-top: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .composer-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .composer-bar > :first-child {
    flex: 1;
  }
  .hint {
    font-size: var(--text-sm);
    color: var(--text-3);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .who {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .when {
    font-size: var(--text-sm);
    color: var(--text-3);
  }
  .edited {
    margin-left: 0.3em;
  }
  .pending {
    color: var(--amber);
  }
  .actions {
    display: flex;
    gap: var(--space-3);
  }
  .body {
    margin-top: var(--space-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.45;
  }
  .link {
    border: 0;
    background: transparent;
    padding: 0;
    min-height: 44px;
    color: var(--accent-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .link.danger {
    color: var(--red);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
