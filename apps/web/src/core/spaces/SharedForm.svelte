<script lang="ts">
  import { ValueError, type SharedFieldInfo, type StoredValue } from "@assistant/shared";
  import { Button, toast } from "../ui/index.ts";
  import ValueField from "./ValueField.svelte";
  import { formValue, readForm, sendValues } from "./spaces-api.ts";

  // A shared form (design §11): the fields the owner shared, filled in and sent. Used in the
  // app (Shared with you) and on the link-only page; `send` does the sending.
  let {
    fields,
    send,
    sentLabel = "Sent",
  }: {
    fields: SharedFieldInfo[];
    send: (values: Record<string, unknown>) => Promise<void>;
    sentLabel?: string;
  } = $props();

  const uid = $props.id();
  const full = $derived(fields.map((f) => ({ ...f, aliases: [] })));
  let form = $state<Record<string, unknown>>({});
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  function reset() {
    form = Object.fromEntries(fields.map((f) => [f.id, formValue(f.type, null)]));
    errors = {};
  }
  $effect(() => {
    if (fields) reset();
  });

  async function submit(ev: SubmitEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    let values: Record<string, StoredValue> = {};
    for (const f of full) {
      try {
        values = { ...values, ...readForm([f], { [f.id]: form[f.id] }) };
      } catch (err) {
        e[f.id] = err instanceof ValueError ? err.message.replace(`${f.name}: `, "") : String(err);
      }
      if (!e[f.id] && f.required && (values[f.id] === null || values[f.id] === undefined)) e[f.id] = "Needed";
    }
    errors = e;
    if (Object.keys(e).length) return;
    busy = true;
    try {
      const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
      await send(sendValues(fields, filled));
      toast.success(sentLabel);
      reset();
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<form id="shared-form-{uid}" class="form" onsubmit={submit} novalidate>
  {#each full as f (f.id)}
    {#if f.id in form}<ValueField field={f} bind:value={form[f.id]} error={errors[f.id]} />{/if}
  {/each}
  <div><Button variant="primary" type="submit" loading={busy}>Send</Button></div>
</form>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
    max-width: var(--content-max);
  }
</style>
