// The engine's actions (docs/design/universal.md): each is a REST route, an MCP tool and,
// later, an assistant tool. Names are plain (collections, fields, record titles); the
// space object resolves them and never guesses.
import { z } from "zod";
import {
  AddCommentInput,
  PracticeAnswerInput,
  PracticeStartInput,
  AddFieldInput,
  CommentRef,
  AddRecordInput,
  ChangesInput,
  ChangeRecordsInput,
  UploadImportInput,
  ImportRecordsInput,
  ExportCsvInput,
  CollectionRef,
  CreateCollectionInput,
  FindRecordsInput,
  LinkRecordsInput,
  OpenViewInput,
  SaveViewInput,
  UpdateViewInput,
  HistoryInput,
  TRASH_DAYS,
  TrashInput,
  UndoInput,
  ViewRef,
  RecordRef,
  RemoveFieldInput,
  SpaceRef,
  UnlinkRecordsInput,
  UpdateCollectionInput,
  UpdateFieldInput,
  UpdateRecordInput,
  StartListInput,
  UpdateRecordsInput,
  QueryInput,
  NewSpaceInput,
  SpaceInstructionsInput,
} from "@assistant/shared";
import { defineOperation } from "../operations.ts";
import {
  endPractice,
  mySpaces,
  newSpace,
  practiceAnswer,
  practiceView,
  setSpaceInstructions,
  spaceOf,
  spaceSettings,
  startPractice,
} from "./service.ts";

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
    id: "core.space_new",
    tool: "new_space",
    description:
      'A new space of the person\'s own for a separate part of life ("the band", "home", "the society gate"): its own lists, cards, chats, memory and instructions. Shown as a card; made when they tap Confirm.',
    kind: "write",
    confirm: true,
    http: { method: "POST", path: "/spaces", status: 201 },
    input: NewSpaceInput,
    handler: (ctx, i) => newSpace(ctx, i.name),
  }),
  // Practice copies (decision 2026-10-16 "Rehearse a workflow", second part).
  defineOperation({
    id: "core.practice_start",
    tool: "start_practice",
    description:
      'Make a practice copy of a space (its lists, records, rules and workflows, all workflows on) to try workflows for real: add records, see who would be asked or told, answer as each person. Nothing in it reaches anyone; messages and questions go to its practice log. It\'s a space called "Practice: …". Use it when someone wants to try a workflow with people, or see what each person would get.',
    kind: "write",
    confirm: true,
    http: { method: "POST", path: "/spaces/:space/practice", status: 201 },
    input: PracticeStartInput,
    handler: (ctx, i) => startPractice(ctx, i.space),
  }),
  defineOperation({
    id: "core.practice_view",
    tool: "practice_log",
    description:
      "In a practice copy: what each person would have been told or asked (newest first), and what's waiting on whom.",
    kind: "read",
    http: { method: "GET", path: "/spaces/:space/practice" },
    input: PracticeStartInput,
    handler: (ctx, i) => practiceView(ctx, i.space ?? ""),
  }),
  defineOperation({
    id: "core.practice_answer",
    tool: "practice_answer",
    description:
      "In a practice copy: answer a waiting question as one of the people it went to (by their user id from practice_log), so the workflow goes on as if they had.",
    kind: "write",
    http: { method: "POST", path: "/spaces/:space/practice/answer" },
    input: PracticeAnswerInput,
    handler: (ctx, i) => practiceAnswer(ctx, i.space ?? "", i),
  }),
  defineOperation({
    id: "core.practice_end",
    tool: "end_practice",
    description: "End a practice copy: it's erased, with everything in it. The real space isn't touched.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/spaces/:space/practice" },
    input: PracticeStartInput,
    handler: (ctx, i) => endPractice(ctx, i.space ?? ""),
  }),
  defineOperation({
    id: "core.space_settings",
    tool: "space_settings",
    description: "One of my spaces with how I want things done in it (its instructions).",
    kind: "read",
    http: { method: "GET", path: "/spaces/:space" },
    input: SpaceRef,
    handler: (ctx, i) => spaceSettings(ctx, i.space),
  }),
  defineOperation({
    id: "core.space_instructions",
    tool: "set_space_instructions",
    description:
      'When the person says how things should work in a space ("in the band space, money is always split four ways"), keep it here in their words; you read it in every chat of that space. Replaces what was there: include what should stay.',
    kind: "write",
    http: { method: "PUT", path: "/spaces/:space/instructions" },
    input: SpaceInstructionsInput,
    handler: (ctx, i) => setSpaceInstructions(ctx, i.space, i.text),
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
    id: "core.start_list",
    tool: "start_list",
    description:
      "Start an everyday list the first time it's needed: notes, reminders (with an alarm at Due), events or expenses. If it's already there, it's returned as it is.",
    kind: "write",
    http: { method: "POST", path: "/lists/start", status: 201 },
    input: StartListInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.startList(actor, ctx.idempotencyKey, i.kind);
    },
  }),
  defineOperation({
    id: "core.create_collection",
    tool: "create_collection",
    description:
      "Make a new collection (like a table) with typed fields. Field types: text, long_text, number, money, date, datetime, boolean, choice (options.choices), multi_choice, person, link (options.target = collection name or none for any record; options.many).",
    kind: "write",
    // A new setup: assistants show it and wait for the person's OK.
    confirm: true,
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
    id: "core.query",
    tool: "query",
    description:
      'Answer a question about a list exactly: totals, counts, averages, highest/lowest, by group or by month. E.g. "earnings per venue this year": {from: "Gigs", where: [{field: "Date", op: "period", value: "this_year"}], group_by: ["Venue"], measures: [{fn: "sum", field: "Fee", as: "Earned"}]}. Fields of linked lists as "Client.Name" (or a list linking here: "Payouts.Amount"); dates by "Date:month". A column may have its own where (this year next to last year), or be arithmetic on earlier columns: {calc: "{Earned} - {Paid}", as: "Kept"}. Use this for any total or count instead of adding numbers yourself; the app shows the answer as a table.',
    kind: "read",
    http: { method: "POST", path: "/query" },
    input: QueryInput,
    handler: async (ctx, i) => {
      const { space, ...spec } = i;
      const { stub, actor } = await spaceOf(ctx, space);
      return stub.query(actor, spec);
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
    confirmWhen: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.touchesMoney(actor, { collection: i.collection }, Object.keys(i.values));
    },
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
    confirmWhen: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.touchesMoney(actor, { recordId: i.record_id }, Object.keys(i.values));
    },
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.updateRecord(actor, ctx.idempotencyKey, i.record_id, {
        values: i.values,
        version: i.version,
      });
    },
  }),
  defineOperation({
    id: "core.update_records",
    tool: "update_records",
    description:
      "Change several records at once, all or nothing (e.g. move the person holding a place to Not this time and select another).",
    kind: "write",
    http: { method: "POST", path: "/records/batch" },
    input: UpdateRecordsInput,
    confirmWhen: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      for (const c of i.changes)
        if (await stub.touchesMoney(actor, { recordId: c.record_id }, Object.keys(c.values))) return true;
      return false;
    },
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return { records: await stub.updateRecords(actor, ctx.idempotencyKey, i.changes) };
    },
  }),
  defineOperation({
    id: "core.preview_change",
    tool: "preview_change",
    description:
      "What change_records would do: how many records match and the first few shown before and after. Nothing changes.",
    kind: "read",
    http: { method: "POST", path: "/collections/:collection/change/preview" },
    input: ChangeRecordsInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.previewChange(actor, i);
    },
  }),
  defineOperation({
    id: "core.change_records",
    tool: "change_records",
    description:
      'Change every record that matches, the same value for all or one worked out per record by a formula ("raise every fee above 10,000 by 10%": filters Fee gt 10000, set Fee = "{Fee} * 1.1"). The person sees the count and examples first and confirms; all or nothing; up to 500 records.',
    kind: "write",
    confirm: true,
    http: { method: "POST", path: "/collections/:collection/change" },
    input: ChangeRecordsInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.changeRecords(actor, ctx.idempotencyKey, i);
    },
  }),
  defineOperation({
    id: "core.upload_import",
    tool: "upload_import",
    description:
      "Keep a CSV file for a day (the app sends it; the first line names the columns) and say what's in it: columns with a guess at their kind and sample cells, and the row count.",
    kind: "write",
    http: { method: "POST", path: "/imports", status: 201 },
    input: UploadImportInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.uploadImport(actor, ctx.idempotencyKey, { name: i.name, csv: i.csv });
    },
  }),
  defineOperation({
    id: "core.preview_import",
    tool: "preview_import",
    description:
      "What import_records would do with an uploaded file: into which list (new or existing), which column fills which field (new fields too), the first records, and the rows that can't be read. Nothing changes.",
    kind: "read",
    http: { method: "POST", path: "/imports/preview" },
    input: ImportRecordsInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.previewImport(actor, i);
    },
  }),
  defineOperation({
    id: "core.import_records",
    tool: "import_records",
    description:
      "Add an uploaded file's rows to a list, one record per row: map each column to a field of the list or to a new field (add); name a list that doesn't exist with add for every column to make it. The person confirms a card with the count, the mapping and sample rows; all or nothing unless skip_bad.",
    kind: "write",
    confirm: true,
    http: { method: "POST", path: "/imports/run", status: 201 },
    input: ImportRecordsInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.importRecords(actor, ctx.idempotencyKey, i);
    },
  }),
  defineOperation({
    id: "core.export_csv",
    tool: "export_csv",
    description:
      "A list, or one of its saved views, as CSV text (field names first; money in rupees, dates as yyyy-mm-dd, links by title), up to 5,000 rows. The app offers it as a file (GET /api/export/<collection>.csv?view=…).",
    kind: "read",
    http: { method: "POST", path: "/collections/:collection/export" },
    input: ExportCsvInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.exportCsv(actor, i);
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
    id: "core.list_views",
    tool: "list_views",
    description: "Saved views (a collection with filters and sort); pinned ones are the person's shortcuts.",
    kind: "read",
    http: { method: "GET", path: "/views" },
    input: SpaceRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.views(actor);
    },
  }),
  defineOperation({
    id: "core.open_view",
    tool: "show_view",
    description: "Open a saved view by name or id: its records with the view's filters and sort.",
    kind: "read",
    http: { method: "GET", path: "/views/:view_id" },
    input: OpenViewInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.openView(actor, i.view_id, { limit: i.limit, cursor: i.cursor });
    },
  }),
  defineOperation({
    id: "core.save_view",
    tool: "save_view",
    description:
      'Save a view of a collection (filters like find_records; periods such as "this_month" stay relative). pinned puts it on the shortcuts bar. When the person asks for a quick add (an add box) for a list, save a pinned view with add_fields: it shows an add box with just those fields.',
    kind: "write",
    http: { method: "POST", path: "/views", status: 201 },
    input: SaveViewInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.saveView(actor, ctx.idempotencyKey, {
        id: i.id ?? null,
        name: i.name,
        collection: i.collection,
        filters: i.filters,
        search: i.search,
        sort: i.sort,
        mode: i.mode,
        pinned: i.pinned,
        add_fields: i.add_fields,
        card_size: i.card_size,
        card: i.card,
      });
    },
  }),
  defineOperation({
    id: "core.update_view",
    tool: "update_view",
    description:
      "Rename a saved view, change its filters or sort, pin / unpin it, give it a quick add (add_fields; [] removes it), or change its card (arrangement, controls like switches, chips, steppers, stars and buttons).",
    kind: "write",
    http: { method: "PATCH", path: "/views/:view_id" },
    input: UpdateViewInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.updateView(actor, ctx.idempotencyKey, i.view_id, {
        name: i.name,
        filters: i.filters,
        search: i.search,
        sort: i.sort,
        mode: i.mode,
        pinned: i.pinned,
        position: i.position,
        add_fields: i.add_fields,
        card_size: i.card_size,
        card: i.card,
      });
    },
  }),
  defineOperation({
    id: "core.history",
    tool: "what_changed",
    description:
      "What changed lately in the space: records added, changed or deleted, in plain words, newest first, with whether each can be undone.",
    kind: "read",
    http: { method: "GET", path: "/history" },
    input: HistoryInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.history(actor, i.limit);
    },
  }),
  defineOperation({
    id: "core.undo",
    tool: "undo_change",
    description:
      "Undo one entry from what_changed: a changed record gets its earlier values back, an added record is removed, a deleted record comes back. If someone changed the same fields later it stops and says so; ask the person before undoing anyway (force_through). Things a workflow did because of it can be undone too (with). Needs confirmation.",
    kind: "write",
    confirm: true,
    http: { method: "POST", path: "/history/:change_id/undo" },
    input: UndoInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.undo(actor, ctx.idempotencyKey, i.change_id, {
        force_through: i.force_through,
        with: i.with,
      });
    },
  }),
  defineOperation({
    id: "core.trash",
    tool: "recently_deleted",
    description: `Recently deleted records (kept ${TRASH_DAYS} days, then erased), newest first; optionally one list's.`,
    kind: "read",
    http: { method: "GET", path: "/trash" },
    input: TrashInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.trash(actor, i.collection, i.limit);
    },
  }),
  defineOperation({
    id: "core.restore_record",
    tool: "restore_record",
    description:
      "Bring a record back from Recently deleted, with its links and what its delete took with it.",
    kind: "write",
    http: { method: "POST", path: "/trash/:record_id/restore" },
    input: RecordRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.restore(actor, ctx.idempotencyKey, i.record_id);
    },
  }),
  defineOperation({
    id: "core.erase_record",
    tool: "delete_forever",
    description:
      "Erase a record in Recently deleted now, for good (its values, comments and history details). Can't be undone. Needs confirmation.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/trash/:record_id" },
    input: RecordRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.eraseForever(actor, ctx.idempotencyKey, i.record_id);
    },
  }),
  defineOperation({
    id: "core.delete_view",
    tool: "delete_view",
    description: "Delete a saved view (its records stay).",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/views/:view_id" },
    input: ViewRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.deleteView(actor, ctx.idempotencyKey, i.view_id);
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
      return stub.changes(actor, i.since, i.limit, i.data === "1");
    },
  }),
  defineOperation({
    id: "core.list_comments",
    tool: "list_comments",
    description: "Comments on a record (by the space's people and anyone it's shared with).",
    kind: "read",
    http: { method: "GET", path: "/records/:record_id/comments" },
    input: RecordRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.comments(actor, i.record_id);
    },
  }),
  defineOperation({
    id: "core.add_comment",
    tool: "add_comment",
    description: "Comment on a record.",
    kind: "write",
    http: { method: "POST", path: "/records/:record_id/comments", status: 201 },
    input: AddCommentInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.addComment(actor, ctx.idempotencyKey, ctx.user.name, i.record_id, {
        id: i.id ?? null,
        body: i.body,
      });
    },
  }),
  defineOperation({
    id: "core.delete_comment",
    tool: "delete_comment",
    description: "Delete a comment (your own, or any as the space's owner).",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/comments/:comment_id" },
    input: CommentRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.deleteComment(actor, ctx.idempotencyKey, i.comment_id);
    },
  }),
];
