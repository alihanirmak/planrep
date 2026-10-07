import { sqlite } from "./db";

// Boyut uyesi ozellikleri (dimension member attributes) — bir boyutun
// uyelerine hiyerarsi disi ek nitelikler tanimlamayi saglar (orn. "Musteri"
// boyutundaki uyenin "Bolge"si, "Masraf Yeri"nin "Sirket Kodu"). EAV deseni
// kullanilir (dimension_attributes = tanim, dimension_member_attribute_values
// = deger) — facts tablosundaki d1..d16 sabit kolon kisitina TABI DEGIL,
// bir boyuta eklenebilecek attribute sayisi sinirsizdir (bkz. docs/ROADMAP.md
// "Boyut uyesi ozellikleri" maddesi).
export type AttributeType = "text" | "number" | "date" | "member_ref";

export type DimensionAttribute = {
  id: number;
  dimensionId: number;
  code: string;
  name: string;
  type: AttributeType;
  refDimensionId: number | null;
  orderIdx: number;
  createdAt: string;
};

export type DimensionAttributeWithMeta = DimensionAttribute & {
  refDimensionCode: string | null;
  refDimensionName: string | null;
};

type AttrRow = {
  id: number;
  dimension_id: number;
  code: string;
  name: string;
  type: AttributeType;
  ref_dimension_id: number | null;
  order_idx: number;
  created_at: string;
};

function mapAttrRow(r: AttrRow): DimensionAttribute {
  return {
    id: r.id,
    dimensionId: r.dimension_id,
    code: r.code,
    name: r.name,
    type: r.type,
    refDimensionId: r.ref_dimension_id,
    orderIdx: r.order_idx,
    createdAt: r.created_at,
  };
}

export function listDimensionAttributes(dimensionId: number): DimensionAttribute[] {
  return (
    sqlite
      .prepare("SELECT * FROM dimension_attributes WHERE dimension_id = ? ORDER BY order_idx, id")
      .all(dimensionId) as AttrRow[]
  ).map(mapAttrRow);
}

export function getDimensionAttribute(id: number): DimensionAttribute | null {
  const row = sqlite.prepare("SELECT * FROM dimension_attributes WHERE id = ?").get(id) as
    | AttrRow
    | undefined;
  return row ? mapAttrRow(row) : null;
}

// Attribute listesini, member_ref tipindekiler icin referans boyutun
// kod/adiyla zenginlestirir (UI'nin "hangi boyuta isaret ediyor" bilgisini
// ekstra bir istek yapmadan gosterebilmesi icin).
export function listDimensionAttributesWithMeta(dimensionId: number): DimensionAttributeWithMeta[] {
  const attrs = listDimensionAttributes(dimensionId);
  const refIds = [...new Set(attrs.filter((a) => a.refDimensionId != null).map((a) => a.refDimensionId as number))];
  const meta = new Map<number, { code: string; name: string }>();
  if (refIds.length > 0) {
    const ph = refIds.map(() => "?").join(",");
    const rows = sqlite.prepare(`SELECT id, code, name FROM dimensions WHERE id IN (${ph})`).all(...refIds) as Array<{
      id: number;
      code: string;
      name: string;
    }>;
    for (const r of rows) meta.set(r.id, { code: r.code, name: r.name });
  }
  return attrs.map((a) => ({
    ...a,
    refDimensionCode: a.refDimensionId != null ? meta.get(a.refDimensionId)?.code ?? null : null,
    refDimensionName: a.refDimensionId != null ? meta.get(a.refDimensionId)?.name ?? null : null,
  }));
}

