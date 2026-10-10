<script lang="ts">
  import type { SharedQuestionView } from "@assistant/shared";
  import Check from "@lucide/svelte/icons/check";
  import { Button, toast } from "../ui/index.ts";
  import { publish } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import { sharedCardKey } from "./shares-api.ts";
  import { questionsApi } from "./questions-api.ts";

  // Answering a question someone asked me: tap a choice, or write a short answer. I can
  // change it until they close it.
  let { view, compact = false }: { view: SharedQuestionView; compact?: boolean } = $props();
  let busy = $state<string | null>(null);
  let draft = $state("");

  async function answer(a: string) {
    const t = a.trim();
    if (!t || busy) return;
    if (!connection.online) {
      toast.error("Answering needs a connection.");
      return;
    }
    busy = t;
    try {
      publish(sharedCardKey(view.share.id), await questionsApi.answer(view.share.id, t));
      draft = "";
    } catch (e) {
      toast.error(e);
    } finally {
      busy = null;
    }
  }
</script>

<div class="answer" class:compact>
  {#if view.closed}
    <p class="note">{view.mine ? `Closed. You said: ${view.mine}` : "Closed: no more answers."}</p>
  {:else if view.choices}
    <div class="choices" role="group" aria-label="Your answer">
      {#each view.choices as c (c)}
        <button
          type="button"
          class="choice"
          class:on={view.mine === c}
          aria-pressed={view.mine === c}
          disabled={!!busy}
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void answer(c);
          }}
        >
          {#if view.mine === c}<Check size={16} />{/if}
          {c}
        </button>
      {/each}
    </div>
  {:else}
    {#if view.mine}<p class="note">You said: <strong>{view.mine}</strong></p>{/if}
    {#if !compact}
      <form
        class="free"
        onsubmit={(e) => {
          e.preventDefault();
          void answer(draft);
        }}
      >
        <input
          bind:value={draft}
          maxlength="300"
          placeholder={view.mine ? "Change your answer" : "Your answer"}
          aria-label="Your answer"
        />
        <Button type="submit" variant="primary" loading={!!busy} disabled={!draft.trim()}>Send</Button>
      </form>
    {:else}
      <a class="tap" href="/shared/{view.share.id}"
        >{view.mine ? "Change your answer" : "Write your answer"}</a
      >
    {/if}
  {/if}
</div>

<style>
  .answer {
    display: grid;
    gap: var(--space-2);
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 var(--space-4);
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease);
  }
  .choice.on {
    background: var(--kind-people-soft);
    border-color: var(--kind-people);
    color: var(--kind-people);
  }
  .choice:disabled {
    opacity: 0.7;
  }
  .free {
    display: flex;
    gap: var(--space-2);
  }
  .free input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0 var(--space-3);
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }
  .tap {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--kind-people);
    font-weight: 600;
    text-decoration: none;
  }
  .note {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
</style>
