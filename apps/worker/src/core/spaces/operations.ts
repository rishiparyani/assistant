// The engine's actions (docs/design/universal.md): each is a REST route, an MCP tool and,
// later, an assistant tool. Names are plain (collections, fields, record titles); the
// space object resolves them and never guesses.
import { z } from "zod";
import {
  AddFieldInput,
  AddRecordInput,
  ChangesInput,
  CollectionRef,
  CreateCollectionInput,
  FindRecordsInput,
  LinkRecordsInput,
  RecordRef,
  RemoveFieldInput,
  SpaceRef,
  UnlinkRecordsInput,
  UpdateCollectionInput,
  UpdateFieldInput,
  UpdateRecordInput,
} from "@assistant/shared";
import { defineOperation } from "../operations.ts";
import { mySpaces, spaceOf } from "./service.ts";

export const spaceOperations = [
  defineOperation({
    id: "core.list_spaces",
    tool: "list_spaces",
    description:
      "My spaces (Personal first). Most actions take an optional space name; Personal is the default.",
    kind: "read",
    http: { method: "GET", path: "/spaces" },
    input: z.object({}),
    handler: (ctx) => mySpaces(ctx),
  }),
  defineOperation({
    id: "core.list_collections",
    tool: "list_collections",
    description: "The collections in a space with their fields (names, types, choices, links).",
    kind: "read",
    http: { method: "GET", path: "/collections" },
    input: SpaceRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.collections(actor);
    },
  }),
  defineOperation({
    id: "core.describe_collection",
    tool: "describe_collection",
    description: "One collection's fields (names, types, choices, link targets) and what links to it.",
    kind: "read",
    http: { method: "GET", path: "/collections/:collection" },
    input: CollectionRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.describe(actor, i.collection);
    },
  }),
  defineOperation({
    id: "core.create_collection",
    tool: "create_collection",
    description:
      "Make a new collection (like a table) with typed fields. Field types: text, long_text, number, money, date, datetime, boolean, choice (options.choices), multi_choice, person, link (options.target = collection name or none for any record; options.many).",
    kind: "write",
    http: { method: "POST", path: "/collections", status: 201 },
    input: CreateCollectionInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.createCollection(actor, ctx.idempotencyKey, {
        id: i.id ?? null,
        name: i.name,
        description: i.description ?? null,
        fields: i.fields,
      });
    },
  }),
  defineOperation({
    id: "core.update_collection",
    tool: "update_collection",
    description: "Rename a collection or change its description.",
    kind: "write",
    http: { method: "PATCH", path: "/collections/:collection" },
    input: UpdateCollectionInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.updateCollection(actor, ctx.idempotencyKey, i.collection, {
        name: i.name,
        description: i.description,
      });
    },
  }),
  defineOperation({
    id: "core.add_field",
    tool: "add_field",
    description: "Add a field to a collection (same types as create_collection).",
    kind: "write",
    http: { method: "POST", path: "/collections/:collection/fields", status: 201 },
    input: AddFieldInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.addField(actor, ctx.idempotencyKey, i.collection, i.field);
    },
  }),
  defineOperation({
    id: "core.update_field",
    tool: "update_field",
    description: "Rename a field, change its choices or link options, make it required, or set aliases.",
    kind: "write",
    http: { method: "PATCH", path: "/collections/:collection/fields/:field" },
    input: UpdateFieldInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.updateField(actor, ctx.idempotencyKey, i.collection, i.field, {
        name: i.name,
        options: i.options,
        required: i.required,
        aliases: i.aliases,
      });
    },
  }),
  defineOperation({
    id: "core.remove_field",
    tool: "remove_field",
    description: "Hide a field from a collection (its values are kept and can come back).",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/collections/:collection/fields/:field" },
    input: RemoveFieldInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.removeField(actor, ctx.idempotencyKey, i.collection, i.field);
    },
  }),
  defineOperation({
    id: "core.find_records",
    tool: "find_records",
    description:
      'Find records in a collection. filters: [{field, op, value}] with op eq, ne, lt, lte, gt, gte, contains, in, empty, not_empty, or period (value: today, tomorrow, this_week, next_7_days, this_month, last_month, past, future…). Person fields accept "me". search matches title words. Returns values by field name in `named`.',
    kind: "read",
    http: { method: "POST", path: "/collections/:collection/find" },
    input: FindRecordsInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.find(actor, i.collection, {
        filters: i.filters,
        search: i.search,
        sort: i.sort,
        limit: i.limit,
        cursor: i.cursor,
      });
    },
  }),
  defineOperation({
    id: "core.get_record",
    tool: "get_record",
    description: "One record with all its values and links.",
    kind: "read",
    http: { method: "GET", path: "/records/:record_id" },
    input: RecordRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.getRecord(actor, i.record_id);
    },
  }),
  defineOperation({
    id: "core.add_record",
    tool: "add_record",
    description:
      'Add a record. values by field name: money as "₹450" or 450, dates "2026-12-12", date-times "2026-12-12T19:00" (India time), choices by name, links by record id or exact title.',
    kind: "write",
    http: { method: "POST", path: "/collections/:collection/records", status: 201 },
    input: AddRecordInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.addRecord(actor, ctx.idempotencyKey, i.collection, { id: i.id ?? null, values: i.values });
    },
  }),
  defineOperation({
    id: "core.update_record",
    tool: "update_record",
    description: "Change some of a record's values (null clears a field; a link value replaces its links).",
    kind: "write",
    http: { method: "PATCH", path: "/records/:record_id" },
    input: UpdateRecordInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.updateRecord(actor, ctx.idempotencyKey, i.record_id, {
        values: i.values,
        version: i.version,
      });
    },
  }),
  defineOperation({
    id: "core.delete_record",
    tool: "delete_record",
    description: "Delete a record. Links to it follow each link field's rule (unlink, block or cascade).",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/records/:record_id" },
    input: RecordRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.deleteRecord(actor, ctx.idempotencyKey, i.record_id);
    },
  }),
  defineOperation({
    id: "core.link_records",
    tool: "link_records",
    description: "Link a record to others through one of its link fields (ids or exact titles).",
    kind: "write",
    http: { method: "POST", path: "/records/:record_id/links" },
    input: LinkRecordsInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.linkRecords(actor, ctx.idempotencyKey, i.record_id, i.field, i.to, i.after);
    },
  }),
  defineOperation({
    id: "core.unlink_records",
    tool: "unlink_records",
    description: "Remove links from a record's link field.",
    kind: "write",
    http: { method: "POST", path: "/records/:record_id/unlink" },
    input: UnlinkRecordsInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.unlinkRecords(actor, ctx.idempotencyKey, i.record_id, i.field, i.to);
    },
  }),
  defineOperation({
    id: "core.space_changes",
    tool: "space_changes",
    description: "What changed in a space since a change number (used by the app to stay in sync offline).",
    kind: "read",
    sessionOnly: true,
    http: { method: "GET", path: "/space-changes" },
    input: ChangesInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.changes(actor, i.since, i.limit);
    },
  }),
];