// member_ref tipindeki attribute'lar icin, UI'de dropdown doldurmaya yarayan
// referans boyut(lar)in TUM uyelerini (kod+ad) tek sorguda ceker (N+1 onlenir).
export function getRefMemberOptions(
  attributes: DimensionAttribute[]
): Record<number, Array<{ code: string; name: string }>> {
  const refIds = [
    ...new Set(
      attributes
        .filter((a) => a.type === "member_ref" && a.refDimensionId != null)
        .map((a) => a.refDimensionId as number)
    ),
  ];
  const out: Record<number, Array<{ code: string; name: string }>> = {};
  if (refIds.length === 0) return out;
  const ph = refIds.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT dimension_id AS dimensionId, code, name FROM dimension_members
       WHERE dimension_id IN (${ph}) ORDER BY order_idx, id`
    )
    .all(...refIds) as Array<{ dimensionId: number; code: string; name: string }>;
  for (const r of rows) {
    const arr = out[r.dimensionId] ?? (out[r.dimensionId] = []);
    arr.push({ code: r.code, name: r.name });
  }
  return out;
}

export function createDimensionAttribute(input: {
  dimensionId: number;
  code: string;
  name: string;
  type: AttributeType;
  refDimensionId?: number | null;
  orderIdx?: number;
}): DimensionAttribute {
  const now = new Date().toISOString();
  const id = Number(
    sqlite
      .prepare(
        `INSERT INTO dimension_attributes
           (dimension_id, code, name, type, ref_dimension_id, order_idx, created_at)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        input.dimensionId,
        input.code,
        input.name,
        input.type,
        input.type === "member_ref" ? input.refDimensionId ?? null : null,
        input.orderIdx ?? 0,
        now
      ).lastInsertRowid
  );
  return getDimensionAttribute(id)!;
}

// type/refDimensionId KASITLI OLARAK degistirilemiyor — bkz. yukaridaki
// dimensionAttributes tablo yorumu (lib/db/schema.ts).
export function updateDimensionAttribute(
  id: number,
  patch: Partial<{ name: string; orderIdx: number }>
): DimensionAttribute | null {
  sqlite
    .prepare(
      `UPDATE dimension_attributes SET
         name = COALESCE(?, name),
         order_idx = COALESCE(?, order_idx)
       WHERE id = ?`
    )
    .run(patch.name ?? null, patch.orderIdx ?? null, id);
  return getDimensionAttribute(id);
}

export function deleteDimensionAttribute(id: number) {
  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM dimension_member_attribute_values WHERE attribute_id = ?").run(id);
    sqlite.prepare("DELETE FROM dimension_attributes WHERE id = ?").run(id);
  });
  tx();
}

export type MemberAttributeValues = Record<string, string | null>;

// Bir boyutun TUM uyelerinin TUM attribute degerlerini tek sorguda ceker
// (bkz. lib/model.ts fetchMembersByDimension ile ayni N+1-onleme deseni).
export function getAttributeValuesForMembers(memberIds: number[]): Map<number, MemberAttributeValues> {
  const out = new Map<number, MemberAttributeValues>();
  if (memberIds.length === 0) return out;
  const ph = memberIds.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT v.member_id AS memberId, a.code AS attrCode, v.value AS value
       FROM dimension_member_attribute_values v
       JOIN dimension_attributes a ON a.id = v.attribute_id
       WHERE v.member_id IN (${ph})`
    )
    .all(...memberIds) as Array<{ memberId: number; attrCode: string; value: string | null }>;
  for (const r of rows) {
    const map = out.get(r.memberId) ?? {};
    map[r.attrCode] = r.value;
    out.set(r.memberId, map);
  }
  return out;
}

// value=null ise satir silinir (attribute "bos" durumuna doner) — ayri bir
// "deger yok" temsili tutulmaz.
export function setMemberAttributeValue(memberId: number, attributeId: number, value: string | null) {
  if (value === null) {
    sqlite
      .prepare("DELETE FROM dimension_member_attribute_values WHERE member_id = ? AND attribute_id = ?")
      .run(memberId, attributeId);
    return;
  }
  sqlite
    .prepare(
      `INSERT INTO dimension_member_attribute_values (member_id, attribute_id, value)
       VALUES (?,?,?)
       ON CONFLICT(member_id, attribute_id) DO UPDATE SET value = excluded.value`
    )
    .run(memberId, attributeId, value);
}

// Attribute tipine gore yazilmak istenen HAM (henuz kaydedilmemis) degeri
// dogrular. null donerse gecerlidir; aksi halde route'un dondurmesi gereken
// hata kodu doner (invalid_number/invalid_date/ref_member_not_found).
export function validateAttributeValue(attr: DimensionAttribute, value: string): string | null {
  switch (attr.type) {
    case "number":
      return value.trim() !== "" && Number.isFinite(Number(value)) ? null : "invalid_number";
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "invalid_date";
    case "member_ref": {
      if (attr.refDimensionId == null) return "invalid_attribute_config";
      const exists = sqlite
        .prepare("SELECT 1 FROM dimension_members WHERE dimension_id = ? AND code = ?")
        .get(attr.refDimensionId, value);
      return exists ? null : "ref_member_not_found";
    }
    case "text":
    default:
      return null;
  }
}
