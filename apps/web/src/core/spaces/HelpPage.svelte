<script lang="ts">
  import MessageCircle from "@lucide/svelte/icons/message-circle";
  import Hand from "@lucide/svelte/icons/hand";
  import { Card, PageHeader } from "../ui/index.ts";

  // How to use Gigspree: a few examples for the assistant, and how to do things by tapping
  // (everything works by tapping too). Examples open the chat with the text filled in.
  const ASK: { title: string; items: string[] }[] = [
    {
      title: "Everyday",
      items: [
        "Spent ₹450 on groceries",
        "Remind me to call the venue tomorrow at 6",
        "Note: the PA at Test Hall needs two DI boxes",
        "What did I spend on travel this month?",
        "Kal shaam 7 baje rehearsal add karo",
      ],
    },
    {
      title: "Setting things up",
      items: [
        "Make a collection for fam jam sign-ups: name, song, instrument, and which jam",
        "Add a ‘Paid with’ field to Expenses: cash, UPI or card",
        "Link rehearsals to gigs, and delete them when the gig is deleted",
      ],
    },
    {
      title: "Finding and reports",
      items: [
        "Show expenses over ₹1,000 from last month",
        "Everyone who played at both fam jams",
        "Which reminders are due this week?",
      ],
    },
  ];
  const TAP: { title: string; text: string; href?: string }[] = [
    {
      title: "Open a collection",
      text: "Collections → tap one. Search, filter, sort, or switch to a table.",
      href: "/c",
    },
    { title: "Add a record", text: "In a collection, tap Add. Required fields are marked *." },
    {
      title: "Link records",
      text: "A link field lets you pick records from another collection. On a record, linked sections have “Add to …”.",
    },
    {
      title: "Make your own collection",
      text: "Collections → New. Name it, add fields and pick their types.",
    },
    {
      title: "Change a setup",
      text: "In a collection, tap the settings button: rename it, add, edit or hide fields.",
    },
    {
      title: "Offline",
      text: "What you've opened works offline. New and changed records wait and sync when you're back online.",
    },
  ];
</script>

<PageHeader
  title="Help"
  subtitle="A few examples of what you can ask, and how to do it by tapping."
  back="/c"
  backLabel="Collections"
/>

<div class="stack">
  <Card>
    <div class="intro">
      <span class="icon"><MessageCircle size={20} /></span>
      <p>
        Say what you want in the chat, in English or Hinglish: tap an example to try it. Everything also works
        by tapping, and new setups (like a new collection) use the smart model once AI credit is added.
      </p>
    </div>
  </Card>

  {#each ASK as group (group.title)}
    <section>
      <h2>Ask: {group.title.toLowerCase()}</h2>
      <ul class="card">
        {#each group.items as item (item)}
          <li><a class="ask" href="/?ask={encodeURIComponent(item)}">“{item}”</a></li>
        {/each}
      </ul>
    </section>
  {/each}

  <section>
    <h2>By tapping</h2>
    <ul class="card">
      {#each TAP as t (t.title)}
        <li class="tap">
          <span class="icon small"><Hand size={16} /></span>
          <div>
            {#if t.href}<a href={t.href}>{t.title}</a>{:else}<strong>{t.title}</strong>{/if}
            <p>{t.text}</p>
          </div>
        </li>
      {/each}
    </ul>
  </section>
</div>

<style>
  h2 {
    margin: 0 0 var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .card {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface);
    overflow: hidden;
  }
  .card li + li {
    border-top: 1px solid var(--separator);
  }
  .ask {
    display: block;
    padding: var(--space-3) var(--space-4);
    min-height: 44px;
    color: var(--text);
    text-decoration: none;
  }
  .ask:hover {
    background: var(--surface-hover);
  }
  .tap {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .tap a,
  .tap strong {
    font-weight: 600;
    color: var(--text);
  }
  .tap a {
    color: var(--accent-text);
    text-decoration: none;
  }
  .tap p {
    margin: var(--space-1) 0 0;
    color: var(--text-2);
    font-size: var(--text-sm);
  }
  .stack {
    display: grid;
    gap: var(--space-6);
    max-width: 640px;
  }
  .intro {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }
  .intro p {
    margin: 0;
    color: var(--text-2);
  }
  .icon {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .icon.small {
    width: 32px;
    height: 32px;
  }
</style>
