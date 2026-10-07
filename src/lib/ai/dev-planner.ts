// Dogal dil mesajindan (veya basit yapilandirilmis komut satirlarindan) bir
// DevPlan uretir. Birincil yol: axet-code CLI (kurumsal LLM) — mevcut
// model/boyut envanterini + DevAction JSON semasini prompt'a koyar, donen
// JSON'u devPlanSchema ile dogrular (gecersiz/eksik alanlar REDDEDILIR,
// asla "iyi niyetle tahmin" edilmez). Yedek yol: axet yoksa/basarisizsa,
// nl2report.ts'teki ruleFallback ile AYNI pragmatizmle, SADECE basit tek
// satirlik komutlari ("MODEL kod "Ad" DIMS=..." gibi) ayristiran kucuk bir
// yapisal format — tam NLU degil, kullanicinin yazabilecegi acik bir sozdizimi.
import { getModels, type ModelInfo } from "../model";
import { getServerT } from "../i18n-server";
import { formatT } from "../i18n";
import { sqlite } from "../db";
import { runAxet, axetAvailable } from "./axet-cli";
import { devPlanSchema, type DevPlan } from "./dev-actions";

export function buildDevPrompt(message: string, models: ModelInfo[], reportNames: string[]): string {
  const meta = models
    .map((m) => {
      const dims = m.dims
        .map((d) => {
          const sample = d.members.slice(0, 20).map((mm) => mm.code).join(",");
          return `${d.code} (${d.name}, tip=${d.type}${sample ? `, üyeler=[${sample}]` : ""})`;
        })
        .join("; ");
      const measures = (m.measures ?? []).map((me) => me.code).join(",");
      return `- ${m.code} (${m.name}): boyutlar [${dims}]${measures ? ` ölçüler=[${measures}]` : ""}`;
    })
    .join("\n");

  return `Sen bir planlama/raporlama uygulamasında (PlanRep) model/boyut/ölçü/rapor OLUŞTURAN, veri analiz eden ve tahmin üreten bir asistansın.
Kullanıcının isteğini aşağıdaki SABİT eylem şemasına çevir. SADECE geçerli JSON döndür, başka hiçbir açıklama yazma.

Mevcut modeller:
${meta || "(henüz model yok)"}

Mevcut raporlar: ${reportNames.length > 0 ? reportNames.join(", ") : "(henüz rapor yok)"}

Şema:
{
  "summary": "insan için kısa açıklama",
  "actions": [
    {"type":"create_dimension","code":"KOD","name":"Ad","dimType":"standard|time|version","members":[{"code":"KOD","name":"Ad","parentCode":null}]},
    {"type":"create_model","code":"KOD","name":"Ad","description":null,"dimensionCodes":["KOD1","KOD2"]},
    {"type":"create_measure","modelCode":"KOD","code":"KOD","name":"Ad"},
    {"type":"create_report","modelCode":"KOD","name":"Ad","rows":["KOD"],"cols":["KOD"],"filters":{},"shared":false},
    {"type":"upload_facts","modelCode":"KOD","rows":[{"coords":{"BOYUT_KODU":"UYE_KODU"},"value":123}]},
    {"type":"analyze_anomalies","modelCode":"KOD","rowDim":"KOD","colDim":"KOD","filters":{},"attachToReport":"RAPOR_ADI veya yok","attachCellComments":false},
    {"type":"forecast_measure","modelCode":"KOD","timeDim":"ZAMAN_BOYUT_KODU","sourceVersionCode":"KAYNAK_VERSIYON","targetVersionCode":"HEDEF_VERSIYON","targetVersionName":"Ad","periods":3,"filters":{"DIGER_BOYUT":["TEK_DEGER"]}},
    {"type":"update_report_add_comparison","reportName":"RAPOR_ADI","versionCodes":["KOD1","KOD2"]},
    {"type":"create_comment","reportName":"RAPOR_ADI","target":"report|cell","cellRowCode":"KOD","cellColCode":"KOD","text":"yorum metni"}
  ]
}

Kurallar:
- Kodlar SADECE harf/rakam/alt çizgi içerir, büyük harf kullan.
- Var olan bir model/boyuda referans veriyorsan yukarıdaki listedeki KOD'u kullan, var olmayan bir şey oluşturuyorsan create_dimension/create_model ile ÖNCE tanımla.
- forecast_measure SADECE TEK bir koordinat kesiti için çalışır: timeDim/VERSION dışındaki HER boyut için filters'ta TAM OLARAK bir değer belirt.
- analyze_anomalies/forecast_measure/update_report_add_comparison/create_comment SADECE var olan gerçek verfi/raporlar üzerinde çalışır — yeni oluşturulan bir model/rapora aynı plan içinde hemen bu eylemleri uygulama, önce o adımın gerçekten commit edilmesini (ayrı bir sohbet turunda) bekle.
- business_rules, kullanıcı/rol, connector gibi eylemler YOK — sadece yukarıdaki 9 tür mevcut.
- En fazla 30 eylem.

İstek: ${message}`;
}

export type DevPlanResult = { plan: DevPlan | null; source: "axet" | "fallback"; note: string | null };

