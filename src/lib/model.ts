import { sqlite } from "./db";

export type Member = {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
  orderIdx: number;
};

export type DimInfo = {
  id: number;
  code: string;
  name: string;
  type: string;
  slot: number;
  members: Member[];
};

export type ModelInfo = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  dims: DimInfo[];
};

export function getModels(): ModelInfo[] {
  const models = sqlite
    .prepare("SELECT id, code, name, description FROM models ORDER BY id")
    .all() as Array<{ id: number; code: string; name: string; description: string | null }>;
  return models.map((m) => ({ ...m, dims: getModelDims(m.id) }));
}

export function getModelDims(modelId: number): DimInfo[] {
  const dims = sqlite
    .prepare(
      `SELECT d.id, d.code, d.name, d.type, md.slot
       FROM model_dimensions md JOIN dimensions d ON d.id = md.dimension_id
       WHERE md.model_id = ? ORDER BY md.slot`
    )
    .all(modelId) as Array<Omit<DimInfo, "members">>;
  const memStmt = sqlite.prepare(
    `SELECT id, code, name, parent_id AS parentId, order_idx AS orderIdx
     FROM dimension_members WHERE dimension_id = ? ORDER BY order_idx, id`
  );
  return dims.map((d) => ({ ...d, members: memStmt.all(d.id) as Member[] }));
}

// Secilen uye kodlari + tum alt uyelerinin kodlari
export function withDescendants(members: Member[], codes: string[]): string[] {
  const byParent = new Map<number, Member[]>();
  const byCode = new Map<string, Member>();
  for (const m of members) {
    byCode.set(m.code, m);
    if (m.parentId != null) {
      const arr = byParent.get(m.parentId) ?? [];
      arr.push(m);
      byParent.set(m.parentId, arr);
    }
  }
  const out = new Set<string>();
  const stack = codes
    .map((c) => byCode.get(c))
    .filter((m): m is Member => !!m);
  while (stack.length) {
    const m = stack.pop()!;
    if (out.has(m.code)) continue;
    out.add(m.code);
    for (const child of byParent.get(m.id) ?? []) stack.push(child);
  }
  return [...out];
}
