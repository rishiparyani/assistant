<script lang="ts">
  import type { ContactKind, ContactView } from "@assistant/shared";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import BookUser from "@lucide/svelte/icons/book-user";
  import {
    Avatar,
    Button,
    EmptyState,
    ListGroup,
    ListRow,
    PageHeader,
    Segmented,
    Skeleton,
    toast,
  } from "../../../core/ui/index.ts";
  import { createQuery } from "../../../core/query.svelte.ts";
  import { bookingsApi } from "../gigs-api.ts";
  import ContactSheet from "./ContactSheet.svelte";

  // My address book: clients, venues and people. Filled in from gigs I manage, and by me.
  type Tab = "all" | ContactKind;
  let tab = $state<Tab>("all");
  let query = $state("");
  let search = $state("");
  let editing = $state<ContactView | null>(null);
  let sheetOpen = $state(false);

  $effect(() => {
    const q = query.trim();
    const t = setTimeout(() => (search = q), 200);
    return () => clearTimeout(t);
  });

  const list = createQuery<ContactView[]>(
    () => `contacts:${tab}:${search}`,
    () =>
      bookingsApi.contacts({
        kind: tab === "all" ? undefined : tab,
        q: search || undefined,
        limit: 200,
      }),
  );
  $effect(() => {
    if (list.error) toast.error(list.error);
  });

  const KIND_LABEL: Record<ContactKind, string> = { client: "Clients", venue: "Venues", person: "People" };
  const groups = $derived.by(() => {
    const items = list.data;
    if (!items) return null;
    const kinds: ContactKind[] = tab === "all" ? ["client", "venue", "person"] : [tab];
    return kinds
      .map((k) => ({
        kind: k,
        items: items.filter((c) => c.kind === k).sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((g) => g.items.length);
  });

  const subtitle = (c: ContactView) =>
    [c.phone, c.email, c.city, c.gigs ? `${c.gigs} ${c.gigs === 1 ? "gig" : "gigs"}` : null]
      .filter(Boolean)
      .join(" · ") || undefined;

  function openNew() {
    editing = null;
    sheetOpen = true;
  }
  function openContact(c: ContactView) {
    editing = c;
    sheetOpen = true;
  }
</script>

<PageHeader title="Address book" subtitle="Your clients, venues and people. Pick them when you add a gig.">
  {#snippet actions()}
    <Button variant="primary" onclick={openNew}>
      {#snippet icon()}<Plus />{/snippet}
      Add
    </Button>
  {/snippet}
</PageHeader>

<div class="toolbar">
  <Segmented
    label="Which contacts"
    bind:value={tab}
    options={[
      { value: "all", label: "All" },
      { value: "client", label: "Clients" },
      { value: "venue", label: "Venues" },
      { value: "person", label: "People" },
    ]}
  />
  <label class="search">
    <Search size={18} />
    <input
      type="search"
      placeholder="Search name, phone, email, city"
      bind:value={query}
      aria-label="Search the address book"
    />
  </label>
</div>

{#if groups === null}
  <Skeleton rows={5} label="Loading your address book" />
{:else if groups.length === 0}
  <EmptyState
    title={query ? "No matches" : "Nothing here yet"}
    text={query
      ? "Try part of a name, phone number, email or city."
      : "Clients, venues and people from gigs you manage appear here by themselves. You can add them yourself too."}
  >
    {#snippet icon()}<BookUser size={26} />{/snippet}
    {#snippet action()}
      {#if !query}<Button variant="primary" onclick={openNew}>Add a contact</Button>{/if}
    {/snippet}
  </EmptyState>
{:else}
  <div class="groups">
    {#each groups as g (g.kind)}
      <ListGroup title={KIND_LABEL[g.kind]}>
        {#each g.items as c (c.id)}
          <ListRow title={c.name} subtitle={subtitle(c)} onclick={() => openContact(c)} chevron>
            {#snippet leading()}<Avatar name={c.name} size={36} />{/snippet}
          </ListRow>
        {/each}
      </ListGroup>
    {/each}
  </div>
{/if}

<ContactSheet
  bind:open={sheetOpen}
  contact={editing}
  kind={tab === "all" ? "client" : tab}
  onsaved={() => list.refresh()}
/>

<style>
  .toolbar {
    display: grid;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  @media (min-width: 1024px) {
    .toolbar {
      grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
      align-items: center;
    }
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-3);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    outline: none;
    font-size: 16px;
  }
  .groups {
    display: grid;
    gap: var(--space-6);
  }
</style>
