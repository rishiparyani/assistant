<script lang="ts">
  import type { CollectionView, FilterOp, RuleView } from "@assistant/shared";
  import Trash from "@lucide/svelte/icons/trash-2";
  import {
    Button,
    ListGroup,
    ListRow,
    Segmented,
    SelectField,
    Sheet,
    Spinner,
    TextField,
    confirm,
    toast,
  } from "../ui/index.ts";
  import { request } from "../api.ts";
  import { connection } from "../offline.svelte.ts";

  // A list's rules (chat-first step 6), by tapping: checks every record must meet,
  // "only one … per …", and the moves a status may make. The words come from the saved rule.
  let { open = $bindable(false), collection }: { open?: boolean; collection: CollectionView } = $props();
  const enc = encodeURIComponent;

  let rules = $state<RuleView[] | null>(null);
  let adding = $state(false);
  let busy = $state(false);
  let kind = $state<"check" | "unique" | "flow">("check");
  let checkField = $state("");
  let checkOp = $state<FilterOp>("gt");
  let checkValue = $state("");
  let uniq = $state<string[]>([]);
  let whenField = $state("");
  let whenValue = $state("");
  let flowField = $state("");
  let moves = $state<Record<string, string[]>>({});
  let message = $state("");

  const fields = $derived(collection.fields.filter((f) => !f.options.personal));
  const choiceFields = $derived(fields.filter((f) => f.type === "choice"));
  const flowChoices = $derived(choiceFields.find((f) => f.id === flowField)?.options.choices ?? []);

  async function load() {
    try {
      rules = await request<RuleView[]>("GET", `/api/collections/${enc(collection.id)}/rules`);
    } catch (e) {
      toast.error(e);
      rules = [];
    }
  }
  $effect(() => {
    if (!open) return;
    rules = null;
    adding = false;
    void load();
  });
  function startNew() {
    kind = "check";
    checkField = "";
    checkOp = "gt";
    checkValue = "";
    uniq = [];
    whenField = "";
    whenValue = "";
    flowField = choiceFields[0]?.id ?? "";
    moves = {};
    message = "";
    adding = true;
  }
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const canSave = $derived(
    kind === "check"
      ? !!checkField && (checkOp === "empty" || checkOp === "not_empty" || !!checkValue.trim())
      : kind === "unique"
        ? uniq.length > 0
        : !!flowField && Object.keys(moves).length > 0,
  );

  // online-only: rules are checked by the space on the server, against every record there.
  async function save() {
    if (!connection.online) {
      toast.error("Changing rules needs a connection.");
      return;
    }
    busy = true;
    try {
      const onlyIf = whenField ? [{ field: whenField, op: "eq", value: whenValue }] : [];
      const body =
        kind === "check"
          ? {
              kind,
              require: [
                {
                  field: checkField,
                  op: checkOp,
                  ...(checkOp === "empty" || checkOp === "not_empty" ? {} : { value: checkValue.trim() }),
                },
              ],
              only_if: onlyIf,
            }
          : kind === "unique"
            ? { kind, fields: uniq, only_if: onlyIf }
            : { kind, field: flowField, moves };
      await request<RuleView>("POST", `/api/collections/${enc(collection.id)}/rules`, {
        ...body,
        ...(message.trim() ? { message: message.trim() } : {}),
      });
      adding = false;
      await load();
      toast.success("Rule added");
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }

  // online-only: rules live in the space on the server.
  async function remove(r: RuleView) {
    const ok = await confirm({
      title: "Remove this rule?",
      message: r.words,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await request("DELETE", `/api/rules/${enc(r.id)}`);
      await load();
    } catch (e) {
      toast.error(e);
    }
  }
</script>

<Sheet bind:open title="Rules for {collection.name}">
  <div class="body">
    {#if rules === null}
      <Spinner size={20} label="Loading…" />
    {:else if !adding}
      <ListGroup footer="Rules are checked whenever a record is added or changed, by anyone.">
        {#each rules as r (r.id)}
          <ListRow title={r.words} subtitle={r.message ?? undefined} chevron={false}>
            {#snippet trailing()}
              <Button size="sm" variant="ghost" aria-label="Remove rule" onclick={() => remove(r)}>
                {#snippet icon()}<Trash />{/snippet}
              </Button>
            {/snippet}
          </ListRow>
        {:else}
          <ListRow title="No rules yet" chevron={false} />
        {/each}
      </ListGroup>
      <Button variant="primary" onclick={startNew}>Add a rule</Button>
    {:else}
      <Segmented
        label="Kind of rule"
        bind:value={kind}
        options={[
          { value: "check", label: "Must meet" },
          { value: "unique", label: "Only one" },
          { value: "flow", label: "Status moves" },
        ]}
      />
      {#if kind === "check"}
        <div class="row">
          <SelectField
            label="Field"
            id="rule-check-field"
            bind:value={checkField}
            options={[
              { value: "", label: "Pick one" },
              ...fields.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
          <SelectField
            label="Must be"
            id="rule-check-op"
            bind:value={checkOp}
            options={[
              { value: "gt", label: "more than" },
              { value: "gte", label: "at least" },
              { value: "lt", label: "less than" },
              { value: "eq", label: "exactly" },
              { value: "ne", label: "not" },
              { value: "not_empty", label: "filled in" },
            ]}
          />
          {#if checkOp !== "empty" && checkOp !== "not_empty"}
            <TextField label="Value" id="rule-check-value" bind:value={checkValue} />
          {/if}
        </div>
      {:else if kind === "unique"}
        <fieldset class="group">
          <legend>Only one record per</legend>
          <div class="chips">
            {#each fields.filter((f) => !["money", "long_text", "multi_choice"].includes(f.type)) as f (f.id)}
              <button
                type="button"
                class="chip"
                class:on={uniq.includes(f.id)}
                aria-pressed={uniq.includes(f.id)}
                onclick={() => (uniq = toggle(uniq, f.id))}>{f.name}</button
              >
            {/each}
          </div>
        </fieldset>
      {:else}
        <SelectField
          label="Status field"
          id="rule-flow-field"
          bind:value={flowField}
          options={[
            { value: "", label: "Pick one" },
            ...choiceFields.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        {#each flowChoices as from (from)}
          <fieldset class="group">
            <legend>From {from}, it can go to</legend>
            <div class="chips">
              {#each flowChoices.filter((c) => c !== from) as to (to)}
                <button
                  type="button"
                  class="chip"
                  class:on={moves[from]?.includes(to)}
                  aria-pressed={!!moves[from]?.includes(to)}
                  onclick={() => (moves = { ...moves, [from]: toggle(moves[from] ?? [], to) })}>{to}</button
                >
              {/each}
            </div>
          </fieldset>
        {/each}
      {/if}
      {#if kind !== "flow"}
        <div class="row">
          <SelectField
            label="Only when (optional)"
            id="rule-when-field"
            bind:value={whenField}
            options={[{ value: "", label: "Always" }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
          />
          {#if whenField}<TextField label="Is" id="rule-when-value" bind:value={whenValue} />{/if}
        </div>
      {/if}
      <TextField
        label="Message when it stops a change (optional)"
        id="rule-message"
        bind:value={message}
        maxlength={200}
      />
      <div class="actions">
        <Button variant="primary" loading={busy} disabled={!canSave} onclick={save}>Save rule</Button>
        <Button variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
      </div>
    {/if}
  </div>
</Sheet>

<style>
  .body {
    display: grid;
    gap: var(--space-4);
  }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--space-2);
  }
  .group {
    display: grid;
    gap: var(--space-2);
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  legend {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
    padding: 0;
    margin-bottom: var(--space-2);
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
    background: var(--kind-form-soft);
    border-color: var(--kind-form);
    color: var(--kind-form);
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
