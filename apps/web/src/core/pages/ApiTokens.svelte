<script lang="ts">
  import type { ApiTokenView, CreatedApiTokenView } from "@assistant/shared";
  import Mic from "@lucide/svelte/icons/mic";
  import Plus from "@lucide/svelte/icons/plus";
  import Copy from "@lucide/svelte/icons/copy";
  import Trash from "@lucide/svelte/icons/trash-2";
  import { Button, ListGroup, ListRow, Segmented, Sheet, TextField, confirm, toast } from "../ui/index.ts";
  import { tokensApi } from "../api.ts";

  // Tokens for Siri Shortcuts (and scripts). The secret is shown once, right after making it.
  const GUIDE = "https://github.com/rishiparyani/assistant/blob/main/shortcuts/README.md";
  let tokens = $state<ApiTokenView[] | null>(null);
  let open = $state(false);
  let name = $state("Siri on my iPhone");
  let access = $state<"read" | "write">("write");
  let busy = $state(false);
  let created = $state<CreatedApiTokenView | null>(null);

  const load = () =>
    tokensApi.list().then(
      (t) => (tokens = t),
      (e) => {
        toast.error(e);
        tokens = [];
      },
    );
  load();

  function startNew() {
    created = null;
    name = "Siri on my iPhone";
    access = "write";
    open = true;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      created = await tokensApi.create(name.trim(), access === "write");
      await load();
    } catch (err) {
      toast.error(err);
    } finally {
      busy = false;
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      toast.success("Token copied");
    } catch {
      toast.error("Couldn't copy; press and hold the token to copy it");
    }
  }

  async function revoke(t: ApiTokenView) {
    const ok = await confirm({
      title: `Revoke “${t.name}”?`,
      message: "Shortcuts using it stop working at once.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    try {
      await tokensApi.revoke(t.id);
      toast.success("Token revoked");
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const subtitle = (t: ApiTokenView) =>
    [
      t.scopes.includes("write") ? "Can make changes" : "Read only",
      `made ${when(t.created_at)}`,
      t.last_used_at ? `last used ${when(t.last_used_at)}` : "not used yet",
    ].join(" · ");
</script>

<ListGroup
  title="Siri and Shortcuts"
  footer="Ask Siri for your next gig, who owes you, or record a payment. Each token works like you signed in, so keep it private."
>
  {#each tokens ?? [] as t (t.id)}
    <ListRow title={t.name} subtitle={subtitle(t)}>
      {#snippet leading()}<span class="ic"><Mic size={18} /></span>{/snippet}
      {#snippet trailing()}
        <button class="icon-btn" type="button" aria-label="Revoke {t.name}" onclick={() => revoke(t)}>
          <Trash size={16} />
        </button>
      {/snippet}
    </ListRow>
  {/each}
  <ListRow title="Make a token for Siri" onclick={startNew} chevron={false}>
    {#snippet leading()}<span class="ic add"><Plus size={18} /></span>{/snippet}
  </ListRow>
  <ListRow title="How to set up the shortcuts" href={GUIDE} />
</ListGroup>

<Sheet bind:open title={created ? "Your token" : "New token"}>
  {#if created}
    <p class="note">Copy it now: it won't be shown again. Paste it into the shortcuts as the guide shows.</p>
    <p class="secret" aria-label="Token">{created.token}</p>
    <div class="row">
      <Button variant="primary" onclick={copy}>
        {#snippet icon()}<Copy />{/snippet}
        Copy token
      </Button>
      <Button href={GUIDE}>Open the guide</Button>
    </div>
  {:else}
    <form id="token-form" class="form" onsubmit={create}>
      <TextField label="Name" id="token-name" bind:value={name} required maxlength={60} />
      <Segmented
        label="What it can do"
        bind:value={access}
        options={[
          { value: "write", label: "Read and change" },
          { value: "read", label: "Read only" },
        ]}
      />
      <p class="note">
        "Read and change" lets shortcuts add gigs and record payments (each asks you first). Read only answers
        questions.
      </p>
    </form>
  {/if}
  {#snippet footer()}
    {#if created}
      <Button variant="primary" onclick={() => (open = false)}>Done</Button>
    {:else}
      <Button onclick={() => (open = false)}>Cancel</Button>
      <Button variant="primary" type="submit" form="token-form" loading={busy}>Make token</Button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .ic {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .ic.add {
    background: var(--surface-2);
    color: var(--text-2);
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .form {
    display: grid;
    gap: var(--space-4);
  }
  .note {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .secret {
    margin: var(--space-3) 0;
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 14px;
    word-break: break-all;
    user-select: all;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
