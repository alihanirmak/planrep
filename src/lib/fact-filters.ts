import { withDescendants, type DimInfo } from "./model";
import { restrictCodes } from "./access";

// SQLite'in tek bir prepared statement'ta kabul ettigi parametre sayisi
// surume gore degisir (eski surumlerde 999, yeni surumlerde cok daha yuksek).
// Guvenli taraf icin boyut basina IN(...) listesini bu boyutun altinda tut;
// asarsa kesisimsiz chunk'lara bolup varyant sorgular uretilir.
export const SQL_IN_CHUNK_SIZE = 400;

export function chunkArray<T>(arr: T[], size = SQL_IN_CHUNK_SIZE): T[][] {
  if (arr.length <= size) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Pivot/query sonuc kumesinin (satir x sutun aggregate hucre sayisi) ust
// siniri. Hiyerarsik rollup client-side kuruldugu icin (bkz. lib/pivot.ts,
// lib/query.ts) kismi/sayfali sonuc dondurmek yanlis toplam uretir; bu yuzden
// bu sinir asilirsa sonuc kirpilmaz, acik bir hata dondurulur (kullanici
// filtre eklemeye yonlendirilir).
export const MAX_AGGREGATE_RESULT_ROWS = 20000;

export type WhereVariant = { sql: string; params: unknown[] };

/**
 * dims + filters + erisim kumesinden WHERE kosul varyantlari uretir.
 * Herhangi bir boyutun kod listesi SQL_IN_CHUNK_SIZE'i asarsa, o boyut icin
 * ayri (kesisimsiz) chunk'lara bolunur; tum boyutlarin chunk'larinin kartezyen
 * carpimi kadar varyant doner (buyuk cogunlukla tek varyant).
 *
 * Her varyant birbirinden bagimsiz calistirilmali, sonuclar cagiran tarafindan
 * birlestirilmelidir: COUNT -> toplam, DELETE -> toplam, duz SELECT -> concat,
 * SUM...GROUP BY -> anahtar bazli yeniden toplama (bkz. sumGroupedRows).
 */
export function buildFactWhereVariants(
  modelId: number,
  dims: DimInfo[],
  filters: Record<string, string[]>,
  access: Map<string, Set<string>>
): { variants: WhereVariant[]; empty: boolean } {
  let variants: Array<{ conds: string[]; params: unknown[] }> = [
    { conds: ["model_id = ?"], params: [modelId] },
  ];
  for (const d of dims) {
    const requested =
      filters[d.code] && filters[d.code].length > 0
        ? withDescendants(d.members, filters[d.code])
        : undefined;
    const codes = restrictCodes(requested, access.get(d.code));
    if (!codes) continue;
    if (codes.length === 0) return { variants: [], empty: true };

    const chunks = chunkArray(codes);
    const next: Array<{ conds: string[]; params: unknown[] }> = [];
    for (const v of variants) {
      for (const chunk of chunks) {
        next.push({
          conds: [...v.conds, `d${d.slot} IN (${chunk.map(() => "?").join(",")})`],
          params: [...v.params, ...chunk],
        });
      }
    }
    variants = next;
  }
  return {
    variants: variants.map((v) => ({ sql: v.conds.join(" AND "), params: v.params })),
    empty: false,
  };
}

// Birden fazla varyanttan gelen SUM...GROUP BY sonuc satirlarini keyFields'e
// gore anahtarlayip valueField'i toplayarak birlestirir.
export function sumGroupedRows(
  resultSets: Array<Array<Record<string, unknown>>>,
  keyFields: string[],
  valueField = "v"
): Array<Record<string, unknown>> {
  if (resultSets.length === 1) return resultSets[0];
  const map = new Map<string, Record<string, unknown>>();
  for (const rows of resultSets) {
    for (const row of rows) {
      const key = keyFields.map((f) => String(row[f])).join("\u0000");
      const existing = map.get(key);
      if (existing) {
        existing[valueField] = Number(existing[valueField]) + Number(row[valueField]);
      } else {
        map.set(key, { ...row });
      }
    }
  }
  return [...map.values()];
}
