// Gigs whose outbox note couldn't be handed to the queue yet (docs/design/gig-centric.md §5).
// Quiet in normal operation: a gig joins only after a failed send and leaves once its
// outbox is empty. "Flush outboxes" walks these lists.
import { DurableObject } from "cloudflare:workers";
import { migrate, type Migrations } from "../../../core/objects/storage.ts";

const MIGRATIONS: Migrations = [`create table waiting (gig_id text primary key, since text not null);`];

export class PendingObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  async add(gigId: string): Promise<void> {
    this.sql.exec(
      `insert or ignore into waiting (gig_id, since) values (?, ?)`,
      gigId,
      new Date().toISOString(),
    );
  }

  async remove(gigId: string): Promise<void> {
    this.sql.exec(`delete from waiting where gig_id = ?`, gigId);
  }

  async list(): Promise<{ gig_id: string; since: string }[]> {
    return this.sql
      .exec<{ gig_id: string; since: string }>(`select gig_id, since from waiting order by since`)
      .toArray();
  }
}
