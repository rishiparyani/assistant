<script lang="ts">
  import type { GigsSettings, WorkspaceDetail } from "@assistant/shared";
  import { ListGroup, ListRow, Segmented, Skeleton, toast } from "../../core/ui/index.ts";
  import { gigsApi } from "./api.ts";

  // A collective's Gigs settings. Owners change them; members see what applies.
  let { workspace }: { workspace: WorkspaceDetail } = $props();
  const api = $derived(gigsApi(workspace.id));
  const isOwner = $derived(workspace.role === "owner");

  let settings = $state<GigsSettings | null>(null);
  $effect(() => {
    api.settings().then(
      (s) => (settings = s),
      (e) => toast.error(e),
    );
  });

  // Segmented binds strings; keep the boolean setting as "everyone"/"owners" in the UI.
  let seeLineup = $state<"everyone" | "owners">("everyone");
  let editors = $state<"everyone" | "owners">("owners");
  let payers = $state<"everyone" | "owners">("owners");
  let ready = false;
  $effect(() => {
    if (!settings) return;
    seeLineup = settings.lineup_visible_to_members ? "everyone" : "owners";
    editors = settings.lineup_editors;
    payers = settings.payout_recorders;
    ready = true;
  });

  async function save(patch: Partial<GigsSettings>) {
    if (!ready || !settings) return;
    const same = Object.entries(patch).every(([k, v]) => settings![k as keyof GigsSettings] === v);
    if (same) return;
    try {
      settings = await api.updateSettings(patch);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e);
    }
  }

  $effect(() => void save({ lineup_visible_to_members: seeLineup === "everyone" }));
  $effect(() => void save({ lineup_editors: editors }));
  $effect(() => void save({ payout_recorders: payers }));

  const who = (w: "everyone" | "owners") => (w === "everyone" ? "Everyone" : "Owners only");
  const OPTIONS = [
    { value: "owners", label: "Owners only" },
    { value: "everyone", label: "Everyone" },
  ] as const;
</script>

{#if !settings}
  <Skeleton rows={3} />
{:else if isOwner}
  <ListGroup
    title="Gig settings"
    footer="Anyone who can set lineups or record payouts also sees everyone's shares. Expenses and what the collective keeps stay with owners."
  >
    <div class="setting">
      <div class="text">
        <strong>Who sees who's playing</strong>
        <span>Names and roles on each gig. People always see their own share.</span>
      </div>
      <Segmented label="Who sees who's playing" bind:value={seeLineup} options={[...OPTIONS]} />
    </div>
    <div class="setting">
      <div class="text">
        <strong>Who can set the lineup</strong>
        <span>Choose who plays and each person's share.</span>
      </div>
      <Segmented label="Who can set the lineup" bind:value={editors} options={[...OPTIONS]} />
    </div>
    <div class="setting">
      <div class="text">
        <strong>Who can record payouts</strong>
        <span>Money paid to musicians, and corrections.</span>
      </div>
      <Segmented label="Who can record payouts" bind:value={payers} options={[...OPTIONS]} />
    </div>
  </ListGroup>
{:else}
  <ListGroup title="Gig settings" footer="Only owners can change these.">
    <ListRow title="Who sees who's playing" subtitle={who(seeLineup)} />
    <ListRow title="Who can set the lineup" subtitle={who(editors)} />
    <ListRow title="Who can record payouts" subtitle={who(payers)} />
  </ListGroup>
{/if}

<style>
  .setting {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .setting + .setting {
    border-top: 1px solid var(--separator);
  }
  .text {
    display: grid;
    gap: 2px;
  }
  .text strong {
    font-weight: 600;
  }
  .text span {
    font-size: var(--text-sm);
    color: var(--text-2);
  }
</style>
