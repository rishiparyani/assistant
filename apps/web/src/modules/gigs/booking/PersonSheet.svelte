<script lang="ts">
  import type { BookingPersonView, BookingRole, BookingView } from "@assistant/shared";
  import { Button, Segmented, Sheet, TextField, confirm, toast } from "../../../core/ui/index.ts";
  import { navigate } from "../../../core/router.svelte.ts";
  import { bookingsApi } from "../gigs-api.ts";

  // Add someone to a gig, or change their role and name, or remove them (managers).
  let {
    open = $bindable(false),
    gig,
    person = null,
    onsaved,
  }: {
    open?: boolean;
    gig: BookingView;
    person?: BookingPersonView | null;
    onsaved: (g: BookingView) => void;
  } = $props();

  const uid = $props.id();
  const formId = `person-form-${uid}`;
  let who = $state("");
  let name = $state("");
  let phone = $state("");
  let role = $state<BookingRole>("player");
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    who = "";
    name = person?.name ?? "";
    phone = "";
    role = person?.role ?? "player";
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      let saved: BookingView;
      if (person) {
        saved = await bookingsApi.updatePerson(gig.id, person.id, {
          role,
          ...(person.has_account ? {} : { name: name.trim() }),
        });
      } else {
        const email = who.includes("@") ? who.trim() : undefined;
        saved = await bookingsApi.addPerson(gig.id, {
          ...(email ? { email } : {}),
          name: name.trim() || (email ? undefined : who.trim()),
          phone: phone.trim() || null,
          role,
        });
      }
      toast.success(person ? "Saved" : "Added to the gig");
      open = false;
      onsaved(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!person) return;
    const ok = await confirm({
      title: person.is_me ? "Leave this gig?" : `Remove ${person.name} from this gig?`,
      message: person.is_me
        ? "You'll lose access to it."
        : "They're taken off every event's lineup and lose access to the gig.",
      confirmLabel: person.is_me ? "Leave" : "Remove",
      destructive: true,
    });
    if (!ok) return;
    busy = true;
    try {
      const res = await bookingsApi.removePerson(gig.id, person.id);
      open = false;
      if ("removed" in res) {
        toast.success("You've left the gig");
        navigate("/gigs");
      } else {
        toast.success("Removed");
        onsaved(res);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title={person ? person.name : "Add a person"}>
  <form id={formId} class="form" onsubmit={submit}>
    {#if !person}
      <TextField
        label="Email or name"
        id="{uid}-who"
        bind:value={who}
        placeholder="their@email.com, or just a name"
        hint="With an email they see the gig on their Home once they sign in."
        required
        maxlength={200}
      />
      {#if who.includes("@")}
        <TextField
          label="Name"
          id="{uid}-name"
          bind:value={name}
          placeholder="How they're called on this gig"
          maxlength={120}
        />
      {/if}
      <TextField
        label="Phone"
        id="{uid}-phone"
        type="tel"
        bind:value={phone}
        placeholder="Optional"
        maxlength={40}
      />
    {:else if !person.has_account}
      <TextField label="Name" id="{uid}-name" bind:value={name} required maxlength={120} />
    {/if}
    <Segmented
      label="Role"
      bind:value={role}
      options={[
        { value: "player", label: "Player" },
        { value: "manager", label: "Manager" },
      ]}
    />
    <p class="hint">
      Managers can change everything on the gig, including money. Players see the details and their own share.
    </p>
    {#if person}
      <div class="danger">
        <Button variant="ghost" onclick={remove} disabled={busy}
          >{person.is_me ? "Leave this gig" : "Remove from gig"}</Button
        >
      </div>
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form={formId} loading={busy}>{person ? "Save" : "Add"}</Button>
  {/snippet}
</Sheet>

<style>
  .form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .hint {
    margin: 0;
    color: var(--text-3);
    font-size: var(--text-sm);
  }
  .danger :global(.btn) {
    color: var(--red);
  }
</style>
