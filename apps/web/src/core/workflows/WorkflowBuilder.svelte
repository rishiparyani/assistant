<script lang="ts">
  import { untrack } from "svelte";
  import type { CollectionView, FilterOp, WorkflowView } from "@assistant/shared";
  import { Button, Segmented, SelectField, Sheet, TextField, toast } from "../ui/index.ts";
  import { createQuery } from "../query.svelte.ts";
  import { connection } from "../offline.svelte.ts";
  import { COLLECTIONS_KEY, spacesApi } from "../spaces/spaces-api.ts";
  import { workflowsApi } from "./workflows-api.ts";

  // Making a workflow by tapping, without the assistant (chat-first step 5): when, an
  // optional check, an optional wait, then tell me (or set a field). The person makes it, so
  // it's saved on; the card shows the same diagram and words the assistant's would.
  let { open = $bindable(false), onmade }: { open?: boolean; onmade: (w: WorkflowView) => void } = $props();

  const collections = createQuery<CollectionView[]>(() => COLLECTIONS_KEY, spacesApi.collections);

  let name = $state("");
  let event = $state<"added" | "changed" | "date">("added");
  let collectionId = $state("");
  let field = $state("");
  let offsetAmount = $state("0");
  let offsetUnit = $state<"minutes" | "hours" | "days">("hours");
  let offsetDir = $state<"before" | "after">("before");
  let checkField = $state("");
  let checkOp = $state<FilterOp>("eq");
  let checkValue = $state("");
  let waitAmount = $state("0");
  let waitUnit = $state<"minutes" | "hours" | "days">("hours");
  let action = $state<"notify" | "set">("notify");
  let text = $state("");
  let setField = $state("");
  let setValue = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    name = "";
    event = "added";
    // Read without tracking: a background refresh of the lists mustn't wipe the form.
    collectionId = untrack(() => collections.data?.[0]?.id ?? "");
    field = "";
    offsetAmount = "0";
    checkField = "";
    checkValue = "";
    waitAmount = "0";
    action = "notify";
    text = "";
    setField = "";
    setValue = "";
  });

  // Lists that arrive after the sheet opened: start on the first one.
  $effect(() => {
    if (open && !collectionId && collections.data?.length) collectionId = collections.data[0]!.id;
  });

  const collection = $derived(collections.data?.find((c) => c.id === collectionId));
  const fields = $derived(collection?.fields.filter((f) => f.type !== "link") ?? []);
  const dateFields = $derived(fields.filter((f) => f.type === "date" || f.type === "datetime"));
  const UNIT = { minutes: 1, hours: 60, days: 1440 } as const;
  const minutes = (amount: string, unit: keyof typeof UNIT) =>
    Math.max(0, Math.round(Number(amount) || 0)) * UNIT[unit];
  const canSave = $derived(
    !!name.trim() &&
      !!collection &&
      (event !== "date" || !!field) &&
      (action === "notify" ? !!text.trim() : !!setField && !!setValue.trim()),
  );

  async function save() {
    if (!canSave || !collection) return;
    if (!connection.online) {
      toast.error("Making a workflow needs a connection.");
      return;
    }
    busy = true;
    try {
      const off = minutes(offsetAmount, offsetUnit);
      const made = await workflowsApi.create({
        name: name.trim(),
        when: {
          event,
          collection: collection.id,
          ...(event !== "added" && field ? { field } : {}),
          offset_minutes: event === "date" ? (offsetDir === "before" ? -off : off) : 0,
        },
        check: checkField
          ? [{ field: checkField, op: checkOp, ...(checkOp === "empty" ? {} : { value: checkValue }) }]
          : [],
        wait_minutes: minutes(waitAmount, waitUnit),
        then:
          action === "notify"
            ? [{ do: "notify", text: text.trim(), to: ["me"] }]
            : [{ do: "set", field: setField, value: setValue.trim() }],
        enabled: true,
      });
      open = false;
      onmade(made);
    } catch (e) {
      toast.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="New workflow">
  <div class="body">
    <TextField label="Name" id="wf-name-1" bind:value={name} maxlength={80} placeholder="Big expenses" />

    <fieldset class="group">
      <legend>When</legend>
      <Segmented
        label="When"
        bind:value={event}
        options={[
          { value: "added", label: "Added" },
          { value: "changed", label: "Changed" },
          { value: "date", label: "A date" },
        ]}
      />
      <SelectField
        label="List"
        id="wf-list-1"
        bind:value={collectionId}
        options={(collections.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
      />
      {#if event === "changed"}
        <SelectField
          label="Which field"
          id="wf-which-field-1"
          bind:value={field}
          options={[
            { value: "", label: "Any change" },
            ...fields.filter((f) => !f.options.personal).map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      {:else if event === "date"}
        <SelectField
          label="Date field"
          id="wf-date-field-1"
          bind:value={field}
          options={[
            { value: "", label: "Pick one" },
            ...dateFields.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        <div class="row">
          <TextField
            label="How long"
            id="wf-how-long-1"
            type="number"
            inputmode="numeric"
            min="0"
            bind:value={offsetAmount}
          />
          <SelectField
            label="Unit"
            id="wf-unit-1"
            bind:value={offsetUnit}
            options={[
              { value: "minutes", label: "minutes" },
              { value: "hours", label: "hours" },
              { value: "days", label: "days" },
            ]}
          />
          <SelectField
            label="Before or after"
            id="wf-before-or-after-1"
            bind:value={offsetDir}
            options={[
              { value: "before", label: "before" },
              { value: "after", label: "after" },
            ]}
          />
        </div>
      {/if}
    </fieldset>

    <fieldset class="group">
      <legend>Only if (optional)</legend>
      <SelectField
        label="Field"
        id="wf-field-1"
        bind:value={checkField}
        options={[{ value: "", label: "Always" }, ...fields.map((f) => ({ value: f.id, label: f.name }))]}
      />
      {#if checkField}
        <div class="row">
          <SelectField
            label="Is"
            id="wf-is-1"
            bind:value={checkOp}
            options={[
              { value: "eq", label: "is" },
              { value: "ne", label: "isn't" },
              { value: "gt", label: "more than" },
              { value: "lt", label: "less than" },
              { value: "empty", label: "empty" },
            ]}
          />
          {#if checkOp !== "empty"}<TextField label="Value" id="wf-value-1" bind:value={checkValue} />{/if}
        </div>
      {/if}
    </fieldset>

    <fieldset class="group">
      <legend>Wait (optional)</legend>
      <div class="row">
        <TextField
          label="How long"
          id="wf-how-long-2"
          type="number"
          inputmode="numeric"
          min="0"
          bind:value={waitAmount}
        />
        <SelectField
          label="Unit"
          id="wf-unit-2"
          bind:value={waitUnit}
          options={[
            { value: "minutes", label: "minutes" },
            { value: "hours", label: "hours" },
            { value: "days", label: "days" },
          ]}
        />
      </div>
    </fieldset>

    <fieldset class="group">
      <legend>Then</legend>
      <Segmented
        label="Then"
        bind:value={action}
        options={[
          { value: "notify", label: "Tell me" },
          { value: "set", label: "Set a field" },
        ]}
      />
      {#if action === "notify"}
        <TextField
          label="Message"
          id="wf-message-1"
          bind:value={text}
          maxlength={200}
          placeholder="Big expense: {'{Amount}'} on {'{What}'}"
          hint="{'{Field}'} puts in the record's value"
        />
      {:else}
        <div class="row">
          <SelectField
            label="Field"
            id="wf-field-2"
            bind:value={setField}
            options={[
              { value: "", label: "Pick one" },
              ...fields.filter((f) => !f.options.personal).map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
          <TextField label="To" id="wf-to-1" bind:value={setValue} />
        </div>
      {/if}
    </fieldset>

    <Button variant="primary" loading={busy} disabled={!canSave} onclick={save}>Save and turn on</Button>
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
  legend {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--kind-flow);
    padding: 0;
    margin-bottom: var(--space-2);
  }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: var(--space-2);
  }
</style>
