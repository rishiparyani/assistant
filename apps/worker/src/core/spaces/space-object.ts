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
  type CollectionView,
  type FieldOptions,
  type FieldType,
  type FieldView,
  type Filter,
  type FindResult,
  type LinkedRef,
  type Period,
  type RecordView,
  type StoredValue,
} from "@assistant/shared";
import {
  BASE_TABLES,
  audit,
  hashOf,
  idempotent,
  migrate,
  nowIso,
  type Actor,
  type Migrations,
} from "../objects/storage.ts";
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
];

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

export interface SpaceInit {
  id: string;
  name: string;
  kind: "personal" | "shared";
  owner: { user_id: string; name: string };
  /** Personal spaces start with the starter setup (design §10). */
  starter: boolean;
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

export class SpaceObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  // --- Space and members ---------------------------------------------------------------

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
  ): Promise<T> {
    this.canWrite(actor);
    const hash = await hashOf(request);
    try {
      return idempotent(this.ctx.storage, key, hash, () => run(nowIso()));
    } catch (e) {
      if (e instanceof ValueError) throw new ObjectError("validation_failed", e.message);
      throw e;
    }
  }

  private logChange(
    kind: "collection" | "record" | "space",
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
    return this.collectionView(this.requireCollection(collection));
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
    if (!specs.some((f) => f.type === "text")) specs.unshift({ name: "Title", type: "text", required: true });
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
      if (!titleId && f.type === "text") titleId = fid;
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
    const options = this.checkOptions(f.type, f.options ?? {});
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
  private checkOptions(type: FieldType, o: FieldOptions & { target?: string | null }): FieldOptions {
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
        options = this.checkOptions(f.type, { ...before.options, ...input.options });
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
    return this.write(actor, key, ["add_record", collection, input], (ts) => {
      const c = this.requireCollection(collection);
      const fields = this.fieldRows(c.id);
      const { values, links } = this.readValues(fields, input.values);
      for (const f of fields)
        if (
          f.required &&
          (f.type === "link" ? !links.get(f.id)?.length : values[f.id] === null || values[f.id] === undefined)
        )
          throw new ObjectError("validation_failed", `${f.name} is required`);
      const id = this.newId("records", input.id);
      this.saveRecord(id, c, fields, values, ts, actor, true);
      for (const [fid, ids] of links)
        this.setLinks(
          fields.find((f) => f.id === fid)!,
          id,
          ids,
          ts,
        );
      this.logChange("record", id, "upsert", ts);
      audit(this.sql, actor, {
        action: "add_record",
        entityType: "record",
        entityId: id,
        after: input.values,
      });
      return this.recordView(this.requireRecord(id));
    });
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
    return this.recordView(this.requireRecord(recordId));
  }

  async updateRecord(
    actor: Actor,
    key: string | null,
    recordId: string,
    input: { values: Record<string, unknown>; version?: number },
  ): Promise<RecordView> {
    return this.write(actor, key, ["update_record", recordId, input], (ts) => {
      const r = this.requireRecord(recordId);
      if (input.version !== undefined && input.version !== r.version)
        throw new ObjectError("conflict", "This record changed since you read it; reload and try again", {
          reason: "stale_version",
        });
      const c = this.requireCollection(r.collection_id);
      const fields = this.fieldRows(c.id);
      const before = JSON.parse(r.values_json) as Record<string, StoredValue>;
      const { values, links } = this.readValues(fields, input.values);
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
      this.logChange("record", r.id, "upsert", ts);
      audit(this.sql, actor, {
        action: "update_record",
        entityType: "record",
        entityId: r.id,
        before: Object.fromEntries(Object.keys(values).map((k) => [k, before[k] ?? null])),
        after: input.values,
      });
      return this.recordView(this.requireRecord(r.id));
    });
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
      audit(this.sql, actor, {
        action: "link_records",
        entityType: "record",
        entityId: r.id,
        after: { field: f.name, to: ids },
      });
      return this.recordView(this.requireRecord(r.id));
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
      this.touchRecord(r.id, ts);
      audit(this.sql, actor, {
        action: "unlink_records",
        entityType: "record",
        entityId: r.id,
        before: { field: f.name, to },
      });
      return this.recordView(this.requireRecord(r.id));
    });
  }

  private touchRecord(id: string, ts: string) {
    this.sql.exec(`update records set updated_at = ?, version = version + 1 where id = ?`, ts, id);
    this.logChange("record", id, "upsert", ts);
  }

  /** Splits input values (by field name, alias or id) into stored values and link targets. */
  private readValues(fields: FieldRow[], input: Record<string, unknown>) {
    const values: Record<string, StoredValue> = {};
    const links = new Map<string, string[]>();
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
      } else {
        values[f.id] = normalizeValue(toField(f), raw);
      }
    }
    return { values, links };
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

  private recordView(r: RecordRow): RecordView {
    const fields = this.fieldRows(r.collection_id);
    const values = JSON.parse(r.values_json) as Record<string, StoredValue>;
    const live: Record<string, StoredValue> = {};
    const named: Record<string, string | string[] | null> = {};
    const links: Record<string, LinkedRef[]> = {};
    for (const f of fields) {
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
    const fields = this.fieldRows(c.id);
    const where: string[] = [`r.collection_id = ?`, `r.deleted_at is null`];
    const args: unknown[] = [c.id];
    for (const flt of q.filters) {
      const f = this.matchField(fields, flt.field);
      const [clause, a] = this.filterClause(f, flt, actor);
      where.push(clause);
      args.push(...a);
    }
    for (const w of words(q.search ?? "").slice(0, 5)) {
      where.push(`r.id in (select record_id from record_words where word >= ? and word < ?)`);
      args.push(w, `${w}￿`);
    }
    let order = `r.created_at desc, r.id desc`;
    if (q.sort) {
      const f = this.matchField(fields, q.sort.field);
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
      items: rows.slice(0, q.limit).map((r) => this.recordView(r)),
      next_cursor: more ? encodeCursor([offset + q.limit]) : null,
    };
  }

  private filterClause(f: FieldRow, flt: Filter, actor: Actor): [string, unknown[]] {
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
        const s = String(raw);
        const member = this.sql
          .exec<{ user_id: string }>(`select user_id from members`)
          .toArray()
          .find((m) => m.user_id === s);
        return member ? `user:${s}` : `name:${nameKey(s)}`;
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

  // --- Sync ---------------------------------------------------------------------------------

  async changes(actor: Actor, since: number, limit: number): Promise<ChangesView> {
    this.role(actor);
    const rows = this.sql
      .exec<{
        seq: number;
        at: string;
        kind: "collection" | "record" | "space";
        entity_id: string;
        op: "upsert" | "delete";
      }>(
        `select seq, at, kind, entity_id, op from changes where seq > ? order by seq limit ?`,
        since,
        limit + 1,
      )
      .toArray();
    const page = rows.slice(0, limit);
    return {
      changes: page.map((r) => ({ seq: r.seq, at: r.at, kind: r.kind, id: r.entity_id, op: r.op })),
      seq: page.at(-1)?.seq ?? since,
      more: rows.length > limit,
    };
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

  private newId(table: "collections" | "fields" | "records", given?: string | null): string {
    if (!given) return ulid();
    if (this.sql.exec(`select 1 from ${table} where id = ?`, given).toArray().length)
      throw new ObjectError("conflict", "That id is already used", { reason: "id_taken" });
    return given;
  }
}
