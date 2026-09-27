<script lang="ts">
  import type { ClientView, GigView, MusicianView, VenueView, WorkspaceDetail } from "@assistant/shared";
  import {
    Button,
    ListGroup,
    ListRow,
    Pill,
    SelectField,
    Sheet,
    Skeleton,
    TextArea,
    TextField,
    confirm,
    toast,
  } from "../../core/ui/index.ts";
  import { gigsApi } from "./api.ts";
  import type { PersonKind } from "./options.ts";
  import GigDate from "./GigDate.svelte";
  import { statusLabel, statusTone } from "./status.ts";

  type Item = ClientView | VenueView | MusicianView;

  // Add, edit or delete a client, venue or roster musician. `item` set = edit mode.
  let {
    open = $bindable(false),
    kind,
    item = null,
    workspace,
    readonly = false,
    onchanged,
  }: {
    open?: boolean;
    kind: PersonKind;
    item?: Item | null;
    workspace: WorkspaceDetail;
    readonly?: boolean;
    onchanged: () => void;
  } = $props();

  const api = $derived(gigsApi(workspace.id));
  const noun = $derived(kind === "clients" ? "client" : kind === "venues" ? "venue" : "musician");

  let busy = $state(false);
  let history = $state<GigView[] | null>(null);

  const FIELDS = [
    "name",
    "phone",
    "email",
    "organisation",
    "city",
    "address",
    "instrument",
    "notes",
    "user_id",
  ];
  let f = $state<Record<string, string>>(Object.fromEntries(FIELDS.map((k) => [k, ""])));

  $effect(() => {
    if (!open) return;
    const src = (item ?? {}) as Record<string, unknown>;
    f = Object.fromEntries(FIELDS.map((k) => [k, (src[k] as string | null | undefined) ?? ""]));
    history = null;
    if (kind === "clients" && item) {
      api.clientHistory(item.id).then(
        (r) => (history = r.gigs),
        () => (history = []),
      );
    }
  });

  function payload(): Record<string, string | null> {
    const keys =
      kind === "clients"
        ? ["name", "phone", "email", "organisation", "notes"]
        : kind === "venues"
          ? ["name", "city", "address", "notes"]
          : ["name", "instrument", "phone", "email", "notes", "user_id"];
    return Object.fromEntries(keys.map((k) => [k, f[k]!.trim() || (k === "name" ? "" : null)]));
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const body = payload();
      if (kind === "clients") await (item ? api.updateClient(item.id, body) : api.createClient(body));
      else if (kind === "venues") await (item ? api.updateVenue(item.id, body) : api.createVenue(body));
      else await (item ? api.updateMusician(item.id, body) : api.createMusician(body));
      toast.success(item ? "Saved" : `${noun[0]!.toUpperCase()}${noun.slice(1)} added`);
      open = false;
      onchanged();
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!item) return;
    const ok = await confirm({
      title: `Delete ${item.name}?`,
      message: "Past gigs keep their details; the name just stops showing up in lists.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      if (kind === "clients") await api.deleteClient(item.id);
      else if (kind === "venues") await api.deleteVenue(item.id);
      else await api.deleteMusician(item.id);
      toast.success("Deleted");
      open = false;
      onchanged();
    } catch (err) {
      toast.error(err);
    }
  }

  const memberOptions = $derived([
    { value: "", label: "Not linked" },
    ...workspace.members.map((m) => ({ value: m.user_id, label: `${m.name} (${m.email})` })),
  ]);
  const title = $derived(readonly ? (item?.name ?? "") : item ? `Edit ${noun}` : `New ${noun}`);
  const uid = $props.id();
  const formId = `person-form-${uid}`;
</script>

<Sheet bind:open {title}>
  <form id={formId} class="form" onsubmit={save}>
    <fieldset disabled={readonly}>
      <TextField label="Name" bind:value={f.name} required maxlength={120} />
      {#if kind === "clients"}
        <TextField label="Organisation" bind:value={f.organisation} placeholder="e.g. event company" />
        <div class="two">
          <TextField label="Phone" type="tel" bind:value={f.phone} />
          <TextField label="Email" type="email" bind:value={f.email} />
        </div>
      {:else if kind === "venues"}
        <TextField label="City" bind:value={f.city} placeholder="e.g. Pune" />
        <TextField label="Address" bind:value={f.address} />
      {:else}
        <TextField label="Instrument" bind:value={f.instrument} placeholder="e.g. drums, vocals" />
        <div class="two">
          <TextField label="Phone" type="tel" bind:value={f.phone} />
          <TextField label="Email" type="email" bind:value={f.email} />
        </div>
        {#if workspace.kind === "band"}
          <SelectField
            label="Member account"
            bind:value={f.user_id}
            options={memberOptions}
            hint="Linked people see their own share and payouts."
          />
        {/if}
      {/if}
      <TextArea label="Notes" bind:value={f.notes} />
    </fieldset>
  </form>

  {#if kind === "clients" && item}
    <ListGroup title="Gigs with this client">
      {#if history === null}
        <Skeleton rows={2} />
      {:else if history.length === 0}
        <ListRow title="No gigs yet" />
      {:else}
        {#each history as g (g.id)}
          <ListRow href="/w/{workspace.id}/gigs/{g.id}" title={g.title} subtitle={g.fee.amount_display}>
            {#snippet leading()}<GigDate iso={g.start_at} muted={g.status === "cancelled"} />{/snippet}
            {#snippet trailing()}<Pill tone={statusTone(g.status)}>{statusLabel(g.status)}</Pill>{/snippet}
          </ListRow>
        {/each}
      {/if}
    </ListGroup>
  {/if}

  {#snippet footer()}
    {#if readonly}
      <Button onclick={() => (open = false)}>Close</Button>
    {:else}
      {#if item}<Button variant="danger" onclick={remove}>Delete</Button>{/if}
      <span class="spacer"></span>
      <Button onclick={() => (open = false)}>Cancel</Button>
      <Button variant="primary" type="submit" form={formId} loading={busy}>{item ? "Save" : "Add"}</Button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .form fieldset {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-2);
  }
  .spacer {
    flex: 1;
  }
</style>
