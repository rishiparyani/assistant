// Audit log entries (architecture rule 11). Returned as prepared statements so they
// go in the same D1 batch (transaction) as the write they describe.
import { ulid } from "@assistant/shared";
import type { Source } from "./db/schema.ts";

export interface AuditEntry {
  workspaceId: string;
  actorUserId: string | null;
  source: Source;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export function auditStatement(d1: D1Database, e: AuditEntry): D1PreparedStatement {
  return d1
    .prepare(
      `insert into audit_log (id, workspace_id, actor_user_id, source, module, action, entity_type, entity_id, before_json, after_json)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ulid(),
      e.workspaceId,
      e.actorUserId,
      e.source,
      e.module,
      e.action,
      e.entityType,
      e.entityId,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
    );
}
