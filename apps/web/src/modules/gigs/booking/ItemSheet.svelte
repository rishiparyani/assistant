<script lang="ts">
  import type { BookingView, GigListItemView, GigListView } from "@assistant/shared";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import { Button, Sheet, TextField, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { breakLength } from "./list-breaks.ts";

  // Change one item of a list: its text and detail, its place (for anyone who'd rather
  // not drag), or remove it. A break (a divider: the interval between sets, a heading)
  // has a name and an optional length instead; with no `item` it adds a new break.
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
    item: GigListItemView | null;
    onsaved: (g: BookingView) => void;
  } = $props();

  const uid = $props.id();
  const formId = `item-form-${uid}`;
  let text = $state("");
  let detail = $state("");
  let minutes = $state("");
  let busy = $state(false);
  const isBreak = $derived(!item || item.kind === "break");
  const PRESETS = [10, 15, 20, 30];

  // Fill the fields once per opening; a live refresh (or moving the item) mustn't wipe
  // what's being typed.
  let filledFor = "";
  $effect(() => {
    if (!open) {
      filledFor = "";
      return;
    }
    const key = item?.id ?? "new";
    if (filledFor === key) return;
    filledFor = key;
    text = item?.text ?? "Break";
    detail = item?.detail ?? "";
    minutes = item?.minutes ? String(item.minutes) : "";
  });

  const index = $derived(item ? list.items.findIndex((i) => i.id === item.id) : -1);
  const length = $derived.by(() => {
    const n = Number(minutes);
    return minutes.trim() && Number.isInteger(n) && n > 0 && n <= 600 ? n : null;
  });

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
    if (!item) {
      void run(
        () =>
          bookingsApi.addItems(gig.id, list.id, [
            { kind: "break", text: text.trim(), detail: detail.trim() || undefined, minutes: length },
          ]),
        "Break added",
      );
      return;
    }
    void run(
      () =>
        bookingsApi.updateItem(gig.id, list.id, item.id, {
          text: text.trim(),
          detail: detail.trim() || null,
          ...(isBreak ? { minutes: length } : {}),
        }),
      "Saved",
    );
  }

  // Up: after the item two above (or the top); down: after the item below.
  const moveTo = (after: string | null, label: string) =>
    item && run(() => bookingsApi.moveItem(gig.id, list.id, item.id, after), label, false);
  const up = () => moveTo(index >= 2 ? list.items[index - 2]!.id : null, "Moved up");
  const down = () => moveTo(list.items[index + 1]!.id, "Moved down");
</script>

<Sheet bind:open title={!item ? "Add a break" : isBreak ? "Edit break" : "Edit item"}>
  <form id={formId} class="form" onsubmit={submit}>
    {#if isBreak}
      <TextField
        label="Name"
        id="{uid}-text"
        bind:value={text}
        required
        maxlength={200}
        hint="e.g. Break, Interval, Set 2, Cables"
      />
      <div class="length">
        <TextField
          label="How long (minutes)"
          id="{uid}-minutes"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength={3}
          bind:value={minutes}
          placeholder="Optional"
          error={minutes.trim() && !length ? "Whole minutes, 1 to 600" : undefined}
        />
        <div class="presets" role="group" aria-label="Quick lengths">
          {#each PRESETS as m (m)}
            <button
              type="button"
              class:on={length === m}
              aria-pressed={length === m}
              onclick={() => (minutes = length === m ? "" : String(m))}>{m} min</button
            >
          {/each}
        </div>
      </div>
      <TextField
        label="Note"
        id="{uid}-detail"
        bind:value={detail}
        maxlength={200}
        placeholder="Optional, e.g. food for the band"
      />
      {#if length}<p class="preview">Shows as “{breakLength(text.trim() || "Break", length)}”</p>{/if}
    {:else}
      <TextField label="Item" id="{uid}-text" bind:value={text} required maxlength={200} />
      <TextField
        label="Detail"
        id="{uid}-detail"
        bind:value={detail}
        maxlength={200}
        placeholder="Optional, e.g. key of G · 4 min"
      />
    {/if}
    {#if item}<div class="move">
        <span class="muted">Place {index + 1} of {list.items.length}</span>
        <Button size="sm" onclick={up} disabled={busy || index <= 0}>
          {#snippet icon()}<ArrowUp />{/snippet}
          Up
        </Button>
        <Button size="sm" onclick={down} disabled={busy || index >= list.items.length - 1}>
          {#snippet icon()}<ArrowDown />{/snippet}
          Down
        </Button>
      </div>{/if}
  </form>
  {#snippet footer()}
    {#if item}
      <Button
        variant="danger"
        disabled={busy}
        onclick={() =>
          run(
            () => bookingsApi.removeItem(gig.id, list.id, item.id),
            isBreak ? "Break removed" : "Item removed",
          )}>Remove</Button
      >
    {:else}
      <Button onclick={() => (open = false)}>Cancel</Button>
    {/if}
    <Button
      variant="primary"
      type="submit"
      form={formId}
      loading={busy}
      disabled={isBreak && !!minutes.trim() && !length}>{item ? "Save" : "Add break"}</Button
    >
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
  .length {
    display: grid;
    gap: var(--space-2);
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .presets button {
    min-height: 44px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .presets button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .preview {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .move .muted {
    flex: 1;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
</style>
