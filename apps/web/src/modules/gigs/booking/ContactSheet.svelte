<script lang="ts">
  import type { ContactKind, ContactView } from "@assistant/shared";
  import { untrack } from "svelte";
  import { Button, Segmented, Sheet, TextArea, TextField, confirm, toast } from "../../../core/ui/index.ts";
  import { bookingsApi } from "../gigs-api.ts";

  // Add a contact, or edit / remove one. Gigs keep their own copy of the details.
  let {
    open = $bindable(false),
    contact = null,
    kind = "client",
    onsaved,
  }: {
    open?: boolean;
    contact?: ContactView | null;
    kind?: ContactKind;
    onsaved: () => void;
  } = $props();

  const uid = $props.id();
  let k = $state<ContactKind>("client");
  let name = $state("");
  let phone = $state("");
  let email = $state("");
  let city = $state("");
  let notes = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      k = contact?.kind ?? kind;
      name = contact?.name ?? "";
      phone = contact?.phone ?? "";
      email = contact?.email ?? "";
      city = contact?.city ?? "";
      notes = contact?.notes ?? "";
    });
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    const fields = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      city: k === "venue" ? city.trim() || null : null,
      notes: notes.trim() || null,
    };
    try {
      if (contact) await bookingsApi.updateContact(contact.id, fields);
      else await bookingsApi.saveContact({ kind: k, ...fields });
      toast.success(contact ? "Saved" : "Added to your address book");
      open = false;
      onsaved();
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!contact) return;
    const ok = await confirm({
      title: `Remove ${contact.name}?`,
      message: "Gigs that used it keep their details. It won't be added back from those gigs.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    busy = true;
    try {
      await bookingsApi.removeContact(contact.id);
      toast.success("Removed");
      open = false;
      onsaved();
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={contact ? contact.name : "New contact"}>
  <form id="contact-form-{uid}" class="form" onsubmit={save}>
    {#if !contact}
      <Segmented
        label="Kind"
        bind:value={k}
        options={[
          { value: "client", label: "Client" },
          { value: "venue", label: "Venue" },
          { value: "person", label: "Person" },
        ]}
      />
    {/if}
    <TextField label="Name" id="{uid}-name" bind:value={name} required maxlength={120} />
    <div class="two">
      <TextField label="Phone" id="{uid}-phone" type="tel" bind:value={phone} maxlength={40} />
      {#if k === "venue"}
        <TextField label="City" id="{uid}-city" bind:value={city} maxlength={80} />
      {:else}
        <TextField label="Email" id="{uid}-email" type="email" bind:value={email} maxlength={200} />
      {/if}
    </div>
    <TextArea label="Notes" id="{uid}-notes" bind:value={notes} rows={3} maxlength={1000} />
    {#if contact}
      <p class="hint">
        Used on {contact.gigs}
        {contact.gigs === 1 ? "gig" : "gigs"} you manage. Changes here don't change those gigs.
      </p>
    {/if}
  </form>
  {#snippet footer()}
    {#if contact}
      <Button variant="danger" onclick={remove} disabled={busy}>Remove</Button>
    {:else}
      <Button onclick={() => (open = false)}>Cancel</Button>
    {/if}
    <Button variant="primary" type="submit" form="contact-form-{uid}" loading={busy}>
      {contact ? "Save" : "Add"}
    </Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  @media (max-width: 420px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
  .hint {
    margin: 0;
    color: var(--text-3);
    font-size: var(--text-sm);
  }
</style>
