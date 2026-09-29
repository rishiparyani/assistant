// One person's notifications and the devices that get them as push messages (T11). A
// Durable Object per person (`inbox:<user id>`), so notifying never writes to a shared
// place. Modules call `notify()` (core/push/notify.ts); nothing here knows about gigs.
import { DurableObject } from "cloudflare:workers";
import { ulid, type NotificationView } from "@assistant/shared";
import { migrate, nowIso, type Migrations } from "../objects/storage.ts";
import { sendPush, type PushResult, type PushSubscriptionKeys } from "./webpush.ts";

const MIGRATIONS: Migrations = [
  `
  create table notifications (
    id text primary key,
    at text not null,
    kind text not null,
    title text not null,
    body text,
    url text,
    read_at text
  );
  create index notifications_at_idx on notifications (at);
  create table devices (
    endpoint text primary key,
    p256dh text not null,
    auth text not null,
    label text,
    created_at text not null,
    last_sent_at text
  );
  `,
];

const KEEP = 100;
const MAX_DEVICES = 10;

export interface NewNotification {
  kind: string;
  title: string;
  body?: string | null;
  /** Path in the app to open, e.g. /gigs/01… */
  url?: string | null;
}

export class InboxObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  /** Stores a notification and pushes it to this person's devices. Returns how many got it. */
  async notify(n: NewNotification, fetcher?: typeof fetch): Promise<number> {
    const id = ulid();
    const at = nowIso();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `insert into notifications (id, at, kind, title, body, url) values (?, ?, ?, ?, ?, ?)`,
        id,
        at,
        n.kind,
        n.title,
        n.body ?? null,
        n.url ?? null,
      );
      this.sql.exec(
        `delete from notifications where id not in (select id from notifications order by at desc limit ?)`,
        KEEP,
      );
    });
    return this.push({ id, title: n.title, body: n.body ?? "", url: n.url ?? "/" }, fetcher);
  }

  private async push(message: Record<string, string>, fetcher?: typeof fetch): Promise<number> {
    const devices = this.sql
      .exec<PushSubscriptionKeys & Record<string, string>>(`select endpoint, p256dh, auth from devices`)
      .toArray();
    let sent = 0;
    for (const d of devices) {
      const result: PushResult = await sendPush(this.env, d, message, fetcher);
      if (result === "gone") this.sql.exec(`delete from devices where endpoint = ?`, d.endpoint);
      if (result === "sent") {
        sent++;
        this.sql.exec(`update devices set last_sent_at = ? where endpoint = ?`, nowIso(), d.endpoint);
      }
    }
    return sent;
  }

  async list(limit = 30): Promise<{ items: NotificationView[]; unread: number }> {
    const items = this.sql
      .exec<{ [K in keyof NotificationView]: NotificationView[K] }>(
        `select id, at, kind, title, body, url, read_at from notifications order by at desc limit ?`,
        limit,
      )
      .toArray();
    const unread = Number(
      this.sql.exec(`select count(*) as n from notifications where read_at is null`).one().n,
    );
    return { items, unread };
  }

  async markAllRead(): Promise<{ unread: 0 }> {
    this.sql.exec(`update notifications set read_at = ? where read_at is null`, nowIso());
    return { unread: 0 };
  }

  /** Adds (or refreshes) a device. The oldest is dropped beyond ten. */
  async addDevice(d: PushSubscriptionKeys & { label?: string | null }): Promise<number> {
    this.sql.exec(
      `insert into devices (endpoint, p256dh, auth, label, created_at) values (?, ?, ?, ?, ?)
       on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
      d.endpoint,
      d.p256dh,
      d.auth,
      d.label ?? null,
      nowIso(),
    );
    this.sql.exec(
      `delete from devices where endpoint not in (select endpoint from devices order by created_at desc limit ?)`,
      MAX_DEVICES,
    );
    return this.deviceCount();
  }

  async removeDevice(endpoint: string): Promise<number> {
    this.sql.exec(`delete from devices where endpoint = ?`, endpoint);
    return this.deviceCount();
  }

  async deviceCount(): Promise<number> {
    return Number(this.sql.exec(`select count(*) as n from devices`).one().n);
  }

  async hasDevice(endpoint: string): Promise<boolean> {
    return this.sql.exec(`select 1 from devices where endpoint = ?`, endpoint).toArray().length > 0;
  }
}
