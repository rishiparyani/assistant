<script lang="ts">
  import type { BookingView, GigListView } from "@assistant/shared";
  import { Button, SelectField, Sheet, TextArea, TextField, confirm, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";

  // Make a list (setlist, packing list, run of show…) or change one: name, which event,
  // tick boxes. A new list can start from pasted lines, one item per line.
  let {
    open = $bindable(false),
    gig,
    list = null,
    onsaved,
  }: {
    open?: boolean;
    gig: BookingView;
    list?: GigListView | null;
    onsaved: (g: BookingView) => void;
  } = $props();

  const uid = $props.id();
  const formId = `list-form-${uid}`;
  let title = $state("");
  let eventId = $state("");
  let checkable = $state(false);
  let paste = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    title = list?.title ?? "";
    eventId = list?.event_id ?? "";
    checkable = list?.checkable ?? false;
    paste = "";
  });

  const PASTE_HINT = ["One per line, e.g.", "Song A - G - 4 min", "Song B"].join("\n");
  const eventOptions = $derived([
    { value: "", label: "The whole gig" },
    ...gig.events.map((e, i) => ({ value: e.id, label: e.title ?? `Event ${i + 1}` })),
  ]);
  // "Song A - G - 4 min" or "Song A | key G": text, then the rest as detail.
  const lines = $derived(
    paste
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 300)
      .map((l) => {
        const m = /^(.+?)\s+(?:[|·]|-{1,2}|–)\s+(.+)$/.exec(l);
        return m ? { text: m[1]!.slice(0, 200), detail: m[2]!.slice(0, 200) } : { text: l.slice(0, 200) };
      }),
  );

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const saved = list
        ? await bookingsApi.updateList(gig.id, list.id, {
            title: title.trim(),
            event_id: eventId || null,
            checkable,
          })
        : await bookingsApi.createList(gig.id, {
            title: title.trim(),
            ...(eventId ? { event_id: eventId } : {}),
            checkable,
            items: lines,
          });
      toast.success(list ? "List saved" : "List made");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!list) return;
    const ok = await confirm({
      title: `Remove “${list.title}”?`,
      message: "It disappears for everyone on this gig.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    busy = true;
    try {
      const saved = await bookingsApi.removeList(gig.id, list.id);
      toast.success("List removed");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={list ? "Edit list" : "New list"}>
  <form id={formId} class="form" onsubmit={submit}>
    <TextField
      label="Name"
      id="{uid}-title"
      bind:value={title}
      required
      maxlength={80}
      placeholder="Set 1, Packing, Run of show"
    />
    {#if gig.events.length > 1}
      <SelectField label="For" id="{uid}-event" bind:value={eventId} options={eventOptions} />
    {/if}
    <label class="toggle">
      <span class="toggle-text"
        ><span>Tick boxes</span><span class="muted small">For things to tick off, like a packing list.</span
        ></span
      >
      <input type="checkbox" role="switch" bind:checked={checkable} />
    </label>
    {#if !list}
      <TextArea
        label="Items (optional)"
        id="{uid}-paste"
        bind:value={paste}
        rows={6}
        placeholder={PASTE_HINT}
        hint={lines.length
          ? `${lines.length} item${lines.length === 1 ? "" : "s"}`
          : "Paste or type a line per item. Add more later."}
      />
    {/if}
  </form>
  {#snippet footer()}
    {#if list}
      <Button variant="danger" onclick={remove} disabled={busy}>Remove</Button>
    {:else}
      <Button onclick={() => (open = false)}>Cancel</Button>
    {/if}
    <Button variant="primary" type="submit" form={formId} loading={busy}>{list ? "Save" : "Make list"}</Button
    >
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 44px;
  }
  .toggle-text {
    display: grid;
    gap: 2px;
  }
  .muted {
    color: var(--text-2);
  }
  .small {
    font-size: var(--text-sm);
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
