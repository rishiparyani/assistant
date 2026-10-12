// One space's own database (docs/design/universal.md §4): its collections, fields,
// records, links and change log. Setups are data: this object knows nothing about gigs
// or expenses, only field types and the rules every write follows. It checks the
// caller's role itself (architecture rule 3) and keeps idempotency and audit with the data.
import { DurableObject } from "cloudflare:workers";
import {
  SPACE_LIMITS,
  ValueError,
  decodeCursor,
  displayValue,
  encodeCursor,
  isUlid,
  nameKey,
  normalizeValue,
  periodRange,
  ulid,
  type ChangesView,
  type CommentView,
  type CollectionView,
  type FieldOptions,
  type FieldType,
  type FieldView,
  type Filter,
  type FindResult,
  type LinkedRef,
  type Period,
  type OpenedView,
  type RecordView,
  type HistoryItem,
  type SavedView,
  type StarterKind,
  formulaValues,
  type SetupResult,
  type RuleFilter,
  type ShareAccess,
  type ShareInclude,
  type Person,
  type QuestionView,
  type FormulaNode,
  type FormulaValue,
  evalFormula,
  parseFormula,
  type RuleKind,
  type RuleView,
  ruleWords,
  type WorkflowDetail,
  type WorkflowEvent,
  type WaitingItem,
  type WorkflowRun,
  type WorkflowView,
  workflowWords,
  type ShareKind,
  type ShareView,
  type SharedCardView,
  type SharedFieldInfo,
  type SharedOpened,
  type SharedRecord,
  type SharedWithMe,
  type StoredValue,
  type ViewMode,
} from "@assistant/shared";
import {
  retryDelayMs,
  BASE_TABLES,
  audit,
  getMeta,
  setMeta,
  hashOf,
  idempotent,
  migrate,
  nowIso,
  type Actor,
  type Migrations,
  bumpAndNote,
  clearOutbox,
  outboxFailed,
  outboxNote,
  backupTables,
  exportTables,
  importTables,
  type ObjectDump,
} from "../objects/storage.ts";
import { liveOf } from "../live/live-object.ts";
import { inboxName } from "../push/notify.ts";
import { searchOf, type SearchDoc } from "../search/search-object.ts";
import { embed } from "../search/embed.ts";
import type { NewNotification } from "../push/inbox.ts";

/** A burst of writes waits this long, then pings everyone once. */
const LIVE_DELAY_MS = 500;
import { ObjectError } from "../objects/errors.ts";
import { STARTER_COLLECTIONS } from "./starter.ts";

const MIGRATIONS: Migrations = [
  BASE_TABLES,
  `
  create table space (
    id text primary key,
    name text not null,
    kind text not null check (kind in ('personal', 'shared')),
    owner_user_id text not null,
    created_at text not null
  );
  create table members (
    user_id text primary key,
    name text not null,
    role text not null check (role in ('owner', 'editor', 'viewer')),
    added_at text not null
  );
  create table collections (
    id text primary key,
    name text not null,
    name_key text not null,
    description text,
    title_field_id text not null,
    position integer not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create unique index collections_name_idx on collections (name_key) where deleted_at is null;
  create table fields (
    id text primary key,
    collection_id text not null,
    name text not null,
    name_key text not null,
    type text not null,
    options_json text not null default '{}',
    required integer not null default 0,
    aliases_json text not null default '[]',
    position integer not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create unique index fields_name_idx on fields (collection_id, name_key) where deleted_at is null;
  create index fields_collection_idx on fields (collection_id, position) where deleted_at is null;
  create index fields_target_idx on fields (type, deleted_at);
  create table records (
    id text primary key,
    collection_id text not null,
    values_json text not null,
    title text not null,
    title_key text not null,
    created_by text,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    version integer not null default 1
  );
  create index records_created_idx on records (collection_id, deleted_at, created_at);
  create index records_title_idx on records (collection_id, deleted_at, title_key);
  create table record_values (
    record_id text not null,
    field_id text not null,
    num real,
    txt text
  );
  create index record_values_num_idx on record_values (field_id, num);
  create index record_values_txt_idx on record_values (field_id, txt);
  create index record_values_record_idx on record_values (record_id, field_id);
  create table links (
    field_id text not null,
    from_id text not null,
    to_id text not null,
    position real not null default 0,
    created_at text not null,
    primary key (field_id, from_id, to_id)
  ) without rowid;
  create index links_to_idx on links (to_id, field_id);
  create table record_words (
    word text not null,
    record_id text not null,
    primary key (word, record_id)
  ) without rowid;
  create index record_words_record_idx on record_words (record_id);
  create table changes (
    seq integer primary key autoincrement,
    at text not null,
    kind text not null,
    entity_id text not null,
    op text not null
  );
  `,
  // Saved views: a collection with filters, search and sort; pinned ones are shortcuts.
  `
  create table views (
    id text primary key,
    name text not null,
    name_key text not null,
    collection_id text not null,
    query_json text not null,
    mode text not null default 'list',
    pinned integer not null default 0,
    position real not null default 0,
    created_by text,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create unique index views_name_idx on views (name_key) where deleted_at is null;
  create index views_order_idx on views (deleted_at, pinned, position);
  create index views_collection_idx on views (collection_id) where deleted_at is null;
  `,
  // Sharing (design §11): a card is one record plus the linked parts the owner chose. The join
  // link is kept only as a hash; people who joined are listed per share.
  `
  create table shares (
    id text primary key,
    record_id text not null,
    token_hash text not null,
    access text not null check (access in ('view', 'edit')),
    include_json text not null default '[]',
    hidden_json text not null default '[]',
    expires_at text,
    created_by text,
    created_at text not null,
    revoked_at text
  );
  create unique index shares_token_idx on shares (token_hash);
  create index shares_record_idx on shares (record_id, revoked_at);
  create table share_people (
    share_id text not null,
    user_id text not null,
    name text not null,
    joined_at text not null,
    primary key (share_id, user_id)
  ) without rowid;
  create index share_people_user_idx on share_people (user_id);
  `,
  // Views and forms can be shared too, and views and forms by link without signing in.
  `
  alter table shares add column kind text not null default 'card';
  alter table shares add column target_id text;
  alter table shares add column public integer not null default 0;
  update shares set target_id = record_id;
  create index shares_target_idx on shares (target_id, revoked_at);
  create table share_counts (
    share_id text not null,
    day text not null,
    count integer not null,
    primary key (share_id, day)
  ) without rowid;
  `,
  // A person's own records (shared forms list "what I sent").
  `
  create index records_creator_idx on records (collection_id, created_by, deleted_at, created_at);
  `,
  // Comments on records, by members and by people a record is shared with.
  `
  create table comments (
    id text primary key,
    record_id text not null,
    author_id text,
    author_name text not null,
    body text not null,
    created_at text not null,
    deleted_at text
  );
  create index comments_record_idx on comments (record_id, deleted_at, created_at);
  `,
  // Personal answers: fields each person fills in for themselves (design §11).
  `
  create table answers (
    record_id text not null,
    field_id text not null,
    user_id text not null,
    value_json text not null,
    updated_at text not null,
    primary key (record_id, field_id, user_id)
  ) without rowid;
  create index answers_user_idx on answers (user_id, field_id);
  `,
  // Row rules on shared views: which rows everyone ("*") or one person sees.
  `
  create table share_rules (
    share_id text not null,
    user_id text not null,
    filters_json text not null,
    primary key (share_id, user_id)
  ) without rowid;
  `,
  // Live updates: people who just lost access still hear about it once (then they're dropped).
  `
  create table live_extra (user_id text primary key) without rowid;
  `,
  // Questions sent to people (chat-first step 4): one answer per person, changeable.
  `
  create table questions (
    id text primary key,
    text text not null,
    choices_json text,
    share_id text not null,
    created_by text,
    created_at text not null,
    closed_at text,
    deleted_at text
  );
  create table question_answers (
    question_id text not null,
    user_id text not null,
    answer text not null,
    at text not null,
    primary key (question_id, user_id)
  ) without rowid;
  `,
  // Workflows (chat-first step 5): saved definitions, jobs waiting to run, and what they did.
  `
  create table workflows (
    id text primary key,
    name text not null,
    collection_id text not null,
    def_json text not null,
    enabled integer not null default 0,
    run_count integer not null default 0,
    last_run_at text,
    created_by text,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create index workflows_collection_idx on workflows (collection_id, enabled) where deleted_at is null;
  create table workflow_jobs (
    id text primary key,
    workflow_id text not null,
    record_id text not null,
    kind text not null check (kind in ('event', 'date')),
    due_at text not null,
    depth integer not null default 0
  );
  create index workflow_jobs_due_idx on workflow_jobs (due_at);
  create index workflow_jobs_record_idx on workflow_jobs (workflow_id, record_id, kind);
  create table workflow_runs (
    id text primary key,
    workflow_id text not null,
    record_id text,
    at text not null,
    ok integer not null,
    counted integer not null,
    detail text not null
  );
  create index workflow_runs_idx on workflow_runs (workflow_id, at);
  `,
  // Workflow notifications waiting to reach people's inboxes (tried again until they do).
  `
  create table workflow_notes (
    id text primary key,
    user_id text not null,
    note_json text not null,
    attempts integer not null default 0,
    next_at text not null
  );
  create index workflow_notes_next_idx on workflow_notes (next_at);
  `,
  // Rules on a collection (chat-first step 6): checks, uniqueness and status flows.
  `
  create table rules (
    id text primary key,
    collection_id text not null,
    kind text not null check (kind in ('check', 'unique', 'flow')),
    def_json text not null,
    message text,
    created_by text,
    created_at text not null,
    deleted_at text
  );
  create index rules_collection_idx on rules (collection_id) where deleted_at is null;
  `,
  // Every audit entry gets a ULID (architecture rule 4): "what changed" names entries by it.
  `alter table _audit add column change_id text;
   create index _audit_change_idx on _audit (change_id);`,
  // Processes (home-first.md §2 point 9): a run paused at an "ask" step, waiting on people.
  `
  create table workflow_waits (
    id text primary key,
    workflow_id text not null,
    record_id text not null,
    step integer not null,
    question_id text not null,
    asked_at text not null,
    nudge_minutes integer,
    next_nudge_at text,
    nudges integer not null default 0,
    loops integer not null default 0,
    depth integer not null default 0,
    until text not null default 'all'
  );
  create index workflow_waits_nudge_idx on workflow_waits (next_nudge_at);
  create index workflow_waits_question_idx on workflow_waits (question_id);
  create index workflow_waits_workflow_idx on workflow_waits (workflow_id, record_id);
  alter table workflow_jobs add column wait_id text;
  `,
  // Each "repeat" step counts its own loops (a JSON map by step), not one shared count.
  `alter table workflow_waits add column loops_json text;`,
];

type ViewQuery = {
  filters: Filter[];
  search: string | null;
  sort: { field: string; dir: "asc" | "desc" } | null;
  /** A quick add the person asked for: the fields its add box fills in (ids). */
  add?: string[];
  /** The card's size on the phone's home, when the person set one. */
  card_size?: "s" | "m" | "l";
};
type ViewInput = {
  filters?: Filter[];
  search?: string | null;
  sort?: { field: string; dir: "asc" | "desc" } | null;
  mode?: ViewMode;
  add_fields?: string[];
  /** null clears it (the app picks again). */
  card_size?: "s" | "m" | "l" | null;
};
type ViewRow = {
  id: string;
  name: string;
  collection_id: string;
  query_json: string;
  mode: ViewMode;
  pinned: number;
  position: number;
  updated_at: string;
};

type CollectionRow = {
  id: string;
  name: string;
  description: string | null;
  title_field_id: string;
  position: number;
  updated_at: string;
};
type FieldRow = {
  id: string;
  collection_id: string;
  name: string;
  name_key: string;
  type: FieldType;
  options_json: string;
  required: number;
  aliases_json: string;
  position: number;
};
type RecordRow = {
  id: string;
  collection_id: string;
  values_json: string;
  title: string;
  created_at: string;
  updated_at: string;
  version: number;
};
type Role = "owner" | "editor" | "viewer";
type CommentRow = {
  id: string;
  record_id: string;
  author_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};
type ShareRow = {
  id: string;
  record_id: string;
  kind: ShareKind;
  target_id: string;
  public: number;
  token_hash: string;
  access: ShareAccess;
  include_json: string;
  hidden_json: string;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
};

/** Records reached from the triggering one through a link (either way). */
type LinkPath = { field_id: string; dir: "out" | "in" };
type WorkflowDef = {
  when: { event: WorkflowEvent; field_id: string | null; offset_minutes: number };
  check: Filter[];
  wait_minutes: number;
  then: (
    | {
        do: "notify";
        text: string;
        to: Person[];
        to_fields?: string[];
        /** The people in a person field of linked records ({Lineup.Player}). */
        to_linked?: (LinkPath & { person_field_id: string })[];
      }
    | { do: "set"; field_id: string; value: unknown; via?: LinkPath; where?: Filter[] }
    | { do: "add"; collection_id: string; values: Record<string, unknown> }
    | {
        do: "ask";
        text: string;
        choices: string[] | null;
        to: Person[];
        to_fields?: string[];
        to_linked?: (LinkPath & { person_field_id: string })[];
        save_to: string | null;
        nudge_minutes: number | null;
        until: "all" | "first";
      }
    | { do: "repeat"; if: Filter[]; from: number; at_most: number }
  )[];
};
type WorkflowRow = {
  id: string;
  name: string;
  collection_id: string;
  def_json: string;
  enabled: number;
  run_count: number;
  last_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type WorkflowJobRow = {
  id: string;
  workflow_id: string;
  record_id: string;
  kind: "event" | "date";
  due_at: string;
  depth: number;
  /** A run going on after an "ask" step: the wait it comes from. */
  wait_id: string | null;
};
type WaitRow = {
  id: string;
  workflow_id: string;
  record_id: string;
  step: number;
  question_id: string;
  asked_at: string;
  nudge_minutes: number | null;
  next_nudge_at: string | null;
  nudges: number;
  loops: number;
  /** How many times each "repeat" step (by index) went back so far, as JSON. */
  loops_json: string | null;
  depth: number;
  until: "all" | "first";
};
type Loops = Record<string, number>;
/** A proposal for the week (home-first.md §2 point 13): what to make, as a confirm card. */
export type Proposal = {
  kind: "quick_add" | "nudge" | "finished";
  title: string;
  why: string;
  tool: string;
  args: Record<string, unknown>;
  details: string[];
};
/** A workflow as asked for: names (resolved here) and the people to tell (resolved before). */
export type WorkflowSpec = {
  name: string;
  when: { event: WorkflowEvent; collection: string; field?: string; offset_minutes: number };
  check: Filter[];
  wait_minutes: number;
  then: (
    | { do: "notify"; text: string; to: Person[]; to_fields?: string[] }
    | { do: "set"; field: string; value: unknown; via?: string; where?: Filter[] }
    | { do: "add"; collection: string; values: Record<string, unknown> }
    | {
        do: "ask";
        text: string;
        choices?: string[];
        to: Person[];
        to_fields?: string[];
        save_to?: string;
        nudge_minutes?: number;
        until: "all" | "first";
      }
    | { do: "repeat"; if: Filter[]; from: number; at_most: number }
  )[];
  enabled: boolean;
};
/** The card each everyday list starts with (name and filter; the rest is the list's). */
const STARTER_CARDS: Partial<Record<StarterKind, { name: string; filters: Filter[] }>> = {
  reminders: { name: "Today", filters: [{ field: "Done", op: "ne", value: true }] },
  expenses: { name: "Spent this month", filters: [{ field: "Date", op: "period", value: "this_month" }] },
  events: { name: "Coming up", filters: [{ field: "Starts", op: "period", value: "future" }] },
  notes: { name: "Notes", filters: [] },
  inbox: { name: "Inbox", filters: [{ field: "Sorted", op: "ne", value: true }] },
};

/** At most this many workflows per space, and this many workflow steps in a chain. */
const MAX_WORKFLOWS = 100;
const MAX_WORKFLOW_DEPTH = 3;
/** A process nudges the people it waits on at most this often. */
const MAX_NUDGES = 10;
/** Someone to tell after a run; a question's share also goes in their "shared with me". */
type Tell = { userId: string; n: NewNotification & { share_id?: string } };
/** A workflow sets a field on at most this many linked records at once. */
const MAX_LINKED_SETS = 100;
const DAY_TIME_IST = "09:00:00+05:30";

type RuleDef = {
  require: Filter[];
  fields: string[];
  /** unique: how many may share the fields (default 1), and a number field added up instead. */
  at_most?: number;
  of?: string | null;
  only_if: Filter[];
  field: string | null;
  moves: Record<string, string[]>;
};
type RuleRow = {
  id: string;
  collection_id: string;
  kind: RuleKind;
  def_json: string;
  message: string | null;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
};

type QuestionRow = {
  id: string;
  text: string;
  choices_json: string | null;
  share_id: string;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
  deleted_at: string | null;
};

export interface SpaceInit {
  id: string;
  name: string;
  kind: "personal" | "shared";
  owner: { user_id: string; name: string };
  /** Personal spaces start with the starter setup (design §10). */
  starter: boolean;
}

interface RuleInput {
  kind: RuleKind;
  require?: Filter[];
  fields?: string[];
  at_most?: number;
  of?: string;
  only_if?: Filter[];
  field?: string;
  moves?: Record<string, string[]>;
  message?: string;
}

export interface FieldSpec {
  id?: string | null;
  name: string;
  type: FieldType;
  options?: FieldOptions & { target?: string | null };
  required?: boolean;
  aliases?: string[];
}

const toField = (r: FieldRow): FieldView => ({
  id: r.id,
  name: r.name,
  type: r.type,
  options: JSON.parse(r.options_json) as FieldOptions,
  required: !!r.required,
  aliases: JSON.parse(r.aliases_json) as string[],
});

/** Words for title search: lower case, letters and digits. */
const words = (s: string) => [
  ...new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 0)
      .slice(0, 20),
  ),
];
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** How many times a failing member index is retried before the others go on without it. */
const SEARCH_ATTEMPTS = 8;

