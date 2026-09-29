<script lang="ts">
  import type { BookingView, GigListItemView, GigListView } from "@assistant/shared";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import { Button, Sheet, TextField, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";

  // Change one item of a list: its text and detail, its place (for anyone who'd rather
  // not drag), or remove it.
  let {
    open = $bindable(false),
    gig,
    list,
    item,
    onsaved,
  }: {
    open?: boolean;
    gig: BookingView;
    list: GigListView;
    item: GigListItemView;
    onsaved: (g: BookingView) => void;
  } = $props();

  const uid = $props.id();
  const formId = `item-form-${uid}`;
  let text = $state("");
  let detail = $state("");
  let busy = $state(false);

  // Fill the fields once per opening; a live refresh (or moving the item) mustn't wipe
  // what's being typed.
  let filledFor = "";
  $effect(() => {
    if (!open) {
      filledFor = "";
      return;
    }
    if (filledFor === item.id) return;
    filledFor = item.id;
    text = item.text;
    detail = item.detail ?? "";
  });

  const index = $derived(list.items.findIndex((i) => i.id === item.id));

  async function run(fn: () => Promise<BookingView>, done: string, close = true) {
    busy = true;
    try {
      const saved = await fn();
      toast.success(done);
      if (close) open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    void run(
      () =>
        bookingsApi.updateItem(gig.id, list.id, item.id, {
          text: text.trim(),
          detail: detail.trim() || null,
        }),
      "Saved",
    );
  }

  // Up: after the item two above (or the top); down: after the item below.
  const moveTo = (after: string | null, label: string) =>
    run(() => bookingsApi.moveItem(gig.id, list.id, item.id, after), label, false);
  const up = () => moveTo(index >= 2 ? list.items[index - 2]!.id : null, "Moved up");
  const down = () => moveTo(list.items[index + 1]!.id, "Moved down");
</script>

<Sheet bind:open title="Edit item">
  <form id={formId} class="form" onsubmit={submit}>
    <TextField label="Item" id="{uid}-text" bind:value={text} required maxlength={200} />
    <TextField
      label="Detail"
      id="{uid}-detail"
      bind:value={detail}
      maxlength={200}
      placeholder="Optional, e.g. key of G · 4 min"
    />
    <div class="move">
      <span class="muted">Place {index + 1} of {list.items.length}</span>
      <Button size="sm" onclick={up} disabled={busy || index <= 0}>
        {#snippet icon()}<ArrowUp />{/snippet}
        Up
      </Button>
      <Button size="sm" onclick={down} disabled={busy || index >= list.items.length - 1}>
        {#snippet icon()}<ArrowDown />{/snippet}
        Down
      </Button>
    </div>
  </form>
  {#snippet footer()}
    <Button
      variant="danger"
      disabled={busy}
      onclick={() => run(() => bookingsApi.removeItem(gig.id, list.id, item.id), "Item removed")}
      >Remove</Button
    >
    <Button variant="primary" type="submit" form={formId} loading={busy}>Save</Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .move {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .move .muted {
    flex: 1;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
</style>
