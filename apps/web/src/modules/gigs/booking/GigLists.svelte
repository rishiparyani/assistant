<script lang="ts">
  import type { BookingView, GigListItemView, GigListView } from "@assistant/shared";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import Plus from "@lucide/svelte/icons/plus";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Music from "@lucide/svelte/icons/music";
  import Play from "@lucide/svelte/icons/play";
  import type { SongSummary } from "@assistant/shared";
  import { Button, EmptyState, toast } from "../../../core/ui/index.ts";
  import { navigate } from "../../../core/router.svelte.ts";
  import {
    SongPicker,
    StageView,
    musicApi,
    savedSong,
    songFacts,
    type StageSong,
  } from "../../music/index.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import { outbox } from "../../../core/outbox.svelte.ts";
  import ListSheet from "./ListSheet.svelte";
  import ItemSheet from "./ItemSheet.svelte";

  // A gig's lists (setlists, packing, run of show): everyone on the gig sees them live and,
  // unless a manager turned it off, changes them. Drag the handle to reorder (or use the
  // arrow keys on it, or Up/Down in the item's sheet).
  let { gig, onsaved }: { gig: BookingView; onsaved: (g: BookingView) => void } = $props();

  const canEdit = $derived(gig.can_edit_lists);
  let listOpen = $state(false);
  let listFor = $state<GigListView | null>(null);
  let itemOpen = $state(false);
  let itemFor = $state<{ list: GigListView; item: GigListItemView } | null>(null);
  let drafts = $state<Record<string, string>>({});

  // While a move is on its way, show the new order at once.
  let pending = $state<Record<string, string[]>>({});
  const itemsOf = (l: GigListView): GigListItemView[] => {
    const ids = pending[l.id];
    if (!ids) return l.items;
    const byId = new Map(l.items.map((i) => [i.id, i]));
    return ids.map((id) => byId.get(id)).filter((i): i is GigListItemView => !!i);
  };

  const eventName = (id: string | null) => {
    if (!id || gig.events.length < 2) return null;
    const i = gig.events.findIndex((e) => e.id === id);
    return i < 0 ? null : (gig.events[i]!.title ?? `Event ${i + 1}`);
  };

  async function run(fn: () => Promise<BookingView>) {
    try {
      onsaved(await fn());
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }

  async function addItem(l: GigListView, e: SubmitEvent) {
    e.preventDefault();
    const text = (drafts[l.id] ?? "").trim();
    if (!text) return;
    // Cleared at once so the next one can be typed; given back if the server says no.
    drafts[l.id] = "";
    if (!(await run(() => bookingsApi.addItems(gig.id, l.id, [{ text }])))) drafts[l.id] ||= text;
  }

  // --- Songs (music module): add from my library; play the list in stage mode ---------
  let pickFor = $state<GigListView | null>(null);
  let picking = $state(false);
  function pickSongs(l: GigListView) {
    pickFor = l;
    picking = true;
  }
  const addSongs = (songs: SongSummary[]) =>
    pickFor &&
    run(() =>
      bookingsApi.addItems(
        gig.id,
        pickFor!.id,
        songs.map((s) => ({ text: s.title, detail: songFacts(s) || undefined, song_id: s.id })),
      ),
    );

  let stage = $state<StageSong[] | null>(null);
  /** The list's songs with their charts (from the saved library when offline). */
  async function play(l: GigListView) {
    const out: StageSong[] = [];
    for (const item of itemsOf(l).filter((i) => i.song_id)) {
      const song = await musicApi.song(item.song_id!).catch(() => savedSong(item.song_id!));
      out.push(song ?? { title: item.text, key: null, tempo_bpm: null, chart: null });
    }
    if (out.length) stage = out;
  }

  const toggle = (l: GigListView, i: GigListItemView) =>
    run(() => bookingsApi.updateItem(gig.id, l.id, i.id, { done: !i.done }));

  async function move(l: GigListView, ids: string[], itemId: string) {
    const at = ids.indexOf(itemId);
    pending[l.id] = ids;
    await run(() => bookingsApi.moveItem(gig.id, l.id, itemId, at > 0 ? ids[at - 1]! : null));
    delete pending[l.id];
  }

  // --- Drag to reorder (pointer events: works with touch, pen and mouse) ---------------
  let drag = $state<{
    listId: string;
    itemId: string;
    from: number;
    to: number;
    dy: number;
    height: number;
  } | null>(null);
  let startY = 0;
  let mids: number[] = [];

  function startDrag(e: PointerEvent, l: GigListView, item: GigListItemView) {
    if (!canEdit || e.button > 0) return;
    const handle = e.currentTarget as HTMLElement;
    const rows = [...(handle.closest(".items")?.querySelectorAll<HTMLElement>(".item") ?? [])];
    const from = rows.findIndex((r) => r.dataset.id === item.id);
    if (from < 0) return;
    e.preventDefault();
    try {
      handle.setPointerCapture(e.pointerId); // keep getting moves when the finger leaves the handle
    } catch {
      // not a live pointer (some synthetic events); moves still arrive on the handle
    }
    const rects = rows.map((r) => r.getBoundingClientRect());
    mids = rects.map((r) => r.top + r.height / 2);
    startY = e.clientY;
    drag = { listId: l.id, itemId: item.id, from, to: from, dy: 0, height: rects[from]!.height };
  }

  function moveDrag(e: PointerEvent) {
    if (!drag) return;
    const dy = e.clientY - startY;
    const centre = mids[drag.from]! + dy;
    let to = drag.from;
    while (to < mids.length - 1 && centre > mids[to + 1]!) to++;
    while (to > 0 && centre < mids[to - 1]!) to--;
    drag = { ...drag, dy, to };
  }

  async function endDrag(l: GigListView) {
    if (!drag) return;
    const { from, to, itemId } = drag;
    drag = null;
    if (from === to) return;
    const ids = itemsOf(l).map((i) => i.id);
    ids.splice(to, 0, ...ids.splice(from, 1));
    await move(l, ids, itemId);
  }

  /** How far a row slides to make room for the one being dragged. */
  function shift(listId: string, index: number): number {
    if (!drag || drag.listId !== listId) return 0;
    if (index === drag.from) return drag.dy;
    if (drag.from < index && index <= drag.to) return -drag.height;
    if (drag.to <= index && index < drag.from) return drag.height;
    return 0;
  }

  function keyMove(e: KeyboardEvent, l: GigListView, item: GigListItemView) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const ids = itemsOf(l).map((i) => i.id);
    const from = ids.indexOf(item.id);
    const to = e.key === "ArrowUp" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    void move(l, ids, item.id);
  }

  const openList = (l: GigListView | null) => ((listFor = l), (listOpen = true));
  const openItem = (list: GigListView, item: GigListItemView) => {
    if (!canEdit) return;
    itemFor = { list, item };
    itemOpen = true;
  };
