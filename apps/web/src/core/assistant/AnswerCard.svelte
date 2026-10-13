<script lang="ts">
  import type { LiveRef, QueryResult } from "@assistant/shared";
  import Sigma from "@lucide/svelte/icons/sigma";
  import { spacesApi } from "../spaces/spaces-api.ts";
  import { createQuery } from "../query.svelte.ts";

  // An answer in the chat (decision 2026-10-13 "Questions, not SQL"): the space works the
  // question out each time it shows; this only lays out the table it returns. Pinning it to
  // the home is on the phone app.
  let { live }: { live: Extract<LiveRef, { kind: "query" }> } = $props();
  const answer = createQuery<QueryResult>(
    () => `answer:${JSON.stringify(live)}`,
    () =>
      spacesApi.query({
        ...(live.space_id ? { space: live.space_id } : {}),
        ...live.query,
        title: live.title,
      }),
  );
  const right = (t: string) => t !== "text";
</script>

<article class="card">
  <header>
    <span class="kind" aria-hidden="true"><Sigma size={18} /></span>
    <span class="head">
      <span class="title">{answer.data?.title ?? live.title}</span>
      {#if answer.data}<span class="sub">{answer.data.words}</span>{/if}
    </span>
  </header>
  {#if answer.data}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            {#each answer.data.columns as c (c.name)}
              <th class:right={c.kind === "measure" && right(c.type)}>{c.name}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each answer.data.rows as r, i (i)}
            <tr>
              {#each r.shown as v, j (j)}
                <td
                  class:right={answer.data.columns[j]?.kind === "measure" &&
                    right(answer.data.columns[j]!.type)}>{v}</td
                >
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if !answer.data.rows.length}<p class="sub">Nothing matches yet.</p>{/if}
    {#if answer.data.more}<p class="sub">{answer.data.more} more</p>{/if}
  {:else if answer.error}
    <p class="sub">
      Couldn't work it out: {answer.error instanceof Error ? answer.error.message : String(answer.error)}
    </p>
  {:else}
    <p class="sub">Working it out…</p>
  {/if}
</article>

<style>
  .card {
    --k: var(--kind-money);
    --k-soft: var(--kind-money-soft);
    display: grid;
    gap: var(--space-3);
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
    flex: 1;
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
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  th {
    text-align: left;
    color: var(--text-3);
    font-weight: 600;
    padding: var(--space-1) var(--space-2) var(--space-1) 0;
    border-bottom: 1px solid var(--border);
  }
  td {
    padding: var(--space-2) var(--space-2) var(--space-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .right {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
