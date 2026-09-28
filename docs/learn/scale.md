# Learning notes: building for scale

Plain-language notes on the ideas behind [the gig-centric design](../design/gig-centric.md), with our app as the example. Added to as we build.

## Partitioning (sharding)

**Idea:** instead of one big database that every request touches, split the data into many smaller pieces that work independently.

**How we split:** by _entity_. Each gig (booking) gets its own small database, each person gets one, and the index is split by month. Cloudflare Durable Objects give us "a small database per thing" with no servers to manage.

**Choosing the split (the partition key):** split along the lines you read and write by. A gig's money is always read and changed together, so a gig is one partition. The index is always searched by date, so month is its partition key.

**The catch:** you can't run one query across all partitions. So we keep ready-made summaries where they're needed (see _fan-out_).

## Hot spots

**Idea:** a single place that too much traffic funnels into. Everything else scales out; the hot spot doesn't, so it sets the ceiling.

**Where we found them:** one shared index everyone writes to; audit and idempotency rows written to D1 on every action; wedding season bunching into one month; a person on thousands of gigs; a gig with many people.

**The rule:** never make every action write to the same single place. And watch where traffic naturally bunches up (a peak month, a very busy person) so it can be split further.

## One writer at a time (serialization)

A Durable Object handles one request at a time. That sounds slow, but it's a feature: inside one gig, two people recording payments can't corrupt each other. Scale comes from having _many_ objects, not from one object doing things in parallel.

## Idempotency

**Problem:** networks fail after the server did the work but before your phone heard back. The phone retries and the payment is recorded twice.

**Fix:** every action carries a unique key. The first time, the server does the work and saves "key → result". A repeat with the same key returns the saved result without doing anything. We keep these for 24 hours, inside the gig's own database so the check and the write happen together.

## Transactional outbox

**Problem:** after changing a gig we must also update people's summaries and the index. If we update the gig and then crash before telling the others, they're out of date forever.

**Fix:** in the same transaction as the change, save "tell these people" rows in an _outbox_ table. A timer then delivers them and removes them once acknowledged. Either both the change and the outbox rows are saved, or neither.

## Fan-out on write vs on read

- **On write:** when a gig changes, push updates to everyone who needs them (their person objects). Reads are then cheap: Home reads one object.
- **On read:** when you open Home, gather from every gig you're on. Writes are cheap, reads are expensive.

We fan out on write, because people read Home far more often than gigs change.

**Write amplification:** one change to a gig with 200 people means 200 deliveries. The outbox combines repeated updates and delivers in the background.

## Eventual consistency

The gig's own page is always exact. Other people's Home and reports catch up within a second or two, after the outbox delivers. That's _eventually consistent_: correct soon, not instantly. It's fine for summaries; money itself is only ever changed in one place (the gig).

## Safe to repeat (idempotent consumers)

Deliveries can arrive twice or out of order. Each carries a sequence number, and the receiver ignores anything older than what it already applied. So repeating a delivery never double-counts.

## Rebuild from the source of truth

Summaries are copies. If one is ever wrong, or a new report needs a new field, we recompute it from the gigs rather than patching it. Keeping the source of truth (the gig) separate from copies (summaries, index) is what makes that possible.

## Optimistic concurrency (version checks)

Two people editing the same detail: one-at-a-time processing prevents corruption, but the second save would still replace the first. So an edit sends the version it started from; if the gig changed since, the server refuses and asks you to reload. It's "optimistic" because we don't lock anything while you're typing; we just check at save time.
