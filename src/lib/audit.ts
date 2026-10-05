import { sqlite } from "./db";

export function logAudit(
  userId: number | null,
  action: string,
  entity?: string,
  entityId?: string | number,
  detail?: unknown
) {
  sqlite
    .prepare(
      "INSERT INTO audit_log (user_id, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?)"
    )
    .run(
      userId,
      action,
      entity ?? null,
      entityId != null ? String(entityId) : null,
      detail != null ? JSON.stringify(detail) : null,
      new Date().toISOString()
    );
}
