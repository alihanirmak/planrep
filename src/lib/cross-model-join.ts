import { sqlite } from "./db";
import { getModelDims, withDescendants } from "./model";
import { allowedSets } from "./access";
import { buildFactWhereVariants, sumGroupedRows } from "./fact-filters";
import { listEffectiveMeasures, valueColumnForSlot } from "./model-measures";
import { getAttributeValuesForMembers } from "./dimension-attributes";
import type { JoinDef } from "./report-types";

// Coklu-model join hesaplamasi (bkz. report-types.ts JoinDef yorumu).
// Fiziksel SQL JOIN YAPILMAZ — birincil modelin rows[0] boyutundaki HER
// uye (herhangi bir derinlikte, sadece kokler degil — pivot.ts'teki
// PivotViewRow.path[0] her zaman o uyenin KENDI kodu oldugundan, UI'da
// herhangi bir derinlikteki satir icin dogru deger gorunsun diye) icin,
// kendi alt agacindaki (withDescendants) uyelerin ikincil modeldeki
// karsiligi (ayni kod ya da bir attribute degeri) bulunur; tum bu
// karsilik kodlari icin TEK bir aggregate sorgusu calisir, sonra her
// birincil uyenin kendi karsilik kodlari toplanarak nihai deger elde
// edilir.
export function computeJoinValues(
  primaryModelId: number,
  primaryDimCode: string,
  join: JoinDef,
  userId?: number
): Record<string, number> {
  const primaryDims = getModelDims(primaryModelId);
  const primaryDimFound = primaryDims.find((d) => d.code === primaryDimCode);
  if (!primaryDimFound || primaryDimFound.members.length === 0) return {};
  const primaryDim = primaryDimFound;

  let attrValuesByMemberId: Map<number, Record<string, string | null>> | null = null;
  if (join.via === "attribute" && join.attributeCode) {
    attrValuesByMemberId = getAttributeValuesForMembers(primaryDim.members.map((m) => m.id));
  }
  const byCode = new Map(primaryDim.members.map((m) => [m.code, m]));

  function mappedCodesFor(code: string): string[] {
    const descCodes = withDescendants(primaryDim.members, [code]);
    const out: string[] = [];
    for (const dc of descCodes) {
      if (join.via === "dimension") {
        out.push(dc);
      } else if (attrValuesByMemberId && join.attributeCode) {
        const member = byCode.get(dc);
        const val = member ? attrValuesByMemberId.get(member.id)?.[join.attributeCode] : null;
        if (val) out.push(val);
      }
    }
    return out;
  }

  const mappedByMember = new Map<string, string[]>();
  for (const m of primaryDim.members) mappedByMember.set(m.code, mappedCodesFor(m.code));

  const allMappedCodes = [...new Set([...mappedByMember.values()].flat())];
  if (allMappedCodes.length === 0) return {};

  const secondaryDims = getModelDims(join.modelId);
  const targetD = secondaryDims.find((d) => d.code === join.targetDim);
  if (!targetD) return {};

  const measures = listEffectiveMeasures(join.modelId);
  const measure =
    (join.measureCode ? measures.find((m) => m.code === join.measureCode) : undefined) ??
    measures.find((m) => m.slot === 1) ??
    measures[0];
  const valueCol = valueColumnForSlot(measure.slot);

  const access = userId != null ? allowedSets(userId, secondaryDims) : new Map<string, Set<string>>();
  const filters: Record<string, string[]> = { [join.targetDim]: allMappedCodes };
  const { variants, empty } = buildFactWhereVariants(join.modelId, secondaryDims, filters, access);
  if (empty) return {};

  const partials = variants.map(
    (v) =>
      sqlite
        .prepare(`SELECT d${targetD.slot} AS code, SUM(${valueCol}) AS v FROM facts WHERE ${v.sql} GROUP BY code`)
        .all(...v.params) as Array<Record<string, unknown>>
  );
  const raw = sumGroupedRows(partials, ["code"]) as Array<{ code: string; v: number }>;
  const totalsByCode = new Map(raw.map((r) => [r.code, r.v]));

  const out: Record<string, number> = {};
  for (const [memberCode, mapped] of mappedByMember) {
    if (mapped.length === 0) continue;
    let sum = 0;
    for (const code of mapped) sum += totalsByCode.get(code) ?? 0;
    out[memberCode] = sum;
  }
  return out;
}
