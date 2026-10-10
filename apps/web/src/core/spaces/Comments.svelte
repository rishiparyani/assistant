<script lang="ts">
  import { formatDateTimeIST, ulid, type CommentView } from "@assistant/shared";
  import Trash from "@lucide/svelte/icons/trash-2";
  import { Button, ListGroup, TextArea, confirm, toast } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";

  // A record's comments (design §11): the space's people and anyone it's shared with talk about
  // it here. Text people type is shown as text, never as markup.
  let {
    cacheKey,
    load,
    post,
    remove,
  }: {
    cacheKey: string;
    load: () => Promise<CommentView[]>;
    post: (id: string, body: string) => Promise<CommentView>;
    /** Leave out where deleting isn't offered. */
    remove?: (id: string) => Promise<unknown>;
  } = $props();

  const uid = $props.id();
  const q = createQuery<CommentView[]>(
    () => cacheKey,
    () => load(),
  );
  let body = $state("");
  let busy = $state(false);

  async function send(ev: SubmitEvent) {
    ev.preventDefault();
    const text = body.trim();
    if (!text) return;
    busy = true;
    try {
      await post(ulid(), text);
      body = "";
      await q.refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
  async function drop(c: CommentView) {
    if (!remove) return;
    const ok = await confirm({ title: "Delete this comment?", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try {
      await remove(c.id);
      await q.refresh();
    } catch (e) {
      toast.error(e);
    }
  }
</script>

<section class="comments" aria-labelledby="{uid}-h">
  <h2 id="{uid}-h">Comments</h2>
  {#if q.data?.length}
    <ListGroup>
      {#each q.data as c (c.id)}
        <div class="comment">
          <div class="meta">
            <strong>{c.mine ? "You" : c.author.name}</strong>
            <span>{formatDateTimeIST(c.created_at)}</span>
            {#if remove && c.can_delete}
              <button type="button" class="del" aria-label="Delete comment" onclick={() => drop(c)}
                ><Trash size={16} /></button
              >
            {/if}
          </div>
          <p>{c.body}</p>
        </div>
      {/each}
    </ListGroup>
  {:else if q.data}
    <p class="none">No comments yet.</p>
  {/if}
  <form class="new" onsubmit={send}>
    <TextArea label="Add a comment" id="{uid}-body" bind:value={body} rows={2} maxlength={4000} />
    <div><Button type="submit" loading={busy} disabled={!body.trim()}>Send</Button></div>
  </form>
</section>

<style>
  .comments {
    display: grid;
    gap: var(--space-3);
    max-width: var(--content-max);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .comment {
    padding: var(--space-3) var(--space-4);
  }
  .comment + .comment {
    border-top: 1px solid var(--separator);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-2);
  }
  .meta strong {
    color: var(--text);
  }
  .del {
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin-block: calc(-1 * var(--space-3));
    border: 0;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .comment p {
    margin: var(--space-1) 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .none {
    margin: 0;
    color: var(--text-2);
  }
  .new {
    display: grid;
    gap: var(--space-2);
  }
</style>
