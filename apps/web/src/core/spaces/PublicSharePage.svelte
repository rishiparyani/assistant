<script lang="ts">
  import { ulid, type SharedFormView, type SharedListView, type SharedRecord } from "@assistant/shared";
  import { Button, EmptyState, ListGroup, ListRow, Spinner, toast } from "../ui/index.ts";
  import Centered from "../shell/Centered.svelte";
  import SharedForm from "./SharedForm.svelte";
  import { sharesApi } from "./shares-api.ts";
  import { showValue } from "./spaces-api.ts";

  // /s#<token>: a view or form someone shared by link, no sign-in (design §11). The token stays
  // after # (browsers never send that part), and goes to the server only in the request body.
  const token = window.location.hash.slice(1);
  let opened = $state<SharedListView | SharedFormView | null>(null);
  let error = $state<string | null>(token ? null : "This link is incomplete. Ask for it again.");
  let sent = $state(0);
  let loadingMore = $state(false);

  $effect(() => {
    if (!token) return;
    sharesApi.openLink(token).then(
      (o) => (opened = o),
      (e: unknown) => (error = e instanceof Error ? e.message : "This link doesn't work."),
    );
  });

  const list = $derived(opened?.share.kind === "view" ? (opened as SharedListView) : null);
  const form = $derived(opened?.share.kind === "form" ? (opened as SharedFormView) : null);

  async function more() {
    if (!list?.next_cursor) return;
    loadingMore = true;
    try {
      const next = (await sharesApi.openLink(token, list.next_cursor)) as SharedListView;
      opened = { ...next, records: [...list.records, ...next.records] };
    } catch (e) {
      toast.error(e);
    } finally {
      loadingMore = false;
    }
  }
  async function send(values: Record<string, unknown>) {
    await sharesApi.submitLink(token, ulid(), values);
    sent++;
  }
  const summary = (r: SharedRecord) =>
    r.fields
      .filter((f) => !f.title)
      .map((f) => {
        const v = showValue(f, f.value);
        return v && (f.type === "number" || f.type === "boolean") ? `${f.name}: ${v}` : v;
      })
      .filter(Boolean)
      .slice(0, 3)
      .join(" · ");
</script>

<Centered>
  {#if error}
    <EmptyState title="Can't open this link" text={error} />
  {:else if !opened}
    <div class="wait"><Spinner size={22} label="Opening…" /></div>
  {:else}
    <header>
      <h1>{opened.share.title}</h1>
      <p class="muted">Shared by {opened.share.owner}</p>
    </header>
    {#if form}
      {#if form.description}<p>{form.description}</p>{/if}
      {#if sent}<p class="thanks" role="status">Thanks, that's sent. You can send another.</p>{/if}
      <SharedForm fields={form.fields} {send} sentLabel="Sent, thank you" />
    {:else if list}
      <ListGroup>
        {#each list.records as r (r.id)}
          <ListRow title={r.title} subtitle={summary(r) || undefined} chevron={false} />
        {:else}
          <ListRow title="Nothing here yet" chevron={false} />
        {/each}
      </ListGroup>
      {#if list.next_cursor}
        <Button onclick={more} loading={loadingMore}>Show more</Button>
      {/if}
    {/if}
  {/if}
</Centered>

<style>
  header {
    margin-bottom: var(--space-4);
  }
  h1 {
    margin: 0;
    font-size: var(--text-xl);
  }
  p {
    margin: 0 0 var(--space-4);
  }
  .muted {
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .thanks {
    color: var(--green);
    font-weight: 600;
  }
  .wait {
    display: flex;
    justify-content: center;
    padding: var(--space-10);
  }
</style>
