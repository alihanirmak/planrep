// app/api/v1/odata/* icin kucuk, bagimliliksiz yardimcilar. Tam OData v4
// protokolu (EDMX $metadata XML, $expand, karmasik $filter grameri, batch
// istekleri vb.) BURADA KASITLI OLARAK implemente edilmedi — gerekce
// (bkz. docs/ROADMAP.md Sprint 3.3 madde 1 tamamlama notu): Power BI/
// Tableau'nun "Web"/"REST" veri kaynagi baglayicilari duz JSON uzerinden
// de calisir, bu yuzden tam OData uyumlulugu bu hedef icin sart degil.
// Pragmatik bir alt kume: OData'nin JSON yanit zarfi ($top/$skip/$filter
// query parametreleri + "value" dizisi + "@odata.count") taklit edilir.
// Ayni "DSL'i tam standarda uydurmak yerine ihtiyaca gore uyarlama"
// karari lib/formula.ts SUMIF implementasyonunda da verilmisti.

export type ODataFilterResult =
  | { ok: true; filters: Record<string, string[]> }
  | { ok: false; error: string };

// Desteklenen sozdizimi: "<alan> eq '<deger1>,<deger2>'" kosullari " and "
// ile birlestirilir (buyuk/kucuk harf duyarsiz). Virgulle ayrilmis birden
// fazla deger standart OData'da yok — IN(...) semantigine pragmatik bir
// genisletme (dokumante edilmistir).
export function parseODataFilter(raw: string | null | undefined): ODataFilterResult {
  if (!raw || !raw.trim()) return { ok: true, filters: {} };

  const filters: Record<string, string[]> = {};
  const clauses = raw.split(/\s+and\s+/i);
  const clauseRe = /^\s*([A-Za-z0-9_]+)\s+eq\s+'([^']*)'\s*$/i;
  for (const clause of clauses) {
    const m = clauseRe.exec(clause);
    if (!m) {
      return { ok: false, error: `Desteklenmeyen $filter ifadesi: "${clause.trim()}" (beklenen: alan eq 'değer')` };
    }
    const [, field, value] = m;
    const values = value.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length === 0) {
      return { ok: false, error: `Boş değer: "${clause.trim()}"` };
    }
    filters[field.toUpperCase()] = values;
  }
  return { ok: true, filters };
}

export function buildODataEnvelope<T>(contextUrl: string, value: T[], count?: number) {
  return {
    "@odata.context": contextUrl,
    ...(count != null ? { "@odata.count": count } : {}),
    value,
  };
}

// $top/$skip parse + sinirlama. $top verilmezse DEFAULT_TOP kullanilir,
// MAX_TOP'u asamaz (tum facts tablosunun tek seferde export edilmesini
// onlemek icin — buyuk veri setleri $skip ile sayfalanmalidir).
export const DEFAULT_TOP = 1000;
export const MAX_TOP = 5000;

export function parseTopSkip(searchParams: URLSearchParams): { top: number; skip: number } {
  const topRaw = Number(searchParams.get("$top"));
  const skipRaw = Number(searchParams.get("$skip"));
  const top = Number.isFinite(topRaw) && topRaw > 0 ? Math.min(Math.floor(topRaw), MAX_TOP) : DEFAULT_TOP;
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;
  return { top, skip };
}
