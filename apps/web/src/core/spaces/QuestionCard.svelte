<script lang="ts">
  import type { QuestionView } from "@assistant/shared";
  import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question";
  import { Button, Skeleton, toast } from "../ui/index.ts";
  import { createQuery, publish } from "../query.svelte.ts";
  import { questionKey, questionsApi } from "./questions-api.ts";

  // A question I sent, in the chat (chat-first step 4): answers come in live, a bar per choice
  // and who said what; Close stops answers.
  let { id }: { id: string } = $props();
  const q = createQuery<QuestionView>(
    () => questionKey(id),
    () => questionsApi.get(id),
  );
  const answered = $derived(q.data?.people.filter((p) => p.answer !== null).length ?? 0);
  const total = $derived(q.data?.people.length ?? 0);
  const tally = $derived(
    q.data?.choices?.map((c) => ({
      choice: c,
      who: q.data!.people.filter((p) => p.answer === c).map((p) => p.name),
    })) ?? [],
  );
  let busy = $state(false);
  async function toggleClosed() {
    if (!q.data) return;
    busy = true;
    try {
      publish(questionKey(id), await questionsApi.close(id, !q.data.closed));
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<article class="card">
  <header>
    <span class="kind" aria-hidden="true"><MessageCircleQuestion size={18} /></span>
    <span class="head">
      <span class="title">{q.data?.text ?? "Question"}</span>
      <span class="sub"
        >{q.data ? `${answered} of ${total} answered${q.data.closed ? " · closed" : ""}` : "Loading"}</span
      >
    </span>
  </header>
  {#if !q.data}
    {#if q.error}<p class="sub">Can't load this question.</p>{:else}<Skeleton rows={2} label="Loading" />{/if}
  {:else}
    {#if tally.length}
      <ul class="tally">
        {#each tally as t (t.choice)}
          <li>
            <div class="row"><span>{t.choice}</span><span class="n">{t.who.length}</span></div>
            <div class="bar" aria-hidden="true">
              <span style:width="{total ? (t.who.length / total) * 100 : 0}%"></span>
            </div>
            {#if t.who.length}<div class="who">{t.who.join(", ")}</div>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    <ul class="people">
      {#each q.data.people.filter((p) => !q.data!.choices || p.answer === null) as p (p.user_id)}
        <li>
          <span>{p.name}</span>
          <span class:waiting={p.answer === null}>{p.answer ?? "Waiting"}</span>
        </li>
      {/each}
    </ul>
    <footer>
      <Button size="sm" variant="ghost" loading={busy} onclick={toggleClosed}>
        {q.data.closed ? "Open again" : "Close"}
      </Button>
    </footer>
  {/if}
</article>

<style>
  .card {
    --k: var(--kind-people);
    --k-soft: var(--kind-people-soft);
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .kind {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--k-soft);
    color: var(--k);
  }
  .head {
    display: grid;
    min-width: 0;
  }
  .title {
    font-weight: 600;
  }
  .sub {
    color: var(--text-3);
    font-size: var(--text-sm);
    margin: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
  }
  .n {
    color: var(--k);
  }
  .bar {
    height: 8px;
    border-radius: 99px;
    background: var(--k-soft);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--k);
    border-radius: 99px;
    transition: width var(--dur-slow) var(--ease-spring);
  }
  .who {
    color: var(--text-2);
    font-size: var(--text-sm);
    margin-top: 2px;
  }
  .people li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }
  .waiting {
    color: var(--text-3);
  }
  footer {
    display: flex;
    gap: var(--space-2);
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
  }
</style>
