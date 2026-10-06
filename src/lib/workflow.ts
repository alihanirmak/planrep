import { sqlite } from "./db";
import type { DimInfo } from "./model";
import { scopeMatchesCoord, scopesOverlap } from "./fact-filters";
import type { Role } from "./session";

export type WorkflowStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected"
  | "locked";

export type WorkflowItem = {
  id: number;
  modelId: number;
  name: string;
  scopeFilters: Record<string, string[]>;
  status: WorkflowStatus;
  ownerId: number;
  approverId: number | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
};

export type WorkflowHistoryEntry = {
  id: number;
  workflowId: number;
  fromStatus: WorkflowStatus | null;
  toStatus: WorkflowStatus;
  userId: number;
  comment: string | null;
  createdAt: string;
};

export type WorkflowAction = "submit" | "review" | "approve" | "reject" | "lock" | "reopen";

type Row = {
  id: number;
  model_id: number;
  name: string;
  scope_filters: string;
  status: WorkflowStatus;
  owner_id: number;
  approver_id: number | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  locked_at: string | null;
};

function mapRow(r: Row): WorkflowItem {
  return {
    id: r.id,
    modelId: r.model_id,
    name: r.name,
    scopeFilters: JSON.parse(r.scope_filters),
    status: r.status,
    ownerId: r.owner_id,
    approverId: r.approver_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    approvedAt: r.approved_at,
    lockedAt: r.locked_at,
  };
}

export function listWorkflowItems(filter?: { modelId?: number; status?: WorkflowStatus }): WorkflowItem[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter?.modelId != null) {
    where.push("model_id = ?");
    params.push(filter.modelId);
  }
  if (filter?.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  const sql = `SELECT * FROM workflow_items${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC`;
  const rows = sqlite.prepare(sql).all(...params) as Row[];
  return rows.map(mapRow);
}

export function getWorkflowItem(id: number): WorkflowItem | null {
  const row = sqlite.prepare("SELECT * FROM workflow_items WHERE id = ?").get(id) as Row | undefined;
  return row ? mapRow(row) : null;
}

export function getWorkflowHistory(workflowId: number): WorkflowHistoryEntry[] {
  const rows = sqlite
    .prepare("SELECT * FROM workflow_history WHERE workflow_id = ? ORDER BY id ASC")
    .all(workflowId) as Array<{
    id: number;
    workflow_id: number;
    from_status: WorkflowStatus | null;
    to_status: WorkflowStatus;
    user_id: number;
    comment: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    userId: r.user_id,
    comment: r.comment,
    createdAt: r.created_at,
  }));
}

export function createWorkflowItem(input: {
  modelId: number;
  name: string;
  scopeFilters: Record<string, string[]>;
  ownerId: number;
  approverId?: number | null;
}): WorkflowItem {
  const now = new Date().toISOString();
  const id = Number(
    sqlite
      .prepare(
        `INSERT INTO workflow_items
           (model_id, name, scope_filters, status, owner_id, approver_id, created_at, updated_at)
         VALUES (?,?,?,'draft',?,?,?,?)`
      )
      .run(
        input.modelId,
        input.name,
        JSON.stringify(input.scopeFilters),
        input.ownerId,
        input.approverId ?? null,
        now,
        now
      ).lastInsertRowid
  );
  return getWorkflowItem(id)!;
}

