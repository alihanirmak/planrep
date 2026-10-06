import { sqlite } from "./db";
import type { DimInfo } from "./model";
import { scopeMatchesCoord } from "./fact-filters";

export type RuleOp = "<" | ">" | "<=" | ">=" | "=" | "<>";
export type RuleSeverity = "block" | "warn";

export type BusinessRule = {
  id: number;
  tenantId: number;
  modelId: number;
  name: string;
  scopeFilters: Record<string, string[]>;
  op: RuleOp;
  value: number;
  severity: RuleSeverity;
  message: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: number;
  tenant_id: number;
  model_id: number;
  name: string;
  scope_filters: string;
  op: RuleOp;
  value: number;
  severity: RuleSeverity;
  message: string | null;
  active: number;
  created_at: string;
  updated_at: string;
};

function mapRow(r: Row): BusinessRule {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    modelId: r.model_id,
    name: r.name,
    scopeFilters: JSON.parse(r.scope_filters),
    op: r.op,
    value: r.value,
    severity: r.severity,
    message: r.message,
    active: r.active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listBusinessRules(filter?: {
  tenantId?: number;
  modelId?: number;
  activeOnly?: boolean;
}): BusinessRule[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter?.tenantId != null) {
    where.push("tenant_id = ?");
    params.push(filter.tenantId);
  }
  if (filter?.modelId != null) {
    where.push("model_id = ?");
    params.push(filter.modelId);
  }
  if (filter?.activeOnly) where.push("active = 1");
  const sql = `SELECT * FROM business_rules${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC`;
  return (sqlite.prepare(sql).all(...params) as Row[]).map(mapRow);
}

export function getBusinessRule(id: number): BusinessRule | null {
  const row = sqlite.prepare("SELECT * FROM business_rules WHERE id = ?").get(id) as Row | undefined;
  return row ? mapRow(row) : null;
}

export function createBusinessRule(input: {
  tenantId: number;
  modelId: number;
  name: string;
  scopeFilters: Record<string, string[]>;
  op: RuleOp;
  value: number;
  severity: RuleSeverity;
  message?: string | null;
}): BusinessRule {
  const now = new Date().toISOString();
  const id = Number(
    sqlite
      .prepare(
        `INSERT INTO business_rules
           (tenant_id, model_id, name, scope_filters, op, value, severity, message, active, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,1,?,?)`
      )
      .run(
        input.tenantId,
        input.modelId,
        input.name,
        JSON.stringify(input.scopeFilters),
        input.op,
        input.value,
        input.severity,
        input.message ?? null,
        now,
        now
      ).lastInsertRowid
  );
  return getBusinessRule(id)!;
}

export function updateBusinessRule(
  id: number,
  patch: Partial<{
    name: string;
    scopeFilters: Record<string, string[]>;
    op: RuleOp;
    value: number;
    severity: RuleSeverity;
    message: string | null;
    active: boolean;
  }>
): BusinessRule | null {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `UPDATE business_rules SET
         name = COALESCE(?, name),
         scope_filters = COALESCE(?, scope_filters),
         op = COALESCE(?, op),
         value = COALESCE(?, value),
         severity = COALESCE(?, severity),
         message = CASE WHEN ? THEN ? ELSE message END,
         active = COALESCE(?, active),
         updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? null,
      patch.scopeFilters != null ? JSON.stringify(patch.scopeFilters) : null,
      patch.op ?? null,
      patch.value ?? null,
      patch.severity ?? null,
      patch.message !== undefined ? 1 : 0,
      patch.message ?? null,
      patch.active != null ? (patch.active ? 1 : 0) : null,
      now,
      id
    );
  return getBusinessRule(id);
}

export function deleteBusinessRule(id: number) {
  sqlite.prepare("DELETE FROM business_rules WHERE id = ?").run(id);
}

function ruleViolated(op: RuleOp, value: number, threshold: number): boolean {
  switch (op) {
    case "<":
      return value < threshold;
    case ">":
      return value > threshold;
    case "<=":
      return value <= threshold;
    case ">=":
      return value >= threshold;
    case "=":
      return value === threshold;
    case "<>":
      return value !== threshold;
  }
}

export type RuleViolation = { rule: BusinessRule; value: number };

// Bir koordinat+deger icin aktif is kurallarini degerlendirir. "block"
// siddetindeki ihlaller yazmayi durdurmali (caller BusinessRuleError
// firlatmali); "warn" siddetindekiler sadece bilgilendirme amaclidir.
export function evaluateBusinessRules(
  modelId: number,
  dims: DimInfo[],
  coordsByDimCode: Record<string, string | undefined>,
  value: number
): { blocking: RuleViolation[]; warnings: RuleViolation[] } {
  const rules = listBusinessRules({ modelId, activeOnly: true });
  const blocking: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];
  for (const rule of rules) {
    if (!scopeMatchesCoord(rule.scopeFilters, dims, coordsByDimCode)) continue;
    if (!ruleViolated(rule.op, value, rule.value)) continue;
    (rule.severity === "block" ? blocking : warnings).push({ rule, value });
  }
  return { blocking, warnings };
}

export class BusinessRuleError extends Error {
  constructor(public violations: RuleViolation[]) {
    const uniqueByRule = new Map<number, RuleViolation>();
    for (const v of violations) uniqueByRule.set(v.rule.id, v);
    super(
      [...uniqueByRule.values()]
        .map((v) => v.rule.message || `"${v.rule.name}" kuralı ihlal edildi (değer: ${v.value})`)
        .join("; ")
    );
    this.name = "BusinessRuleError";
  }
}
