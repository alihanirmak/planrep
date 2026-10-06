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
  if (models.length === 0) return [];

  const modelIds = models.map((m) => m.id);
  const phModels = modelIds.map(() => "?").join(",");
  const modelDimRows = sqlite
    .prepare(
      `SELECT md.model_id AS modelId, d.id, d.code, d.name, d.type, md.slot
       FROM model_dimensions md JOIN dimensions d ON d.id = md.dimension_id
       WHERE md.model_id IN (${phModels}) ORDER BY md.model_id, md.slot`
    )
    .all(...modelIds) as Array<Omit<DimInfo, "members"> & { modelId: number }>;

  const dimIds = [...new Set(modelDimRows.map((r) => r.id))];
  const membersByDim = fetchMembersByDimension(dimIds);

  const dimsByModel = new Map<number, DimInfo[]>();
  for (const { modelId, ...d } of modelDimRows) {
    const arr = dimsByModel.get(modelId) ?? [];
    arr.push({ ...d, members: membersByDim.get(d.id) ?? [] });
    dimsByModel.set(modelId, arr);
  }

  return models.map((m) => ({ ...m, dims: dimsByModel.get(m.id) ?? [] }));
}

// Birden fazla boyutun uyelerini tek sorguda ceker (N+1'i onler).
function fetchMembersByDimension(dimensionIds: number[]): Map<number, Member[]> {
  const out = new Map<number, Member[]>();
  if (dimensionIds.length === 0) return out;
  const placeholders = dimensionIds.map(() => "?").join(",");
  const members = sqlite
    .prepare(
      `SELECT id, dimension_id AS dimensionId, code, name, parent_id AS parentId, order_idx AS orderIdx
       FROM dimension_members WHERE dimension_id IN (${placeholders}) ORDER BY order_idx, id`
    )
    .all(...dimensionIds) as Array<Member & { dimensionId: number }>;
  for (const { dimensionId, ...m } of members) {
    const arr = out.get(dimensionId) ?? [];
    arr.push(m);
    out.set(dimensionId, arr);
  }
  return out;
}

export function getModelDims(modelId: number): DimInfo[] {
  const dims = sqlite
    .prepare(
      `SELECT d.id, d.code, d.name, d.type, md.slot
       FROM model_dimensions md JOIN dimensions d ON d.id = md.dimension_id
       WHERE md.model_id = ? ORDER BY md.slot`
    )
    .all(modelId) as Array<Omit<DimInfo, "members">>;
  if (dims.length === 0) return [];
  const membersByDim = fetchMembersByDimension(dims.map((d) => d.id));
  return dims.map((d) => ({ ...d, members: membersByDim.get(d.id) ?? [] }));
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

// Bir boyutun hiyerarsisindeki kok (parent'i olmayan ya da parent'i ayni
// boyutta bulunmayan) uyelerini sira numarasina gore dondurur. Sayfalama
// icin "sayfa = kok uyelerin bir dilimi" semantigi kullanilir (bkz. query.ts,
// api/pivot/route.ts) — her kok uyenin alt agaci (withDescendants) tamamen
// dahil edildigi icin sayfadaki satirlarin toplamlari her zaman dogru kalir.
export function rootMembers(members: Member[]): Member[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  return members
    .filter((m) => m.parentId == null || !byId.has(m.parentId))
    .sort((a, b) => a.orderIdx - b.orderIdx || a.id - b.id);
}
