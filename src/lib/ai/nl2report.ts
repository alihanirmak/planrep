// Dogal dil -> rapor tanimi. Birincil yol: axet-code CLI (kurumsal LLM).
// Yedek yol: kural tabanli cozumleyici (axet yoksa/basarisizsa da calisir).
import type { ModelInfo } from "@/lib/model";
import { DEFAULT_OPTIONS, type ReportDefV2 } from "@/lib/report-types";

export function buildPrompt(question: string, models: ModelInfo[]): string {
  const meta = models
    .map((m) => {
      const dims = m.dims
        .map((d) => {
          const members = d.members
            .slice(0, 40)
            .map((mm) => `${mm.code}=${mm.name}`)
            .join(", ");
          return `  - ${d.code} (${d.name}): ${members}`;
        })
        .join("\n");
      return `Model ${m.code} (${m.name}):\n${dims}`;
    })
    .join("\n\n");

  return `Sen bir planlama/raporlama uygulamasının sorgu çevirmenisin. Kullanıcının Türkçe sorusunu aşağıdaki JSON şemasına çevir.

Mevcut modeller ve boyutları (KOD=Ad):
${meta}

Kurallar:
- SADECE geçerli JSON döndür, başka hiçbir açıklama yazma.
- rows: satırlarda gösterilecek boyut kodları (1-3 adet). cols: sütun boyutları (1-2 adet). rows ve cols kesişmez.
- filters: {"BOYUT_KODU": ["UYE_KODU", ...]} — sadece soruda geçen kısıtlar.
- topN: "en yüksek 5" gibi bir ifade varsa sayı, yoksa null.
- Üye kodlarını yukarıdaki listeden birebir kullan.

Şema: {"modelCode": "...", "rows": ["..."], "cols": ["..."], "filters": {}, "topN": null}

Soru: ${question}`;
}

export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  // Dengeli parantezle en genis blogu bul
  for (let end = text.length; end > start; end--) {
    const candidate = text.slice(start, end);
    if (!candidate.trimEnd().endsWith("}")) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      /* devam */
    }
  }
  return null;
}

export function toDef(
  raw: unknown,
  models: ModelInfo[]
): ReportDefV2 | { error: string } {
  const o = raw as {
    modelCode?: string;
    rows?: string[];
    cols?: string[];
    filters?: Record<string, string[]>;
    topN?: number | null;
  };
  const model = models.find((m) => m.code === o?.modelCode) ?? models[0];
  if (!model) return { error: "model_yok" };
  const dimCodes = new Set(model.dims.map((d) => d.code));
  const rows = (o.rows ?? []).filter((c) => dimCodes.has(c)).slice(0, 3);
  const cols = (o.cols ?? []).filter((c) => dimCodes.has(c) && !rows.includes(c)).slice(0, 2);
  if (rows.length === 0 || cols.length === 0) return { error: "boyutlar_cozulemedi" };

  const filters: Record<string, string[]> = {};
  for (const [dim, codes] of Object.entries(o.filters ?? {})) {
    const d = model.dims.find((x) => x.code === dim);
    if (!d || !Array.isArray(codes)) continue;
    const valid = codes.filter((c) => d.members.some((m) => m.code === c));
    if (valid.length > 0) filters[dim] = valid;
  }

  return {
    version: 2,
    modelId: model.id,
    rows,
    cols,
    filters,
    calcColumns: [],
    calcRows: [],
    condRules: [],
    options: {
      ...DEFAULT_OPTIONS,
      topN: typeof o.topN === "number" && o.topN > 0 ? o.topN : null,
      sort: typeof o.topN === "number" && o.topN > 0 ? { key: "__total", dir: "desc" } : null,
    },
  };
}

// Kural tabanli yedek: axet erisilemedibinde temel sorulari cozer
export function ruleFallback(question: string, models: ModelInfo[]): ReportDefV2 | { error: string } {
  const q = question.toLocaleLowerCase("tr");
  const model =
    models.find((m) => q.includes(m.name.toLocaleLowerCase("tr"))) ?? models[0];
  if (!model) return { error: "model_yok" };

  const filters: Record<string, string[]> = {};

  // Uye adi/kodu gecen boyutlar filtreye girer
  for (const d of model.dims) {
    const hits = d.members.filter(
      (m) =>
        q.includes(m.name.toLocaleLowerCase("tr")) ||
        (m.code.length > 3 && q.includes(m.code.toLocaleLowerCase("tr")))
    );
    // Cok genel eslesmelerden kacin: en fazla 3 uye
    if (hits.length > 0 && hits.length <= 3) {
      filters[d.code] = hits.map((m) => m.code);
    }
  }

  // Versiyon anahtar kelimeleri
  const versionDim = model.dims.find((d) => d.code === "VERSION");
  if (versionDim && !filters.VERSION) {
    if (q.includes("bütçe") || q.includes("butce")) filters.VERSION = ["BUDGET"];
    else if (q.includes("gerçekleş") || q.includes("gerceklesen") || q.includes("fiili"))
      filters.VERSION = ["ACTUAL"];
    else if (q.includes("tahmin") || q.includes("forecast")) filters.VERSION = ["FORECAST"];
  }

  // Top-N
  const topMatch = q.match(/(?:en yüksek|en çok|en fazla|ilk|top)\s*(\d+)/);
  const topN = topMatch ? Number(topMatch[1]) : null;

  // Satir boyutu: "X bazında/e göre/kırılımında" kaliplari
  let rowDim = null as string | null;
  for (const d of model.dims) {
    const dn = d.name.toLocaleLowerCase("tr");
    if (
      q.includes(`${dn} bazında`) ||
      q.includes(`${dn} bazinda`) ||
      q.includes(`${dn} kırılım`) ||
      q.includes(`${dn}e göre`) ||
      q.includes(`${dn}a göre`) ||
      q.includes(`${dn}ye göre`) ||
      q.includes(`${dn}ya göre`)
    ) {
      rowDim = d.code;
      break;
    }
  }
  if (!rowDim) {
    // Soruda adi gecen boyut satira alinir (en uzun ad once, zaman haric)
    const byLen = [...model.dims]
      .filter((d) => d.code !== "TIME")
      .sort((a, b) => b.name.length - a.name.length);
    const mentioned = byLen.find((d) => q.includes(d.name.toLocaleLowerCase("tr")));
    if (mentioned) rowDim = mentioned.code;
  }
  if (!rowDim) {
    const acc = model.dims.find((d) => d.code === "ACCOUNT");
    rowDim = acc?.code ?? model.dims[model.dims.length - 1].code;
  }

  const timeDim = model.dims.find((d) => d.code === "TIME");
  const colDim =
    timeDim && timeDim.code !== rowDim
      ? timeDim.code
      : model.dims.find((d) => d.code !== rowDim)!.code;

  return {
    version: 2,
    modelId: model.id,
    rows: [rowDim],
    cols: [colDim],
    filters,
    calcColumns: [],
    calcRows: [],
    condRules: [],
    options: {
      ...DEFAULT_OPTIONS,
      topN,
      sort: topN ? { key: "__total", dir: "desc" } : null,
    },
  };
}
