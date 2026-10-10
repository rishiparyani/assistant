<script lang="ts">
  import { ulid, type Person, type QuestionView } from "@assistant/shared";
  import Send from "@lucide/svelte/icons/send";
  import { Button, Segmented, Sheet, Spinner, TextArea, toast } from "../ui/index.ts";
  import { connection } from "../offline.svelte.ts";
  import { sharesApi } from "./shares-api.ts";
  import { questionsApi } from "./questions-api.ts";

  // Ask people I know a question without the assistant (chat-first step 4): the text, how they
  // answer, and who. The card with the answers goes into the chat (`onasked`).
  let {
    open = $bindable(false),
    chatId,
    onasked,
  }: { open?: boolean; chatId: string; onasked: (q: QuestionView) => void } = $props();

  let text = $state("");
  let kind = $state<"yesno" | "maybe" | "free">("yesno");
  let picked = $state<string[]>([]);
  let known = $state<Person[] | null>(null);
  let busy = $state(false);
  // One id and key per ask: a retry after a dropped connection sends the same question once.
  let questionId = ulid();
  let askKey = crypto.randomUUID();

  $effect(() => {
    if (!open) return;
    text = "";
    picked = [];
    questionId = ulid();
    askKey = crypto.randomUUID();
    kind = "yesno";
    known = null;
    sharesApi.people().then(
      (p) => (known = p),
      (e) => {
        known = [];
        toast.error(e);
      },
    );
  });

  const toggle = (id: string) =>
    (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  async function ask() {
    if (!text.trim() || !picked.length) return;
    if (!connection.online) {
      toast.error("Asking people needs a connection.");
      return;
    }
    busy = true;
    try {
      const q = await questionsApi.ask(
        {
          id: questionId,
          text: text.trim(),
          ...(kind === "free" ? {} : { choices: kind === "yesno" ? ["Yes", "No"] : ["Yes", "No", "Maybe"] }),
          people: picked,
          chat_id: chatId,
        },
        askKey,
      );
      open = false;
      onasked(q);
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Ask people">
  <div class="body">
    <TextArea
      label="Question"
      bind:value={text}
      rows={2}
      maxlength={300}
      placeholder="Free on Saturday for the wedding?"
    />
    <div class="group">
      <span class="legend">They answer</span>
      <Segmented
        label="How they answer"
        bind:value={kind}
        options={[
          { value: "yesno", label: "Yes / No" },
          { value: "maybe", label: "Yes / No / Maybe" },
          { value: "free", label: "In words" },
        ]}
      />
    </div>
    <fieldset class="group">
      <legend>Who</legend>
      {#if known === null}
        <Spinner size={20} label="Loading…" />
      {:else if !known.length}
        <p class="muted">
          No one yet. Share something with them first (Share on a card gives a link); once they join, you can
          ask them here.
        </p>
      {:else}
        <div class="chips">
          {#each known as k (k.user_id)}
            <button
              type="button"
              class="chip"
              class:on={picked.includes(k.user_id)}
              aria-pressed={picked.includes(k.user_id)}
              onclick={() => toggle(k.user_id)}>{k.name}</button
            >
          {/each}
        </div>
      {/if}
    </fieldset>
    <Button variant="primary" loading={busy} disabled={!text.trim() || !picked.length} onclick={ask}>
      {#snippet icon()}<Send />{/snippet}
      Ask {picked.length === 1 ? "1 person" : picked.length ? `${picked.length} people` : ""}
    </Button>
  </div>
</Sheet>

<style>
  .body {
    display: grid;
    gap: var(--space-4);
  }
  .group {
    display: grid;
    gap: var(--space-2);
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .legend,
  legend {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
    padding: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    min-height: 44px;
    padding: 0 var(--space-4);
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .chip.on {
    background: var(--kind-people-soft);
    border-color: var(--kind-people);
    color: var(--kind-people);
    font-weight: 600;
  }
  .muted {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
</style>