export class SpaceObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql, MIGRATIONS);
      this.ensureReminders();
      await this.wakeForJobs();
    });
  }

  /** Makes sure the alarm comes for the next workflow job (after a restart or a new job). */
  private async wakeForJobs() {
    const next = this.nextWorkflowTime();
    if (next !== null && (await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, next));
  }

  /** When the next workflow job is due or a notification is to be tried again (ms), or null. */
  private nextWorkflowTime(): number | null {
    const row = this.sql
      .exec<{ at: string | null }>(
        `select min(at) as at from (select min(due_at) as at from workflow_jobs
         union all select min(next_at) as at from workflow_notes
         union all select min(next_nudge_at) as at from workflow_waits where next_nudge_at != 'resumed')`,
      )
      .toArray()[0];
    return row?.at ? Date.parse(row.at) : null;
  }

  // --- Space and members ---------------------------------------------------------------

  /** Everything needed to restore this space (not idempotency records or the outbox). */
  async exportData(): Promise<ObjectDump | null> {
    if (!this.sql.exec(`select 1 from space`).toArray().length) return null;
    return exportTables(this.sql, backupTables(this.sql));
  }

  /** Restores a backup into this space if it's empty; never overwrites anything. */
  async importData(dump: ObjectDump): Promise<boolean> {
    if (this.sql.exec(`select 1 from space`).toArray().length) return false;
    importTables(this.ctx.storage, dump, Object.keys(dump.tables), MIGRATIONS);
    await this.wakeForJobs();
    return true;
  }

  /** Sets the space up once (repeats are harmless). */
  async init(init: SpaceInit): Promise<void> {
    if (this.sql.exec(`select 1 from space`).toArray().length) return;
    const ts = nowIso();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `insert into space (id, name, kind, owner_user_id, created_at) values (?, ?, ?, ?, ?)`,
        init.id,
        init.name,
        init.kind,
        init.owner.user_id,
        ts,
      );
      this.sql.exec(
        `insert into members (user_id, name, role, added_at) values (?, ?, 'owner', ?)`,
        init.owner.user_id,
        init.owner.name,
        ts,
      );
      if (init.starter) {
        const actor: Actor = { userId: init.owner.user_id, source: "system" };
        for (const c of STARTER_COLLECTIONS) this.insertCollection(actor, { ...c, id: null }, ts);
      }
      this.logChange("space", init.id, "upsert", ts);
    });
    this.ensureReminders();
    await this.wakeForJobs();
  }

  private role(actor: Actor): Role {
    const row = actor.userId
      ? this.sql.exec<{ role: Role }>(`select role from members where user_id = ?`, actor.userId).toArray()[0]
      : undefined;
    if (!row) throw new ObjectError("not_found", "Space not found");
    return row.role;
  }
  private canWrite(actor: Actor) {
    if (this.role(actor) === "viewer") throw new ObjectError("forbidden", "You can only view this space");
  }

  // --- Writes: one helper for idempotency, audit and the change log -----------------------

  private async write<T>(
    actor: Actor,
    key: string | null,
    request: unknown,
    run: (ts: string) => T,
    check: () => void = () => this.canWrite(actor),
  ): Promise<T> {
    check();
    const hash = await hashOf(request);
    try {
      return idempotent(this.ctx.storage, key, hash, () => {
        const out = run(nowIso());
        this.changed();
        return out;
      });
    } catch (e) {
      if (e instanceof ValueError) throw new ObjectError("validation_failed", e.message);
      throw e;
    }
  }

  // --- Live updates (chat-first step 4) ---------------------------------------------------
  // A write leaves one outbox note (in its own transaction); shortly after, the alarm pings
  // the live object of everyone in the space or in one of its shares. A ping carries no data
  // (their apps fetch again, so nobody sees more than they may), and repeats are harmless.

  private changed() {
    bumpAndNote(this.sql);
    // Bursts of writes (a few rows at once) become one ping.
    void this.ctx.storage.setAlarm(Date.now() + LIVE_DELAY_MS);
  }

  override async alarm(): Promise<void> {
    await this.runDueJobs();
    const searchIn = await this.syncSearch();
    const liveIn = await this.pingLive();
    // Next: the live ping still owed, or the next workflow job, whichever is sooner.
    const next = this.nextWorkflowTime();
    const times = [
      ...(liveIn === null ? [] : [Date.now() + liveIn]),
      ...(searchIn === null ? [] : [Date.now() + searchIn]),
      ...(next === null ? [] : [next]),
    ];
    if (times.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, Math.min(...times)));
  }

  // --- Search (home-first.md §4) ----------------------------------------------------------
  // Each member has a search index (one per person); this space fills it from its change log
  // after every write (the alarm, like the live pings), and can rebuild it from scratch. The
  // index is a copy: a query's hits are re-checked here before they're shown.

  /** Pushes the records changed since the last push to every member's index; ms until the next try, or null. */
  private async syncSearch(): Promise<number | null> {
    const from = Number(getMeta(this.sql, "search_seq") ?? "0");
    const rows = this.sql
      .exec<{ seq: number; kind: string; entity_id: string }>(
        `select seq, kind, entity_id from changes where seq > ? and kind in ('record', 'collection') order by seq limit 200`,
        from,
      )
      .toArray();
    // A collection change (a field renamed, removed or hidden) changes how its records read in
    // the index: its records are queued for reindexing, a page at a time.
    const reindex = JSON.parse(getMeta(this.sql, "search_reindex") ?? "[]") as { c: string; after: string }[];
    for (const r of rows)
      if (r.kind === "collection" && !reindex.some((x) => x.c === r.entity_id))
        reindex.push({ c: r.entity_id, after: "" });
    const ids = [...new Set(rows.filter((r) => r.kind === "record").map((r) => r.entity_id))];
    let page: { c: string; after: string } | null = null;
    let paged = false;
    if (!ids.length && reindex.length) {
      paged = true;
      // Only when no record changes are waiting, so edits never queue behind a big reindex.
      const next = reindex[0]!;
      const batch = this.sql
        .exec<{ id: string }>(
          `select id from records where collection_id = ? and deleted_at is null and id > ? order by id limit 200`,
          next.c,
          next.after,
        )
        .toArray();
      for (const b of batch) ids.push(b.id);
      page = batch.length === 200 ? { c: next.c, after: batch[batch.length - 1]!.id } : null;
    }
    if (!rows.length && !ids.length) {
      if (reindex.length) setMeta(this.sql, "search_reindex", JSON.stringify(reindex.slice(1)));
      return reindex.length > 1 ? 50 : null;
    }
    const members = this.sql
      .exec<{ user_id: string }>(`select user_id from members`)
      .toArray()
      .map((m) => m.user_id);
    const spaceId = this.sql.exec<{ id: string }>(`select id from space limit 1`).toArray()[0]?.id ?? "";
    // The latest state of each record wins (several changes to one record are one push).
    const docs: SearchDoc[] = [];
    const gone: string[] = [];
    for (const id of ids) {
      const r = this.liveRecord(id);
      if (r) docs.push(this.searchDoc(spaceId, r));
      else gone.push(`${spaceId}:${id}`);
    }
    // By meaning too, when the model answers (best effort: words always work).
    const vectors = docs.length
      ? await embed(
          this.embedder(),
          docs.map((d) => `${d.title}\n${d.body}`),
        ).catch(() => null)
      : [];
    // Each member's index on its own: one that fails doesn't hold up the others. Writes are
    // replaces, so a retry is harmless to the ones that took it.
    const results = await Promise.allSettled(
      members.map(async (u) => {
        const index = searchOf(this.env, u);
        if (docs.length) await index.upsert(docs);
        if (gone.length) await index.remove(gone);
        if (vectors?.length)
          await index.upsertVectors(docs.map((d, i) => ({ doc_id: d.id, vec: vectors[i]! })));
      }),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) {
      const attempts = Number(getMeta(this.sql, "search_attempts") ?? "0") + 1;
      console.warn(`search sync: ${failed} of ${members.length} indexes failed (attempt ${attempts})`);
      if (attempts < SEARCH_ATTEMPTS) {
        setMeta(this.sql, "search_attempts", String(attempts));
        return retryDelayMs(attempts);
      }
      // Still failing after a while: go on. Those people's results are re-checked on every
      // hit, and "rebuild search" fills their index again.
    }
    if (rows.length) setMeta(this.sql, "search_seq", String(rows[rows.length - 1]!.seq));
    if (paged) {
      if (page) reindex[0] = page;
      else reindex.shift();
    }
    setMeta(this.sql, "search_reindex", JSON.stringify(reindex));
    setMeta(this.sql, "search_attempts", "0");
    return rows.length === 200 || reindex.length ? 50 : null;
  }

  /** Workers AI for search by meaning; the stand-in with the scripted model. */
  private embedder() {
    return { ai: this.env.AI, fake: this.env.AI_FAKE === "1" };
  }

  /** One record as the index sees it: its title and every readable value the members can see. */
  private searchDoc(spaceId: string, r: RecordRow): SearchDoc {
    const fields = this.fieldRows(r.collection_id);
    const values = JSON.parse(r.values_json) as Record<string, StoredValue>;
    const lines: string[] = [];
    for (const f of fields) {
      if (toField(f).options.personal || f.type === "link") continue;
      const shown = displayValue(f.type, values[f.id] ?? null);
      const text = Array.isArray(shown) ? shown.join(", ") : shown;
      if (text && text !== r.title) lines.push(`${f.name}: ${text}`);
    }
    return {
      id: `${spaceId}:${r.id}`,
      space_id: spaceId,
      collection_id: r.collection_id,
      collection: this.requireCollection(r.collection_id).name,
      record_id: r.id,
      title: r.title,
      body: lines.join("\n"),
      updated_at: r.updated_at,
    };
  }

  /** Fills one member's index with every record of this space (after joining, or on request). */
  async rebuildSearch(actor: Actor): Promise<number> {
    this.role(actor);
    if (!actor.userId) return 0;
    const spaceId = this.sql.exec<{ id: string }>(`select id from space limit 1`).toArray()[0]?.id ?? "";
    const index = searchOf(this.env, actor.userId);
    await index.removeSpace(spaceId);
    let after = "";
    let n = 0;
    for (;;) {
      const batch = this.sql
        .exec<RecordRow>(
          `select * from records where deleted_at is null and id > ? order by id limit 200`,
          after,
        )
        .toArray();
      if (!batch.length) break;
      const docs = batch.map((r) => this.searchDoc(spaceId, r));
      await index.upsert(docs);
      const vectors = await embed(
        this.embedder(),
        docs.map((d) => `${d.title}\n${d.body}`),
      );
      if (vectors?.length)
        await index.upsertVectors(docs.map((d, i) => ({ doc_id: d.id, vec: vectors[i]! })));
      n += batch.length;
      after = batch[batch.length - 1]!.id;
      if (batch.length < 200) break;
    }
    return n;
  }

  // --- This week (home-first.md §2 point 13) ------------------------------------------
  // Once a week, proposals from the data, never actions: a quick add for a list the person
  // keeps adding to by hand, a reminder workflow for dates that go by unnoticed, a finished
  // card to take off the home. Each is a confirm card in the chat; the person taps.

  async proposals(actor: Actor, since: string): Promise<Proposal[]> {
    this.role(actor);
    const out: Proposal[] = [];
    const views = this.sql
      .exec<ViewRow>(`select * from views where deleted_at is null`)
      .toArray()
      .flatMap((v) => this.viewOf(v) ?? []);
    // 1. Lists added to by hand, a lot, with a pinned card but no quick add.
    const adds = this.sql
      .exec<{ collection_id: string; n: number }>(
        `select r.collection_id, count(*) as n from _audit a join records r on r.id = a.entity_id
         where a.action = 'add_record' and a.actor_user_id = ? and a.source in ('web', 'app') and a.at >= ?
         group by r.collection_id having n >= 5`,
        actor.userId,
        since,
      )
      .toArray();
    for (const a of adds) {
      const view = views.find((v) => v.collection_id === a.collection_id && v.pinned && !v.add_fields.length);
      if (!view) continue;
      const all = this.fieldRows(a.collection_id);
      const fillable = (f: FieldRow) =>
        f.type !== "link" &&
        f.type !== "person" &&
        !toField(f).options.personal &&
        !toField(f).options.formula &&
        !toField(f).options.rollup;
      // The required fields first (a quick add must fill them in), then the others up to three;
      // a list whose required fields a quick add can't fill gets no proposal.
      const required = all.filter((f) => f.required);
      if (required.some((f) => !fillable(f)) || required.length > 10) continue;
      const pick = [...required, ...all.filter((f) => !f.required && fillable(f))].slice(
        0,
        Math.max(3, required.length),
      );
      if (
        !pick.length ||
        this.quickAddProblem(
          all,
          pick.map((f) => f.id),
        )
      )
        continue;
      const names = pick.map((f) => f.name);
      out.push({
        kind: "quick_add",
        title: `A quick add for ${view.collection}`,
        why: `You added ${a.n} to ${view.collection} by hand this week.`,
        tool: "update_view",
        args: { view_id: view.id, add_fields: names },
        details: [`On the ${view.name} card: ${names.join(", ")}`],
      });
    }
    // 2. A date that goes by with nobody told: a collection with a date field and records
    //    whose date passed this week, and no workflow watching that date.
    const workflows = this.sql
      .exec<WorkflowRow>(`select * from workflows where deleted_at is null`)
      .toArray()
      .map((w) => ({ w, def: JSON.parse(w.def_json) as WorkflowDef }));
    for (const c of this.sql
      .exec<CollectionRow>(`select * from collections where deleted_at is null`)
      .toArray()) {
      const fields = this.fieldRows(c.id);
      const date = fields.find(
        (f) => (f.type === "date" || f.type === "datetime") && !toField(f).options.personal,
      );
      const money = fields.find((f) => f.type === "money");
      if (!date || !money) continue;
      if (
        workflows.some(
          (x) => x.w.collection_id === c.id && x.def.when.event === "date" && x.def.when.field_id === date.id,
        )
      )
        continue;
      const passed = this.sql
        .exec<{ n: number }>(
          `select count(*) as n from record_values v join records r on r.id = v.record_id
           where r.collection_id = ? and r.deleted_at is null and v.field_id = ? and v.txt >= ? and v.txt <= ?`,
          c.id,
          date.id,
          since.slice(0, 10),
          nowIso().slice(0, 10),
        )
        .toArray()[0];
      if (!passed || !passed.n) continue;
      const title = fields.find((f) => f.id === c.title_field_id)?.name ?? "Title";
      out.push({
        kind: "nudge",
        title: `A reminder when ${date.name} comes in ${c.name}`,
        why: `${passed.n} ${c.name} record${passed.n === 1 ? "" : "s"} had ${date.name} go by this week.`,
        tool: "create_workflow",
        args: {
          name: `${c.name}: ${date.name} is here`,
          when: { event: "date", collection: c.id, field: date.name, offset_minutes: 0 },
          then: [{ do: "notify", text: `{${title}}: ${date.name} is today ({${money.name}})`, to: ["me"] }],
        },
        details: [
          `At the ${date.name} of each ${c.name} record, tell me`,
          "Saved off: turn it on from its card",
        ],
      });
    }
    // 3. A finished card: a pinned list with ticks where everything is ticked.
    for (const v of views) {
      if (!v.pinned) continue;
      const fields = this.fieldRows(v.collection_id);
      const done = fields.find((f) => f.type === "boolean");
      if (!done) continue;
      const open = this.sql
        .exec<{ n: number }>(
          `select count(*) as n from records r left join record_values x on x.record_id = r.id and x.field_id = ?
           where r.collection_id = ? and r.deleted_at is null and coalesce(x.num, 0) = 0`,
          done.id,
          v.collection_id,
        )
        .toArray()[0];
      const total = this.sql
        .exec<{ n: number }>(
          `select count(*) as n from records where collection_id = ? and deleted_at is null`,
          v.collection_id,
        )
        .toArray()[0];
      if (!total?.n || open?.n) continue;
      out.push({
        kind: "finished",
        title: `Take “${v.name}” off the home`,
        why: `Everything on it is done (${total.n}).`,
        tool: "update_view",
        args: { view_id: v.id, pinned: false },
        details: ["The list stays; the chat can pin it again"],
      });
    }
    return out.slice(0, 5);
  }

  /** The records among these the person may still see, with their current titles (a hit's re-check). */
  async peekRecords(
    actor: Actor,
    ids: string[],
  ): Promise<{ id: string; title: string; collection: string }[]> {
    this.role(actor);
    return ids.flatMap((id) => {
      const r = this.liveRecord(id);
      return r
        ? [{ id: r.id, title: r.title, collection: this.requireCollection(r.collection_id).name }]
        : [];
    });
  }

  /** Pings everyone's live object for the outbox note; ms until the next try, or null when done. */
  private async pingLive(): Promise<number | null> {
    const note = outboxNote(this.sql);
    if (!note) return null;
    const spaceId = this.sql.exec<{ id: string }>(`select id from space limit 1`).toArray()[0]?.id;
    const people = this.sql
      .exec<{ user_id: string }>(
        `select user_id from members union select user_id from share_people where user_id is not null
         union select user_id from live_extra`,
      )
      .toArray()
      .map((r) => r.user_id);
    try {
      await Promise.all(
        people.map((u) =>
          liveOf(this.env, u).ping({ type: "space_changed", space_id: spaceId ?? "", seq: note.seq }),
        ),
      );
    } catch (e) {
      console.warn("live ping failed", e);
      return outboxFailed(this.sql);
    }
    // Only those pinged now leave the list; anyone added meanwhile waits for the next alarm.
    for (const u of people) this.sql.exec(`delete from live_extra where user_id = ?`, u);
    return clearOutbox(this.sql, note.seq) ? null : LIVE_DELAY_MS;
  }

  /** Someone losing access to a share still gets one ping, so their open app drops it. */
  private alsoTell(userId: string) {
    this.sql.exec(`insert or ignore into live_extra (user_id) values (?)`, userId);
  }

  private logChange(
    kind: "collection" | "record" | "space" | "view",
    id: string,
    op: "upsert" | "delete",
    ts: string,
  ) {
    this.sql.exec(`insert into changes (at, kind, entity_id, op) values (?, ?, ?, ?)`, ts, kind, id, op);
  }

  // --- Collections and fields ------------------------------------------------------------

  async collections(actor: Actor): Promise<CollectionView[]> {
    this.role(actor);
    return this.sql
      .exec<CollectionRow>(
        `select id, name, description, title_field_id, position, updated_at from collections
         where deleted_at is null order by position, name_key`,
      )
      .toArray()
      .map((c) => this.collectionView(c));
  }

  async describe(actor: Actor, collection: string): Promise<CollectionView> {
    this.role(actor);
    const c = this.requireCollection(collection);
    return { ...this.collectionView(c), rules: this.ruleRows(c.id).map((r) => this.ruleView(r)) };
  }

  async createCollection(
    actor: Actor,
    key: string | null,
    input: { id?: string | null; name: string; description?: string | null; fields: FieldSpec[] },
  ): Promise<CollectionView> {
    return this.write(actor, key, ["create_collection", input], (ts) => {
      const id = this.insertCollection(actor, input, ts);
      return this.collectionView(this.requireCollection(id));
    });
  }

  /**
   * A whole setup in one write (chat-first step 6): the new collections with their plain
   * fields first, then their links (which may point at each other), then calculated fields in
   * the order their parts exist, then rules and views. If any part is wrong, nothing is made.
   */
  async makeSetup(
    actor: Actor,
    key: string | null,
    input: {
      collections: { id?: string | null; name: string; description?: string | null; fields: FieldSpec[] }[];
      rules: (RuleInput & { collection: string })[];
      views: (ViewInput & { id?: string | null; name: string; collection: string; pinned?: boolean })[];
    },
  ): Promise<SetupResult> {
    return this.write(actor, key, ["make_setup", input], (ts) => {
      const isLink = (f: FieldSpec) => f.type === "link";
      const isRollup = (f: FieldSpec) => !isLink(f) && !!f.options?.rollup;
      const isFormula = (f: FieldSpec) => !isLink(f) && !f.options?.rollup && !!f.options?.formula;
      const ids = input.collections.map((c) =>
        this.insertCollection(
          actor,
          { ...c, fields: c.fields.filter((f) => !isLink(f) && !isRollup(f) && !isFormula(f)) },
          ts,
        ),
      );
      input.collections.forEach((c, i) => {
        const id = ids[i]!;
        for (const f of c.fields.filter(isLink)) this.insertField(id, f, this.fieldRows(id).length, ts);
      });
      // Calculated fields may use each other across lists (a rollup of a formula, a formula of
      // a rollup): add the ones whose parts exist, round by round, until none are left.
      let pending = input.collections.flatMap((c, i) =>
        c.fields.filter((f) => isRollup(f) || isFormula(f)).map((f) => ({ id: ids[i]!, f })),
      );
      while (pending.length) {
        const left: typeof pending = [];
        let last: unknown = null;
        for (const p of pending)
          try {
            this.insertField(p.id, p.f, this.fieldRows(p.id).length, ts);
          } catch (e) {
            if (!(e instanceof ObjectError)) throw e;
            left.push(p);
            last = e;
          }
        if (left.length === pending.length) throw last;
        pending = left;
      }
      // Fields in the order the setup gave them (an added Title stays first).
      input.collections.forEach((c, i) => {
        const rows = this.fieldRows(ids[i]!);
        const offset = rows.length - c.fields.length;
        c.fields.forEach((f, at) => {
          const row = rows.find((r) => r.name_key === nameKey(f.name));
          if (row) this.sql.exec(`update fields set position = ? where id = ?`, offset + at, row.id);
        });
      });
      const rules = input.rules.map(({ collection, ...r }) => this.insertRule(actor, collection, r, ts));
      const views = input.views.map((v) => this.insertView(actor, v, ts));
      for (const id of ids) this.logChange("collection", id, "upsert", ts);
      audit(this.sql, actor, {
        action: "make_setup",
        entityType: "collection",
        entityId: ids[0]!,
        after: input,
      });
      return {
        collections: ids.map((id) => this.collectionView(this.requireCollection(id))),
        rules,
        views,
      };
    });
  }

  private insertCollection(
    actor: Actor,
    input: { id?: string | null; name: string; description?: string | null; fields: FieldSpec[] },
    ts: string,
  ): string {
    const count = this.sql
      .exec<{ n: number }>(`select count(*) as n from collections where deleted_at is null`)
      .one().n;
    if (count >= SPACE_LIMITS.collections)
      throw new ObjectError(
        "validation_failed",
        `A space can have up to ${SPACE_LIMITS.collections} collections`,
      );
    const nk = nameKey(input.name);
    if (
      this.sql.exec(`select 1 from collections where name_key = ? and deleted_at is null`, nk).toArray()
        .length
    )
      throw new ObjectError("conflict", `There's already a collection called "${input.name}"`);
    const id = this.newId("collections", input.id);
    // The first text field is the title; add one if there's none.
    const specs = [...input.fields];
    if (!specs.some((f) => f.type === "text" && !f.options?.personal))
      specs.unshift({ name: "Title", type: "text", required: true });
    this.sql.exec(
      `insert into collections (id, name, name_key, description, title_field_id, position, created_at, updated_at)
       values (?, ?, ?, ?, '', ?, ?, ?)`,
      id,
      input.name.trim(),
      nk,
      input.description ?? null,
      count,
      ts,
      ts,
    );
    let titleId = "";
    specs.forEach((f, i) => {
      const fid = this.insertField(id, f, i, ts);
      if (!titleId && f.type === "text" && !f.options?.personal) titleId = fid;
    });
    this.sql.exec(`update collections set title_field_id = ? where id = ?`, titleId, id);
    this.logChange("collection", id, "upsert", ts);
    audit(this.sql, actor, {
      action: "create_collection",
      entityType: "collection",
      entityId: id,
      after: input,
    });
    return id;
  }

  /** A field's name and aliases must not match another live field's name or alias (rule 10). */
  private checkFieldNames(collectionId: string, exceptId: string | null, name: string, aliases: string[]) {
    const taken = new Map<string, string>();
    for (const other of this.fieldRows(collectionId)) {
      if (other.id === exceptId) continue;
      taken.set(other.name_key, other.name);
      for (const a of JSON.parse(other.aliases_json) as string[]) taken.set(nameKey(a), other.name);
    }
    const own = nameKey(name);
    for (const n of [name, ...aliases]) {
      const k = nameKey(n);
      const by = taken.get(k);
      if (by === undefined) continue;
      throw new ObjectError(
        "conflict",
        k === own && nameKey(by) === k
          ? `This collection already has a field called "${n}"`
          : `"${n}" already names the field "${by}"`,
      );
    }
    if (aliases.some((a) => nameKey(a) === own) || new Set(aliases.map(nameKey)).size !== aliases.length)
      throw new ObjectError("validation_failed", "Aliases must differ from the name and each other");
  }

  private insertField(collectionId: string, f: FieldSpec, position: number, ts: string): string {
    const nk = nameKey(f.name);
    this.checkFieldNames(collectionId, null, f.name, f.aliases ?? []);
    const options = this.checkOptions(f.type, f.options ?? {}, collectionId, null);
    if ((options.formula || options.rollup) && f.required)
      throw new ObjectError("validation_failed", `${f.name} is calculated; it can't be required`);
    if (options.personal && f.required)
      throw new ObjectError("validation_failed", `${f.name}: a personal answer can't be required`);
    const id = this.newId("fields", f.id);
    this.sql.exec(
      `insert into fields (id, collection_id, name, name_key, type, options_json, required, aliases_json, position, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      collectionId,
      f.name.trim(),
      nk,
      f.type,
      JSON.stringify(options),
      f.required ? 1 : 0,
      JSON.stringify(f.aliases ?? []),
      position,
      ts,
      ts,
    );
    return id;
  }

  /** Keeps only the options that fit the type; a link's target name becomes its id. */
  private checkOptions(
    type: FieldType,
    o: FieldOptions & { target?: string | null },
    collectionId: string,
    selfId: string | null,
  ): FieldOptions {
    if (o.personal && type === "link")
      throw new ObjectError("validation_failed", "Links can't be personal answers");
    const personal = o.personal && type !== "link" ? { personal: true } : {};
    const computed = this.computedOptions(type, o, collectionId, selfId);
    if (computed && o.personal)
      throw new ObjectError("validation_failed", "A calculated field can't be a personal answer");
    return { ...this.typeOptions(type, o), ...personal, ...computed };
  }

  /**
   * A formula or rollup, checked now: every field it names exists and has a type it can use,
   * and its result has the field's type. Formulas can't use other formulas (no loops).
   */
  private computedOptions(
    type: FieldType,
    o: FieldOptions,
    collectionId: string,
    selfId: string | null,
  ): Pick<FieldOptions, "formula" | "rollup"> | null {
    if (!o.formula && !o.rollup) return null;
    if (o.formula && o.rollup)
      throw new ObjectError("validation_failed", "A field is a formula or a rollup, not both");
    if (type !== "number" && type !== "money" && type !== "date")
      throw new ObjectError("validation_failed", "Calculated fields are number, money or date fields");
    const fields = this.fieldRows(collectionId).filter((f) => f.id !== selfId);
    if (o.formula) {
      let tree: FormulaNode;
      try {
        tree = parseFormula(o.formula);
      } catch (e) {
        throw new ObjectError("validation_failed", (e as Error).message);
      }
      const sample = (name: string): FormulaValue => {
        const f = this.matchField(fields, name);
        if (toField(f).options.formula)
          throw new ObjectError(
            "validation_failed",
            `${f.name} is a formula itself; use the fields it's made of`,
          );
        if (f.type === "number") return { t: "num", v: 1 };
        if (f.type === "money") return { t: "money", v: 100 };
        if (f.type === "date" || f.type === "datetime") return { t: "date", v: 0 };
        throw new ObjectError("validation_failed", `${f.name} isn't a number, money or date field`);
      };
      let out: FormulaValue;
      try {
        out = evalFormula(tree, sample);
      } catch (e) {
        if (e instanceof ObjectError) throw e;
        throw new ObjectError("validation_failed", (e as Error).message);
      }
      const want = type === "number" ? "num" : type;
      if (out && out.t !== want)
        throw new ObjectError(
          "validation_failed",
          `That formula gives ${out.t === "num" ? "a number" : out.t}, but the field is ${type}`,
        );
      return { formula: o.formula.trim() };
    }
    const r = o.rollup!;
    const { via, dir } = this.resolveVia(collectionId, r.via, fields);
    const linkedCollection = dir === "out" ? toField(via).options.target : via.collection_id;
    let of: string | null = null;
    if (r.fn === "count") {
      if (type !== "number") throw new ObjectError("validation_failed", "A count is a number field");
    } else {
      if (!r.of) throw new ObjectError("validation_failed", `Say which field to ${r.fn}`);
      if (!linkedCollection)
        throw new ObjectError(
          "validation_failed",
          "That link can point anywhere; pick a link to one collection",
        );
      const f = this.matchField(this.fieldRows(linkedCollection), r.of);
      const t = f.type === "datetime" ? "date" : f.type;
      if (r.fn === "sum" ? t !== "number" && t !== "money" : t !== "number" && t !== "money" && t !== "date")
        throw new ObjectError("validation_failed", `Can't ${r.fn} ${f.name}`);
      if (t !== type)
        throw new ObjectError("validation_failed", `${f.name} is ${t}, but this field is ${type}`);
      of = f.id;
    }
    let where: RuleFilter[] | undefined;
    if (r.where?.length) {
      if (!linkedCollection)
        throw new ObjectError(
          "validation_failed",
          "That link can point anywhere; pick a link to one collection to filter it",
        );
      // Stored values are worked out in writes, so nothing that changes by itself: no
      // "today"-style periods, and no "me" (whose?).
      for (const w of r.where)
        if (w.op === "period" || w.value === "me")
          throw new ObjectError(
            "validation_failed",
            "A calculated field can't filter by a period like today or by “me”; use fixed values",
          );
      where = this.checkViewQuery(this.requireCollection(linkedCollection), { filters: r.where })
        .filters as RuleFilter[];
    }
    return { rollup: { via: via.id, dir, fn: r.fn, of, ...(where ? { where } : {}) } };
  }

  /**
   * A link that reaches other records from this collection's records: one of its link
   * fields ("out"), or a link field elsewhere that points here, named by its collection
   * ("Payments") or collection and field ("Payments Gig") ("in").
   */
  private resolveVia(
    collectionId: string,
    ref: string,
    fields = this.fieldRows(collectionId),
  ): { via: FieldRow; dir: "out" | "in"; target: string | null } {
    // The link: one of this collection's link fields, or a link elsewhere that points here.
    const own = fields.find((f) => f.type === "link" && (f.id === ref || f.name_key === nameKey(ref)));
    if (own) return { via: own, dir: "out", target: toField(own).options.target ?? null };
    const incoming = this.sql
      .exec<FieldRow & { collection_name: string }>(
        `select f.*, c.name as collection_name from fields f join collections c on c.id = f.collection_id
           where f.type = 'link' and f.deleted_at is null and c.deleted_at is null`,
      )
      .toArray()
      .filter((f) => toField(f).options.target === collectionId)
      .filter(
        (f) =>
          f.id === ref ||
          nameKey(f.collection_name) === nameKey(ref) ||
          nameKey(`${f.collection_name} ${f.name}`) === nameKey(ref.replace(/[.:]/g, " ")),
      );
    if (incoming.length > 1)
      throw new ObjectError("ambiguous", `More than one link from ${ref}; which one?`, {
        candidates: incoming.map((f) => ({ id: f.id, name: `${f.collection_name}: ${f.name}` })),
      });
    if (!incoming.length)
      throw new ObjectError(
        "validation_failed",
        `"${ref}" isn't a link field here or a collection that links here`,
      );
    return { via: incoming[0]!, dir: "in", target: incoming[0]!.collection_id };
  }

  /** A link to one collection's records, for workflows (a link that can point anywhere won't do). */
  private linkPath(collectionId: string, ref: string): LinkPath & { target: string } {
    const { via, dir, target } = this.resolveVia(collectionId, ref.trim());
    if (!target)
      throw new ObjectError("validation_failed", `${via.name} can point anywhere; use a link to one list`);
    return { field_id: via.id, dir, target };
  }

  /** A link's name as people see it: the field here, or the list that links here. */
  private linkPathName(p: LinkPath): string {
    const f = this.liveField(p.field_id);
    if (!f) return "(removed link)";
    if (p.dir === "out") return f.name;
    return (
      this.sql
        .exec<{ name: string }>(`select name from collections where id = ?`, f.collection_id)
        .toArray()[0]?.name ?? f.name
    );
  }

  /** The live records linked to or from a record through a link. */
  private linkedIds(via: string, dir: "out" | "in", recordId: string): string[] {
    return this.sql
      .exec<{ id: string }>(
        dir === "in"
          ? `select l.from_id as id from links l join records x on x.id = l.from_id
             where l.field_id = ? and l.to_id = ? and x.deleted_at is null`
          : `select l.to_id as id from links l join records x on x.id = l.to_id
             where l.field_id = ? and l.from_id = ? and x.deleted_at is null`,
        via,
        recordId,
      )
      .toArray()
      .map((x) => x.id);
  }

  /** The calculated fields of a collection (none for most). */
  private computedFields(collectionId: string): FieldRow[] {
    return this.fieldRows(collectionId).filter((f) => {
      const o = toField(f).options;
      return !!(o.formula || o.rollup);
    });
  }

  /** A record's stored values right now. */
  private currentValues(recordId: string): Record<string, StoredValue> {
    const r = this.liveRecord(recordId);
    return r ? (JSON.parse(r.values_json) as Record<string, StoredValue>) : {};
  }

  /**
   * Recalculates a record's rollups, then its formulas, and saves them when they changed
   * (values and index, no new version). Called inside the write, so they're always current.
   */
  private recompute(recordId: string): boolean {
    const r = this.liveRecord(recordId);
    if (!r) return false;
    const computed = this.computedFields(r.collection_id);
    if (!computed.length) return false;
    const fields = this.fieldRows(r.collection_id);
    const values = JSON.parse(r.values_json) as Record<string, StoredValue>;
    const next: Record<string, StoredValue> = { ...values };
    for (const f of computed) {
      const ru = toField(f).options.rollup;
      if (!ru) continue;
      let ids = this.linkedIds(ru.via, ru.dir ?? "out", r.id);
      // Only the linked records that match (e.g. the shows among a gig's events).
      if (ru.where?.length && ids.length) ids = this.matching(ru, ids);
      if (ru.fn === "count") {
        next[f.id] = ids.length;
        continue;
      }
      const vals = ids
        .map((id) => this.currentValues(id)[ru.of!])
        .filter((v): v is string | number => typeof v === "number" || typeof v === "string");
      if (!vals.length) next[f.id] = ru.fn === "sum" ? 0 : null;
      else if (ru.fn === "sum") next[f.id] = (vals as number[]).reduce((a, b) => a + b, 0);
      else {
        const sorted = [...vals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const v = ru.fn === "min" ? sorted[0]! : sorted[sorted.length - 1]!;
        next[f.id] = f.type === "date" && typeof v === "string" ? v.slice(0, 10) : v;
      }
    }
    Object.assign(
      next,
      formulaValues(
        fields.map((f) => toField(f)),
        next,
      ),
    );
    if (computed.every((f) => JSON.stringify(next[f.id] ?? null) === JSON.stringify(values[f.id] ?? null)))
      return false;
    for (const [k, v] of Object.entries(next)) if (v === null) delete next[k];
    this.sql.exec(`update records set values_json = ? where id = ?`, JSON.stringify(next), r.id);
    for (const f of computed) {
      this.sql.exec(`delete from record_values where record_id = ? and field_id = ?`, r.id, f.id);
      const v = next[f.id];
      if (v === undefined || v === null) continue;
      for (const [num, txt] of this.indexOf(f.type, v))
        this.sql.exec(
          `insert into record_values (record_id, field_id, num, txt) values (?, ?, ?, ?)`,
          r.id,
          f.id,
          num,
          txt,
        );
    }
    return true;
  }

  /** The ids, among linked records, that match a rollup's filters (in chunks: few SQL args). */
  private matching(ru: NonNullable<FieldOptions["rollup"]>, ids: string[]): string[] {
    const via = this.liveField(ru.via);
    const target = via ? (ru.dir === "in" ? via.collection_id : toField(via).options.target) : null;
    return target ? this.matchingIn(target, (ru.where ?? []) as Filter[], ids) : [];
  }

  /** The ids, among these records of a collection, matching all the filters (few SQL args each). */
  private matchingIn(
    collectionId: string,
    filters: Filter[],
    ids: string[],
    actor: Actor = { userId: null, source: "system" },
  ): string[] {
    const c = this.sql
      .exec<CollectionRow>(`select * from collections where id = ? and deleted_at is null`, collectionId)
      .toArray()[0];
    if (!c) return [];
    if (!filters.length) return ids;
    const out: string[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      out.push(...this.findRows(actor, c, { filters, ids: part, limit: part.length }).rows.map((x) => x.id));
    }
    return out;
  }

  /** Records whose links a write just removed (their rollups change too). */
  private leftLinks: string[] = [];

  /** After a record changed: itself, then every record linked to or from it (and ones it left). */
  /**
   * A record whose calculated values may have moved because another record changed: save
   * them, and treat it as changed (its rules must still hold; its workflows see the change).
   */
  private refreshNeighbor(id: string, ts: string) {
    const r = this.liveRecord(id);
    if (!r) return;
    const before = JSON.parse(r.values_json) as Record<string, StoredValue>;
    if (!this.recompute(id)) return;
    this.logChange("record", id, "upsert", ts);
    const after = this.currentValues(id);
    const c = this.requireCollection(r.collection_id);
    this.enforceRules(c, id, before, after);
    this.queueWorkflows(c.id, id, before, after);
  }

  /** A new or changed calculated field: work it out for every record already there. */
  private backfill(collectionId: string, ts: string) {
    for (let after = ""; ;) {
      const batch = this.sql
        .exec<{ id: string }>(
          `select id from records where collection_id = ? and deleted_at is null and id > ? order by id limit 500`,
          collectionId,
          after,
        )
        .toArray();
      for (const r of batch) if (this.recompute(r.id)) this.logChange("record", r.id, "upsert", ts);
      if (batch.length < 500) break;
      after = batch[batch.length - 1]!.id;
    }
  }

  private recomputeAround(recordId: string, alsoIds: Iterable<string> = []) {
    this.recompute(recordId);
    const near = new Set<string>(alsoIds);
    for (const row of this.sql
      .exec<{ id: string }>(
        `select to_id as id from links where from_id = ? union select from_id as id from links where to_id = ?`,
        recordId,
        recordId,
      )
      .toArray())
      near.add(row.id);
    near.delete(recordId);
    const ts = nowIso();
    for (const id of near) this.refreshNeighbor(id, ts);
  }

  private typeOptions(type: FieldType, o: FieldOptions & { target?: string | null }): FieldOptions {
    if (type === "choice" || type === "multi_choice") {
      const choices = [...new Set((o.choices ?? []).map((c) => c.trim()).filter(Boolean))];
      if (!choices.length)
        throw new ObjectError("validation_failed", "A choice field needs at least one choice");
      return { choices };
    }
    if (type === "link") {
      const target = o.target ? this.requireCollection(o.target).id : null;
      return {
        target,
        many: !!o.many,
        ...(o.many && o.ordered ? { ordered: true } : {}),
        on_delete: o.on_delete ?? "unlink",
      };
    }
    return {};
  }

  async updateCollection(
    actor: Actor,
    key: string | null,
    collection: string,
    input: { name?: string; description?: string | null },
  ): Promise<CollectionView> {
    return this.write(actor, key, ["update_collection", collection, input], (ts) => {
      const c = this.requireCollection(collection);
      if (input.name !== undefined && nameKey(input.name) !== nameKey(c.name)) {
        if (
          this.sql
            .exec(`select 1 from collections where name_key = ? and deleted_at is null`, nameKey(input.name))
            .toArray().length
        )
          throw new ObjectError("conflict", `There's already a collection called "${input.name}"`);
      }
      this.sql.exec(
        `update collections set name = ?, name_key = ?, description = ?, updated_at = ? where id = ?`,
        input.name?.trim() ?? c.name,
        nameKey(input.name ?? c.name),
        input.description === undefined ? c.description : input.description,
        ts,
        c.id,
      );
      this.logChange("collection", c.id, "upsert", ts);
      audit(this.sql, actor, {
        action: "update_collection",
        entityType: "collection",
        entityId: c.id,
        before: { name: c.name, description: c.description },
        after: input,
      });
      return this.collectionView(this.requireCollection(c.id));
    });
  }

  async addField(
    actor: Actor,
    key: string | null,
    collection: string,
    field: FieldSpec,
  ): Promise<CollectionView> {
    return this.write(actor, key, ["add_field", collection, field], (ts) => {
      const c = this.requireCollection(collection);
      const n = this.sql
        .exec<{ n: number }>(
          `select count(*) as n from fields where collection_id = ? and deleted_at is null`,
          c.id,
        )
        .one().n;
      if (n >= SPACE_LIMITS.fieldsPerCollection)
        throw new ObjectError(
          "validation_failed",
          `A collection can have up to ${SPACE_LIMITS.fieldsPerCollection} fields`,
        );
      const id = this.insertField(c.id, field, n, ts);
      if (field.options?.formula || field.options?.rollup) this.backfill(c.id, ts);
      this.touchCollection(c.id, ts);
      audit(this.sql, actor, { action: "add_field", entityType: "field", entityId: id, after: field });
      return this.collectionView(this.requireCollection(c.id));
    });
  }

  async updateField(
    actor: Actor,
    key: string | null,
    collection: string,
    field: string,
    input: {
      name?: string;
      options?: FieldOptions & { target?: string | null };
      required?: boolean;
      aliases?: string[];
    },
  ): Promise<CollectionView> {
    return this.write(actor, key, ["update_field", collection, field, input], (ts) => {
      const c = this.requireCollection(collection);
      const f = this.requireField(c.id, field);
      const before = toField(f);
      this.checkFieldNames(c.id, f.id, input.name ?? f.name, input.aliases ?? before.aliases);
      let options = before.options;
      if (input.options !== undefined) {
        options = this.checkOptions(f.type, { ...before.options, ...input.options }, c.id, f.id);
        // Removing a choice that's in use would leave values nobody can pick again.
        if (f.type === "choice" || f.type === "multi_choice") {
          const kept = new Set(options.choices);
          const used = this.sql
            .exec<{ txt: string }>(`select distinct txt from record_values where field_id = ?`, f.id)
            .toArray()
            .map((r) => r.txt);
          const dropped = (before.options.choices ?? []).filter((ch) => !kept.has(ch) && used.includes(ch));
          if (dropped.length)
            throw new ObjectError(
              "conflict",
              `Records still use ${dropped.map((d) => `"${d}"`).join(", ")}; change them first`,
            );
        }
        // Existing links must still fit: one record each, and in the (new) target collection.
        if (f.type === "link") {
          if (before.options.many && !options.many) {
            const several = this.sql
              .exec(
                `select from_id from links where field_id = ? group by from_id having count(*) > 1 limit 1`,
                f.id,
              )
              .toArray().length;
            if (several)
              throw new ObjectError(
                "conflict",
                `Some records link more than one record in ${f.name}; unlink the extras first`,
              );
          }
          if (options.target && options.target !== before.options.target) {
            const outside = this.sql
              .exec(
                `select 1 from links l join records r on r.id = l.to_id
                 where l.field_id = ? and r.collection_id != ? limit 1`,
                f.id,
                options.target,
              )
              .toArray().length;
            if (outside)
              throw new ObjectError(
                "conflict",
                `Some records in ${f.name} link to another collection; unlink them first`,
              );
          }
        }
      }
      if (!!options.personal !== !!before.options.personal) {
        if (options.personal && f.id === c.title_field_id)
          throw new ObjectError("validation_failed", `${f.name} is the title; it can't be a personal answer`);
        // Values and answers are kept apart; switching would lose one or the other.
        const used =
          this.sql.exec(`select 1 from record_values where field_id = ? limit 1`, f.id).toArray().length +
          this.sql.exec(`select 1 from answers where field_id = ? limit 1`, f.id).toArray().length;
        if (used)
          throw new ObjectError(
            "conflict",
            `${f.name} already has values; add a new field to ${options.personal ? "collect personal answers" : "hold one value"}`,
          );
      }
      if (options.personal && (input.required ?? !!f.required))
        throw new ObjectError("validation_failed", `${f.name}: a personal answer can't be required`);
      // Nobody can type a calculated value, so it can't be required either.
      if ((options.formula || options.rollup) && (input.required ?? !!f.required))
        throw new ObjectError("validation_failed", `${f.name} is calculated; it can't be required`);
      this.sql.exec(
        `update fields set name = ?, name_key = ?, options_json = ?, required = ?, aliases_json = ?, updated_at = ? where id = ?`,
        input.name?.trim() ?? f.name,
        nameKey(input.name ?? f.name),
        JSON.stringify(options),
        input.required === undefined ? f.required : input.required ? 1 : 0,
        JSON.stringify(input.aliases ?? before.aliases),
        ts,
        f.id,
      );
      // A new formula or rollup, or a renamed field a formula may use: work them out again.
      if (this.computedFields(c.id).length) this.backfill(c.id, ts);
      this.touchCollection(c.id, ts);
      audit(this.sql, actor, {
        action: "update_field",
        entityType: "field",
        entityId: f.id,
        before,
        after: input,
      });
      return this.collectionView(this.requireCollection(c.id));
    });
  }

  /** Hides a field (its values stay in records, so it can come back). The title can't go. */
  async removeField(
    actor: Actor,
    key: string | null,
    collection: string,
    field: string,
  ): Promise<CollectionView> {
    return this.write(actor, key, ["remove_field", collection, field], (ts) => {
      const c = this.requireCollection(collection);
      const f = this.requireField(c.id, field);
      if (f.id === c.title_field_id)
        throw new ObjectError("conflict", "The title field can't be removed; rename it instead");
      // A rule that uses it would stop every write here: the rule goes first.
      const user = this.ruleRows(c.id).find((r) => {
        const d = JSON.parse(r.def_json) as RuleDef;
        return (
          d.field === f.id ||
          d.of === f.id ||
          d.fields.includes(f.id) ||
          [...d.require, ...d.only_if].some((x) => x.field === f.id)
        );
      });
      if (user)
        throw new ObjectError(
          "conflict",
          `${f.name} is used by a rule (${this.ruleView(user).words}); remove the rule first`,
          { reason: "rule", rule_id: user.id },
        );
      // So would a rollup elsewhere that filters by it, or a workflow that picks linked
      // records by it: those go (or change) first.
      const rollup = this.sql
        .exec<FieldRow>(`select * from fields where deleted_at is null and options_json like '%"where"%'`)
        .toArray()
        .find((g) => (toField(g).options.rollup?.where ?? []).some((w) => w.field === f.id));
      if (rollup)
        throw new ObjectError(
          "conflict",
          `${f.name} is used by the calculated field ${rollup.name}; change or remove it first`,
          { reason: "rollup", field_id: rollup.id },
        );
      const flow = this.sql
        .exec<WorkflowRow>(`select * from workflows where deleted_at is null`)
        .toArray()
        .find((w) =>
          (JSON.parse(w.def_json) as WorkflowDef).then.some(
            (a) => a.do === "set" && (a.where ?? []).some((x) => x.field === f.id),
          ),
        );
      if (flow)
        throw new ObjectError(
          "conflict",
          `${f.name} is used by the workflow ${flow.name}; change or remove it first`,
          { reason: "workflow", workflow_id: flow.id },
        );
      this.sql.exec(`update fields set deleted_at = ?, updated_at = ? where id = ?`, ts, ts, f.id);
      this.sql.exec(`delete from record_values where field_id = ?`, f.id);
      this.touchCollection(c.id, ts);
      audit(this.sql, actor, {
        action: "remove_field",
        entityType: "field",
        entityId: f.id,
        before: toField(f),
      });
      return this.collectionView(this.requireCollection(c.id));
    });
  }

  private touchCollection(id: string, ts: string) {
    this.sql.exec(`update collections set updated_at = ? where id = ?`, ts, id);
    this.logChange("collection", id, "upsert", ts);
  }

  private collectionView(c: CollectionRow): CollectionView {
    const fields = this.fieldRows(c.id).map(toField);
    const linkedFrom = this.sql
      .exec<{
        field_id: string;
        field: string;
        collection_id: string;
        collection: string;
        options_json: string;
      }>(
        `select f.id as field_id, f.name as field, c.id as collection_id, c.name as collection, f.options_json
         from fields f join collections c on c.id = f.collection_id
         where f.type = 'link' and f.deleted_at is null and c.deleted_at is null`,
      )
      .toArray()
      .filter((l) => (JSON.parse(l.options_json) as FieldOptions).target === c.id)
      .map(({ options_json: _o, ...rest }) => rest);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      title_field_id: c.title_field_id,
      fields,
      linked_from: linkedFrom,
      updated_at: c.updated_at,
    };
  }

  // --- Records ------------------------------------------------------------------------------

  async addRecord(
    actor: Actor,
    key: string | null,
    collection: string,
    input: { id?: string | null; values: Record<string, unknown> },
  ): Promise<RecordView> {
    return this.write(actor, key, ["add_record", collection, input], (ts) =>
      this.insertRecord(actor, ts, this.requireCollection(collection), input),
    );
  }

  private insertRecord(
    actor: Actor,
    ts: string,
    c: CollectionRow,
    input: { id?: string | null; values: Record<string, unknown> },
  ): RecordView {
    const fields = this.fieldRows(c.id);
    const { values, links, answers } = this.readValues(fields, input.values, actor);
    for (const f of fields)
      if (
        f.required &&
        (f.type === "link" ? !links.get(f.id)?.length : values[f.id] === null || values[f.id] === undefined)
      )
        throw new ObjectError("validation_failed", `${f.name} is required`);
    const id = this.newId("records", input.id);
    this.saveRecord(id, c, fields, values, ts, actor, true);
    this.saveAnswers(actor, id, answers, ts);
    for (const [fid, ids] of links)
      this.setLinks(
        fields.find((f) => f.id === fid)!,
        id,
        ids,
        ts,
      );
    this.recomputeAround(id, this.leftLinks.splice(0));
    this.enforceRules(c, id, null, this.currentValues(id));
    this.logChange("record", id, "upsert", ts);
    // Workflows see the stored values, calculated ones included.
    this.queueWorkflows(c.id, id, null, this.currentValues(id));
    audit(this.sql, actor, {
      action: "add_record",
      entityType: "record",
      entityId: id,
      after: input.values,
    });
    return this.recordView(this.requireRecord(id), actor);
  }

  /** Whether a write to these values touches a money field (MCP asks for confirmation then). */
  async touchesMoney(
    actor: Actor,
    target: { collection?: string; recordId?: string },
    keys: string[],
  ): Promise<boolean> {
    this.role(actor);
    const collectionId = target.recordId
      ? this.sql
          .exec<{ collection_id: string }>(
            `select collection_id from records where id = ? and deleted_at is null`,
            target.recordId,
          )
          .toArray()[0]?.collection_id
      : target.collection
        ? this.sql
            .exec<{ id: string }>(
              `select id from collections where deleted_at is null and (id = ? or name_key = ?)`,
              target.collection,
              nameKey(target.collection),
            )
            .toArray()[0]?.id
        : undefined;
    // Unknown collections, records or fields fail in the write itself.
    if (!collectionId) return false;
    const fields = this.fieldRows(collectionId);
    return keys.some((k) => {
      try {
        return this.matchField(fields, k).type === "money";
      } catch {
        return false;
      }
    });
  }

  async getRecord(actor: Actor, recordId: string): Promise<RecordView> {
    this.role(actor);
    return this.recordView(this.requireRecord(recordId), actor);
  }

  async updateRecord(
    actor: Actor,
    key: string | null,
    recordId: string,
    input: { values: Record<string, unknown>; version?: number },
  ): Promise<RecordView> {
    return this.write(actor, key, ["update_record", recordId, input], (ts) =>
      this.changeRecord(actor, ts, this.requireRecord(recordId), input),
    );
  }

  /** Several changes in one write: if any is refused (a rule, a flow), none is kept. */
  async updateRecords(
    actor: Actor,
    key: string | null,
    changes: { record_id: string; values: Record<string, unknown> }[],
  ): Promise<RecordView[]> {
    return this.write(actor, key, ["update_records", changes], (ts) =>
      changes.map((c) => this.changeRecord(actor, ts, this.requireRecord(c.record_id), { values: c.values })),
    );
  }

  private changeRecord(
    actor: Actor,
    ts: string,
    r: RecordRow,
    input: { values: Record<string, unknown>; version?: number },
  ): RecordView {
    if (input.version !== undefined && input.version !== r.version)
      throw new ObjectError("conflict", "This record changed since you read it; reload and try again", {
        reason: "stale_version",
      });
    const c = this.requireCollection(r.collection_id);
    const fields = this.fieldRows(c.id);
    const before = JSON.parse(r.values_json) as Record<string, StoredValue>;
    const { values, links, answers } = this.readValues(fields, input.values, actor);
    const merged = { ...before, ...values };
    for (const f of fields)
      if (
        f.required &&
        (f.type === "link"
          ? links.has(f.id) && !links.get(f.id)!.length
          : f.id in values && (merged[f.id] === null || merged[f.id] === undefined))
      )
        throw new ObjectError("validation_failed", `${f.name} is required`);
    this.saveRecord(r.id, c, fields, merged, ts, actor, false);
    for (const [fid, ids] of links)
      this.setLinks(
        fields.find((f) => f.id === fid)!,
        r.id,
        ids,
        ts,
      );
    const answered = this.saveAnswers(actor, r.id, answers, ts);
    this.recomputeAround(r.id, this.leftLinks.splice(0));
    this.enforceRules(c, r.id, before, this.currentValues(r.id));
    this.logChange("record", r.id, "upsert", ts);
    // Links and personal answers live apart from the values; they count as a change too.
    this.queueWorkflows(c.id, r.id, before, this.currentValues(r.id), links.size > 0 || answers.size > 0);
    audit(this.sql, actor, {
      action: "update_record",
      entityType: "record",
      entityId: r.id,
      // A personal answer's "before" is this person's own earlier answer.
      before: {
        ...Object.fromEntries(Object.keys(values).map((k) => [k, before[k] ?? null])),
        ...answered,
      },
      after: input.values,
    });
    return this.recordView(this.requireRecord(r.id), actor);
  }

  /** Soft delete; links to it follow each link field's rule (unlink / block / cascade). */
  async deleteRecord(actor: Actor, key: string | null, recordId: string): Promise<{ deleted: string[] }> {
    return this.write(actor, key, ["delete_record", recordId], (ts) => {
      const deleted: string[] = [];
      this.removeRecord(this.requireRecord(recordId), ts, actor, deleted, 0);
      return { deleted };
    });
  }

  private removeRecord(r: RecordRow, ts: string, actor: Actor, deleted: string[], depth: number) {
    if (depth > 5 || deleted.includes(r.id)) return;
    // Records that point at this one, by the pointing field's rule.
    const incoming = this.sql
      .exec<{ field_id: string; from_id: string; options_json: string; name: string }>(
        `select l.field_id, l.from_id, f.options_json, f.name from links l join fields f on f.id = l.field_id
         where l.to_id = ?`,
        r.id,
      )
      .toArray();
    for (const l of incoming) {
      const rule = (JSON.parse(l.options_json) as FieldOptions).on_delete ?? "unlink";
      if (rule === "block")
        throw new ObjectError("conflict", `"${r.title}" is still linked from ${l.name}; unlink it first`);
    }
    // Records it linked to, or that link to it: their rollups change once it's gone.
    const near = [
      ...incoming.map((l) => l.from_id),
      ...this.sql
        .exec<{ to_id: string }>(`select to_id from links where from_id = ?`, r.id)
        .toArray()
        .map((x) => x.to_id),
    ];
    this.sql.exec(`update records set deleted_at = ?, updated_at = ? where id = ?`, ts, ts, r.id);
    this.sql.exec(`delete from record_values where record_id = ?`, r.id);
    this.sql.exec(`delete from record_words where record_id = ?`, r.id);
    deleted.push(r.id);
    this.logChange("record", r.id, "delete", ts);
    audit(this.sql, actor, {
      action: "delete_record",
      entityType: "record",
      entityId: r.id,
      before: { title: r.title },
    });
    for (const l of incoming) {
      const rule = (JSON.parse(l.options_json) as FieldOptions).on_delete ?? "unlink";
      if (rule === "cascade") {
        const from = this.sql
          .exec<RecordRow>(`select * from records where id = ? and deleted_at is null`, l.from_id)
          .toArray()[0];
        if (from) this.removeRecord(from, ts, actor, deleted, depth + 1);
      } else {
        this.sql.exec(
          `delete from links where field_id = ? and from_id = ? and to_id = ?`,
          l.field_id,
          l.from_id,
          r.id,
        );
        this.logChange("record", l.from_id, "upsert", ts);
      }
    }
    this.sql.exec(`delete from links where from_id = ?`, r.id);
    for (const id of new Set(near)) if (!deleted.includes(id)) this.refreshNeighbor(id, ts);
  }

  async linkRecords(
    actor: Actor,
    key: string | null,
    recordId: string,
    field: string,
    to: string[],
    after?: string | null,
  ): Promise<RecordView> {
    return this.write(actor, key, ["link", recordId, field, to, after], (ts) => {
      const r = this.requireRecord(recordId);
      const f = this.requireField(r.collection_id, field);
      if (f.type !== "link") throw new ObjectError("validation_failed", `${f.name} isn't a link field`);
      const ids = to.map((t) => this.resolveRecord(f, t));
      const opts = toField(f).options;
      const current = this.linkRows(f.id, r.id).map((l) => l.to_id);
      if (!opts.many) {
        if (ids.length > 1) throw new ObjectError("validation_failed", `${f.name} takes one record`);
        this.setLinks(f, r.id, ids, ts);
      } else {
        const add = ids.filter((id) => !current.includes(id));
        if (current.length + add.length > SPACE_LIMITS.linksPerField)
          throw new ObjectError(
            "validation_failed",
            `${f.name} can link up to ${SPACE_LIMITS.linksPerField} records`,
          );
        const positions = this.positionsAfter(f.id, r.id, after, add.length);
        add.forEach((id, i) =>
          this.sql.exec(
            `insert into links (field_id, from_id, to_id, position, created_at) values (?, ?, ?, ?, ?)`,
            f.id,
            r.id,
            id,
            positions[i]!,
            ts,
          ),
        );
      }
      this.touchRecord(r.id, ts);
      this.enforceLinkRules(this.requireRecord(r.id));
      audit(this.sql, actor, {
        action: "link_records",
        entityType: "record",
        entityId: r.id,
        after: { field: f.name, to: ids },
      });
      return this.recordView(this.requireRecord(r.id), actor);
    });
  }

  async unlinkRecords(
    actor: Actor,
    key: string | null,
    recordId: string,
    field: string,
    to: string[],
  ): Promise<RecordView> {
    return this.write(actor, key, ["unlink", recordId, field, to], (ts) => {
      const r = this.requireRecord(recordId);
      const f = this.requireField(r.collection_id, field);
      if (f.type !== "link") throw new ObjectError("validation_failed", `${f.name} isn't a link field`);
      for (const id of to)
        this.sql.exec(`delete from links where field_id = ? and from_id = ? and to_id = ?`, f.id, r.id, id);
      this.touchRecord(r.id, ts, to);
      this.enforceLinkRules(this.requireRecord(r.id));
      audit(this.sql, actor, {
        action: "unlink_records",
        entityType: "record",
        entityId: r.id,
        before: { field: f.name, to },
      });
      return this.recordView(this.requireRecord(r.id), actor);
    });
  }

  private touchRecord(id: string, ts: string, unlinked: string[] = []) {
    this.sql.exec(`update records set updated_at = ?, version = version + 1 where id = ?`, ts, id);
    this.logChange("record", id, "upsert", ts);
    this.recomputeAround(id, unlinked);
  }

  /** Splits input values (by field name, alias or id) into stored values and link targets. */
  private readValues(fields: FieldRow[], input: Record<string, unknown>, actor: Actor | null = null) {
    const values: Record<string, StoredValue> = {};
    const links = new Map<string, string[]>();
    const answers = new Map<string, StoredValue>();
    for (const [k, raw] of Object.entries(input)) {
      const f = this.matchField(fields, k);
      if (f.type === "link") {
        const list = raw === null || raw === "" ? [] : Array.isArray(raw) ? raw : [raw];
        const opts = toField(f).options;
        if (!opts.many && list.length > 1)
          throw new ObjectError("validation_failed", `${f.name} takes one record`);
        links.set(
          f.id,
          list.map((t) => {
            const v = typeof t === "object" && t && "id" in t ? (t as { id: unknown }).id : t;
            if (typeof v !== "string")
              throw new ObjectError("validation_failed", `${f.name}: expected a record id or title`);
            return this.resolveRecord(f, v);
          }),
        );
      } else if (toField(f).options.personal) {
        answers.set(f.id, normalizeValue(toField(f), raw));
      } else {
        if (toField(f).options.formula || toField(f).options.rollup)
          throw new ObjectError("validation_failed", `${f.name} is calculated; it can't be set`);
        values[f.id] =
          f.type === "person" ? this.personValue(f, raw, actor) : normalizeValue(toField(f), raw);
      }
    }
    return { values, links, answers };
  }

  /** The person's own answers to personal fields (null clears theirs). */
  private saveAnswers(
    actor: Actor,
    recordId: string,
    answers: Map<string, StoredValue>,
    ts: string,
  ): Record<string, StoredValue> {
    const before: Record<string, StoredValue> = {};
    if (!answers.size) return before;
    if (!actor.userId) throw new ObjectError("forbidden", "Sign in to give your own answer");
    for (const [fieldId, v] of answers) {
      const old = this.sql
        .exec<{ value_json: string }>(
          `select value_json from answers where record_id = ? and field_id = ? and user_id = ?`,
          recordId,
          fieldId,
          actor.userId,
        )
        .toArray()[0];
      before[fieldId] = old ? (JSON.parse(old.value_json) as StoredValue) : null;
      if (v === null || v === undefined)
        this.sql.exec(
          `delete from answers where record_id = ? and field_id = ? and user_id = ?`,
          recordId,
          fieldId,
          actor.userId,
        );
      else
        this.sql.exec(
          `insert into answers (record_id, field_id, user_id, value_json, updated_at) values (?, ?, ?, ?, ?)
           on conflict (record_id, field_id, user_id) do update set value_json = excluded.value_json, updated_at = excluded.updated_at`,
          recordId,
          fieldId,
          actor.userId,
          JSON.stringify(v),
          ts,
        );
    }
    return before;
  }

  /** Someone in the space or in one of its shares (the only people a record can point at). */
  private knownPerson(userId: string): boolean {
    return (
      this.sql.exec(`select 1 from members where user_id = ?`, userId).toArray().length > 0 ||
      this.sql.exec(`select 1 from share_people where user_id = ? limit 1`, userId).toArray().length > 0
    );
  }

  /** A person value: "me" is whoever writes; an account id only counts if the space knows them. */
  private personValue(f: FieldRow, raw: unknown, actor: Actor | null): StoredValue {
    if (typeof raw === "string" && nameKey(raw) === "me" && actor?.userId)
      return { user_id: actor.userId, name: this.personNames([actor.userId]).get(actor.userId) ?? "me" };
    // An account id of someone the space knows (from list_people) is that person.
    if (typeof raw === "string" && this.knownPerson(raw.trim()))
      return { user_id: raw.trim(), name: this.personNames([raw.trim()]).get(raw.trim()) ?? raw.trim() };
    const v = normalizeValue(toField(f), raw);
    if (v && typeof v === "object" && !Array.isArray(v) && v.user_id && !this.knownPerson(v.user_id))
      return { user_id: null, name: v.name };
    return v;
  }

  /** Names of these people: from the space's people, else from the shares they joined. */
  private personNames(ids: string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const id of ids) {
      const name =
        this.sql.exec<{ name: string }>(`select name from members where user_id = ?`, id).toArray()[0]
          ?.name ??
        this.sql
          .exec<{ name: string }>(`select name from share_people where user_id = ? limit 1`, id)
          .toArray()[0]?.name;
      if (name) out.set(id, name);
    }
    return out;
  }

  private saveRecord(
    id: string,
    c: CollectionRow,
    fields: FieldRow[],
    values: Record<string, StoredValue>,
    ts: string,
    actor: Actor,
    isNew: boolean,
  ) {
    // Only live fields' values are kept in the index; hidden fields keep their stored value.
    for (const [k, v] of Object.entries(values)) if (v === null) delete values[k];
    const titleRaw = values[c.title_field_id];
    const title = typeof titleRaw === "string" && titleRaw ? titleRaw : "Untitled";
    if (isNew) {
      this.sql.exec(
        `insert into records (id, collection_id, values_json, title, title_key, created_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        c.id,
        JSON.stringify(values),
        title,
        nameKey(title),
        actor.userId,
        ts,
        ts,
      );
    } else {
      this.sql.exec(
        `update records set values_json = ?, title = ?, title_key = ?, updated_at = ?, version = version + 1 where id = ?`,
        JSON.stringify(values),
        title,
        nameKey(title),
        ts,
        id,
      );
    }
    this.sql.exec(`delete from record_values where record_id = ?`, id);
    for (const f of fields) {
      const v = values[f.id];
      if (v === undefined || v === null || f.type === "link") continue;
      for (const [num, txt] of this.indexOf(f.type, v))
        this.sql.exec(
          `insert into record_values (record_id, field_id, num, txt) values (?, ?, ?, ?)`,
          id,
          f.id,
          num,
          txt,
        );
    }
    this.sql.exec(`delete from record_words where record_id = ?`, id);
    for (const w of words(title))
      this.sql.exec(`insert or ignore into record_words (word, record_id) values (?, ?)`, w, id);
  }

  /** How a value is indexed: numbers in `num`, everything else as comparable text. */
  private indexOf(type: FieldType, v: StoredValue): [number | null, string | null][] {
    switch (type) {
      case "number":
      case "money":
        return [[v as number, null]];
      case "boolean":
        return [[v ? 1 : 0, null]];
      case "multi_choice":
        return (v as string[]).map((c) => [null, c]);
      case "person": {
        const p = v as { user_id: string | null; name: string };
        return [[null, p.user_id ? `user:${p.user_id}` : `name:${nameKey(p.name)}`]];
      }
      case "text":
      case "long_text":
        return [[null, (v as string).toLowerCase().slice(0, 300)]];
      default:
        return [[null, String(v)]];
    }
  }

  private setLinks(f: FieldRow, fromId: string, ids: string[], ts: string) {
    // Records it stops linking to need their rollups recalculated.
    for (const row of this.linkRows(f.id, fromId))
      if (!ids.includes(row.to_id)) this.leftLinks.push(row.to_id);
    this.sql.exec(`delete from links where field_id = ? and from_id = ?`, f.id, fromId);
    [...new Set(ids)].forEach((to, i) =>
      this.sql.exec(
        `insert into links (field_id, from_id, to_id, position, created_at) values (?, ?, ?, ?, ?)`,
        f.id,
        fromId,
        to,
        i + 1,
        ts,
      ),
    );
  }

  private linkRows(fieldId: string, fromId: string) {
    return this.sql
      .exec<{ to_id: string; position: number }>(
        `select to_id, position from links where field_id = ? and from_id = ? order by position, created_at`,
        fieldId,
        fromId,
      )
      .toArray();
  }

  /** `count` positions after `after` (null: first; undefined: last) in an ordered link list. */
  private positionsAfter(
    fieldId: string,
    fromId: string,
    after: string | null | undefined,
    count: number,
  ): number[] {
    const rows = this.linkRows(fieldId, fromId);
    const at =
      after === undefined ? rows.length : after === null ? 0 : rows.findIndex((r) => r.to_id === after) + 1;
    const lo = at > 0 ? rows[at - 1]!.position : (rows[0]?.position ?? 1) - 1;
    const hi = at < rows.length ? rows[at]!.position : lo + count + 1;
    const step = (hi - lo) / (count + 1);
    if (step < 1e-6) {
      rows.forEach((r, i) =>
        this.sql.exec(
          `update links set position = ? where field_id = ? and from_id = ? and to_id = ?`,
          i + 1,
          fieldId,
          fromId,
          r.to_id,
        ),
      );
      return this.positionsAfter(fieldId, fromId, after, count);
    }
    return Array.from({ length: count }, (_, i) => lo + step * (i + 1));
  }

  /**
   * A record as the space's people see it. Personal fields show the asking person's own answer
   * in `values`, and everyone's in `answers`.
   */
  private recordView(r: RecordRow, actor?: Actor): RecordView {
    const fields = this.fieldRows(r.collection_id);
    const values = JSON.parse(r.values_json) as Record<string, StoredValue>;
    const live: Record<string, StoredValue> = {};
    const named: Record<string, string | string[] | null> = {};
    const links: Record<string, LinkedRef[]> = {};
    const personal = fields.filter((f) => toField(f).options.personal);
    let answers: RecordView["answers"];
    if (personal.length) {
      const rows = this.sql
        .exec<{ field_id: string; user_id: string; value_json: string }>(
          `select field_id, user_id, value_json from answers where record_id = ? order by updated_at`,
          r.id,
        )
        .toArray();
      const names = this.personNames([...new Set(rows.map((a) => a.user_id))]);
      answers = {};
      for (const f of personal) {
        const mine = rows.find((a) => a.field_id === f.id && a.user_id === actor?.userId);
        const v = mine ? (JSON.parse(mine.value_json) as StoredValue) : null;
        live[f.id] = v;
        named[f.name] = displayValue(f.type, v);
        answers[f.id] = rows
          .filter((a) => a.field_id === f.id)
          .map((a) => {
            const value = JSON.parse(a.value_json) as StoredValue;
            return {
              user_id: a.user_id,
              name: names.get(a.user_id) ?? "Someone",
              value,
              display: displayValue(f.type, value),
            };
          });
      }
    }
    for (const f of fields) {
      if (toField(f).options.personal) continue;
      if (f.type === "link") {
        const refs = this.sql
          .exec<{ id: string; collection_id: string; title: string }>(
            `select r.id, r.collection_id, r.title from links l join records r on r.id = l.to_id
             where l.field_id = ? and l.from_id = ? and r.deleted_at is null order by l.position, l.created_at`,
            f.id,
            r.id,
          )
          .toArray();
        links[f.id] = refs;
        named[f.name] = refs.length ? refs.map((x) => x.title) : null;
      } else {
        const v = values[f.id] ?? null;
        live[f.id] = v;
        named[f.name] = displayValue(f.type, v);
      }
    }
    return {
      id: r.id,
      collection_id: r.collection_id,
      title: r.title,
      values: live,
      named,
      links,
      ...(answers ? { answers } : {}),
      created_at: r.created_at,
      updated_at: r.updated_at,
      version: r.version,
    };
  }

  // --- Finding ------------------------------------------------------------------------------

  async find(
    actor: Actor,
    collection: string,
    q: {
      filters: Filter[];
      search?: string;
      sort?: { field: string; dir: "asc" | "desc" };
      limit: number;
      cursor?: string;
    },
  ): Promise<FindResult> {
    this.role(actor);
    const c = this.requireCollection(collection);
    const { rows, next_cursor } = this.findRows(actor, c, q);
    return { items: rows.map((r) => this.recordView(r, actor)), next_cursor };
  }

  /** The find itself, without the role check (shares check their own access first). */
  private findRows(
    actor: Actor,
    c: CollectionRow,
    q: {
      filters: Filter[];
      search?: string;
      sort?: { field: string; dir: "asc" | "desc" };
      limit: number;
      cursor?: string;
      ids?: string[];
    },
  ): { rows: RecordRow[]; next_cursor: string | null } {
    const fields = this.fieldRows(c.id);
    const where: string[] = [`r.collection_id = ?`, `r.deleted_at is null`];
    const args: unknown[] = [c.id];
    for (const flt of q.filters) {
      const f = this.matchField(fields, flt.field);
      const [clause, a] = this.filterClause(f, flt, actor);
      where.push(clause);
      args.push(...a);
    }
    if (q.ids) {
      where.push(`r.id in (${q.ids.map(() => "?").join(", ") || "null"})`);
      args.push(...q.ids);
    }
    for (const w of words(q.search ?? "").slice(0, 5)) {
      where.push(`r.id in (select record_id from record_words where word >= ? and word < ?)`);
      args.push(w, `${w}￿`);
    }
    let order = `r.created_at desc, r.id desc`;
    if (q.sort) {
      const f = this.matchField(fields, q.sort.field);
      if (toField(f).options.personal)
        throw new ObjectError("validation_failed", `${f.name} is a personal answer; it can't be sorted yet`);
      const dir = q.sort.dir === "desc" ? "desc" : "asc";
      if (f.id === c.title_field_id) order = `r.title_key ${dir}, r.id`;
      else {
        const col = f.type === "number" || f.type === "money" || f.type === "boolean" ? "num" : "txt";
        order = `(select ${col} from record_values v where v.record_id = r.id and v.field_id = ?) is null, (select ${col} from record_values v where v.record_id = r.id and v.field_id = ?) ${dir}, r.id`;
        args.push(f.id, f.id);
      }
    }
    const offset = q.cursor ? Number((decodeCursor(q.cursor) ?? [0])[0]) || 0 : 0;
    const rows = this.sql
      .exec<RecordRow>(
        `select r.* from records r where ${where.join(" and ")} order by ${order} limit ? offset ?`,
        ...(args as SqlStorageValue[]),
        q.limit + 1,
        offset,
      )
      .toArray();
    const more = rows.length > q.limit;
    return {
      rows: rows.slice(0, q.limit),
      next_cursor: more ? encodeCursor([offset + q.limit]) : null,
    };
  }

  private filterClause(f: FieldRow, flt: Filter, actor: Actor): [string, unknown[]] {
    if (toField(f).options.personal)
      throw new ObjectError("validation_failed", `${f.name} is a personal answer; it can't be filtered yet`);
    const op = flt.op;
    const sub = (cond: string) =>
      `r.id in (select record_id from record_values where field_id = ? and ${cond})`;
    const notSub = (cond: string) =>
      `r.id not in (select record_id from record_values where field_id = ? and ${cond})`;
    if (f.type === "link") {
      if (op === "empty") return [`r.id not in (select from_id from links where field_id = ?)`, [f.id]];
      if (op === "not_empty") return [`r.id in (select from_id from links where field_id = ?)`, [f.id]];
      if (op === "eq" || op === "in") {
        const list = (Array.isArray(flt.value) ? flt.value : [flt.value]).map((v) =>
          this.resolveRecord(f, String(v)),
        );
        return [
          `r.id in (select from_id from links where field_id = ? and to_id in (${list.map(() => "?").join(", ")}))`,
          [f.id, ...list],
        ];
      }
      throw new ObjectError(
        "validation_failed",
        `${f.name}: links can be filtered with eq, in, empty or not_empty`,
      );
    }
    if (op === "empty")
      return [`r.id not in (select record_id from record_values where field_id = ?)`, [f.id]];
    if (op === "not_empty")
      return [`r.id in (select record_id from record_values where field_id = ?)`, [f.id]];
    const numeric = f.type === "number" || f.type === "money" || f.type === "boolean";
    const col = numeric ? "num" : "txt";
    if (op === "period") {
      if (f.type !== "date" && f.type !== "datetime")
        throw new ObjectError("validation_failed", `${f.name}: "period" works on dates`);
      const p = periodRange(String(flt.value) as Period);
      const [from, to] = f.type === "date" ? [p.fromDate, p.toDate] : [p.from, p.to];
      const conds: string[] = [];
      const a: unknown[] = [f.id];
      if (from) {
        conds.push(`txt >= ?`);
        a.push(from);
      }
      if (to) {
        conds.push(`txt < ?`);
        a.push(to);
      }
      return [sub(conds.join(" and ") || "1"), a];
    }
    const value = (raw: unknown): unknown => {
      if (f.type === "person") {
        if (raw === "me") return `user:${actor.userId}`;
        // A stored person value (rules compare records' own values), or an id or a name.
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          const p = raw as { user_id?: string | null; name?: string };
          return p.user_id ? `user:${p.user_id}` : `name:${nameKey(p.name ?? "")}`;
        }
        const s = String(raw);
        return this.knownPerson(s) ? `user:${s}` : `name:${nameKey(s)}`;
      }
      const v = normalizeValue(toField(f), raw);
      if (v === null) throw new ObjectError("validation_failed", `${f.name}: a value is needed`);
      return this.indexOf(f.type, Array.isArray(v) ? v[0]! : v)[0]![numeric ? 0 : 1];
    };
    switch (op) {
      case "eq":
        return [sub(`${col} = ?`), [f.id, value(flt.value)]];
      case "ne":
        return [notSub(`${col} = ?`), [f.id, value(flt.value)]];
      case "lt":
      case "lte":
      case "gt":
      case "gte": {
        const sym = { lt: "<", lte: "<=", gt: ">", gte: ">=" }[op];
        return [sub(`${col} ${sym} ?`), [f.id, value(flt.value)]];
      }
      case "in": {
        const list = (Array.isArray(flt.value) ? flt.value : [flt.value]).map(value);
        return [sub(`${col} in (${list.map(() => "?").join(", ")})`), [f.id, ...list]];
      }
      case "contains": {
        if (numeric) throw new ObjectError("validation_failed", `${f.name}: "contains" works on text`);
        const pattern = `%${escapeLike(String(flt.value ?? "").toLowerCase())}%`;
        // Text is matched on the whole stored value (the index keeps only a prefix); a
        // "contains" can't use an index either way, and the collection filter bounds the scan.
        if (f.type === "text" || f.type === "long_text")
          return [`lower(json_extract(r.values_json, ?)) like ? escape '\\'`, [`$."${f.id}"`, pattern]];
        return [sub(`lower(txt) like ? escape '\\'`), [f.id, pattern]];
      }
    }
    throw new ObjectError("validation_failed", `Unknown filter "${op}"`);
  }

  // --- What changed, and Undo (home-first.md §2 decision 14) ------------------------------
  // Read from the audit log the writes already keep. An add or a change can be undone (the
  // values go back); a delete can't, its values are gone with it.

  async history(actor: Actor, limit: number): Promise<HistoryItem[]> {
    this.role(actor);
    type Row = {
      id: string;
      at: string;
      actor_user_id: string | null;
      source: string;
      action: string;
      entity_id: string;
      before_json: string | null;
      after_json: string | null;
    };
    const rows = this.sql
      .exec<Row>(
        `select change_id as id, at, actor_user_id, source, action, entity_id, before_json, after_json from _audit
         where change_id is not null and entity_type = 'record'
           and action in ('add_record', 'update_record', 'delete_record', 'undo')
         order by rowid desc limit ?`,
        limit * 2,
      )
      .toArray();
    const undone = new Map<string, string>();
    for (const r of rows)
      if (r.action === "undo") {
        const b = JSON.parse(r.before_json ?? "{}") as { change_id?: string };
        if (b.change_id) undone.set(b.change_id, r.id);
      }
    const names = new Map(
      this.sql
        .exec<{ user_id: string; name: string }>(`select user_id, name from members`)
        .toArray()
        .map((m) => [m.user_id, m.name]),
    );
    const out: HistoryItem[] = [];
    for (const r of rows) {
      if (r.action === "undo") continue;
      const rec = this.sql
        .exec<{ title: string; collection_id: string; deleted_at: string | null }>(
          `select title, collection_id, deleted_at from records where id = ?`,
          r.entity_id,
        )
        .toArray()[0];
      if (!rec) continue;
      const c = this.sql
        .exec<{ name: string }>(`select name from collections where id = ?`, rec.collection_id)
        .toArray()[0];
      const fields = this.fieldRows(rec.collection_id);
      const before = (JSON.parse(r.before_json ?? "null") ?? {}) as Record<string, unknown>;
      const after = (JSON.parse(r.after_json ?? "null") ?? {}) as Record<string, unknown>;
      // Stored values show as the app shows them; what the writer sent ("500" for money)
      // is read the way the write read it, so both sides of "→" look the same.
      const show = (f: FieldRow | null, v: unknown, raw = false) => {
        if (v === null || v === undefined || v === "") return "empty";
        if (!f) return String(v);
        try {
          const value = raw ? normalizeValue(toField(f), v) : (v as StoredValue);
          if ((f.type === "date" || f.type === "datetime") && typeof value === "string")
            return readableDate(value);
          return displayValue(f.type, value);
        } catch {
          return String(v);
        }
      };
      const field = (k: string) => {
        try {
          return this.matchField(fields, k);
        } catch {
          return null;
        }
      };
      const lines: string[] = [];
      if (r.action === "update_record") {
        // `before` is keyed by field id; `after` as the writer sent it (ids or names).
        const afterByKey = new Map(Object.entries(after).map(([k, v]) => [field(k)?.id ?? k, v]));
        for (const [k, was] of Object.entries(before)) {
          const f = field(k);
          const now = afterByKey.get(f?.id ?? k);
          lines.push(`${f?.name ?? k}: ${show(f, was)} → ${show(f, now, true)}`);
        }
      } else if (r.action === "add_record") {
        for (const [k, v] of Object.entries(after)) {
          const f = field(k);
          lines.push(`${f?.name ?? k}: ${show(f, v, true)}`);
        }
      }
      const action = r.action as HistoryItem["action"];
      // Undo must be able to do something: the record still there, and for a change at least
      // one field that can be put back (not a link, not calculated).
      const canUndo =
        !rec.deleted_at &&
        !undone.has(r.id) &&
        (action === "add_record" ||
          (action === "update_record" && Object.keys(this.revertible(fields, before)).length > 0));
      out.push({
        id: r.id,
        at: r.at,
        action,
        record_id: r.entity_id,
        title: rec.title,
        collection: c?.name ?? "",
        lines,
        by: r.actor_user_id === actor.userId ? "you" : (names.get(r.actor_user_id ?? "") ?? r.source),
        source: r.source,
        undoable: canUndo,
        undone_by: undone.get(r.id) ?? null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Puts a change back (values as they were) or removes an added record. */
  async undo(
    actor: Actor,
    key: string | null,
    changeId: string,
  ): Promise<{ undone: string; record: RecordView | null }> {
    return this.write(actor, key, ["undo", changeId], (ts) => {
      const row = this.sql
        .exec<{
          id: string;
          action: string;
          entity_type: string;
          entity_id: string;
          before_json: string | null;
        }>(
          `select change_id as id, action, entity_type, entity_id, before_json from _audit where change_id = ?`,
          changeId,
        )
        .toArray()[0];
      if (!row || row.entity_type !== "record") throw new ObjectError("not_found", "No such change");
      const already = this.sql
        .exec<{ n: number }>(
          `select count(*) as n from _audit where action = 'undo' and before_json like ?`,
          `%"change_id":"${row.id}"%`,
        )
        .one().n;
      if (already) throw new ObjectError("conflict", "That change was already undone");
      let record: RecordView | null = null;
      if (row.action === "update_record") {
        const before = (JSON.parse(row.before_json ?? "{}") ?? {}) as Record<string, unknown>;
        const r = this.requireRecord(row.entity_id);
        const values = this.revertible(this.fieldRows(r.collection_id), before);
        if (!Object.keys(values).length)
          throw new ObjectError("conflict", "Nothing in that change can be put back");
        record = this.changeRecord(actor, ts, r, { values });
      } else if (row.action === "add_record") {
        const deleted: string[] = [];
        this.removeRecord(this.requireRecord(row.entity_id), ts, actor, deleted, 0);
      } else throw new ObjectError("conflict", "A delete can't be undone: its values are gone");
      audit(this.sql, actor, {
        action: "undo",
        entityType: "record",
        entityId: row.entity_id,
        before: { change_id: row.id, action: row.action },
      });
      return { undone: row.id, record };
    });
  }

  /** The stored values of a change that a write can put back (as a write takes them). */
  private revertible(fields: FieldRow[], before: Record<string, unknown>): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(before)) {
      const f = fields.find((x) => x.id === k);
      // Links keep their own rule; calculated fields can't be set. Stored money is paise; a
      // write takes rupees.
      if (f && f.type !== "link" && !toField(f).options.formula && !toField(f).options.rollup)
        values[k] = f.type === "money" && typeof v === "number" ? v / 100 : v;
    }
    return values;
  }

  // --- Saved views ---------------------------------------------------------------------------

  async views(actor: Actor): Promise<SavedView[]> {
    this.role(actor);
    return this.sql
      .exec<ViewRow>(`select * from views where deleted_at is null order by pinned desc, position, name_key`)
      .toArray()
      .flatMap((v) => this.viewOf(v) ?? []);
  }

  async saveView(
    actor: Actor,
    key: string | null,
    input: ViewInput & { id?: string | null; name: string; collection: string; pinned?: boolean },
  ) {
    return this.write(actor, key, ["save_view", input], (ts) => this.insertView(actor, input, ts));
  }

  private insertView(
    actor: Actor,
    input: ViewInput & { id?: string | null; name: string; collection: string; pinned?: boolean },
    ts: string,
  ): SavedView {
    const c = this.requireCollection(input.collection);
    const n = this.sql
      .exec<{ n: number }>(`select count(*) as n from views where deleted_at is null`)
      .one().n;
    if (n >= SPACE_LIMITS.views)
      throw new ObjectError("validation_failed", `A space can have up to ${SPACE_LIMITS.views} views`);
    this.checkViewName(input.name, null);
    const query = this.checkViewQuery(c, input);
    const id = this.newId("views", input.id);
    const position =
      this.sql
        .exec<{ p: number | null }>(`select max(position) as p from views where deleted_at is null`)
        .one().p ?? 0;
    this.sql.exec(
      `insert into views (id, name, name_key, collection_id, query_json, mode, pinned, position, created_by, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name.trim(),
      nameKey(input.name),
      c.id,
      JSON.stringify(query),
      input.mode ?? "list",
      input.pinned ? 1 : 0,
      position + 1,
      actor.userId,
      ts,
      ts,
    );
    this.logChange("view", id, "upsert", ts);
    audit(this.sql, actor, { action: "save_view", entityType: "view", entityId: id, after: input });
    return this.viewOf(this.requireView(id))!;
  }

  async updateView(
    actor: Actor,
    key: string | null,
    ref: string,
    input: ViewInput & { name?: string; pinned?: boolean; position?: number },
  ): Promise<SavedView> {
    return this.write(actor, key, ["update_view", ref, input], (ts) => {
      const v = this.requireView(ref);
      const c = this.requireCollection(v.collection_id);
      if (input.name !== undefined) this.checkViewName(input.name, v.id);
      // The view as it reads now (fields hidden since then have dropped out).
      const current = this.viewOf(v)!;
      const before: ViewQuery = { filters: current.filters, search: current.search, sort: current.sort };
      const query = this.checkViewQuery(c, {
        filters: input.filters ?? before.filters,
        search: input.search === undefined ? before.search : input.search,
        sort: input.sort === undefined ? before.sort : input.sort,
        add_fields: input.add_fields ?? current.add_fields,
        card_size: input.card_size === undefined ? current.card_size : input.card_size,
      });
      this.sql.exec(
        `update views set name = ?, name_key = ?, query_json = ?, mode = ?, pinned = ?, position = ?, updated_at = ? where id = ?`,
        input.name?.trim() ?? v.name,
        nameKey(input.name ?? v.name),
        JSON.stringify(query),
        input.mode ?? v.mode,
        input.pinned === undefined ? v.pinned : input.pinned ? 1 : 0,
        input.position ?? v.position,
        ts,
        v.id,
      );
      this.logChange("view", v.id, "upsert", ts);
      audit(this.sql, actor, {
        action: "update_view",
        entityType: "view",
        entityId: v.id,
        before: this.viewOf(v),
        after: input,
      });
      return this.viewOf(this.requireView(v.id))!;
    });
  }

  async deleteView(actor: Actor, key: string | null, ref: string): Promise<{ deleted: string }> {
    return this.write(actor, key, ["delete_view", ref], (ts) => {
      const v = this.requireView(ref);
      this.sql.exec(`update views set deleted_at = ?, updated_at = ? where id = ?`, ts, ts, v.id);
      this.logChange("view", v.id, "delete", ts);
      audit(this.sql, actor, {
        action: "delete_view",
        entityType: "view",
        entityId: v.id,
        before: { name: v.name },
      });
      return { deleted: v.id };
    });
  }

  /** A view with its records (what the pop-up shows, and what "show my view" answers). */
  async openView(actor: Actor, ref: string, page: { limit: number; cursor?: string }): Promise<OpenedView> {
    this.role(actor);
    const v = this.requireView(ref);
    const view = this.viewOf(v);
    if (!view) throw new ObjectError("not_found", `The collection of "${v.name}" was removed`);
    const result = await this.find(actor, v.collection_id, {
      filters: view.filters,
      search: view.search ?? undefined,
      sort: view.sort ?? undefined,
      limit: page.limit,
      cursor: page.cursor,
    });
    return { view, collection: this.collectionView(this.requireCollection(v.collection_id)), result };
  }

  private checkViewName(name: string, exceptId: string | null) {
    const taken = this.sql
      .exec<{ id: string }>(`select id from views where name_key = ? and deleted_at is null`, nameKey(name))
      .toArray()[0];
    if (taken && taken.id !== exceptId)
      throw new ObjectError("conflict", `There's already a view called "${name}"`);
  }

  /** Filters and sort must name real fields (kept by id, so renames don't break views). */
  /**
   * Why a quick add can't work with these fields (or null if it can): it fills in only plain
   * fields, and every required one (a required link or person can't be filled, so no quick
   * add there). Checked when saved, and again when read, so a field change since then hides
   * a quick add that would fail instead of showing it.
   */
  private quickAddProblem(fields: FieldRow[], add: string[]): string | null {
    for (const id of add) {
      const f = fields.find((x) => x.id === id);
      if (!f) continue;
      const o = toField(f).options;
      if (f.type === "link" || f.type === "person" || o.personal || o.formula || o.rollup)
        return `A quick add can't fill in ${f.name}; ask the assistant instead`;
    }
    const missing = fields.filter((f) => f.required && !add.includes(f.id));
    if (missing.length)
      return missing.some((f) => f.type === "link" || f.type === "person")
        ? `${missing.map((f) => f.name).join(", ")} must be filled in, and a quick add can't; ask the assistant instead`
        : `A quick add needs ${missing.map((f) => f.name).join(", ")} (required)`;
    return null;
  }

  private checkViewQuery(c: CollectionRow, q: ViewInput): ViewQuery {
    const fields = this.fieldRows(c.id);
    const filters = (q.filters ?? []).map((f) => {
      const field = this.matchField(fields, f.field);
      // Checks the filter now (bad values fail here, not when the view opens).
      this.filterClause(field, f, { userId: null, source: "system" });
      return { ...f, field: field.id };
    });
    const sort = q.sort ? { field: this.matchField(fields, q.sort.field).id, dir: q.sort.dir } : null;
    // A quick add: plain fields people type in (not links, people, answers or calculated
    // ones), and every required field, so what it adds can be saved.
    let add: string[] | undefined;
    if (q.add_fields?.length) {
      add = [...new Set(q.add_fields.map((ref) => this.matchField(fields, ref).id))];
      const problem = this.quickAddProblem(fields, add);
      if (problem) throw new ObjectError("validation_failed", problem);
    }
    return {
      filters,
      search: q.search?.trim() || null,
      sort,
      ...(add ? { add } : {}),
      ...(q.card_size ? { card_size: q.card_size } : {}),
    };
  }

  private requireView(ref: string): ViewRow {
    const rows = this.sql
      .exec<ViewRow>(
        `select * from views where deleted_at is null and (id = ? or name_key = ?)`,
        ref,
        nameKey(ref),
      )
      .toArray();
    if (rows[0]) return rows[0];
    const names = this.sql
      .exec<{ name: string }>(`select name from views where deleted_at is null order by position`)
      .toArray()
      .map((r) => r.name);
    throw new ObjectError("not_found", `No view "${ref}". Views: ${names.join(", ") || "none yet"}`, {
      candidates: names,
    });
  }

  private viewOf(v: ViewRow): SavedView | null {
    const c = this.sql
      .exec<{ name: string }>(
        `select name from collections where id = ? and deleted_at is null`,
        v.collection_id,
      )
      .toArray()[0];
    if (!c) return null;
    const q = JSON.parse(v.query_json) as ViewQuery;
    // A field hidden since the view was saved drops out of it, so the view still opens
    // (its values are kept; showing the field again brings the filter back).
    const live = new Set(
      this.sql
        .exec<{ id: string }>(
          `select id from fields where collection_id = ? and deleted_at is null`,
          v.collection_id,
        )
        .toArray()
        .map((f) => f.id),
    );
    q.filters = q.filters.filter((f) => live.has(f.field));
    if (q.sort && !live.has(q.sort.field)) q.sort = null;
    // A quick add that a field change since has broken (a new required field, a field now
    // calculated) is hidden rather than shown to fail.
    let add = (q.add ?? []).filter((id) => live.has(id));
    if (add.length && this.quickAddProblem(this.fieldRows(v.collection_id), add)) add = [];
    return {
      id: v.id,
      name: v.name,
      collection_id: v.collection_id,
      collection: c.name,
      filters: q.filters,
      search: q.search,
      sort: q.sort,
      add_fields: add,
      mode: v.mode,
      pinned: v.pinned === 1,
      position: v.position,
      card_size: q.card_size ?? null,
      updated_at: v.updated_at,
    };
  }

  // --- Sharing (design §11) ----------------------------------------------------------------
  // A card is one record plus the linked parts its owner chose; a view shares a saved view's
  // records live; a form lets people add records to a collection and see only their own.
  // Collaborators reach things only through a share; everything else in the space stays 404.

  async createShare(
    actor: Actor,
    key: string | null,
    input: {
      kind: ShareKind;
      target: string;
      include: string[];
      access: ShareAccess;
      hide: string[];
      /** Also hide every money field in what's shared (sharing from the chat). */
      hideMoney?: boolean;
      public: boolean;
      expiresInDays: number | null;
      tokenHash: string;
    },
  ): Promise<{ share: ShareView; token_hash: string }> {
    const { tokenHash, ...request } = input;
    return this.write(actor, key, ["create_share", request], (ts) => {
      let targetId: string;
      let c: CollectionRow;
      let include: ShareInclude[] = [];
      if (input.kind === "card") {
        if (input.public)
          throw new ObjectError("validation_failed", "Cards are shared with people who sign in");
        const r = this.requireRecord(input.target);
        c = this.requireCollection(r.collection_id);
        include = this.resolveIncludes(c, input.include);
        targetId = r.id;
      } else {
        // Every write needs a signed-in person (decision 2026-10-12): a link can show a view,
        // never take a form.
        if (input.public && input.kind === "form")
          throw new ObjectError(
            "validation_failed",
            "A form needs people to sign in: share it with them by name, or send them its join link",
          );
        if (input.include.length)
          throw new ObjectError("validation_failed", "Only cards include linked parts");
        if (input.kind === "view") {
          const v = this.requireView(input.target);
          c = this.requireCollection(v.collection_id);
          targetId = v.id;
        } else {
          c = this.requireCollection(input.target);
          targetId = c.id;
        }
      }
      const hidden = this.resolveHidden(c, include, input.hide);
      if (input.hideMoney)
        for (const id of this.includedCollections(c, include)) {
          const titleId = this.requireCollection(id).title_field_id;
          for (const f of this.fieldRows(id))
            if (f.type === "money" && f.id !== titleId && !hidden.includes(f.id)) hidden.push(f.id);
        }
      // A form must be fillable: every required field shown. A required link works only as a
      // pick list for signed-in people (one record, one target list), never on link-only forms.
      if (input.kind === "form") {
        const pickable = (f: FieldRow) => {
          const o = toField(f).options;
          return !input.public && !o.many && !!o.target;
        };
        const blocked = this.fieldRows(c.id).filter(
          (f) => f.required && ((f.type === "link" && !pickable(f)) || hidden.includes(f.id)),
        );
        if (blocked.length)
          throw new ObjectError(
            "validation_failed",
            `People can't fill in ${blocked.map((f) => f.name).join(", ")} on a form (required${
              blocked.some((f) => f.type === "link") ? "; links can't be shared" : ", but hidden"
            }). Show it, or make it optional first.`,
          );
      }
      // Link-only views are to look at; editing needs a name in the history.
      const access = input.public && input.kind === "view" ? "view" : input.access;
      const id = ulid();
      this.sql.exec(
        `insert into shares (id, record_id, kind, target_id, public, token_hash, access, include_json, hidden_json, expires_at, created_by, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        targetId,
        input.kind,
        targetId,
        input.public ? 1 : 0,
        tokenHash,
        access,
        JSON.stringify(include),
        JSON.stringify(hidden),
        input.expiresInDays
          ? new Date(Date.parse(ts) + input.expiresInDays * 86_400_000).toISOString()
          : null,
        actor.userId,
        ts,
      );
      audit(this.sql, actor, { action: "create_share", entityType: "share", entityId: id, after: request });
      return { share: this.shareView(this.requireShare(id)), token_hash: tokenHash };
    });
  }

  async listShares(actor: Actor, targetId?: string): Promise<ShareView[]> {
    this.canWrite(actor);
    const rows = targetId
      ? this.sql
          .exec<ShareRow>(
            `select * from shares where target_id = ? and revoked_at is null order by created_at`,
            targetId,
          )
          .toArray()
      : this.sql
          .exec<ShareRow>(`select * from shares where revoked_at is null order by created_at`)
          .toArray();
    return rows.map((s) => this.shareView(s));
  }

  async revokeShare(actor: Actor, key: string | null, shareId: string): Promise<{ revoked: string }> {
    return this.write(actor, key, ["revoke_share", shareId], (ts) => {
      const s = this.requireShare(shareId);
      this.sql.exec(`update shares set revoked_at = ? where id = ?`, ts, s.id);
      audit(this.sql, actor, { action: "revoke_share", entityType: "share", entityId: s.id });
      return { revoked: s.id };
    });
  }

  /** A new join link; the old one stops working. People who joined keep their access. */
  async resetShareLink(
    actor: Actor,
    key: string | null,
    shareId: string,
    tokenHash: string,
  ): Promise<{ share: ShareView; token_hash: string }> {
    return this.write(actor, key, ["reset_share_link", shareId], () => {
      const s = this.requireShare(shareId);
      this.sql.exec(`update shares set token_hash = ? where id = ?`, tokenHash, s.id);
      audit(this.sql, actor, { action: "reset_share_link", entityType: "share", entityId: s.id });
      return { share: this.shareView(this.requireShare(s.id)), token_hash: tokenHash };
    });
  }

  async removeSharePerson(
    actor: Actor,
    key: string | null,
    shareId: string,
    userId: string,
  ): Promise<ShareView> {
    return this.write(actor, key, ["remove_share_person", shareId, userId], () => {
      const s = this.requireShare(shareId);
      this.sql.exec(`delete from share_people where share_id = ? and user_id = ?`, s.id, userId);
      this.alsoTell(userId);
      audit(this.sql, actor, {
        action: "remove_share_person",
        entityType: "share",
        entityId: s.id,
        before: { user_id: userId },
      });
      return this.shareView(s);
    });
  }

  /** People I know here: everyone in this space or one of its shares (viewers: members), but me. */
  async people(actor: Actor): Promise<Person[]> {
    // Viewers see the space's members only, not who its owner shared things with.
    if (this.role(actor) === "viewer")
      return this.sql
        .exec<Person>(`select user_id, name from members where user_id != ?`, actor.userId)
        .toArray();
    return this.sql
      .exec<Person>(
        `select user_id, name from members where user_id != ?
         union select user_id, max(name) from share_people where user_id != ? group by user_id`,
        actor.userId,
        actor.userId,
      )
      .toArray();
  }

  /** Adds people the owner already knows to a share, without a link. */
  async addSharePeople(
    actor: Actor,
    key: string | null,
    shareId: string,
    people: Person[],
  ): Promise<ShareView> {
    return this.write(actor, key, ["add_share_people", shareId, people], (ts) => {
      const s = this.requireShare(shareId);
      if (!this.alive(s)) throw new ObjectError("not_found", "Share not found");
      for (const p of people) {
        if (p.user_id === actor.userId) continue;
        this.sql.exec(
          `insert or ignore into share_people (share_id, user_id, name, joined_at) values (?, ?, ?, ?)`,
          s.id,
          p.user_id,
          p.name,
          ts,
        );
      }
      audit(this.sql, actor, {
        action: "add_share_people",
        entityType: "share",
        entityId: s.id,
        after: { people: people.map((p) => p.user_id) },
      });
      return this.shareView(s);
    });
  }

  // --- Rules (chat-first step 6) ----------------------------------------------------------
  // Checked inside every record write, after the values and links are saved and before the
  // transaction commits, so a broken rule leaves nothing behind. A uniqueness clash answers
  // 409 with the record already holding the place, so the app can offer to replace it.

  async listRules(actor: Actor, collection: string): Promise<RuleView[]> {
    this.role(actor);
    return this.ruleRows(this.requireCollection(collection).id).map((r) => this.ruleView(r));
  }

  async addRule(actor: Actor, key: string | null, collection: string, input: RuleInput): Promise<RuleView> {
    return this.write(actor, key, ["add_rule", collection, input], (ts) =>
      this.insertRule(actor, collection, input, ts),
    );
  }

  private insertRule(actor: Actor, collection: string, input: RuleInput, ts: string): RuleView {
    const c = this.requireCollection(collection);
    const fields = this.fieldRows(c.id);
    const only_if = this.checkViewQuery(c, { filters: input.only_if ?? [] }).filters;
    let def: RuleDef;
    if (input.kind === "check") {
      if (!input.require?.length) throw new ObjectError("validation_failed", "Say what records must meet");
      def = {
        require: this.checkViewQuery(c, { filters: input.require }).filters,
        fields: [],
        only_if,
        field: null,
        moves: {},
      };
    } else if (input.kind === "unique") {
      if (!input.fields?.length)
        throw new ObjectError("validation_failed", "Say which fields may not repeat");
      const ids = input.fields.map((ref) => {
        const f = this.matchField(fields, ref);
        if (
          f.type === "money" ||
          f.type === "long_text" ||
          f.type === "multi_choice" ||
          toField(f).options.personal
        )
          throw new ObjectError("validation_failed", `${f.name} can't be part of a uniqueness rule`);
        return f.id;
      });
      let of: string | null = null;
      if (input.of) {
        const f = this.matchField(fields, input.of);
        if (f.type !== "number" && f.type !== "money")
          throw new ObjectError("validation_failed", `${f.name} isn't a number to add up`);
        if (!input.at_most) throw new ObjectError("validation_failed", `Say at most how much ${f.name}`);
        of = f.id;
      }
      def = {
        require: [],
        fields: [...new Set(ids)],
        ...((input.at_most ?? 1) > 1 || of ? { at_most: input.at_most } : {}),
        ...(of ? { of } : {}),
        only_if,
        field: null,
        moves: {},
      };
    } else {
      if (!input.field || !input.moves)
        throw new ObjectError("validation_failed", "Say the field and its moves");
      const f = this.matchField(fields, input.field);
      if (f.type !== "choice") throw new ObjectError("validation_failed", `${f.name} isn't a choice field`);
      const choices = toField(f).options.choices ?? [];
      const pick = (v: string) => {
        const hit = choices.find((x) => nameKey(x) === nameKey(v));
        if (!hit)
          throw new ObjectError(
            "validation_failed",
            `${f.name} has no choice "${v}". Choices: ${choices.join(", ")}`,
          );
        return hit;
      };
      const given = new Map(
        Object.entries(input.moves).map(([from, to]) => [pick(from), [...new Set(to.map(pick))]]),
      );
      // Every choice is listed, so the words show the values that can't move at all.
      const moves = Object.fromEntries(choices.map((ch) => [ch, given.get(ch) ?? []]));
      def = { require: [], fields: [], only_if: [], field: f.id, moves };
    }
    const count = this.sql
      .exec<{ n: number }>(
        `select count(*) as n from rules where collection_id = ? and deleted_at is null`,
        c.id,
      )
      .one().n;
    if (count >= 30) throw new ObjectError("conflict", "A collection can have at most 30 rules");
    const id = ulid();
    this.sql.exec(
      `insert into rules (id, collection_id, kind, def_json, message, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?)`,
      id,
      c.id,
      input.kind,
      JSON.stringify(def),
      input.message?.trim() || null,
      actor.userId,
      ts,
    );
    // Records already there must meet it (a rule that's broken from the start says so now).
    const r = this.sql.exec<RuleRow>(`select * from rules where id = ?`, id).one();
    // Every record, in batches (a rule over broken data would be a promise it can't keep).
    for (let after = ""; ;) {
      const batch = this.sql
        .exec<{ id: string; values_json: string }>(
          `select id, values_json from records where collection_id = ? and deleted_at is null and id > ? order by id limit 500`,
          c.id,
          after,
        )
        .toArray();
      for (const rec of batch)
        this.checkRule(r, c, rec.id, null, JSON.parse(rec.values_json) as Record<string, StoredValue>, true);
      if (batch.length < 500) break;
      after = batch[batch.length - 1]!.id;
    }
    audit(this.sql, actor, { action: "add_rule", entityType: "rule", entityId: id, after: input });
    this.logChange("collection", c.id, "upsert", ts);
    return this.ruleView(r);
  }

  async deleteRule(actor: Actor, key: string | null, id: string): Promise<{ deleted: string }> {
    return this.write(actor, key, ["delete_rule", id], (ts) => {
      const r = this.sql
        .exec<RuleRow>(`select * from rules where id = ? and deleted_at is null`, id)
        .toArray()[0];
      if (!r) throw new ObjectError("not_found", "Rule not found");
      this.sql.exec(`update rules set deleted_at = ? where id = ?`, ts, r.id);
      audit(this.sql, actor, { action: "delete_rule", entityType: "rule", entityId: r.id });
      this.logChange("collection", r.collection_id, "upsert", ts);
      return { deleted: r.id };
    });
  }

  private ruleRows(collectionId: string): RuleRow[] {
    return this.sql
      .exec<RuleRow>(
        `select * from rules where collection_id = ? and deleted_at is null order by created_at`,
        collectionId,
      )
      .toArray();
  }

  private ruleView(r: RuleRow): RuleView {
    const def = JSON.parse(r.def_json) as RuleDef;
    const name = (id: string) => this.liveField(id)?.name ?? "(removed field)";
    const cond = (f: Filter) => ({
      field_id: f.field,
      field: name(f.field),
      op: f.op,
      value: (f.value ?? null) as RuleView["require"][number]["value"],
    });
    const collection =
      this.sql
        .exec<{ name: string }>(`select name from collections where id = ?`, r.collection_id)
        .toArray()[0]?.name ?? "";
    const base = {
      kind: r.kind,
      collection,
      require: def.require.map(cond),
      fields: def.fields.map((id) => ({ id, name: name(id) })),
      ...(r.kind === "unique"
        ? { at_most: def.at_most ?? 1, of: def.of ? { id: def.of, name: name(def.of) } : null }
        : {}),
      only_if: def.only_if.map(cond),
      field: def.field ? { id: def.field, name: name(def.field) } : null,
      moves: def.moves,
    };
    return {
      id: r.id,
      collection_id: r.collection_id,
      ...base,
      message: r.message,
      words: ruleWords(base),
      created_at: r.created_at,
    };
  }

  /** Every rule of the collection, for one record just written (throws to roll it back). */
  private enforceRules(
    c: CollectionRow,
    recordId: string,
    before: Record<string, StoredValue> | null,
    after: Record<string, StoredValue>,
  ) {
    for (const r of this.ruleRows(c.id)) this.checkRule(r, c, recordId, before, after, false);
  }

  /** A record's links changed on their own: its rules must still hold (values didn't move). */
  private enforceLinkRules(r: RecordRow) {
    const values = JSON.parse(r.values_json) as Record<string, StoredValue>;
    this.enforceRules(this.requireCollection(r.collection_id), r.id, values, values);
  }

  private checkRule(
    r: RuleRow,
    c: CollectionRow,
    recordId: string,
    before: Record<string, StoredValue> | null,
    after: Record<string, StoredValue>,
    existing: boolean,
  ) {
    const def = JSON.parse(r.def_json) as RuleDef;
    const system: Actor = { userId: null, source: "system" };
    const matches = (filters: Filter[]) =>
      !filters.length || this.findRows(system, c, { filters, ids: [recordId], limit: 1 }).rows.length > 0;
    const title = () => this.liveRecord(recordId)?.title ?? "A record";
    const say = (fallback: string) => r.message ?? fallback;
    if (r.kind === "check") {
      if (matches(def.only_if) && !matches(def.require))
        throw new ObjectError(
          "validation_failed",
          say(`${existing ? `“${title()}” already breaks this rule. ` : ""}Rule: ${this.ruleView(r).words}`),
          { reason: "rule", rule_id: r.id },
        );
      return;
    }
    if (r.kind === "unique") {
      if (!matches(def.only_if)) return;
      const same: Filter[] = def.fields.map((fid) => {
        const f = this.liveField(fid);
        const v =
          f?.type === "link"
            ? (this.sql
                .exec<{ to_id: string }>(
                  `select to_id from links where field_id = ? and from_id = ? order by position limit 1`,
                  fid,
                  recordId,
                )
                .toArray()[0]?.to_id ?? null)
            : (after[fid] ?? null);
        return v === null ? { field: fid, op: "empty" } : { field: fid, op: "eq", value: v };
      });
      if (def.of || (def.at_most ?? 1) > 1) {
        // "At most N per …": count the records sharing the fields (this one included), or add
        // up a number field across them.
        // Every match counts, page by page; stop as soon as the cap is passed.
        let total = 0;
        let cursor: string | undefined;
        do {
          const page = this.findRows(system, c, { filters: [...def.only_if, ...same], limit: 500, cursor });
          for (const x of page.rows) {
            const v = def.of ? (JSON.parse(x.values_json) as Record<string, StoredValue>)[def.of] : 1;
            total += typeof v === "number" ? v : 0;
          }
          cursor = page.next_cursor ?? undefined;
        } while (cursor && total <= (def.at_most ?? 1));
        if (total > (def.at_most ?? 1))
          throw new ObjectError(
            "conflict",
            say(`${existing ? `“${title()}” already goes past this. ` : ""}Rule: ${this.ruleView(r).words}.`),
            { reason: "limit", rule_id: r.id },
          );
        return;
      }
      const others = this.findRows(system, c, { filters: [...def.only_if, ...same], limit: 6 }).rows.filter(
        (x) => x.id !== recordId,
      );
      if (others.length)
        throw new ObjectError(
          "conflict",
          say(
            `Only one at a time here: “${others[0]!.title}” already has this place. ${this.ruleView(r).words}.`,
          ),
          { reason: "unique", rule_id: r.id, existing: others.map((x) => ({ id: x.id, title: x.title })) },
        );
      return;
    }
    // A status flow: only listed moves (new records may start anywhere).
    if (existing || before === null || !def.field) return;
    const from = before[def.field];
    const to = after[def.field];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null) || typeof from !== "string") return;
    // A value the rule doesn't list can't move anywhere (the words say "moves only …").
    const allowed = def.moves[from] ?? [];
    if (!allowed.includes(String(to ?? "")))
      throw new ObjectError(
        "validation_failed",
        say(
          `${this.liveField(def.field)?.name ?? "It"} can't go from ${from} to ${to ?? "empty"}${allowed.length ? `; from ${from} it can go to ${allowed.join(" or ")}` : ""}`,
        ),
        { reason: "flow", rule_id: r.id },
      );
  }

  // --- Workflows (chat-first step 5) ------------------------------------------------------
  // A workflow is a saved definition: when (a record is added, changes, or a date comes),
  // check (filters), wait, then (tell someone, set a field, add a record). A record write
  // queues a job in its own transaction; the alarm runs due jobs afterwards, checks the record
  // again and does the steps in one transaction (a set or add is a normal record write, so it
  // can start other workflows, at most MAX_WORKFLOW_DEPTH deep). Telling someone goes to their
  // inbox after the run is saved.

  /** How deep in a chain of workflow runs the current write is (0: a person's write). */
  private wfDepth = 0;

  async listWorkflows(actor: Actor): Promise<WorkflowView[]> {
    this.role(actor);
    return this.sql
      .exec<WorkflowRow>(`select * from workflows where deleted_at is null order by created_at`)
      .toArray()
      .map((w) => this.workflowView(w));
  }

  async getWorkflow(actor: Actor, id: string): Promise<WorkflowDetail> {
    this.role(actor);
    const w = this.requireWorkflow(id);
    const history = this.sql
      .exec<{ id: string; at: string; record_id: string | null; ok: number; detail: string }>(
        `select id, at, record_id, ok, detail from workflow_runs where workflow_id = ? order by at desc limit 20`,
        w.id,
      )
      .toArray()
      .map((r): WorkflowRun => ({
        id: r.id,
        at: r.at,
        record_id: r.record_id,
        record: r.record_id ? (this.liveRecord(r.record_id)?.title ?? null) : null,
        ok: !!r.ok,
        detail: r.detail,
      }));
    const waiting = this.sql
      .exec<WaitRow>(
        `select * from workflow_waits where workflow_id = ? and (next_nudge_at is null or next_nudge_at != 'resumed') order by asked_at desc`,
        w.id,
      )
      .toArray()
      .map((x) => this.waitingItem(x, actor))
      .filter((x): x is WaitingItem => !!x);
    return { workflow: this.workflowView(w), history, waiting };
  }

  async createWorkflow(actor: Actor, key: string | null, spec: WorkflowSpec): Promise<WorkflowView> {
    return this.write(actor, key, ["create_workflow", spec], (ts) => {
      const { collectionId, def } = this.resolveWorkflow(spec);
      const count = this.sql
        .exec<{ n: number }>(`select count(*) as n from workflows where deleted_at is null`)
        .one().n;
      if (count >= MAX_WORKFLOWS)
        throw new ObjectError("conflict", `A space can have at most ${MAX_WORKFLOWS} workflows`);
      const id = ulid();
      this.sql.exec(
        `insert into workflows (id, name, collection_id, def_json, enabled, created_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        spec.name,
        collectionId,
        JSON.stringify(def),
        spec.enabled ? 1 : 0,
        actor.userId,
        ts,
        ts,
      );
      if (spec.enabled) this.scheduleExisting(id, collectionId, def);
      audit(this.sql, actor, {
        action: "create_workflow",
        entityType: "workflow",
        entityId: id,
        after: spec,
      });
      return this.workflowView(this.requireWorkflow(id));
    });
  }

  /** Turns a workflow on (it starts watching; dates already set are scheduled) or off. */
  async setWorkflowEnabled(
    actor: Actor,
    key: string | null,
    id: string,
    enabled: boolean,
  ): Promise<WorkflowView> {
    return this.write(actor, key, ["set_workflow_enabled", id, enabled], (ts) => {
      const w = this.requireWorkflow(id);
      // Already so: change nothing (jobs waiting to run stay).
      if (!!w.enabled === enabled) return this.workflowView(w);
      this.sql.exec(
        `update workflows set enabled = ?, updated_at = ? where id = ?`,
        enabled ? 1 : 0,
        ts,
        w.id,
      );
      this.sql.exec(`delete from workflow_jobs where workflow_id = ?`, w.id);
      this.dropWaits(w.id, ts);
      if (enabled) this.scheduleExisting(w.id, w.collection_id, JSON.parse(w.def_json) as WorkflowDef);
      audit(this.sql, actor, {
        action: enabled ? "enable_workflow" : "disable_workflow",
        entityType: "workflow",
        entityId: w.id,
      });
      return this.workflowView(this.requireWorkflow(w.id));
    });
  }

  async deleteWorkflow(actor: Actor, key: string | null, id: string): Promise<{ deleted: string }> {
    return this.write(actor, key, ["delete_workflow", id], (ts) => {
      const w = this.requireWorkflow(id);
      this.sql.exec(`update workflows set deleted_at = ?, enabled = 0 where id = ?`, ts, w.id);
      this.sql.exec(`delete from workflow_jobs where workflow_id = ?`, w.id);
      this.dropWaits(w.id, ts);
      audit(this.sql, actor, { action: "delete_workflow", entityType: "workflow", entityId: w.id });
      return { deleted: w.id };
    });
  }

  /** A workflow turned off or deleted stops waiting: its open questions close. */
  private dropWaits(workflowId: string, ts: string) {
    for (const wait of this.sql
      .exec<WaitRow>(`select * from workflow_waits where workflow_id = ?`, workflowId)
      .toArray())
      this.sql.exec(
        `update questions set closed_at = ? where id = ? and closed_at is null`,
        ts,
        wait.question_id,
      );
    this.sql.exec(`delete from workflow_waits where workflow_id = ?`, workflowId);
  }

  private requireWorkflow(id: string): WorkflowRow {
    const w = this.sql
      .exec<WorkflowRow>(`select * from workflows where id = ? and deleted_at is null`, id)
      .toArray()[0];
    if (!w) throw new ObjectError("not_found", "Workflow not found");
    return w;
  }

  /** Names to ids, and every value checked now (a bad value fails when it's saved, not later). */
  private resolveWorkflow(spec: WorkflowSpec): { collectionId: string; def: WorkflowDef } {
    const c = this.requireCollection(spec.when.collection);
    const fields = this.fieldRows(c.id);
    let fieldId: string | null = null;
    if (spec.when.event === "date") {
      if (!spec.when.field)
        throw new ObjectError("validation_failed", "A date workflow needs the date field to watch");
      const f = this.matchField(fields, spec.when.field);
      if (f.type !== "date" && f.type !== "datetime")
        throw new ObjectError("validation_failed", `${f.name} isn't a date or date-and-time field`);
      if (toField(f).options.personal)
        throw new ObjectError(
          "validation_failed",
          `${f.name} is a personal answer; a date workflow can't watch it yet`,
        );
      fieldId = f.id;
    } else if (spec.when.field) {
      if (spec.when.event === "added")
        throw new ObjectError("validation_failed", "Pick a field only for “changed” or “date”");
      const f = this.matchField(fields, spec.when.field);
      if (f.type === "link" || toField(f).options.personal)
        throw new ObjectError(
          "validation_failed",
          `Workflows can't watch ${f.name} by itself yet (links and personal answers); watch the whole record instead`,
        );
      fieldId = f.id;
    }
    const check = this.checkViewQuery(c, { filters: spec.check }).filters;
    const noLinks = (f: FieldRow) => {
      if (f.type === "link")
        throw new ObjectError("validation_failed", `Workflows can't set links yet (${f.name})`);
    };
    // {Who}: the person named in that field of the record (someone in the space or its shares);
    // {Lineup.Player}: the people in a person field of the records linked through Lineup.
    const peopleIn = (refs: string[], fixed: Person[], verb: string) => {
      const person = (f: FieldRow) => {
        if (f.type !== "person" || toField(f).options.personal)
          throw new ObjectError("validation_failed", `${f.name} isn't a person field`);
        return f.id;
      };
      const to_fields: string[] = [];
      const to_linked: (LinkPath & { person_field_id: string })[] = [];
      for (const ref of refs) {
        const own = fields.find((f) => f.id === ref || f.name_key === nameKey(ref));
        const dot = ref.indexOf(".");
        if (own || dot < 0) {
          to_fields.push(person(this.matchField(fields, ref)));
          continue;
        }
        const path = this.linkPath(c.id, ref.slice(0, dot));
        const target = this.fieldRows(path.target);
        to_linked.push({
          field_id: path.field_id,
          dir: path.dir,
          person_field_id: person(this.matchField(target, ref.slice(dot + 1))),
        });
      }
      if (!fixed.length && !to_fields.length && !to_linked.length)
        throw new ObjectError("validation_failed", `Say who to ${verb}`);
      return {
        ...(to_fields.length ? { to_fields } : {}),
        ...(to_linked.length ? { to_linked } : {}),
      };
    };
    const then = spec.then.map((a, i): WorkflowDef["then"][number] => {
      if (a.do === "notify")
        return { do: "notify", text: a.text, to: a.to, ...peopleIn(a.to_fields ?? [], a.to, "tell") };
      if (a.do === "ask") {
        const who = peopleIn(a.to_fields ?? [], a.to, "ask");
        const choices = a.choices ? [...new Map(a.choices.map((x) => [nameKey(x), x])).values()] : null;
        if (choices && choices.length < 2)
          throw new ObjectError("validation_failed", "Give at least two different choices");
        let save_to: string | null = null;
        if (a.save_to) {
          const f = this.matchField(fields, a.save_to);
          if (toField(f).options.personal)
            throw new ObjectError(
              "validation_failed",
              `${f.name} is a personal answer; keep the answer in a text or choice field`,
            );
          if (f.type === "choice") {
            const allowed = toField(f).options.choices ?? [];
            const missing = (choices ?? []).filter((x) => !allowed.some((y) => nameKey(y) === nameKey(x)));
            if (!choices || missing.length)
              throw new ObjectError(
                "validation_failed",
                `${f.name} is a choice field (${allowed.join(", ")}); the answers to tap must be among its choices`,
              );
            // Several people's answers don't fit one choice: keep the first, or use a text field.
            if (a.until !== "first" && (a.to.length > 1 || who.to_fields || who.to_linked))
              throw new ObjectError(
                "validation_failed",
                `${f.name} keeps one answer: ask one person, wait for the first answer ("until": "first"), or keep the answers in a text field`,
              );
          } else if (f.type !== "text")
            throw new ObjectError("validation_failed", `${f.name} isn't a text or choice field`);
          save_to = f.id;
        }
        return {
          do: "ask",
          text: a.text,
          choices,
          to: a.to,
          ...who,
          save_to,
          nudge_minutes: a.nudge_minutes ?? null,
          until: a.until,
        };
      }
      if (a.do === "repeat") {
        if (a.from > i)
          throw new ObjectError(
            "validation_failed",
            `Step ${i + 1} can only go back to a step before it (1 to ${i})`,
          );
        return {
          do: "repeat",
          if: this.checkViewQuery(c, { filters: a.if }).filters,
          from: a.from,
          at_most: a.at_most,
        };
      }
      if (a.do === "set") {
        if (a.via) {
          // Set a field on the linked records (those matching `where`), e.g. release the holds.
          const path = this.linkPath(c.id, a.via);
          const tc = this.requireCollection(path.target);
          const tf = this.fieldRows(tc.id);
          const f = this.matchField(tf, a.field);
          noLinks(f);
          this.readValues(tf, { [f.id]: a.value });
          const where = this.checkViewQuery(tc, { filters: a.where ?? [] }).filters;
          return {
            do: "set",
            field_id: f.id,
            value: a.value,
            via: { field_id: path.field_id, dir: path.dir },
            ...(where.length ? { where } : {}),
          };
        }
        if (a.where?.length)
          throw new ObjectError("validation_failed", "A filter only fits a set on linked records (via)");
        const f = this.matchField(fields, a.field);
        noLinks(f);
        this.readValues(fields, { [f.id]: a.value });
        return { do: "set", field_id: f.id, value: a.value };
      }
      const t = this.requireCollection(a.collection);
      const tf = this.fieldRows(t.id);
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a.values)) {
        const f = this.matchField(tf, k);
        noLinks(f);
        // Text with {Field} is filled in when it runs; anything else is checked now.
        if (!(typeof v === "string" && /\{[^{}]+\}/.test(v))) this.readValues(tf, { [f.id]: v });
        values[f.id] = v;
      }
      const missing = tf.filter((f) => f.required && f.type !== "link" && !(f.id in values));
      if (missing.length)
        throw new ObjectError(
          "validation_failed",
          `A new ${t.name} record needs ${missing.map((f) => f.name).join(", ")}`,
        );
      return { do: "add", collection_id: t.id, values };
    });
    return {
      collectionId: c.id,
      def: {
        when: {
          event: spec.when.event,
          field_id: fieldId,
          offset_minutes: spec.when.event === "date" ? spec.when.offset_minutes : 0,
        },
        check,
        wait_minutes: spec.wait_minutes,
        then,
      },
    };
  }

  private workflowView(w: WorkflowRow): WorkflowView {
    const def = JSON.parse(w.def_json) as WorkflowDef;
    const fieldName = (id: string) => this.liveField(id)?.name ?? "(removed field)";
    const colName = (id: string) =>
      this.sql
        .exec<{ name: string }>(`select name from collections where id = ? and deleted_at is null`, id)
        .toArray()[0]?.name ?? "(removed list)";
    const base = {
      when: {
        event: def.when.event,
        collection_id: w.collection_id,
        collection: colName(w.collection_id),
        field_id: def.when.field_id,
        field: def.when.field_id ? fieldName(def.when.field_id) : null,
        offset_minutes: def.when.offset_minutes,
      },
      check: def.check.map((f) => ({
        field_id: f.field,
        field: fieldName(f.field),
        op: f.op,
        value: f.value ?? null,
        ...this.shownValue(f),
      })),
      wait_minutes: def.wait_minutes,
      then: def.then.map((a): WorkflowView["then"][number] =>
        a.do === "notify"
          ? {
              do: "notify",
              text: a.text,
              to: [
                ...a.to,
                ...(a.to_fields ?? []).map((fid) => ({ user_id: "", name: `{${fieldName(fid)}}` })),
                ...(a.to_linked ?? []).map((l) => ({
                  user_id: "",
                  name: `{${this.linkPathName(l)}.${fieldName(l.person_field_id)}}`,
                })),
              ],
            }
          : a.do === "set"
            ? {
                do: "set",
                field_id: a.field_id,
                field: fieldName(a.field_id),
                value: a.value,
                ...(a.via
                  ? {
                      via: this.linkPathName(a.via),
                      where: (a.where ?? []).map((f) => ({
                        field_id: f.field,
                        field: fieldName(f.field),
                        op: f.op,
                        value: f.value ?? null,
                        ...this.shownValue(f),
                      })),
                    }
                  : {}),
              }
            : a.do === "add"
              ? {
                  do: "add",
                  collection_id: a.collection_id,
                  collection: colName(a.collection_id),
                  values: Object.fromEntries(Object.entries(a.values).map(([k, v]) => [fieldName(k), v])),
                }
              : a.do === "ask"
                ? {
                    do: "ask",
                    text: a.text,
                    choices: a.choices,
                    who: [
                      ...a.to,
                      ...(a.to_fields ?? []).map((fid) => ({ user_id: "", name: `{${fieldName(fid)}}` })),
                      ...(a.to_linked ?? []).map((l) => ({
                        user_id: "",
                        name: `{${this.linkPathName(l)}.${fieldName(l.person_field_id)}}`,
                      })),
                    ],
                    save_to_id: a.save_to,
                    save_to: a.save_to ? fieldName(a.save_to) : null,
                    nudge_minutes: a.nudge_minutes,
                    until: a.until,
                  }
                : {
                    do: "repeat",
                    if: a.if.map((f) => ({
                      field_id: f.field,
                      field: fieldName(f.field),
                      op: f.op,
                      value: f.value ?? null,
                      ...this.shownValue(f),
                    })),
                    from: a.from,
                    at_most: a.at_most,
                  },
      ),
    };
    return {
      id: w.id,
      name: w.name,
      enabled: !!w.enabled,
      ...base,
      words: workflowWords(base),
      runs: w.run_count,
      last_run_at: w.last_run_at,
      created_at: w.created_at,
    };
  }

  /** A check's value as people read it ("₹5,000", "yes"); nothing when it can't be shown. */
  private shownValue(f: Filter): { shown?: string } {
    const field = this.liveField(f.field);
    if (!field || f.value === undefined || f.value === null || typeof f.value === "object") return {};
    if (!["eq", "ne", "lt", "lte", "gt", "gte"].includes(f.op)) return {};
    try {
      const shown = displayValue(field.type, normalizeValue(toField(field), f.value));
      return typeof shown === "string" ? { shown } : {};
    } catch {
      return {};
    }
  }

  /** Called inside a record write: queues the jobs it starts (same transaction). */
  private queueWorkflows(
    collectionId: string,
    recordId: string,
    before: Record<string, StoredValue> | null,
    after: Record<string, StoredValue>,
    otherChange = false,
  ) {
    if (this.wfDepth >= MAX_WORKFLOW_DEPTH) return;
    const rows = this.sql
      .exec<WorkflowRow>(
        `select * from workflows where collection_id = ? and enabled = 1 and deleted_at is null`,
        collectionId,
      )
      .toArray();
    const now = Date.now();
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    for (const w of rows) {
      const def = JSON.parse(w.def_json) as WorkflowDef;
      const f = def.when.field_id;
      if (def.when.event === "date") {
        this.scheduleDate(w.id, def, recordId, after, now);
        continue;
      }
      const fire =
        def.when.event === "added"
          ? before === null
          : before !== null &&
            (f
              ? !same(before[f], after[f])
              : otherChange ||
                [...new Set([...Object.keys(before), ...Object.keys(after)])].some(
                  (k) => !same(before[k], after[k]),
                ));
      if (fire) this.addJob(w.id, recordId, "event", now + def.wait_minutes * 60_000);
    }
  }

  /** (Re)schedules a date workflow for one record; nothing when the date is gone or past. */
  private scheduleDate(
    workflowId: string,
    def: WorkflowDef,
    recordId: string,
    values: Record<string, StoredValue>,
    now: number,
  ) {
    this.sql.exec(
      `delete from workflow_jobs where workflow_id = ? and record_id = ? and kind = 'date'`,
      workflowId,
      recordId,
    );
    const v = values[def.when.field_id!];
    if (typeof v !== "string") return;
    // A date without a time counts from 9 am India time that day.
    const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${DAY_TIME_IST}` : v);
    if (Number.isNaN(at)) return;
    const due = at + (def.when.offset_minutes + def.wait_minutes) * 60_000;
    if (due > now) this.addJob(workflowId, recordId, "date", due);
  }

  /** A date workflow just turned on: schedules every record that already has a date. */
  private scheduleExisting(workflowId: string, collectionId: string, def: WorkflowDef) {
    if (def.when.event !== "date") return;
    const now = Date.now();
    let after = "";
    for (;;) {
      const batch = this.sql
        .exec<{ id: string; values_json: string }>(
          `select id, values_json from records where collection_id = ? and deleted_at is null and id > ?
           order by id limit 500`,
          collectionId,
          after,
        )
        .toArray();
      for (const r of batch)
        this.scheduleDate(
          workflowId,
          def,
          r.id,
          JSON.parse(r.values_json) as Record<string, StoredValue>,
          now,
        );
      if (batch.length < 500) return;
      after = batch[batch.length - 1]!.id;
    }
  }

  private addJob(workflowId: string, recordId: string, kind: "event" | "date", dueMs: number) {
    this.sql.exec(
      `insert into workflow_jobs (id, workflow_id, record_id, kind, due_at, depth) values (?, ?, ?, ?, ?, ?)`,
      ulid(),
      workflowId,
      recordId,
      kind,
      new Date(dueMs).toISOString(),
      this.wfDepth,
    );
  }

  /** Runs the jobs that are due (a few at a time; the alarm comes back for the rest). */
  private async runDueJobs(): Promise<void> {
    const jobs = this.sql
      .exec<WorkflowJobRow>(
        `select * from workflow_jobs where due_at <= ? order by due_at limit 25`,
        nowIso(),
      )
      .toArray();
    for (const j of jobs) {
      try {
        // The steps and the notifications to send are saved together.
        this.ctx.storage.transactionSync(() => {
          for (const t of this.runJob(j))
            this.sql.exec(
              `insert into workflow_notes (id, user_id, note_json, next_at) values (?, ?, ?, ?)`,
              ulid(),
              t.userId,
              JSON.stringify(t.n),
              nowIso(),
            );
        });
      } catch (e) {
        // The steps rolled back; note why, so the history says what happened.
        this.ctx.storage.transactionSync(() => {
          this.sql.exec(`delete from workflow_jobs where id = ?`, j.id);
          this.noteRun(j.workflow_id, j.record_id, false, false, e instanceof Error ? e.message : String(e));
        });
      } finally {
        this.wfDepth = 0;
      }
    }
    this.ctx.storage.transactionSync(() => {
      for (const t of this.runNudges())
        this.sql.exec(
          `insert into workflow_notes (id, user_id, note_json, next_at) values (?, ?, ?, ?)`,
          ulid(),
          t.userId,
          JSON.stringify(t.n),
          nowIso(),
        );
    });
    await this.sendNotes();
  }

  /**
   * Delivers saved notifications to people's inboxes; one that fails stays and is tried again
   * later (backing off, for about a day), so a run's message isn't lost.
   */
  private async sendNotes(): Promise<void> {
    const notes = this.sql
      .exec<{ id: string; user_id: string; note_json: string; attempts: number }>(
        `select id, user_id, note_json, attempts from workflow_notes where next_at <= ? order by next_at limit 50`,
        nowIso(),
      )
      .toArray();
    const spaceId = this.sql.exec<{ id: string }>(`select id from space limit 1`).toArray()[0]?.id ?? "";
    for (const n of notes) {
      try {
        const { share_id, ...note } = JSON.parse(n.note_json) as NewNotification & { share_id?: string };
        // A question from a process: the person finds it under "Shared with you" too.
        if (share_id)
          await this.env.DB.prepare(
            `insert or ignore into shared_with (user_id, share_id, space_id) values (?, ?, ?)`,
          )
            .bind(n.user_id, share_id, spaceId)
            .run();
        await this.env.INBOX.getByName(inboxName(n.user_id)).notify(note);
        this.sql.exec(`delete from workflow_notes where id = ?`, n.id);
      } catch (e) {
        console.warn("workflow notification failed", e instanceof Error ? e.message : String(e));
        if (n.attempts >= 12) this.sql.exec(`delete from workflow_notes where id = ?`, n.id);
        else
          this.sql.exec(
            `update workflow_notes set attempts = attempts + 1, next_at = ? where id = ?`,
            new Date(Date.now() + Math.min(86_400_000, 30_000 * 2 ** n.attempts)).toISOString(),
            n.id,
          );
      }
    }
  }

  /** One job, inside a transaction: check, then every step; who to tell afterwards. */
  private runJob(j: WorkflowJobRow): Tell[] {
    this.sql.exec(`delete from workflow_jobs where id = ?`, j.id);
    const w = this.sql
      .exec<WorkflowRow>(
        `select * from workflows where id = ? and deleted_at is null and enabled = 1`,
        j.workflow_id,
      )
      .toArray()[0];
    if (!w) return [];
    const def = JSON.parse(w.def_json) as WorkflowDef;
    // A run going on after an "ask" step: the answer is in, the check already passed.
    if (j.wait_id) {
      const wait = this.sql
        .exec<WaitRow>(`select * from workflow_waits where id = ?`, j.wait_id)
        .toArray()[0];
      if (!wait) return [];
      this.sql.exec(`delete from workflow_waits where id = ?`, wait.id);
      this.sql.exec(
        `update questions set closed_at = ? where id = ? and closed_at is null`,
        nowIso(),
        wait.question_id,
      );
      const r = this.liveRecord(wait.record_id);
      if (!r) {
        this.noteRun(w.id, wait.record_id, true, false, "Skipped: the record was deleted");
        return [];
      }
      this.wfDepth = j.depth + 1;
      return this.runSteps(
        w,
        def,
        r,
        wait.step + 1,
        wait.loops_json ? (JSON.parse(wait.loops_json) as Loops) : {},
      );
    }
    const r = this.liveRecord(j.record_id);
    if (!r) {
      this.noteRun(w.id, j.record_id, true, false, "Skipped: the record was deleted");
      return [];
    }
    const actor: Actor = { userId: w.created_by, source: "system" };
    const c = this.requireCollection(w.collection_id);
    if (
      def.check.length &&
      !this.findRows(actor, c, { filters: def.check, ids: [r.id], limit: 1 }).rows.length
    ) {
      this.noteRun(w.id, r.id, true, false, "Skipped: it didn't match the check");
      return [];
    }
    this.wfDepth = j.depth + 1;
    return this.runSteps(w, def, r, 0, {});
  }

  /** The people a step names: fixed ones, the record's person fields, linked records' people. */
  private peopleOf(
    a: { to: Person[]; to_fields?: string[]; to_linked?: (LinkPath & { person_field_id: string })[] },
    r: RecordRow,
  ): Person[] {
    const current = this.requireRecord(r.id);
    const named = (a.to_fields ?? []).flatMap((fid) => {
      const v = (JSON.parse(current.values_json) as Record<string, StoredValue>)[fid];
      const p = v && typeof v === "object" && !Array.isArray(v) ? v : null;
      return p?.user_id && this.knownPerson(p.user_id) ? [{ user_id: p.user_id, name: p.name }] : [];
    });
    const linked = (a.to_linked ?? []).flatMap((l) =>
      this.linkedIds(l.field_id, l.dir, r.id).flatMap((id) => {
        const v = this.currentValues(id)[l.person_field_id];
        const p = v && typeof v === "object" && !Array.isArray(v) ? v : null;
        return p?.user_id && this.knownPerson(p.user_id) ? [{ user_id: p.user_id, name: p.name }] : [];
      }),
    );
    return [...a.to, ...named, ...linked].filter(
      (p, i, all) => !p.user_id || all.findIndex((q) => q.user_id === p.user_id) === i,
    );
  }

  /**
   * The steps from `from` on, in one transaction. An "ask" step stops here: the question goes
   * to the people, a wait is kept, and the run goes on (from the next step) once they answer.
   */
  private runSteps(w: WorkflowRow, def: WorkflowDef, r: RecordRow, from: number, loops: Loops): Tell[] {
    const actor: Actor = { userId: w.created_by, source: "system" };
    const ts = nowIso();
    const tell: Tell[] = [];
    const did: string[] = [];
    for (let i = from; i < def.then.length; i++) {
      const a = def.then[i]!;
      if (a.do === "notify") {
        const current = this.requireRecord(r.id);
        const body = this.fillTemplate(a.text, current);
        const people = this.peopleOf(a, r);
        for (const p of people)
          if (p.user_id)
            tell.push({
              userId: p.user_id,
              n: { kind: "workflow", title: w.name, body, url: `/c/${r.collection_id}/${r.id}` },
            });
        did.push(
          people.length
            ? `Told ${people.map((p) => p.name).join(", ")}: “${body}”`
            : "Nobody to tell: the record names nobody in the space",
        );
      } else if (a.do === "ask") {
        const people = this.peopleOf(a, r).filter((p) => p.user_id);
        const text = this.fillTemplate(a.text, this.requireRecord(r.id));
        if (!people.length) {
          did.push("Nobody to ask: the record names nobody in the space");
          continue;
        }
        const questionId = ulid();
        const shareId = ulid();
        // No link: the people asked are known by account, so nobody can join by a token.
        this.sql.exec(
          `insert into shares (id, record_id, kind, target_id, public, token_hash, access, include_json, hidden_json, expires_at, created_by, created_at)
           values (?, ?, 'question', ?, 0, ?, 'edit', '[]', '[]', null, ?, ?)`,
          shareId,
          questionId,
          questionId,
          `wf:${ulid()}`,
          w.created_by,
          ts,
        );
        this.sql.exec(
          `insert into questions (id, text, choices_json, share_id, created_by, created_at) values (?, ?, ?, ?, ?, ?)`,
          questionId,
          text,
          a.choices ? JSON.stringify(a.choices) : null,
          shareId,
          w.created_by,
          ts,
        );
        for (const p of people)
          this.sql.exec(
            `insert or ignore into share_people (share_id, user_id, name, joined_at) values (?, ?, ?, ?)`,
            shareId,
            p.user_id,
            p.name,
            ts,
          );
        const nudgeAt = a.nudge_minutes
          ? new Date(Date.now() + a.nudge_minutes * 60_000).toISOString()
          : null;
        this.sql.exec(
          `insert into workflow_waits (id, workflow_id, record_id, step, question_id, asked_at, nudge_minutes, next_nudge_at, nudges, loops, loops_json, depth, until)
           values (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
          ulid(),
          w.id,
          r.id,
          i,
          questionId,
          ts,
          a.nudge_minutes,
          nudgeAt,
          JSON.stringify(loops),
          this.wfDepth,
          a.until,
        );
        for (const p of people)
          tell.push({
            userId: p.user_id,
            n: { kind: "question", title: w.name, body: text, url: `/cards/${shareId}`, share_id: shareId },
          });
        did.push(`Asked ${people.map((p) => p.name).join(", ")}: “${text}”`);
        // Waiting: the run goes on from the next step once they answer.
        this.noteRun(w.id, r.id, true, from === 0, did.join(" · "));
        this.changed();
        return tell;
      } else if (a.do === "repeat") {
        const c = this.requireCollection(r.collection_id);
        // Each repeat step counts its own goings-back.
        const done = loops[String(i)] ?? 0;
        const back =
          done < a.at_most &&
          this.findRows(actor, c, { filters: a.if, ids: [r.id], limit: 1 }).rows.length > 0;
        if (back) {
          loops[String(i)] = done + 1;
          did.push(`Went back to step ${a.from} (${done + 1} of ${a.at_most})`);
          i = a.from - 2; // the loop's i++ lands on step `from` (1-based)
          continue;
        }
        did.push(
          done >= a.at_most ? `Stopped going back after ${a.at_most}` : "Went on (no need to go back)",
        );
      } else if (a.do === "set" && a.via) {
        const field = this.liveField(a.field_id);
        const ids = field
          ? this.matchingIn(
              field.collection_id,
              a.where ?? [],
              this.linkedIds(a.via.field_id, a.via.dir, r.id),
              actor, // as the workflow's maker, like its check ("me" is them)
            ).slice(0, MAX_LINKED_SETS)
          : [];
        for (const id of ids)
          this.changeRecord(actor, ts, this.requireRecord(id), { values: { [a.field_id]: a.value } });
        did.push(
          `Set ${field?.name ?? "a field"} on ${ids.length} linked record${ids.length === 1 ? "" : "s"} (${this.linkPathName(a.via)})`,
        );
      } else if (a.do === "set") {
        this.changeRecord(actor, ts, this.requireRecord(r.id), { values: { [a.field_id]: a.value } });
        did.push(`Set ${this.liveField(a.field_id)?.name ?? "a field"}`);
      } else {
        const t = this.requireCollection(a.collection_id);
        const current = this.requireRecord(r.id);
        const values = Object.fromEntries(
          Object.entries(a.values).map(([k, v]) => [
            k,
            typeof v === "string" ? this.fillTemplate(v, current) : v,
          ]),
        );
        const added = this.insertRecord(actor, ts, t, { values });
        did.push(`Added “${added.title}” to ${t.name}`);
      }
    }
    this.noteRun(w.id, r.id, true, from === 0, did.length ? did.join(" · ") : "Done");
    this.changed();
    return tell;
  }

  // --- Processes: waiting on people (home-first.md §2 point 9) --------------------------

  /** Called when someone answers: a wait on that question may go on. */
  private continueWaits(q: QuestionRow, who: Actor) {
    const waits = this.sql
      .exec<WaitRow>(
        `select * from workflow_waits where question_id = ? and (next_nudge_at is null or next_nudge_at != 'resumed')`,
        q.id,
      )
      .toArray();
    for (const wait of waits) {
      const people = this.askedPeople(q);
      const open = people.filter((p) => p.answer === null);
      const name = people.find((p) => p.user_id === who.userId)?.name ?? "Someone";
      const answer = people.find((p) => p.user_id === who.userId)?.answer ?? "";
      if (wait.until === "all" && open.length) {
        this.noteRun(
          wait.workflow_id,
          wait.record_id,
          true,
          false,
          `${name} answered “${answer}” · waiting on ${open.map((p) => p.name).join(", ")}`,
        );
        continue;
      }
      const w = this.sql
        .exec<WorkflowRow>(`select * from workflows where id = ? and deleted_at is null`, wait.workflow_id)
        .toArray()[0];
      const def = w ? (JSON.parse(w.def_json) as WorkflowDef) : null;
      const step = def?.then[wait.step];
      const r = this.liveRecord(wait.record_id);
      if (w && step?.do === "ask" && step.save_to && r) {
        // One person (or the first answer): their answer; everyone: "Rahul: Yes · Priya: No".
        const answered = people.filter((p) => p.answer !== null);
        const kept =
          wait.until === "first" || answered.length === 1
            ? (answered.find((p) => p.user_id === who.userId) ?? answered[0])!.answer
            : answered.map((p) => `${p.name}: ${p.answer}`).join(" · ");
        // As deep in the chain as the run that asked: a workflow this change starts counts on.
        this.wfDepth = wait.depth + 1;
        try {
          this.changeRecord({ userId: w.created_by, source: "system" }, nowIso(), r, {
            values: { [step.save_to]: kept },
          });
        } finally {
          this.wfDepth = 0;
        }
      }
      this.noteRun(
        wait.workflow_id,
        wait.record_id,
        true,
        false,
        wait.until === "all" && people.length > 1
          ? `${name} answered “${answer}” · everyone has answered`
          : `${name} answered “${answer}”`,
      );
      // The rest of the steps run from the alarm, like any job (a set or add there may start
      // other workflows, at most MAX_WORKFLOW_DEPTH deep). The question closes now, so a
      // second answer in the meantime can't change what was kept or start the run twice.
      this.sql.exec(`update questions set closed_at = ? where id = ? and closed_at is null`, nowIso(), q.id);
      this.sql.exec(`update workflow_waits set next_nudge_at = 'resumed' where id = ?`, wait.id);
      this.sql.exec(
        `insert into workflow_jobs (id, workflow_id, record_id, kind, due_at, depth, wait_id) values (?, ?, ?, 'event', ?, ?, ?)`,
        ulid(),
        wait.workflow_id,
        wait.record_id,
        nowIso(),
        wait.depth,
        wait.id,
      );
    }
    if (waits.length) void this.wakeForJobs();
  }

  /** Everyone a question was put to, with their answer so far. */
  private askedPeople(q: QuestionRow): { user_id: string; name: string; answer: string | null }[] {
    return this.sql
      .exec<{ user_id: string; name: string; answer: string | null }>(
        `select p.user_id, p.name, a.answer from share_people p
         left join question_answers a on a.question_id = ? and a.user_id = p.user_id
         where p.share_id = ? order by p.name`,
        q.id,
        q.share_id,
      )
      .toArray();
  }

  /** Asks again the people who haven't answered, for the waits whose nudge time has come. */
  private runNudges(): Tell[] {
    const now = nowIso();
    const tell: Tell[] = [];
    const due = this.sql
      .exec<WaitRow>(
        `select * from workflow_waits where next_nudge_at is not null and next_nudge_at != 'resumed' and next_nudge_at <= ? limit 50`,
        now,
      )
      .toArray();
    for (const wait of due) {
      tell.push(...this.nudge(wait, now));
    }
    return tell;
  }

  /** One nudge: the people still to answer hear the question again. */
  private nudge(wait: WaitRow, now: string): Tell[] {
    const q = this.liveQuestion(wait.question_id);
    const w = this.sql
      .exec<WorkflowRow>(`select * from workflows where id = ? and deleted_at is null`, wait.workflow_id)
      .toArray()[0];
    if (!q || !w) {
      this.sql.exec(`delete from workflow_waits where id = ?`, wait.id);
      return [];
    }
    const open = this.askedPeople(q).filter((p) => p.answer === null);
    const nudges = wait.nudges + 1;
    const next =
      wait.nudge_minutes && nudges < MAX_NUDGES
        ? new Date(Date.parse(now) + wait.nudge_minutes * 60_000).toISOString()
        : null;
    this.sql.exec(
      `update workflow_waits set nudges = ?, next_nudge_at = ? where id = ?`,
      nudges,
      next,
      wait.id,
    );
    this.noteRun(
      w.id,
      wait.record_id,
      true,
      false,
      open.length ? `Nudged ${open.map((p) => p.name).join(", ")}` : "Nudged nobody: everyone has answered",
    );
    return open.map((p) => ({
      userId: p.user_id,
      n: {
        kind: "question",
        title: `Still waiting: ${w.name}`,
        body: q.text,
        url: `/cards/${q.share_id}`,
        share_id: q.share_id,
      },
    }));
  }

  /** The person's view of a wait: who it waits on, and their own way to answer. */
  private waitingItem(wait: WaitRow, actor: Actor): WaitingItem | null {
    const q = this.liveQuestion(wait.question_id);
    const w = this.sql
      .exec<WorkflowRow>(`select * from workflows where id = ? and deleted_at is null`, wait.workflow_id)
      .toArray()[0];
    if (!q || !w) return null;
    const on = this.askedPeople(q);
    const me = on.find((p) => p.user_id === actor.userId);
    return {
      id: wait.id,
      workflow_id: w.id,
      workflow: w.name,
      record_id: wait.record_id,
      record: this.liveRecord(wait.record_id)?.title ?? "(deleted)",
      text: q.text,
      choices: q.choices_json ? (JSON.parse(q.choices_json) as string[]) : null,
      on,
      asked_at: wait.asked_at,
      nudges: wait.nudges,
      next_nudge_at: wait.next_nudge_at === "resumed" ? null : wait.next_nudge_at,
      share_id: me ? q.share_id : null,
      mine: me?.answer ?? null,
    };
  }

  /** What's waiting on people: everything for a member, their own asks for anyone else. */
  async listWaiting(actor: Actor): Promise<WaitingItem[]> {
    if (!actor.userId) return [];
    const member =
      this.sql.exec(`select 1 from members where user_id = ?`, actor.userId).toArray().length > 0;
    const rows = this.sql
      .exec<WaitRow>(
        `select * from workflow_waits where next_nudge_at is null or next_nudge_at != 'resumed' order by asked_at desc limit 200`,
      )
      .toArray();
    return rows
      .map((wait) => this.waitingItem(wait, actor))
      .filter((x): x is WaitingItem => !!x && (member || x.share_id !== null));
  }

  /** Nudges the people a wait is on right now (a member's tap on the process card). */
  async nudgeNow(actor: Actor, key: string | null, waitId: string): Promise<WaitingItem> {
    return this.write(actor, key, ["nudge", waitId], (ts) => {
      const wait = this.sql.exec<WaitRow>(`select * from workflow_waits where id = ?`, waitId).toArray()[0];
      if (!wait) throw new ObjectError("not_found", "Nothing is waiting here any more");
      for (const t of this.nudge(wait, ts))
        this.sql.exec(
          `insert into workflow_notes (id, user_id, note_json, next_at) values (?, ?, ?, ?)`,
          ulid(),
          t.userId,
          JSON.stringify(t.n),
          ts,
        );
      audit(this.sql, actor, { action: "nudge", entityType: "workflow", entityId: wait.workflow_id });
      void this.wakeForJobs();
      const item = this.waitingItem(
        this.sql.exec<WaitRow>(`select * from workflow_waits where id = ?`, waitId).toArray()[0]!,
        actor,
      );
      if (!item) throw new ObjectError("not_found", "Nothing is waiting here any more");
      return item;
    });
  }

  private noteRun(
    workflowId: string,
    recordId: string | null,
    ok: boolean,
    counted: boolean,
    detail: string,
  ) {
    const at = nowIso();
    this.sql.exec(
      `insert into workflow_runs (id, workflow_id, record_id, at, ok, counted, detail) values (?, ?, ?, ?, ?, ?, ?)`,
      ulid(),
      workflowId,
      recordId,
      at,
      ok ? 1 : 0,
      counted ? 1 : 0,
      detail.slice(0, 500),
    );
    if (counted)
      this.sql.exec(
        `update workflows set run_count = run_count + 1, last_run_at = ? where id = ?`,
        at,
        workflowId,
      );
    // Keep the last 50 runs of each workflow.
    this.sql.exec(
      `delete from workflow_runs where workflow_id = ? and id not in
       (select id from workflow_runs where workflow_id = ? order by at desc limit 50)`,
      workflowId,
      workflowId,
    );
  }

  /** "{Amount} on {Category}" with the record's values (unknown names stay as written). */
  private fillTemplate(text: string, r: RecordRow): string {
    const fields = this.fieldRows(r.collection_id);
    const values = JSON.parse(r.values_json) as Record<string, StoredValue>;
    return text.replace(/\{([^{}]{1,80})\}/g, (all, name: string) => {
      const f = fields.find((x) => x.name_key === nameKey(name));
      if (!f) return all;
      const shown = displayValue(f.type, values[f.id] ?? null);
      return Array.isArray(shown) ? shown.join(", ") : (shown ?? "");
    });
  }

  /**
   * An everyday list, started on the spot (decision "Assistant first"). If one with that name
   * is already there, it's used as it is; a new Reminders list comes with its alarm.
   */
  async startList(actor: Actor, key: string | null, kind: StarterKind): Promise<CollectionView> {
    return this.write(actor, key, ["start_list", kind], (ts) => {
      const spec = STARTER_COLLECTIONS.find((c) => c.kind === kind)!;
      const have = this.sql
        .exec<CollectionRow>(
          `select * from collections where name_key = ? and deleted_at is null`,
          nameKey(spec.name),
        )
        .toArray()[0];
      let id: string;
      if (have) id = have.id;
      else {
        const { kind: _k, ...input } = spec;
        id = this.insertCollection(actor, { ...input, id: null }, ts);
        if (kind === "reminders") this.remindersWorkflow(id, ts);
      }
      // Every everyday list comes with its card on the home (home-first.md §2 point 15: the
      // first run is a conversation, and what it starts shows up at once). A list made before
      // cards existed gets its card the next time it's started; once by name, so a card the
      // person took off or renamed isn't forced back.
      const card = STARTER_CARDS[kind];
      if (
        card &&
        !getMeta(this.sql, `starter_card:${kind}`) &&
        !this.sql
          .exec(`select 1 from views where name_key = ? and deleted_at is null`, nameKey(card.name))
          .toArray().length
      )
        try {
          this.insertView(actor, { ...card, collection: id, pinned: true, mode: "list" }, ts);
        } catch (e) {
          // A list made by hand may lack the field the card reads (Expenses without a Date):
          // the list still starts, without its card.
          if (!(e instanceof ObjectError)) throw e;
        }
      if (card) setMeta(this.sql, `starter_card:${kind}`, "1");
      return this.collectionView(this.requireCollection(id));
    });
  }

  /**
   * Spaces made with the old starter Reminders list get its alarm once (new spaces start
   * empty; `startList` adds it with the list).
   */
  private ensureReminders() {
    if (getMeta(this.sql, "wf_reminders")) return;
    const space = this.sql.exec<{ kind: string }>(`select kind from space limit 1`).toArray()[0];
    if (!space) return;
    setMeta(this.sql, "wf_reminders", "1");
    if (space.kind !== "personal") return;
    const c = this.sql
      .exec<{ id: string }>(
        `select id from collections where name_key = ? and deleted_at is null`,
        nameKey("Reminders"),
      )
      .toArray()[0];
    if (c) this.remindersWorkflow(c.id, nowIso());
  }

  /** "Remind me": at Due, unless Done, tell the owner (a built-in workflow, data like any other). */
  private remindersWorkflow(collectionId: string, ts: string) {
    const space = this.sql
      .exec<{ owner_user_id: string }>(`select owner_user_id from space limit 1`)
      .toArray()[0];
    if (!space) return;
    const fields = this.fieldRows(collectionId);
    const due = fields.find(
      (f) => f.name_key === nameKey("Due") && (f.type === "datetime" || f.type === "date"),
    );
    const done = fields.find((f) => f.name_key === nameKey("Done") && f.type === "boolean");
    const title = fields.find((f) => f.name_key === nameKey("Title"));
    if (!due || !title) return;
    const def: WorkflowDef = {
      when: { event: "date", field_id: due.id, offset_minutes: 0 },
      check: done ? [{ field: done.id, op: "ne", value: true }] : [],
      wait_minutes: 0,
      then: [{ do: "notify", text: `{${title.name}}`, to: [{ user_id: space.owner_user_id, name: "me" }] }],
    };
    const id = ulid();
    this.sql.exec(
      `insert into workflows (id, name, collection_id, def_json, enabled, created_by, created_at, updated_at)
       values (?, 'Remind me', ?, ?, 1, ?, ?, ?)`,
      id,
      collectionId,
      JSON.stringify(def),
      space.owner_user_id,
      ts,
      ts,
    );
    this.scheduleExisting(id, collectionId, def);
  }

  // --- Questions (chat-first step 4) ------------------------------------------------------
  // A question is shared like a card (a share of kind "question" with the people asked), so
  // "Shared with you", live pings, leaving and removing work as for everything else.

  private liveQuestion(id: string): QuestionRow | undefined {
    return this.sql
      .exec<QuestionRow>(`select * from questions where id = ? and deleted_at is null`, id)
      .toArray()[0];
  }

  private questionView(q: QuestionRow): QuestionView {
    const people = this.sql
      .exec<{ user_id: string; name: string; answer: string | null; answered_at: string | null }>(
        `select p.user_id, p.name, a.answer, a.at as answered_at from share_people p
         left join question_answers a on a.question_id = ? and a.user_id = p.user_id
         where p.share_id = ? order by p.name`,
        q.id,
        q.share_id,
      )
      .toArray();
    return {
      id: q.id,
      text: q.text,
      choices: q.choices_json ? (JSON.parse(q.choices_json) as string[]) : null,
      people,
      share_id: q.share_id,
      closed: !!q.closed_at,
      created_at: q.created_at,
    };
  }

  /** Asks people the owner knows a question; they find it under "Shared with you". */
  async askPeople(
    actor: Actor,
    key: string | null,
    input: { id: string | null; text: string; choices: string[] | null; people: Person[]; tokenHash: string },
  ): Promise<QuestionView> {
    const { tokenHash, ...request } = input;
    return this.write(actor, key, ["ask_people", request], (ts) => {
      const id = input.id ?? ulid();
      if (this.sql.exec(`select 1 from questions where id = ?`, id).toArray().length)
        throw new ObjectError("conflict", "A question with this id already exists");
      const people = input.people.filter((p) => p.user_id !== actor.userId);
      if (!people.length) throw new ObjectError("validation_failed", "Ask at least one other person");
      const choices = input.choices ? [...new Map(input.choices.map((c) => [nameKey(c), c])).values()] : null;
      if (choices && choices.length < 2)
        throw new ObjectError("validation_failed", "Give at least two different choices");
      const shareId = ulid();
      this.sql.exec(
        `insert into shares (id, record_id, kind, target_id, public, token_hash, access, include_json, hidden_json, expires_at, created_by, created_at)
         values (?, ?, 'question', ?, 0, ?, 'edit', '[]', '[]', null, ?, ?)`,
        shareId,
        id,
        id,
        tokenHash,
        actor.userId,
        ts,
      );
      this.sql.exec(
        `insert into questions (id, text, choices_json, share_id, created_by, created_at) values (?, ?, ?, ?, ?, ?)`,
        id,
        input.text,
        choices ? JSON.stringify(choices) : null,
        shareId,
        actor.userId,
        ts,
      );
      for (const p of people)
        this.sql.exec(
          `insert or ignore into share_people (share_id, user_id, name, joined_at) values (?, ?, ?, ?)`,
          shareId,
          p.user_id,
          p.name,
          ts,
        );
      audit(this.sql, actor, { action: "ask_people", entityType: "question", entityId: id, after: request });
      return this.questionView(this.liveQuestion(id)!);
    });
  }

  /** A question I asked, with everyone's answers. */
  async question(actor: Actor, id: string): Promise<QuestionView> {
    this.canWrite(actor);
    const q = this.liveQuestion(id);
    if (!q) throw new ObjectError("not_found", "Question not found");
    return this.questionView(q);
  }

  /** Stops answers (closed) or opens it again. */
  async closeQuestion(actor: Actor, key: string | null, id: string, closed: boolean): Promise<QuestionView> {
    return this.write(actor, key, ["close_question", id, closed], (ts) => {
      const q = this.liveQuestion(id);
      if (!q) throw new ObjectError("not_found", "Question not found");
      this.sql.exec(`update questions set closed_at = ? where id = ?`, closed ? ts : null, id);
      audit(this.sql, actor, {
        action: closed ? "close_question" : "reopen_question",
        entityType: "question",
        entityId: id,
      });
      return this.questionView(this.liveQuestion(id)!);
    });
  }

  /** Someone asked answers (or changes their answer): one of the choices, or a short text. */
  async answerQuestion(
    actor: Actor,
    key: string | null,
    shareId: string,
    answer: string,
  ): Promise<SharedOpened> {
    let s!: ShareRow;
    return this.write(
      actor,
      key,
      ["answer_question", shareId, answer],
      (ts) => {
        const q = this.liveQuestion(s.target_id)!;
        if (q.closed_at) throw new ObjectError("conflict", "This question is closed");
        const choices = q.choices_json ? (JSON.parse(q.choices_json) as string[]) : null;
        const value = choices ? choices.find((c) => nameKey(c) === nameKey(answer)) : answer;
        if (value === undefined)
          throw new ObjectError("validation_failed", `Answer with one of: ${choices!.join(", ")}`);
        const before = this.sql
          .exec<{ answer: string }>(
            `select answer from question_answers where question_id = ? and user_id = ?`,
            q.id,
            actor.userId,
          )
          .toArray()[0];
        this.sql.exec(
          `insert into question_answers (question_id, user_id, answer, at) values (?, ?, ?, ?)
           on conflict (question_id, user_id) do update set answer = excluded.answer, at = excluded.at`,
          q.id,
          actor.userId,
          value,
          ts,
        );
        audit(this.sql, actor, {
          action: "answer_question",
          entityType: "question",
          entityId: q.id,
          before: before ?? null,
          after: { answer: value },
        });
        this.continueWaits(q, actor);
        return this.opened(s, actor);
      },
      () => {
        s = this.joinedShare(actor, shareId);
        if (s.kind !== "question") throw new ObjectError("not_found", "Share not found");
      },
    );
  }

  /** Joins the share whose link has this hash; null when the link is wrong, off or expired. */
  async joinShare(
    actor: Actor,
    name: string,
    tokenHash: string,
  ): Promise<{ share_id: string; title: string } | null> {
    if (!actor.userId) return null;
    const s = this.shareByHash(tokenHash);
    if (!s) return null;
    const joined = this.sql
      .exec(`select 1 from share_people where share_id = ? and user_id = ?`, s.id, actor.userId)
      .toArray().length;
    if (!joined) {
      this.sql.exec(
        `insert into share_people (share_id, user_id, name, joined_at) values (?, ?, ?, ?)`,
        s.id,
        actor.userId,
        name,
        nowIso(),
      );
      audit(this.sql, actor, { action: "join_share", entityType: "share", entityId: s.id });
      // The owner's open share sheet (and others in it) hear about the new person.
      this.changed();
    }
    return { share_id: s.id, title: this.shareTitle(s) };
  }

  /** The shares in this space the person joined and can still open. */
  async sharesFor(actor: Actor): Promise<SharedWithMe[]> {
    if (!actor.userId) return [];
    return this.sql
      .exec<ShareRow & { joined_at: string }>(
        `select s.*, p.joined_at from share_people p join shares s on s.id = p.share_id
         where p.user_id = ? and s.revoked_at is null order by p.joined_at desc`,
        actor.userId,
      )
      .toArray()
      .flatMap((s) =>
        this.alive(s)
          ? [
              {
                share_id: s.id,
                kind: s.kind,
                title: this.shareTitle(s),
                owner: this.ownerName(),
                access: s.access,
                joined_at: s.joined_at,
              },
            ]
          : [],
      );
  }

  async openShare(actor: Actor, shareId: string, cursor?: string): Promise<SharedOpened> {
    return this.opened(this.joinedShare(actor, shareId), actor, cursor);
  }

  /** A link-only view or form, opened without signing in; null unless the link is live. */
  async openPublicShare(tokenHash: string, cursor?: string): Promise<SharedOpened | null> {
    const s = this.shareByHash(tokenHash);
    // A link opens a view only: forms shared by link before 2026-10-12 no longer open.
    if (!s || !s.public || s.kind !== "view") return null;
    return this.opened(s, { userId: null, source: "web" }, cursor);
  }

  async updateSharedRecord(
    actor: Actor,
    key: string | null,
    shareId: string,
    recordId: string,
    values: Record<string, unknown>,
  ): Promise<SharedOpened> {
    let s!: ShareRow;
    return this.write(
      actor,
      key,
      ["update_shared_record", shareId, recordId, values],
      (ts) => {
        if (!this.sharedRecordIds(s, actor, [recordId]).length)
          throw new ObjectError("not_found", "Record not found");
        const r = this.requireRecord(recordId);
        const shared = this.sharedValues(s, r.collection_id, values, actor);
        // Without edit access, people may still give their own personal answers.
        if (s.access !== "edit") {
          const fields = this.fieldRows(r.collection_id);
          const others = Object.keys(shared).filter(
            (id) => !toField(fields.find((f) => f.id === id)!).options.personal,
          );
          if (others.length) throw new ObjectError("forbidden", "This is shared with you to view only");
        }
        this.changeRecord(actor, ts, r, { values: shared });
        return this.opened(s, actor);
      },
      () => (s = this.joinedShare(actor, shareId)),
    );
  }

  async addSharedRecord(
    actor: Actor,
    key: string | null,
    shareId: string,
    section: string,
    input: { id?: string | null; values: Record<string, unknown> },
  ): Promise<SharedOpened> {
    let s!: ShareRow;
    return this.write(
      actor,
      key,
      ["add_shared_record", shareId, section, input],
      (ts) => {
        if (s.kind === "card") {
          const include = (JSON.parse(s.include_json) as ShareInclude[]).find(
            (x) => "from_field" in x && `from:${x.from_field}` === section,
          );
          const f = include && "from_field" in include ? this.liveField(include.from_field) : undefined;
          if (!f) throw new ObjectError("not_found", "You can't add records there");
          const c = this.requireCollection(f.collection_id);
          this.insertRecord(actor, ts, c, {
            id: input.id ?? null,
            values: { ...this.sharedValues(s, c.id, input.values, actor), [f.id]: [s.target_id] },
          });
        } else {
          if (section !== s.kind) throw new ObjectError("not_found", "You can't add records there");
          const c = this.shareCollection(s);
          this.insertRecord(actor, ts, c, {
            id: input.id ?? null,
            values: this.sharedValues(s, c.id, input.values, actor),
          });
        }
        return this.opened(s, actor);
      },
      () => {
        s = this.joinedShare(actor, shareId);
        // Forms are for filling in, whatever the access; adding elsewhere needs edit access.
        if (s.kind !== "form" && s.access !== "edit")
          throw new ObjectError("forbidden", "This is shared with you to view only");
      },
    );
  }

  /** Limits which rows of a shared view everyone ("*") or one person sees; [] removes it. */
  async setShareRule(
    actor: Actor,
    key: string | null,
    shareId: string,
    userId: string,
    filters: Filter[],
  ): Promise<ShareView> {
    return this.write(actor, key, ["set_share_rule", shareId, userId, filters], () => {
      const s = this.requireShare(shareId);
      if (s.kind !== "view")
        throw new ObjectError("validation_failed", "Row rules are for shared views (lists)");
      if (
        userId !== "*" &&
        !this.sql
          .exec(`select 1 from share_people where share_id = ? and user_id = ?`, s.id, userId)
          .toArray().length
      )
        throw new ObjectError("not_found", "That person isn't in this share");
      const checked = this.checkViewQuery(this.shareCollection(s), { filters }).filters;
      if (checked.length)
        this.sql.exec(
          `insert into share_rules (share_id, user_id, filters_json) values (?, ?, ?)
           on conflict (share_id, user_id) do update set filters_json = excluded.filters_json`,
          s.id,
          userId,
          JSON.stringify(checked),
        );
      else this.sql.exec(`delete from share_rules where share_id = ? and user_id = ?`, s.id, userId);
      audit(this.sql, actor, {
        action: "set_share_rule",
        entityType: "share",
        entityId: s.id,
        after: { user_id: userId, filters: checked },
      });
      return this.shareView(s);
    });
  }

  /**
   * The row rule filters that apply to this person on a shared view (everyone's, then theirs).
   * A rule on a field that's been hidden since shows them no rows (never more than intended)
   * until the field is shown again or the rule is changed; `null` means that.
   */
  private ruleFilters(s: ShareRow, actor: Actor): Filter[] | null {
    const rows = this.sql
      .exec<{ user_id: string; filters_json: string }>(
        `select user_id, filters_json from share_rules where share_id = ? and user_id in ('*', ?)`,
        s.id,
        actor.userId ?? "*",
      )
      .toArray();
    const filters = rows.flatMap((r) => JSON.parse(r.filters_json) as Filter[]);
    return filters.every((f) => this.liveField(f.field)) ? filters : null;
  }

  /** Whether a collaborator's write touches a money field (MCP asks for confirmation then). */
  async sharedTouchesMoney(
    actor: Actor,
    shareId: string,
    target: { recordId?: string; section?: string },
    keys: string[],
  ): Promise<boolean> {
    let collectionId: string | undefined;
    try {
      const s = this.joinedShare(actor, shareId);
      if (target.recordId) collectionId = this.liveRecord(target.recordId)?.collection_id;
      else if (target.section?.startsWith("from:")) {
        const include = (JSON.parse(s.include_json) as ShareInclude[]).find(
          (x) => "from_field" in x && `from:${x.from_field}` === target.section,
        );
        if (include && "from_field" in include)
          collectionId = this.liveField(include.from_field)?.collection_id;
      } else if (target.section === s.kind && s.kind !== "card") collectionId = this.shareCollection(s).id;
    } catch {
      // Not shared with them: the write itself says so.
      return false;
    }
    if (!collectionId) return false;
    const fields = this.fieldRows(collectionId);
    return keys.some((k) => {
      try {
        return this.matchField(fields, k).type === "money";
      } catch {
        return false;
      }
    });
  }

  async leaveShare(actor: Actor, key: string | null, shareId: string): Promise<{ left: string }> {
    return this.write(
      actor,
      key,
      ["leave_share", shareId],
      () => {
        this.sql.exec(`delete from share_people where share_id = ? and user_id = ?`, shareId, actor.userId);
        // Their other devices drop it too.
        if (actor.userId) this.alsoTell(actor.userId);
        audit(this.sql, actor, { action: "leave_share", entityType: "share", entityId: shareId });
        return { left: shareId };
      },
      () => {
        if (!actor.userId) throw new ObjectError("not_found", "Share not found");
      },
    );
  }

  private requireShare(id: string): ShareRow {
    const s = this.sql
      .exec<ShareRow>(`select * from shares where id = ? and revoked_at is null`, id)
      .toArray()[0];
    if (!s) throw new ObjectError("not_found", "Share not found");
    return s;
  }

  /** The live share whose link has this hash. */
  private shareByHash(tokenHash: string): ShareRow | undefined {
    const s = this.sql
      .exec<ShareRow>(`select * from shares where token_hash = ? and revoked_at is null`, tokenHash)
      .toArray()[0];
    return s && this.alive(s) ? s : undefined;
  }

  /** Not expired, and what it shares still exists. */
  private alive(s: ShareRow): boolean {
    if (s.expires_at && s.expires_at <= nowIso()) return false;
    if (s.kind === "card") return !!this.liveRecord(s.target_id);
    if (s.kind === "question") return !!this.liveQuestion(s.target_id);
    try {
      this.shareCollection(s);
      return true;
    } catch {
      return false;
    }
  }

  private liveView(id: string): ViewRow | undefined {
    return this.sql.exec<ViewRow>(`select * from views where id = ? and deleted_at is null`, id).toArray()[0];
  }

  /** The collection a view or form share works on. */
  private shareCollection(s: ShareRow): CollectionRow {
    // A question shares no records.
    if (s.kind === "question") throw new ObjectError("not_found", "Share not found");
    const id = s.kind === "view" ? this.liveView(s.target_id)?.collection_id : s.target_id;
    if (!id) throw new ObjectError("not_found", "Share not found");
    return this.requireCollection(id);
  }

  private shareTitle(s: ShareRow): string {
    if (s.kind === "card") return this.liveRecord(s.target_id)?.title ?? "Deleted";
    if (s.kind === "view") return this.liveView(s.target_id)?.name ?? "Deleted";
    if (s.kind === "question") return this.liveQuestion(s.target_id)?.text ?? "Deleted";
    try {
      return this.requireCollection(s.target_id).name;
    } catch {
      return "Deleted";
    }
  }

  private liveRecord(id: string): RecordRow | undefined {
    return this.sql
      .exec<RecordRow>(`select * from records where id = ? and deleted_at is null`, id)
      .toArray()[0];
  }

  private liveField(id: string): FieldRow | undefined {
    return this.sql
      .exec<FieldRow>(`select * from fields where id = ? and deleted_at is null`, id)
      .toArray()[0];
  }

  private ownerName(): string {
    return (
      this.sql.exec<{ name: string }>(`select name from members where role = 'owner' limit 1`).toArray()[0]
        ?.name ?? ""
    );
  }

  /** A share the person joined (or a member of the space previewing it); anything else is 404. */
  private joinedShare(actor: Actor, shareId: string): ShareRow {
    const s = this.sql
      .exec<ShareRow>(`select * from shares where id = ? and revoked_at is null`, shareId)
      .toArray()[0];
    const allowed =
      !!s &&
      !!actor.userId &&
      this.alive(s) &&
      (this.sql
        .exec(`select 1 from share_people where share_id = ? and user_id = ?`, s.id, actor.userId)
        .toArray().length > 0 ||
        this.sql.exec(`select 1 from members where user_id = ?`, actor.userId).toArray().length > 0);
    if (!allowed) throw new ObjectError("not_found", "Share not found");
    return s;
  }

  /** Which of these records the share lets this person reach. */
  private sharedRecordIds(s: ShareRow, actor: Actor, ids: string[]): string[] {
    if (s.kind === "card") {
      const card = this.cardView(s, actor);
      const inCard = new Set([card.record.id, ...card.sections.flatMap((x) => x.records.map((r) => r.id))]);
      return ids.filter((id) => inCard.has(id));
    }
    const c = this.shareCollection(s);
    if (s.kind === "form")
      return ids.filter((id) => {
        const r = this.liveRecord(id);
        return !!r && r.collection_id === c.id && !!actor.userId && this.createdBy(id) === actor.userId;
      });
    const v = this.viewOf(this.liveView(s.target_id)!);
    if (!v) return [];
    const rule = this.ruleFilters(s, actor);
    if (!rule) return [];
    return this.findRows(actor, c, {
      filters: [...v.filters, ...rule],
      search: v.search ?? undefined,
      limit: ids.length,
      ids,
    }).rows.map((r) => r.id);
  }

  private createdBy(recordId: string): string | null {
    return (
      this.sql
        .exec<{ created_by: string | null }>(`select created_by from records where id = ?`, recordId)
        .toArray()[0]?.created_by ?? null
    );
  }

  /**
   * Values a collaborator may set: only fields shared with them. A link may only point at
   * records they can already see through one of their shares (a sign-up picks a song from the
   * songs shared with them), by id.
   */
  private sharedValues(s: ShareRow, collectionId: string, input: Record<string, unknown>, actor: Actor) {
    const hidden = new Set(JSON.parse(s.hidden_json) as string[]);
    const fields = this.fieldRows(collectionId);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      const f = this.matchField(fields, k);
      if (hidden.has(f.id)) throw new ObjectError("forbidden", `You can't change ${f.name} here`);
      if (f.type === "link") {
        const ids = v === null || v === "" ? [] : Array.isArray(v) ? v : [v];
        for (const id of ids)
          if (typeof id !== "string" || !this.reachable(actor, id))
            throw new ObjectError("forbidden", `You can't link ${f.name} to that here`);
      }
      // Through a share, a person field names only the writer ("me"): nobody adds a guest,
      // a sign-up or a task in someone else's name.
      if (f.type === "person") {
        const other =
          typeof v === "string"
            ? v.trim() !== actor.userId && this.knownPerson(v.trim())
            : !!v && typeof v === "object" && "user_id" in v && !!v.user_id && v.user_id !== actor.userId;
        if (other) throw new ObjectError("forbidden", `Here ${f.name} can only be you`);
      }
      out[f.id] = v;
    }
    return out;
  }

  /** A record this person sees through any share of this space they joined. */
  private reachable(actor: Actor, recordId: string): boolean {
    if (!actor.userId || !this.liveRecord(recordId)) return false;
    return this.sql
      .exec<ShareRow>(
        `select s.* from share_people p join shares s on s.id = p.share_id
         where p.user_id = ? and s.revoked_at is null`,
        actor.userId,
      )
      .toArray()
      .some((sh) => this.alive(sh) && this.sharedRecordIds(sh, actor, [recordId]).length > 0);
  }

  /** What the owner picked to include, as stored ids (a link field, or one that links here). */
  private resolveIncludes(c: CollectionRow, refs: string[]): ShareInclude[] {
    const fields = this.fieldRows(c.id);
    const out = new Map<string, ShareInclude>();
    for (const ref of refs) {
      const own = fields.find((f) => f.type === "link" && (f.id === ref || f.name_key === nameKey(ref)));
      if (own) {
        out.set(`field:${own.id}`, { field: own.id });
        continue;
      }
      const byId = this.liveField(ref);
      if (byId && byId.type === "link" && (JSON.parse(byId.options_json) as FieldOptions).target === c.id) {
        out.set(`from:${byId.id}`, { from_field: byId.id });
        continue;
      }
      const other = this.sql
        .exec<CollectionRow>(
          `select id, name, description, title_field_id, position, updated_at from collections
           where deleted_at is null and (id = ? or name_key = ?)`,
          ref,
          nameKey(ref),
        )
        .toArray()[0];
      const linking = other
        ? this.fieldRows(other.id).filter(
            (f) => f.type === "link" && (JSON.parse(f.options_json) as FieldOptions).target === c.id,
          )
        : [];
      if (linking.length === 1) {
        out.set(`from:${linking[0]!.id}`, { from_field: linking[0]!.id });
        continue;
      }
      if (linking.length > 1)
        throw new ObjectError("ambiguous", `${other!.name} links to ${c.name} in more than one field`, {
          candidates: linking.map((f) => ({ id: f.id, name: `${other!.name}: ${f.name}` })),
        });
      throw new ObjectError(
        "validation_failed",
        `"${ref}" isn't a link field of ${c.name} or a collection that links to it`,
      );
    }
    return [...out.values()];
  }

  private includedCollections(c: CollectionRow, include: ShareInclude[]): string[] {
    const ids = new Set([c.id]);
    for (const x of include) {
      const f = this.liveField("field" in x ? x.field : x.from_field);
      if (!f) continue;
      if ("from_field" in x) ids.add(f.collection_id);
      else {
        const target = (JSON.parse(f.options_json) as FieldOptions).target;
        if (target) ids.add(target);
      }
    }
    return [...ids];
  }

  private resolveHidden(c: CollectionRow, include: ShareInclude[], refs: string[]): string[] {
    const cols = this.includedCollections(c, include).map((id) => this.requireCollection(id));
    const out = new Set<string>();
    for (const ref of refs) {
      let found = false;
      for (const col of cols) {
        const f = this.fieldRows(col.id).find(
          (x) =>
            x.id === ref ||
            x.name_key === nameKey(ref) ||
            (JSON.parse(x.aliases_json) as string[]).some((a) => nameKey(a) === nameKey(ref)),
        );
        if (!f) continue;
        if (f.id === col.title_field_id)
          throw new ObjectError(
            "validation_failed",
            `${f.name} is the title of ${col.name}; it can't be hidden`,
          );
        out.add(f.id);
        found = true;
      }
      if (!found) throw new ObjectError("validation_failed", `No field "${ref}" in what's shared`);
    }
    return [...out];
  }

  private shareView(s: ShareRow): ShareView {
    const include = JSON.parse(s.include_json) as ShareInclude[];
    const hidden = JSON.parse(s.hidden_json) as string[];
    return {
      id: s.id,
      kind: s.kind,
      target_id: s.target_id,
      record_id: s.kind === "card" ? s.target_id : null,
      title: this.shareTitle(s),
      public: !!s.public,
      access: s.access,
      include: include.flatMap((x) => {
        const f = this.liveField("field" in x ? x.field : x.from_field);
        if (!f) return [];
        return "field" in x
          ? [{ key: `field:${f.id}`, title: f.name }]
          : [{ key: `from:${f.id}`, title: this.requireCollection(f.collection_id).name }];
      }),
      hidden_fields: hidden.flatMap((id) => {
        const f = this.liveField(id);
        return f ? [{ id: f.id, name: f.name }] : [];
      }),
      people: this.sql
        .exec<{ user_id: string; name: string; joined_at: string; filters_json: string | null }>(
          `select p.user_id, p.name, p.joined_at, r.filters_json from share_people p
           left join share_rules r on r.share_id = p.share_id and r.user_id = p.user_id
           where p.share_id = ? order by p.joined_at`,
          s.id,
        )
        .toArray()
        .map(({ filters_json, ...p }) => ({
          ...p,
          rule: filters_json ? (JSON.parse(filters_json) as RuleFilter[]) : [],
        })),
      rule_all: (() => {
        const r = this.sql
          .exec<{ filters_json: string }>(
            `select filters_json from share_rules where share_id = ? and user_id = '*'`,
            s.id,
          )
          .toArray()[0];
        return r ? (JSON.parse(r.filters_json) as RuleFilter[]) : [];
      })(),
      expires_at: s.expires_at,
      created_at: s.created_at,
    };
  }

  // What collaborators see: shared fields only, never links (they'd name records outside it).
  private sharedFields(s: ShareRow, collectionId: string): FieldRow[] {
    const hidden = new Set(JSON.parse(s.hidden_json) as string[]);
    return this.fieldRows(collectionId).filter((f) => f.type !== "link" && !hidden.has(f.id));
  }

  /**
   * A form's link fields (one record, one target list), for signed-in people: each lists the
   * records they can already see through their shares (a sign-up picks one of its songs).
   */
  private formPicks(s: ShareRow, collectionId: string, actor: Actor): SharedFieldInfo[] {
    if (!actor.userId) return [];
    const hidden = new Set(JSON.parse(s.hidden_json) as string[]);
    return this.fieldRows(collectionId).flatMap((f) => {
      const o = toField(f).options;
      if (f.type !== "link" || hidden.has(f.id) || o.many || !o.target) return [];
      const pick = this.sql
        .exec<{ id: string; title: string }>(
          `select id, title from records where collection_id = ? and deleted_at is null order by title limit 500`,
          o.target,
        )
        .toArray()
        .filter((r) => this.reachable(actor, r.id))
        .map((r) => ({ id: r.id, title: r.title }));
      if (!pick.length) return [];
      return [
        {
          id: f.id,
          name: f.name,
          type: f.type,
          options: o,
          editable: true,
          required: !!f.required,
          personal: false,
          pick,
        },
      ];
    });
  }

  /** Personal answers are everyone's own to give, whatever the share's access (signed in only). */
  private fieldInfo(fields: FieldRow[], editable: boolean, actor: Actor): SharedFieldInfo[] {
    return fields.map((g) => {
      const personal = !!toField(g).options.personal;
      return {
        id: g.id,
        name: g.name,
        type: g.type,
        options: toField(g).options,
        editable: personal
          ? !!actor.userId
          : editable && !toField(g).options.formula && !toField(g).options.rollup,
        required: !!g.required,
        personal,
      };
    });
  }

  private sharedRecord(r: RecordRow, fields: FieldRow[], editable: boolean, actor: Actor): SharedRecord {
    const values = JSON.parse(r.values_json) as Record<string, StoredValue>;
    const titleId = this.requireCollection(r.collection_id).title_field_id;
    const mine = actor.userId
      ? new Map(
          this.sql
            .exec<{ field_id: string; value_json: string }>(
              `select field_id, value_json from answers where record_id = ? and user_id = ?`,
              r.id,
              actor.userId,
            )
            .toArray()
            .map((a) => [a.field_id, JSON.parse(a.value_json) as StoredValue]),
        )
      : new Map<string, StoredValue>();
    return {
      id: r.id,
      title: r.title,
      fields: fields.map((f) => {
        const personal = !!toField(f).options.personal;
        // A personal field shows only the person's own answer, never anyone else's.
        const v = personal ? (mine.get(f.id) ?? null) : (values[f.id] ?? null);
        return {
          id: f.id,
          name: f.name,
          type: f.type,
          options: toField(f).options,
          value: v,
          display: displayValue(f.type, v),
          editable: personal
            ? !!actor.userId
            : editable && !toField(f).options.formula && !toField(f).options.rollup,
          title: f.id === titleId,
          personal,
        };
      }),
    };
  }

  private opened(s: ShareRow, actor: Actor, cursor?: string): SharedOpened {
    if (s.kind === "card") return this.cardView(s, actor);
    if (s.kind === "question") {
      const q = this.liveQuestion(s.target_id)!;
      const mine = actor.userId
        ? this.sql
            .exec<{ answer: string }>(
              `select answer from question_answers where question_id = ? and user_id = ?`,
              q.id,
              actor.userId,
            )
            .toArray()[0]
        : undefined;
      return {
        share: { id: s.id, kind: "question", title: q.text, access: s.access, owner: this.ownerName() },
        text: q.text,
        choices: q.choices_json ? (JSON.parse(q.choices_json) as string[]) : null,
        mine: mine?.answer ?? null,
        closed: !!q.closed_at,
      };
    }
    const c = this.shareCollection(s);
    const head = { id: s.id, title: this.shareTitle(s), access: s.access, owner: this.ownerName() };
    if (s.kind === "view") {
      const edit = s.access === "edit";
      const fields = this.sharedFields(s, c.id);
      const v = this.viewOf(this.liveView(s.target_id)!);
      if (!v) throw new ObjectError("not_found", "Share not found");
      const rule = this.ruleFilters(s, actor);
      const { rows, next_cursor } = this.findRows(actor, c, {
        filters: [...v.filters, ...(rule ?? [])],
        ...(rule ? {} : { ids: [] }),
        search: v.search ?? undefined,
        sort: v.sort ?? undefined,
        limit: 100,
        cursor,
      });
      return {
        share: { ...head, kind: "view" },
        collection: c.name,
        fields: this.fieldInfo(fields, edit, actor),
        can_add: edit,
        records: rows.map((r) => this.sharedRecord(r, fields, edit, actor)),
        next_cursor,
      };
    }
    // Someone without an account can't give a personal answer, so their form leaves those out.
    const fields = this.sharedFields(s, c.id).filter((f) => !!actor.userId || !toField(f).options.personal);
    const mine = actor.userId
      ? this.sql
          .exec<RecordRow>(
            `select * from records where collection_id = ? and created_by = ? and deleted_at is null
             order by created_at desc limit 50`,
            c.id,
            actor.userId,
          )
          .toArray()
      : [];
    return {
      share: { ...head, kind: "form" },
      collection: c.name,
      description: c.description,
      fields: [...this.fieldInfo(fields, true, actor), ...this.formPicks(s, c.id, actor)].map((f) =>
        f.type === "person" && actor.userId ? { ...f, pick: [{ id: "me", title: "Me" }] } : f,
      ),
      mine: mine.map((r) => this.sharedRecord(r, fields, s.access === "edit", actor)),
    };
  }

  private cardView(s: ShareRow, actor: Actor): SharedCardView {
    const edit = s.access === "edit";
    const card = this.liveRecord(s.target_id);
    if (!card) throw new ObjectError("not_found", "Share not found");
    const cardFields = this.sharedFields(s, card.collection_id);
    const sections: SharedCardView["sections"] = [];
    for (const x of JSON.parse(s.include_json) as ShareInclude[]) {
      const f = this.liveField("field" in x ? x.field : x.from_field);
      if (!f) continue;
      if ("field" in x) {
        const target = (JSON.parse(f.options_json) as FieldOptions).target ?? null;
        const fields = target ? this.sharedFields(s, target) : [];
        const rows = this.sql
          .exec<RecordRow>(
            `select r.* from links l join records r on r.id = l.to_id
             where l.field_id = ? and l.from_id = ? and r.deleted_at is null
             order by l.position, l.created_at limit 500`,
            f.id,
            card.id,
          )
          .toArray();
        sections.push({
          key: `field:${f.id}`,
          title: f.name,
          collection_id: target ?? "",
          can_add: false,
          fields: this.fieldInfo(fields, edit, actor),
          records: rows.map((r) => this.sharedRecord(r, target ? fields : [], edit, actor)),
        });
      } else {
        const fields = this.sharedFields(s, f.collection_id);
        const rows = this.sql
          .exec<RecordRow>(
            `select r.* from links l join records r on r.id = l.from_id
             where l.field_id = ? and l.to_id = ? and r.deleted_at is null
             order by r.created_at limit 500`,
            f.id,
            card.id,
          )
          .toArray();
        sections.push({
          key: `from:${f.id}`,
          title: this.requireCollection(f.collection_id).name,
          collection_id: f.collection_id,
          can_add: edit,
          fields: this.fieldInfo(fields, edit, actor),
          records: rows.map((r) => this.sharedRecord(r, fields, edit, actor)),
        });
      }
    }
    return {
      share: { id: s.id, kind: "card", title: card.title, access: s.access, owner: this.ownerName() },
      record: this.sharedRecord(card, cardFields, edit, actor),
      sections,
    };
  }

  // --- Comments --------------------------------------------------------------------------------

  async comments(actor: Actor, recordId: string): Promise<CommentView[]> {
    this.role(actor);
    return this.commentList(this.requireRecord(recordId).id, actor);
  }

  async addComment(
    actor: Actor,
    key: string | null,
    name: string,
    recordId: string,
    input: { id?: string | null; body: string },
  ): Promise<CommentView> {
    // Viewers may comment too: a comment doesn't change the record.
    return this.write(
      actor,
      key,
      ["add_comment", recordId, input],
      (ts) => this.insertComment(actor, name, this.requireRecord(recordId).id, input, ts),
      () => this.role(actor),
    );
  }

  async deleteComment(actor: Actor, key: string | null, commentId: string): Promise<{ deleted: string }> {
    return this.write(
      actor,
      key,
      ["delete_comment", commentId],
      (ts) => {
        const c = this.sql
          .exec<CommentRow>(`select * from comments where id = ? and deleted_at is null`, commentId)
          .toArray()[0];
        if (!c) throw new ObjectError("not_found", "Comment not found");
        if (c.author_id !== actor.userId && this.role(actor) !== "owner")
          throw new ObjectError("forbidden", "Only its writer or the space's owner can delete a comment");
        this.sql.exec(`update comments set deleted_at = ? where id = ?`, ts, c.id);
        audit(this.sql, actor, {
          action: "delete_comment",
          entityType: "comment",
          entityId: c.id,
          before: { body: c.body },
        });
        return { deleted: c.id };
      },
      () => this.role(actor),
    );
  }

  /** Comments on a record shared with the person (any share that reaches it). */
  async sharedComments(actor: Actor, shareId: string, recordId: string): Promise<CommentView[]> {
    const s = this.joinedShare(actor, shareId);
    if (!this.sharedRecordIds(s, actor, [recordId]).length)
      throw new ObjectError("not_found", "Record not found");
    return this.commentList(recordId, actor);
  }

  async addSharedComment(
    actor: Actor,
    key: string | null,
    name: string,
    shareId: string,
    recordId: string,
    input: { id?: string | null; body: string },
  ): Promise<CommentView> {
    return this.write(
      actor,
      key,
      ["add_shared_comment", shareId, recordId, input],
      (ts) => this.insertComment(actor, name, recordId, input, ts),
      () => {
        const s = this.joinedShare(actor, shareId);
        if (!this.sharedRecordIds(s, actor, [recordId]).length)
          throw new ObjectError("not_found", "Record not found");
      },
    );
  }

  /** People in a share delete their own comments on what it reaches. */
  async deleteSharedComment(
    actor: Actor,
    key: string | null,
    shareId: string,
    commentId: string,
  ): Promise<{ deleted: string }> {
    let c!: CommentRow;
    return this.write(
      actor,
      key,
      ["delete_shared_comment", shareId, commentId],
      (ts) => {
        this.sql.exec(`update comments set deleted_at = ? where id = ?`, ts, c.id);
        audit(this.sql, actor, {
          action: "delete_comment",
          entityType: "comment",
          entityId: c.id,
          before: { body: c.body },
        });
        return { deleted: c.id };
      },
      () => {
        const s = this.joinedShare(actor, shareId);
        const row = this.sql
          .exec<CommentRow>(`select * from comments where id = ? and deleted_at is null`, commentId)
          .toArray()[0];
        if (!row || !this.sharedRecordIds(s, actor, [row.record_id]).length)
          throw new ObjectError("not_found", "Comment not found");
        if (row.author_id !== actor.userId)
          throw new ObjectError("forbidden", "You can delete only your own comments");
        c = row;
      },
    );
  }

  private insertComment(
    actor: Actor,
    name: string,
    recordId: string,
    input: { id?: string | null; body: string },
    ts: string,
  ): CommentView {
    const id = input.id && isUlid(input.id) ? input.id : ulid();
    if (this.sql.exec(`select 1 from comments where id = ?`, id).toArray().length)
      throw new ObjectError("conflict", "That comment id is taken");
    this.sql.exec(
      `insert into comments (id, record_id, author_id, author_name, body, created_at) values (?, ?, ?, ?, ?, ?)`,
      id,
      recordId,
      actor.userId,
      name,
      input.body,
      ts,
    );
    audit(this.sql, actor, {
      action: "add_comment",
      entityType: "comment",
      entityId: id,
      after: { record_id: recordId },
    });
    return this.commentView(
      this.sql.exec<CommentRow>(`select * from comments where id = ?`, id).toArray()[0]!,
      actor,
    );
  }

  /** The newest 500 comments, oldest first. */
  private commentList(recordId: string, actor: Actor, owner = this.isOwner(actor)): CommentView[] {
    return this.sql
      .exec<CommentRow>(
        `select * from comments where record_id = ? and deleted_at is null order by created_at desc, id desc limit 500`,
        recordId,
      )
      .toArray()
      .reverse()
      .map((c) => this.commentView(c, actor, owner));
  }

  private isOwner(actor: Actor): boolean {
    return (
      !!actor.userId &&
      this.sql.exec<{ role: Role }>(`select role from members where user_id = ?`, actor.userId).toArray()[0]
        ?.role === "owner"
    );
  }

  private commentView(c: CommentRow, actor: Actor, owner = this.isOwner(actor)): CommentView {
    const mine = !!actor.userId && c.author_id === actor.userId;
    return {
      can_delete: mine || owner,
      id: c.id,
      record_id: c.record_id,
      author: { user_id: c.author_id, name: c.author_name },
      body: c.body,
      created_at: c.created_at,
      mine,
    };
  }

  // --- Sync ---------------------------------------------------------------------------------

  async changes(actor: Actor, since: number, limit: number, withData = false): Promise<ChangesView> {
    this.role(actor);
    const rows = this.sql
      .exec<{
        seq: number;
        at: string;
        kind: "collection" | "record" | "space" | "view";
        entity_id: string;
        op: "upsert" | "delete";
      }>(
        `select seq, at, kind, entity_id, op from changes where seq > ? order by seq limit ?`,
        since,
        limit + 1,
      )
      .toArray();
    const page = rows.slice(0, limit);
    const out: ChangesView = {
      changes: page.map((r) => ({ seq: r.seq, at: r.at, kind: r.kind, id: r.entity_id, op: r.op })),
      seq: page.at(-1)?.seq ?? since,
      more: rows.length > limit,
    };
    if (!withData) return out;
    // The current state of each thing that changed (once each; deleted ones stay out).
    const ids = (kind: string) => [...new Set(page.filter((r) => r.kind === kind).map((r) => r.entity_id))];
    // Records that link to a changed (or deleted) record show its title, so they come too.
    const changed = ids("record");
    const linking = changed.flatMap((id) =>
      this.sql
        .exec<{ from_id: string }>(`select distinct from_id from links where to_id = ?`, id)
        .toArray()
        .map((l) => l.from_id),
    );
    out.records = [...new Set([...changed, ...linking])].flatMap((id) => {
      const r = this.sql
        .exec<RecordRow>(`select * from records where id = ? and deleted_at is null`, id)
        .toArray()[0];
      return r ? [this.recordView(r, actor)] : [];
    });
    out.collections = ids("collection").flatMap((id) => {
      const c = this.sql
        .exec<CollectionRow>(
          `select id, name, description, title_field_id, position, updated_at from collections where id = ? and deleted_at is null`,
          id,
        )
        .toArray()[0];
      return c ? [this.collectionView(c)] : [];
    });
    out.views = ids("view").flatMap((id) => {
      const v = this.sql
        .exec<ViewRow>(`select * from views where id = ? and deleted_at is null`, id)
        .toArray()[0];
      const view = v ? this.viewOf(v) : null;
      return view ? [view] : [];
    });
    return out;
  }

  // --- Name resolution (design §10: plain names in, ids out; never a guess) ---------------

  private requireCollection(ref: string): CollectionRow {
    const rows = this.sql
      .exec<CollectionRow & { name_key: string }>(
        `select id, name, name_key, description, title_field_id, position, updated_at from collections
         where deleted_at is null and (id = ? or name_key = ?)`,
        ref,
        nameKey(ref),
      )
      .toArray();
    if (rows[0]) return rows[0];
    const names = this.sql
      .exec<{ name: string }>(`select name from collections where deleted_at is null order by position`)
      .toArray()
      .map((r) => r.name);
    throw new ObjectError(
      "not_found",
      `No collection "${ref}". Collections: ${names.join(", ") || "none yet"}`,
      {
        candidates: names,
      },
    );
  }

  private fieldRows(collectionId: string): FieldRow[] {
    return this.sql
      .exec<FieldRow>(
        `select * from fields where collection_id = ? and deleted_at is null order by position`,
        collectionId,
      )
      .toArray();
  }

  private matchField(fields: FieldRow[], ref: string): FieldRow {
    const k = nameKey(ref);
    const hit =
      fields.find((f) => f.id === ref || f.name_key === k) ??
      fields.find((f) => (JSON.parse(f.aliases_json) as string[]).some((a) => nameKey(a) === k));
    if (hit) return hit;
    throw new ObjectError(
      "validation_failed",
      `No field "${ref}". Fields: ${fields.map((f) => f.name).join(", ")}`,
      {
        candidates: fields.map((f) => f.name),
      },
    );
  }

  private requireField(collectionId: string, ref: string): FieldRow {
    return this.matchField(this.fieldRows(collectionId), ref);
  }

  private requireRecord(id: string): RecordRow {
    const r = this.sql
      .exec<RecordRow>(`select * from records where id = ? and deleted_at is null`, id)
      .toArray()[0];
    if (!r) throw new ObjectError("not_found", "Record not found");
    return r;
  }

  /** A link value: a record id, or an exact title in the target collection (several → candidates). */
  private resolveRecord(f: FieldRow, ref: string): string {
    const target = toField(f).options.target ?? null;
    if (isUlid(ref)) {
      const r = this.sql
        .exec<{ collection_id: string }>(
          `select collection_id from records where id = ? and deleted_at is null`,
          ref,
        )
        .toArray()[0];
      if (r && (!target || r.collection_id === target)) return ref;
      if (r) throw new ObjectError("validation_failed", `${f.name} links to a different collection`);
    }
    const rows = this.sql
      .exec<{ id: string; title: string; created_at: string }>(
        `select id, title, created_at from records where deleted_at is null and title_key = ?
         ${target ? "and collection_id = ?" : ""} order by created_at desc limit 10`,
        ...(target ? [nameKey(ref), target] : [nameKey(ref)]),
      )
      .toArray();
    if (rows.length === 1) return rows[0]!.id;
    if (rows.length > 1)
      throw new ObjectError("ambiguous", `More than one "${ref}"; which one?`, {
        candidates: rows.map((r) => ({ id: r.id, title: r.title, created_at: r.created_at })),
      });
    throw new ObjectError("not_found", `${f.name}: nothing called "${ref}"`);
  }

  private newId(table: "collections" | "fields" | "records" | "views", given?: string | null): string {
    if (!given) return ulid();
    if (this.sql.exec(`select 1 from ${table} where id = ?`, given).toArray().length)
      throw new ObjectError("conflict", "That id is already used", { reason: "id_taken" });
    return given;
  }
}

/** "Sat, 12 Dec 2026" for a date, "Sat, 12 Dec 2026, 6:00 pm" (India time) for a date-time. */
function readableDate(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    timeZone: dateOnly ? "UTC" : "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(dateOnly ? {} : { hour: "numeric", minute: "2-digit" }),
  });
}