export function updateWorkflowItem(
  id: number,
  patch: { name?: string; scopeFilters?: Record<string, string[]>; approverId?: number | null }
): WorkflowItem | null {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `UPDATE workflow_items SET
         name = COALESCE(?, name),
         scope_filters = COALESCE(?, scope_filters),
         approver_id = CASE WHEN ? THEN ? ELSE approver_id END,
         updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? null,
      patch.scopeFilters != null ? JSON.stringify(patch.scopeFilters) : null,
      patch.approverId !== undefined ? 1 : 0,
      patch.approverId ?? null,
      now,
      id
    );
  return getWorkflowItem(id);
}

export function deleteWorkflowItem(id: number) {
  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM workflow_history WHERE workflow_id = ?").run(id);
    sqlite.prepare("DELETE FROM workflow_items WHERE id = ?").run(id);
  });
  tx();
}

type TransitionRule = {
  action: WorkflowAction;
  from: WorkflowStatus;
  to: WorkflowStatus;
  requireComment?: boolean;
};

const TRANSITION_RULES: TransitionRule[] = [
  { action: "submit", from: "draft", to: "submitted" },
  { action: "submit", from: "rejected", to: "submitted" },
  { action: "review", from: "submitted", to: "in_review" },
  { action: "approve", from: "in_review", to: "approved" },
  { action: "reject", from: "submitted", to: "rejected", requireComment: true },
  { action: "reject", from: "in_review", to: "rejected", requireComment: true },
  { action: "lock", from: "approved", to: "locked" },
  { action: "reopen", from: "locked", to: "draft", requireComment: true },
];

export type TransitionCheck =
  | { ok: true; rule: TransitionRule }
  | { ok: false; error: "invalid_transition" | "forbidden" | "comment_required" };

// Durum makinesi + rol/sahiplik kontrolu. Saf fonksiyon (DB'ye yazmaz), bu
// yuzden hem API route'unda hem testlerde kullanilabilir.
export function canTransition(
  item: WorkflowItem,
  action: WorkflowAction,
  session: { id: number; role: Role },
  comment?: string | null
): TransitionCheck {
  const rule = TRANSITION_RULES.find((r) => r.action === action && r.from === item.status);
  if (!rule) return { ok: false, error: "invalid_transition" };

  if (action === "submit") {
    if (session.role !== "admin" && session.id !== item.ownerId) {
      return { ok: false, error: "forbidden" };
    }
  } else {
    // review/approve/reject/lock/reopen: admin her zaman yetkili; belirli bir
    // onaylayan atanmissa (approverId) ve islem review/approve ise o kisi de yetkili.
    const isApproverAction = action === "review" || action === "approve";
    const isAssignedApprover = item.approverId != null && session.id === item.approverId;
    if (session.role !== "admin" && !(isApproverAction && isAssignedApprover)) {
      return { ok: false, error: "forbidden" };
    }
  }

  if (rule.requireComment && !comment?.trim()) {
    return { ok: false, error: "comment_required" };
  }
  return { ok: true, rule };
}

const TIMESTAMP_COLUMN: Partial<Record<WorkflowStatus, string>> = {
  submitted: "submitted_at",
  in_review: "reviewed_at",
  approved: "approved_at",
  locked: "locked_at",
};

export function applyTransition(
  item: WorkflowItem,
  rule: TransitionRule,
  userId: number,
  comment: string | null | undefined
): WorkflowItem {
  const now = new Date().toISOString();
  const tsCol = TIMESTAMP_COLUMN[rule.to];
  const tx = sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE workflow_items SET status = ?, updated_at = ?${tsCol ? `, ${tsCol} = ?` : ""} WHERE id = ?`
      )
      .run(...(tsCol ? [rule.to, now, now, item.id] : [rule.to, now, item.id]));
    sqlite
      .prepare(
        `INSERT INTO workflow_history (workflow_id, from_status, to_status, user_id, comment, created_at)
         VALUES (?,?,?,?,?,?)`
      )
      .run(item.id, item.status, rule.to, userId, comment ?? null, now);
  });
  tx();
  return getWorkflowItem(item.id)!;
}

// --- Veri kilidi: locked durumundaki workflow kapsamina yazma/silme koruma ---

// Tek bir fact satirinin (coord) herhangi bir kilitli workflow kapsamina
// girip girmedigini kontrol eder; girерse o workflow item'i dondurur.
export function findBlockingLock(
  modelId: number,
  dims: DimInfo[],
  coordsByDimCode: Record<string, string | undefined>
): WorkflowItem | null {
  const locks = listWorkflowItems({ modelId, status: "locked" });
  for (const item of locks) {
    if (scopeMatchesCoord(item.scopeFilters, dims, coordsByDimCode)) return item;
  }
  return null;
}

// Bir filtre kumesinin (örn. toplu silme) herhangi bir kilitli workflow
// kapsamiyla KESISIP KESISMEDIGINI (overlap) kontrol eder — kesisim varsa
// islem tumuyle reddedilir (kismi/yanlis silmeyi onlemek icin konservatif).
export function findBlockingLockForFilters(
  modelId: number,
  dims: DimInfo[],
  filters: Record<string, string[]>
): WorkflowItem | null {
  const locks = listWorkflowItems({ modelId, status: "locked" });
  for (const item of locks) {
    if (scopesOverlap(item.scopeFilters, filters, dims)) return item;
  }
  return null;
}

export class WorkflowLockError extends Error {
  constructor(
    public workflowItemId: number,
    public workflowName: string
  ) {
    super(`Veri kilitli: "${workflowName}" onay akışı bu veri kesitini kilitlemiş durumda.`);
    this.name = "WorkflowLockError";
  }
}