</script>

{#if gig.lists.length === 0}
  <EmptyState
    title="No lists yet"
    text={canEdit
      ? "Setlists, packing lists, run of show: everyone on the gig sees them and can change them."
      : "The managers haven't made any lists for this gig."}
  >
    {#snippet icon()}<ListPlus size={26} />{/snippet}
    {#snippet action()}
      {#if canEdit}<Button variant="primary" onclick={() => openList(null)}>New list</Button>{/if}
    {/snippet}
  </EmptyState>
{:else}
  <div class="lists">
    {#each gig.lists as l (l.id)}
      {@const items = itemsOf(l)}
      <section class="list" aria-label={l.title}>
        <header>
          <div class="titles">
            <h2>{l.title}</h2>
            <p>
              {[
                eventName(l.event_id),
                l.checkable
                  ? `${items.filter((i) => i.done).length} of ${items.length} done`
                  : `${items.length} ${items.length === 1 ? "item" : "items"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {#if items.some((i) => i.song_id)}
            <button
              class="icon-btn"
              type="button"
              aria-label="Play {l.title} in stage mode"
              onclick={() => play(l)}
            >
              <Play size={20} />
            </button>
          {/if}
          {#if canEdit}
            <button
              class="icon-btn"
              type="button"
              aria-label="Edit list {l.title}"
              onclick={() => openList(l)}
            >
              <Ellipsis size={20} />
            </button>
          {/if}
        </header>
        <ol class="items">
          {#each items as item, i (item.id)}
            <li
              class="item"
              class:dragging={drag?.itemId === item.id}
              class:settling={!!drag && drag.itemId !== item.id}
              data-id={item.id}
              style:transform={shift(l.id, i) ? `translateY(${shift(l.id, i)}px)` : undefined}
            >
              {#if canEdit}
                <button
                  class="grip"
                  type="button"
                  aria-label="Move {item.text} (drag, or use the arrow keys)"
                  onpointerdown={(e) => startDrag(e, l, item)}
                  onpointermove={moveDrag}
                  onpointerup={() => endDrag(l)}
                  onpointercancel={() => (drag = null)}
                  onkeydown={(e) => keyMove(e, l, item)}
                >
                  <GripVertical size={18} />
                </button>
              {/if}
              {#if l.checkable}
                <input
                  class="tick"
                  type="checkbox"
                  checked={item.done}
                  disabled={!canEdit}
                  aria-label="Done: {item.text}"
                  onchange={() => toggle(l, item)}
                />
              {:else}
                <span class="n num" aria-hidden="true">{i + 1}</span>
              {/if}
              <button
                class="body"
                type="button"
                disabled={!canEdit}
                onclick={() => openItem(l, item)}
                aria-label={canEdit ? `Edit ${item.text}` : undefined}
              >
                <span class="text" class:done={item.done}
                  >{#if item.song_id}<Music
                      size={14}
                      class="song-mark"
                      aria-hidden="true"
                    />{/if}{item.text}</span
                >
                {#if item.detail || (item.done && item.done_by) || (item.pending && outbox.showWaiting)}
                  <span class="detail"
                    >{[
                      item.detail,
                      item.done && item.done_by ? `ticked by ${item.done_by}` : null,
                      item.pending && outbox.showWaiting ? "waiting to sync" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}</span
                  >
                {/if}
              </button>
              {#if item.song_id}
                <button
                  class="icon-btn"
                  type="button"
                  aria-label="Open the song {item.text}"
                  onclick={() => navigate(`/songs/${item.song_id}`)}
                >
                  <Music size={18} />
                </button>
              {/if}
            </li>
          {/each}
        </ol>
        {#if canEdit}
          <form class="add" onsubmit={(e) => addItem(l, e)}>
            <Plus size={18} />
            <input
              type="text"
              placeholder="Add an item"
              aria-label="Add an item to {l.title}"
              maxlength={200}
              bind:value={drafts[l.id]}
            />
            {#if (drafts[l.id] ?? "").trim()}
              <button class="link" type="submit">Add</button>
            {:else}
              <button class="link" type="button" onclick={() => pickSongs(l)}>Add songs</button>
            {/if}
          </form>
        {/if}
      </section>
    {/each}
    {#if canEdit}
      <Button onclick={() => openList(null)}>
        {#snippet icon()}<ListPlus />{/snippet}
        New list
      </Button>
    {/if}
  </div>
{/if}

<ListSheet bind:open={listOpen} {gig} list={listFor} {onsaved} />
<SongPicker bind:open={picking} title="Add songs to {pickFor?.title ?? 'the list'}" onpick={addSongs} />
{#if stage}
  <StageView songs={stage} onclose={() => (stage = null)} />
{/if}
{#if itemFor}
  <ItemSheet
    bind:open={itemOpen}
    {gig}
    list={gig.lists.find((l) => l.id === itemFor!.list.id) ?? itemFor.list}
    item={gig.lists.find((l) => l.id === itemFor!.list.id)?.items.find((i) => i.id === itemFor!.item.id) ??
      itemFor.item}
    {onsaved}
  />
{/if}

<style>
  .lists {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    justify-items: stretch;
  }
  .lists > :global(.btn) {
    justify-self: start;
  }
  .list {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-2) var(--space-2) var(--space-4);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
    font-size: var(--text-md);
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  header p {
    margin-top: 2px;
    font-size: var(--text-sm);
    color: var(--text-2);
  }
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    flex: none;
  }
  .icon-btn:hover {
    background: var(--surface-hover);
  }
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 52px;
    padding: 0 var(--space-2);
    border-top: 1px solid var(--separator);
    background: var(--surface);
  }
  .item.settling {
    transition: transform 0.15s ease;
  }
  .item.dragging {
    z-index: 2;
    box-shadow: var(--shadow-lg);
    border-radius: var(--radius);
    border-top-color: transparent;
  }
  .grip {
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
    flex: none;
  }
  .item.dragging .grip {
    cursor: grabbing;
    color: var(--accent);
  }
  .n {
    width: 24px;
    text-align: right;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-3);
    flex: none;
  }
  .tick {
    width: 22px;
    height: 22px;
    margin: 0 1px;
    accent-color: var(--green);
    flex: none;
    cursor: pointer;
  }
  .body {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    display: grid;
    align-content: center;
    gap: 2px;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-2);
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .body:disabled {
    cursor: default;
    opacity: 1;
  }
  .text {
    overflow-wrap: anywhere;
  }
  .text :global(.song-mark) {
    margin-right: 6px;
    vertical-align: -1px;
    color: var(--accent-text);
  }
  .text.done {
    text-decoration: line-through;
    color: var(--text-3);
  }
  .detail {
    font-size: var(--text-sm);
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .add {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 52px;
    padding: 0 var(--space-4);
    border-top: 1px solid var(--separator);
    color: var(--accent-text);
  }
  .add input {
    flex: 1;
    min-width: 0;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 16px;
    outline: none;
  }
  .add input::placeholder {
    color: var(--accent-text);
  }
  .link {
    border: 0;
    background: transparent;
    color: var(--accent-text);
    font: inherit;
    font-weight: 600;
    min-height: 44px;
    cursor: pointer;
  }
</style>