export async function planFromMessage(message: string, tenantId: number): Promise<DevPlanResult> {
  const models = getModels(tenantId);
  const reportRows = sqlite
    .prepare("SELECT DISTINCT name FROM reports WHERE tenant_id = ? ORDER BY name LIMIT 50")
    .all(tenantId) as Array<{ name: string }>;
  const { t } = await getServerT();
  let note: string | null = null;

  if (axetAvailable()) {
    try {
      const output = await runAxet(
        buildDevPrompt(message, models, reportRows.map((r) => r.name)),
        t,
        "stdin'deki görevi uygula ve SADECE istenen JSON'u döndür"
      );
      const json = extractJsonLoose(output);
      if (json) {
        const parsed = devPlanSchema.safeParse(json);
        if (parsed.success) {
          return { plan: parsed.data, source: "axet", note: null };
        }
        note = `axet yanıtı şemaya uymuyor: ${parsed.error.issues[0]?.message ?? "bilinmeyen hata"}`;
      } else {
        note = t("err.axetNoJson");
      }
    } catch (e) {
      note = formatT(t("err.axetFailed"), {
        detail: e instanceof Error ? e.message.slice(0, 200) : t("err.generic"),
      });
    }
  } else {
    note = t("err.axetNotFound");
  }

  const fb = parseStructuredCommands(message);
  if (fb) return { plan: fb, source: "fallback", note };
  return {
    plan: null,
    source: "fallback",
    note: `${note ?? ""} axet mevcut değilken sadece basit yapılandırılmış komutlar desteklenir (örn: MODEL SALES "Satış" DIMS=REGION,TIME).`.trim(),
  };
}

function extractJsonLoose(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
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

// Basit yapilandirilmis komut formati (axet yokken yedek):
//   MODEL <KOD> "<Ad>" DIMS=<KOD1,KOD2>
//   BOYUT <KOD> "<Ad>" TIP=<standard|time|version> UYELER=<KOD1:Ad1;KOD2:Ad2>
//   OLCU <MODEL_KODU> <KOD> "<Ad>"
//   RAPOR <MODEL_KODU> "<Ad>" SATIR=<KOD1,KOD2> SUTUN=<KOD1>
// Her satir bir eylemdir; taninmayan/bozuk bir satir varsa TUM mesaj
// reddedilir (sessizce yanlis yorumlamaktan kacinmak icin).
export function parseStructuredCommands(message: string): DevPlan | null {
  const lines = message
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  const actions: DevPlan["actions"] = [];
  for (const line of lines) {
    const quoted = line.match(/"([^"]*)"/);
    const name = quoted?.[1] ?? "";
    const rest = line.replace(/"[^"]*"/, "").trim();
    const parts = rest.split(/\s+/);
    const keyword = (parts[0] ?? "").toUpperCase();

    if (keyword === "MODEL") {
      const code = (parts[1] ?? "").toUpperCase();
      const dimsMatch = rest.match(/DIMS=([A-Za-z0-9_,]+)/i);
      if (!code || !name || !dimsMatch) return null;
      actions.push({
        type: "create_model",
        code,
        name,
        description: null,
        dimensionCodes: dimsMatch[1].split(",").map((c) => c.toUpperCase()),
      });
    } else if (keyword === "BOYUT") {
      const code = (parts[1] ?? "").toUpperCase();
      if (!code || !name) return null;
      const tipMatch = rest.match(/TIP=(standard|time|version)/i);
      const uyelerMatch = rest.match(/UYELER=([^\s]+)/i);
      const members = uyelerMatch
        ? uyelerMatch[1]
            .split(";")
            .map((pair) => {
              const [mCode, mName] = pair.split(":");
              return mCode && mName ? { code: mCode.toUpperCase(), name: mName } : null;
            })
            .filter((m): m is { code: string; name: string } => m != null)
        : [];
      actions.push({
        type: "create_dimension",
        code,
        name,
        dimType: (tipMatch?.[1] as "standard" | "time" | "version") ?? "standard",
        members,
      });
    } else if (keyword === "OLCU") {
      const modelCode = (parts[1] ?? "").toUpperCase();
      const code = (parts[2] ?? "").toUpperCase();
      if (!modelCode || !code || !name) return null;
      actions.push({ type: "create_measure", modelCode, code, name });
    } else if (keyword === "RAPOR") {
      const modelCode = (parts[1] ?? "").toUpperCase();
      const satirMatch = rest.match(/SATIR=([A-Za-z0-9_,]+)/i);
      const sutunMatch = rest.match(/SUTUN=([A-Za-z0-9_,]+)/i);
      if (!modelCode || !name || !satirMatch || !sutunMatch) return null;
      actions.push({
        type: "create_report",
        modelCode,
        name,
        rows: satirMatch[1].split(",").map((c) => c.toUpperCase()),
        cols: sutunMatch[1].split(",").map((c) => c.toUpperCase()),
      });
    } else {
      return null;
    }
  }
  if (actions.length === 0) return null;
  const parsed = devPlanSchema.safeParse({ actions });
  return parsed.success ? parsed.data : null;
}
