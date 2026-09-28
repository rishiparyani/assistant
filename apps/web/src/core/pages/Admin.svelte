<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import {
    Button,
    Card,
    ListGroup,
    ListRow,
    PageHeader,
    Pill,
    Skeleton,
    Stat,
    TextField,
    confirm,
    toast,
  } from "../ui/index.ts";
  import {
    adminApi,
    type AdminList,
    type AdminLogEntry,
    type AdminOperations,
    type AdminOverview,
  } from "../api.ts";
  import { session } from "../session.svelte.ts";
  import NotFound from "./NotFound.svelte";

  // Owner-only: health and usage counts, repair tools, and who else is an admin.
  // Counts only; this page never shows anyone's gigs, names or money.
  let allowed = $state<boolean | null>(null);
  let overview = $state<AdminOverview | null>(null);
  let admins = $state<AdminList | null>(null);
  let log = $state<AdminLogEntry[]>([]);
  let ops = $state<AdminOperations | null>(null);
  let loading = $state(false);
  let newAdmin = $state("");
  let adding = $state(false);
  let running = $state("");
  let results = $state<Record<string, string>>({});
  let inputs = $state<Record<string, Record<string, string>>>({});

  async function load() {
    loading = true;
    try {
      const [o, a, l] = await Promise.all([adminApi.overview(), adminApi.admins(), adminApi.log()]);
      // Tool inputs must exist before the tools render (they're bound to text fields).
      for (const t of o.tools) inputs[t.id] ??= Object.fromEntries(t.fields.map((f) => [f.name, ""]));
      overview = o;
      admins = a;
      log = l;
      // Slower (an analytics query); shown when it arrives.
      adminApi.operations().then(
        (r) => (ops = r),
        () => (ops = { available: false, operations: [], error: "Couldn't load" }),
      );
    } catch (e) {
      toast.error(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (!session.me) return;
    adminApi.me().then(
      (r) => {
        allowed = r.is_admin;
        if (r.is_admin) void load();
      },
      () => (allowed = false),
    );
  });

  async function run(id: string) {
    running = id;
    try {
      const { result } = await adminApi.runTool(id, inputs[id] ?? {});
      results[id] = result;
      toast.success("Done");
      await load();
    } catch (e) {
      toast.error(e);
    } finally {
      running = "";
    }
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    adding = true;
    try {
      admins = await adminApi.addAdmin(newAdmin);
      newAdmin = "";
      toast.success("Admin added");
      log = await adminApi.log();
    } catch (err) {
      toast.error(err);
    } finally {
      adding = false;
    }
  }

  async function remove(email: string) {
    if (!(await confirm({ title: `Remove ${email} as admin?`, confirmLabel: "Remove", destructive: true })))
      return;
    try {
      admins = await adminApi.removeAdmin(email);
      toast.success("Admin removed");
      log = await adminApi.log();
    } catch (err) {
      toast.error(err);
    }
  }

  const toneOf = (t?: "ok" | "warn" | "bad") =>
    t === "ok" ? "green" : t === "warn" ? "amber" : t === "bad" ? "red" : undefined;
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  const describe = (l: AdminLogEntry) => {
    const d = l.detail as { email?: string; result?: string } | null;
    if (l.action === "add_admin") return `Added admin ${d?.email ?? ""}`;
    if (l.action === "remove_admin") return `Removed admin ${d?.email ?? ""}`;
    return d?.result ?? l.action;
  };
</script>

{#if allowed === false}
  <NotFound />
{:else}
  <PageHeader title="Admin" subtitle="Health and usage. Counts only.">
    {#snippet actions()}
      <Button onclick={load} {loading} disabled={allowed !== true}>
        {#snippet icon()}<RefreshCw />{/snippet}
        Refresh
      </Button>
    {/snippet}
  </PageHeader>

  {#if !overview || !admins}
    <Skeleton rows={6} />
  {:else}
    <div class="grid">
      {#each overview.sections as section (section.title)}
        <Card>
          <div class="section">
            <h2>{section.title}</h2>
            <div class="stats">
              {#each section.stats as s (s.label)}
                <Stat label={s.label} value={String(s.value)} tone={toneOf(s.tone)} hint={s.hint} />
              {/each}
            </div>
          </div>
        </Card>
      {/each}
    </div>

    <ListGroup
      title="Actions, last 24 hours"
      footer={ops?.available
        ? "Errors: server errors (5xx). Speed: typical and slowest 5%."
        : "Needs a read-only analytics token (a one-time setup step)."}
    >
      {#if !ops}
        <ListRow title="Loading…" />
      {:else if ops.error}
        <ListRow title={ops.error} />
      {:else if !ops.available}
        <ListRow
          title="Not set up yet"
          subtitle="Add the ANALYTICS_TOKEN secret to see per-action numbers."
        />
      {:else}
        {#each ops.operations as o (o.operation)}
          <ListRow
            title={o.operation.replace(/^[a-z]+\./, "").replaceAll("_", " ")}
            subtitle="{o.calls} calls · {o.p50_ms} ms typical · {o.p95_ms} ms slowest 5%"
          >
            {#snippet trailing()}
              {#if o.server_errors > 0}<Pill tone="red">{o.server_errors} errors</Pill>
              {:else}<Pill tone="green">OK</Pill>{/if}
            {/snippet}
          </ListRow>
        {:else}
          <ListRow title="No calls yet" />
        {/each}
      {/if}
    </ListGroup>

    <h2 class="heading">Tools</h2>
    <div class="grid">
      {#each overview.tools as t (t.id)}
        <Card>
          <div class="tool">
            <strong>{t.label}</strong>
            <p>{t.description}</p>
            {#if t.fields.length}
              <div class="fields">
                {#each t.fields as f (f.name)}
                  <TextField
                    label={f.label}
                    id="tool-{t.id}-{f.name}"
                    placeholder={f.placeholder}
                    bind:value={inputs[t.id]![f.name]}
                  />
                {/each}
              </div>
            {/if}
            <Button variant="tinted" loading={running === t.id} onclick={() => run(t.id)}>Run</Button>
            {#if results[t.id]}<p class="result">{results[t.id]}</p>{/if}
          </div>
        </Card>
      {/each}
    </div>

    <div class="grid two">
      <ListGroup title="Admins" footer="Owners come from the ADMIN_EMAILS secret and can't be removed here.">
        {#each admins.owners as email (email)}
          <ListRow title={email}>
            {#snippet trailing()}<Pill tone="accent">Owner</Pill>{/snippet}
          </ListRow>
        {/each}
        {#each admins.admins as a (a.email)}
          <ListRow title={a.email} subtitle={a.added_by ? `Added by ${a.added_by}` : undefined}>
            {#snippet trailing()}
              <button class="icon-btn" aria-label="Remove {a.email}" onclick={() => remove(a.email)}
                ><X size={16} /></button
              >
            {/snippet}
          </ListRow>
        {/each}
        <form class="add" onsubmit={add}>
          <input
            type="email"
            placeholder="Add an admin by email"
            bind:value={newAdmin}
            aria-label="New admin's email"
            required
          />
          <Button type="submit" size="sm" loading={adding}>{#snippet icon()}<Plus />{/snippet}Add</Button>
        </form>
      </ListGroup>

      <ListGroup title="Recent admin activity">
        {#each log.slice(0, 10) as l (l.at + l.action)}
          <ListRow title={describe(l)} subtitle="{l.actor ?? 'Someone'} · {when(l.at)}" />
        {:else}
          <ListRow title="Nothing yet" />
        {/each}
      </ListGroup>
    </div>
    <p class="generated">Updated {when(overview.generated_at)}</p>
  {/if}
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }
  @media (min-width: 820px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .section,
  .tool {
    display: grid;
    gap: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
  }
  .heading {
    margin: var(--space-2) 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 var(--space-4);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: var(--space-4);
    align-items: start;
  }
  .tool p {
    margin: 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .tool :global(.btn) {
    justify-self: start;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .result {
    color: var(--text) !important;
    font-weight: 500;
  }
  .add {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--separator);
  }
  .add input {
    flex: 1;
    min-width: 0;
    height: 40px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--grey-soft);
    color: var(--text-2);
    cursor: pointer;
  }
  .generated {
    color: var(--text-3);
    font-size: var(--text-xs);
    text-align: center;
  }
</style>
