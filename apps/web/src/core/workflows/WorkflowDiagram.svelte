<script lang="ts">
  import type { WorkflowView } from "@assistant/shared";
  import Zap from "@lucide/svelte/icons/zap";
  import Filter from "@lucide/svelte/icons/filter";
  import Hourglass from "@lucide/svelte/icons/hourglass";
  import Bell from "@lucide/svelte/icons/bell";
  import PenLine from "@lucide/svelte/icons/pen-line";
  import Plus from "@lucide/svelte/icons/plus";
  import MessageCircleQuestionMark from "@lucide/svelte/icons/message-circle-question-mark";
  import Repeat2 from "@lucide/svelte/icons/repeat-2";
  import Sigma from "@lucide/svelte/icons/sigma";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import Split from "@lucide/svelte/icons/split";

  // A workflow as a diagram (chat-first step 5): one box per part, in order, each with its
  // plain words. Both come from the saved definition, so the picture is what runs.
  let { workflow }: { workflow: WorkflowView } = $props();

  type Step = {
    kind: "when" | "check" | "wait" | WorkflowView["then"][number]["do"];
    label: string;
    text: string;
  };
  const LABELS: Partial<Record<Step["kind"], string>> = {
    ask: "Ask and wait",
    repeat: "Go back",
    summary: "Add up",
    for_each: "For each",
    if: "If",
  };
  const steps = $derived.by((): Step[] => {
    const w = workflow;
    const words = [...w.words];
    const out: Step[] = [{ kind: "when", label: "When", text: words.shift() ?? "" }];
    for (let i = 0; i < w.check.length; i++)
      out.push({ kind: "check", label: "Check", text: words.shift() ?? "" });
    if (w.wait_minutes) out.push({ kind: "wait", label: "Wait", text: words.shift() ?? "" });
    for (const a of w.then)
      out.push({
        kind: a.do,
        label: LABELS[a.do] ?? "Then",
        text: words.shift() ?? "",
      });
    return out;
  });
</script>

<ol class="diagram" aria-label="How it works">
  {#each steps as s, i (i)}
    <li class="step {s.kind}">
      <span class="node" aria-hidden="true">
        {#if s.kind === "when"}<Zap size={16} />{:else if s.kind === "check"}<Filter
            size={16}
          />{:else if s.kind === "wait"}<Hourglass size={16} />{:else if s.kind === "notify"}<Bell
            size={16}
          />{:else if s.kind === "set"}<PenLine
            size={16}
          />{:else if s.kind === "ask"}<MessageCircleQuestionMark
            size={16}
          />{:else if s.kind === "repeat"}<Repeat2 size={16} />{:else if s.kind === "summary"}<Sigma
            size={16}
          />{:else if s.kind === "for_each"}<ListChecks size={16} />{:else if s.kind === "if"}<Split
            size={16}
          />{:else}<Plus size={16} />{/if}
      </span>
      <span class="body">
        <span class="label">{s.label}</span>
        <span class="text">{s.text}</span>
      </span>
    </li>
  {/each}
</ol>

<style>
  .diagram {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0;
  }
  .step {
    position: relative;
    display: flex;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
  }
  /* The line joining one box to the next. */
  .step:not(:last-child)::before {
    content: "";
    position: absolute;
    left: 15px;
    top: 32px;
    bottom: 0;
    width: 2px;
    background: var(--kind-flow-soft);
  }
  .node {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--kind-flow-soft);
    color: var(--kind-flow);
  }
  .step.when .node {
    background: var(--kind-flow);
    color: var(--text-on-accent);
  }
  .body {
    display: grid;
    min-width: 0;
    padding-top: 2px;
  }
  .label {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--kind-flow);
  }
  .text {
    overflow-wrap: anywhere;
  }
</style>
