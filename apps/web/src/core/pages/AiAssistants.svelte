<script lang="ts">
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import Copy from "@lucide/svelte/icons/copy";
  import { Button, Card, toast } from "../ui/index.ts";

  // How to connect Claude, ChatGPT and other assistants (MCP). They sign in through the
  // app and ask for your OK; money, cancellations and deletes always need your yes.
  const url = `${window.location.origin}/mcp`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy; press and hold the address to copy it");
    }
  }
</script>

<Card>
  <div class="head">
    <span class="icon"><Sparkles size={20} /></span>
    <div>
      <h2>AI assistants</h2>
      <p>Ask Claude or ChatGPT about your gigs, or have them add gigs and record payments.</p>
    </div>
  </div>
  <p class="link" aria-label="Connector address">{url}</p>
  <Button onclick={copy}>
    {#snippet icon()}<Copy />{/snippet}
    Copy address
  </Button>
  <ul class="help">
    <li>
      <strong>Claude:</strong> Settings → Connectors → Add custom connector → paste the address → Connect.
    </li>
    <li>
      <strong>ChatGPT:</strong> Settings → Apps and connectors → Advanced → Developer mode on → Create → paste the
      address (authentication: OAuth).
    </li>
    <li>
      You'll be asked to sign in here and allow it. Before any money, cancellation or delete, it asks you
      first.
    </li>
  </ul>
</Card>

<style>
  .head {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    margin-bottom: var(--space-4);
  }
  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
  }
  .head p {
    margin: 2px 0 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .link {
    margin: 0 0 var(--space-3);
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    color: var(--text-2);
    word-break: break-all;
    user-select: all;
  }
  .help {
    margin: var(--space-3) 0 0;
    padding-left: 18px;
    display: grid;
    gap: 6px;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
</style>
