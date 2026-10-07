import { z } from "zod";
import { sqlite } from "../db";
import { MAX_MODEL_DIMENSIONS, getModelDims } from "../model";
import { MAX_MODEL_MEASURES, listEffectiveMeasures, createModelMeasure } from "../model-measures";
import { upsertFacts } from "../facts-write";
import { logAudit } from "../audit";
import type { Role } from "../session";

// ============================================================================
// AI ile Gelistirme (chat/Excel ile model/boyut/olcu/rapor/veri olusturma) —
// GUVENLIK CEKIRDEGI. Bu dosya ASLA genisletilip "serbest SQL/kod calistir"
// gibi bir eylem turu EKLENMEMELI — tasarimin tum guvenligi, AI'nin SADECE
// burada tanimli sabit, parametreli eylem turlerinden (DevAction) birini
// secebilmesine dayanir. Her eylem, karsilik geldigi REST route'un (orn.
// /api/models POST) AYNI dogrulama/limit/rol kontrolunu uygular — AI, bir
// insanin UI uzerinden yapabileceginden FAZLASINI YAPAMAZ. is kurallari
// (business_rules), kullanici/rol yonetimi, connector/scheduled-sync, model/
// boyut SILME gibi islemler KASITLI OLARAK buraya eklenmedi (bkz.
// docs/ROADMAP.md "AI ile gelistirme" maddesi).
// ============================================================================

const codeSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9_]+$/, "Kod sadece harf/rakam/alt çizgi içerebilir");

const memberSchema = z.object({
  code: codeSchema,
  name: z.string().min(1).max(120),
  parentCode: z.string().nullish(),
});

export const devActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_dimension"),
    code: codeSchema,
    name: z.string().min(1).max(80),
    dimType: z.enum(["standard", "time", "version"]).default("standard"),
    members: z.array(memberSchema).max(2000).default([]),
  }),
  z.object({
    type: z.literal("create_model"),
    code: codeSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullish(),
    dimensionCodes: z.array(z.string().min(1)).min(1).max(MAX_MODEL_DIMENSIONS),
  }),
  z.object({
    type: z.literal("create_measure"),
    modelCode: z.string().min(1),
    code: codeSchema,
    name: z.string().min(1).max(120),
  }),
  z.object({
    type: z.literal("create_report"),
    modelCode: z.string().min(1),
    name: z.string().min(1).max(120),
    rows: z.array(z.string().min(1)).min(1).max(3),
    cols: z.array(z.string().min(1)).min(1).max(2),
    filters: z.record(z.string(), z.array(z.string())).optional(),
    shared: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("upload_facts"),
    modelCode: z.string().min(1),
    rows: z
      .array(
        z.object({
          coords: z.record(z.string(), z.string()),
          value: z.number(),
          values: z.record(z.string(), z.number()).optional(),
        })
      )
      .min(1)
      .max(5000),
  }),
]);

export type DevAction = z.infer<typeof devActionSchema>;
export type UploadFactsRow = Extract<DevAction, { type: "upload_facts" }>["rows"][number];

// Bir plandaki toplam eylem sayisi sinirli (hem kotuye kullanim hem de
// "tek seferde cok fazla sey degisti" riskini azaltmak icin) — gercekten
// cok eylemli bir ihtiyac varsa kullanici birden fazla plan calistirir.
export const MAX_PLAN_ACTIONS = 30;

export const devPlanSchema = z.object({
  summary: z.string().max(500).optional(),
  actions: z.array(devActionSchema).min(1).max(MAX_PLAN_ACTIONS),
});
export type DevPlan = z.infer<typeof devPlanSchema>;

export type ActionResult = {
  index: number;
  type: DevAction["type"];
  status: "created" | "exists" | "skipped" | "error";
  message: string;
  entityId?: number;
  entityCode?: string;
};

export type PlanContext = { tenantId: number; userId: number; role: Role };

function viewerBlocked(ctx: PlanContext): boolean {
  return ctx.role === "viewer";
}

type DimRef = { id: number; code: string; memberCodes: Set<string> };
type ModelRef = { id: number; code: string; dimCodes: string[] };

// dryRun=true: HICBIR SQL YAZMA ISLEMI yapilmaz (sadece SELECT) — plan
// onizlemesi icindir. dryRun=false: gercek DB yazimi (apply). Ayni fonksiyon
// her iki modda da KULLANILIR ki onizleme ile gercek uygulama arasinda
// davranis farki (ve dolayisiyla "onizlemede guvenli gorunup uygulamada
// farkli davranma" riski) olmasin.
export function runPlan(plan: DevPlan, ctx: PlanContext, dryRun: boolean): ActionResult[] {
  const results: ActionResult[] = [];
  // Bu calistirma sirasinda (henuz commit edilmemis olsa da dryRun'da
  // simule edilen) olusturulan/bilinen boyut ve modelleri izler — ayni
  // plan icinde sonraki bir eylem (orn. create_model), bu calistirmada
  // henuz DB'ye yazilmamis ama onceki bir adimda "olusturulacak" damgali
  // bir boyuta referans verebilsin diye.
  const knownDims = new Map<string, DimRef>();
  const knownModels = new Map<string, ModelRef>();
  let fakeId = -1;

  function findDim(code: string): DimRef | null {
    const known = knownDims.get(code);
    if (known) return known;
    const row = sqlite
      .prepare("SELECT id FROM dimensions WHERE code = ? AND tenant_id = ?")
      .get(code, ctx.tenantId) as { id: number } | undefined;
    if (!row) return null;
    const members = sqlite
      .prepare("SELECT code FROM dimension_members WHERE dimension_id = ?")
      .all(row.id) as Array<{ code: string }>;
    const ref: DimRef = { id: row.id, code, memberCodes: new Set(members.map((m) => m.code)) };
    knownDims.set(code, ref);
    return ref;
  }

  function findModel(code: string): ModelRef | null {
    const known = knownModels.get(code);
    if (known) return known;
    const row = sqlite
      .prepare("SELECT id FROM models WHERE code = ? AND tenant_id = ?")
      .get(code, ctx.tenantId) as { id: number } | undefined;
    if (!row) return null;
    const dims = sqlite
      .prepare(
        `SELECT d.code FROM model_dimensions md JOIN dimensions d ON d.id = md.dimension_id
         WHERE md.model_id = ? ORDER BY md.slot`
      )
      .all(row.id) as Array<{ code: string }>;
    const ref: ModelRef = { id: row.id, code, dimCodes: dims.map((d) => d.code) };
    knownModels.set(code, ref);
    return ref;
  }

  for (let index = 0; index < plan.actions.length; index++) {
    const action = plan.actions[index];
    try {
      results.push(executeOne(action, index));
    } catch (e) {
      results.push({
        index,
        type: action.type,
        status: "error",
        message: e instanceof Error ? e.message : "Beklenmeyen hata",
      });
    }
  }
  return results;

  function executeOne(action: DevAction, index: number): ActionResult {
    switch (action.type) {
      case "create_dimension":
        return doCreateDimension(action, index);
      case "create_model":
        return doCreateModel(action, index);
      case "create_measure":
        return doCreateMeasure(action, index);
      case "create_report":
        return doCreateReport(action, index);
      case "upload_facts":
        return doUploadFacts(action, index);
    }
  }

  function doCreateDimension(
    action: Extract<DevAction, { type: "create_dimension" }>,
    index: number
  ): ActionResult {
    if (viewerBlocked(ctx)) {
      return { index, type: action.type, status: "error", message: "Bu rol boyut oluşturamaz (viewer)" };
    }
    const existing = findDim(action.code);
    if (existing) {
      return {
        index,
        type: action.type,
        status: "exists",
        message: `"${action.code}" boyutu zaten var — yeniden kullanılacak`,
        entityId: existing.id,
        entityCode: action.code,
      };
    }
    let id: number;
    const memberCodes = new Set<string>();
    if (dryRun) {
      id = fakeId--;
    } else {
      id = Number(
        sqlite
          .prepare(
            "INSERT INTO dimensions (tenant_id, code, name, type, visibility) VALUES (?,?,?,?,'public')"
          )
          .run(ctx.tenantId, action.code, action.name, action.dimType).lastInsertRowid
      );
      logAudit(ctx.userId, "ai_dev.create_dimension", "dimension", id, { code: action.code, name: action.name });
    }
    const byCode = new Map<string, number>();
    for (const m of action.members) {
      const parentId = m.parentCode ? byCode.get(m.parentCode) ?? null : null;
      if (!dryRun) {
        const memberId = Number(
          sqlite
            .prepare(
              "INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)"
            )
            .run(id, m.code, m.name, parentId, byCode.size).lastInsertRowid
        );
        byCode.set(m.code, memberId);
      } else {
        byCode.set(m.code, fakeId--);
      }
      memberCodes.add(m.code);
    }
    knownDims.set(action.code, { id, code: action.code, memberCodes });
    return {
      index,
      type: action.type,
      status: "created",
      message: `Yeni boyut: ${action.code} (${action.name}) — ${action.members.length} üye`,
      entityId: id,
      entityCode: action.code,
    };
  }

  function doCreateModel(action: Extract<DevAction, { type: "create_model" }>, index: number): ActionResult {
    if (viewerBlocked(ctx)) {
      return { index, type: action.type, status: "error", message: "Bu rol model oluşturamaz (viewer)" };
    }
    const existingModel = findModel(action.code);
    if (existingModel) {
      return {
        index,
        type: action.type,
        status: "exists",
        message: `"${action.code}" modeli zaten var — yeniden kullanılacak`,
        entityId: existingModel.id,
        entityCode: action.code,
      };
    }
    if (new Set(action.dimensionCodes).size !== action.dimensionCodes.length) {
      return { index, type: action.type, status: "error", message: "Aynı boyut birden fazla kez verildi" };
    }
    const dimRefs: DimRef[] = [];
    for (const dc of action.dimensionCodes) {
      const dim = findDim(dc);
      if (!dim) {
        return { index, type: action.type, status: "error", message: `Boyut bulunamadı: ${dc}` };
      }
      dimRefs.push(dim);
    }
    let id: number;
    if (dryRun) {
      id = fakeId--;
    } else {
      id = Number(
        sqlite
          .prepare("INSERT INTO models (tenant_id, code, name, description, created_at) VALUES (?,?,?,?,?)")
          .run(ctx.tenantId, action.code, action.name, action.description ?? null, new Date().toISOString())
          .lastInsertRowid
      );
      const ins = sqlite.prepare("INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)");
      dimRefs.forEach((d, i) => ins.run(id, d.id, i + 1));
      logAudit(ctx.userId, "ai_dev.create_model", "model", id, {
        code: action.code,
        name: action.name,
        dimensionCodes: action.dimensionCodes,
      });
    }
    knownModels.set(action.code, { id, code: action.code, dimCodes: action.dimensionCodes });
    return {
      index,
      type: action.type,
      status: "created",
      message: `Yeni model: ${action.code} (${action.name}) — boyutlar: ${action.dimensionCodes.join(", ")}`,
      entityId: id,
      entityCode: action.code,
    };
  }

  function doCreateMeasure(action: Extract<DevAction, { type: "create_measure" }>, index: number): ActionResult {
    if (viewerBlocked(ctx)) {
      return { index, type: action.type, status: "error", message: "Bu rol ölçü oluşturamaz (viewer)" };
    }
    const model = findModel(action.modelCode);
    if (!model) {
      return { index, type: action.type, status: "error", message: `Model bulunamadı: ${action.modelCode}` };
    }
    if (model.id < 0) {
      // Ayni planda bu adimdan once olusturulmus (henuz commit edilmemis,
      // dryRun) bir model — gercek slot/limit kontrolu apply asamasinda yapilir.
      return {
        index,
        type: action.type,
        status: "created",
        message: `Yeni ölçü: ${action.code} (${action.name}) — model: ${action.modelCode}`,
      };
    }
    const existing = listEffectiveMeasures(model.id).find((m) => m.code === action.code);
    if (existing) {
      return {
        index,
        type: action.type,
        status: "exists",
        message: `"${action.code}" ölçüsü zaten var`,
        entityId: existing.id,
        entityCode: action.code,
      };
    }
    const current = listEffectiveMeasures(model.id).filter((m) => m.id !== 0);
    if (current.length >= MAX_MODEL_MEASURES) {
      return {
        index,
        type: action.type,
        status: "error",
        message: `Bir modele en fazla ${MAX_MODEL_MEASURES} ölçü eklenebilir`,
      };
    }
    if (dryRun) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `Yeni ölçü: ${action.code} (${action.name}) — model: ${action.modelCode}`,
      };
    }
    const measure = createModelMeasure({ modelId: model.id, code: action.code, name: action.name });
    logAudit(ctx.userId, "ai_dev.create_measure", "model_measure", measure.id, {
      modelCode: action.modelCode,
      code: action.code,
      name: action.name,
    });
    return {
      index,
      type: action.type,
      status: "created",
      message: `Yeni ölçü: ${action.code} (${action.name})`,
      entityId: measure.id,
      entityCode: action.code,
    };
  }

  function doCreateReport(action: Extract<DevAction, { type: "create_report" }>, index: number): ActionResult {
    const model = findModel(action.modelCode);
    if (!model) {
      return { index, type: action.type, status: "error", message: `Model bulunamadı: ${action.modelCode}` };
    }
    const dimCodes = new Set(model.dimCodes);
    for (const c of [...action.rows, ...action.cols]) {
      if (!dimCodes.has(c)) {
        return { index, type: action.type, status: "error", message: `Model boyutu değil: ${c}` };
      }
    }
    if (model.id < 0) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `Yeni rapor: ${action.name} — model: ${action.modelCode}`,
      };
    }
    const definition = {
      version: 2 as const,
      modelId: model.id,
      rows: action.rows,
      cols: action.cols,
      filters: action.filters ?? {},
      calcColumns: [],
      calcRows: [],
      condRules: [],
      options: { hideZero: false, subtotals: true, valueMode: "abs" as const, scale: 1 as const, decimals: 0 as const, topN: null, sort: null },
    };
    if (dryRun) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `Yeni rapor: ${action.name} (satır: ${action.rows.join(",")} / sütun: ${action.cols.join(",")})`,
      };
    }
    const now = new Date().toISOString();
    const id = Number(
      sqlite
        .prepare(
          "INSERT INTO reports (tenant_id, name, owner_id, model_id, definition, shared, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
        )
        .run(ctx.tenantId, action.name, ctx.userId, model.id, JSON.stringify(definition), action.shared ? 1 : 0, now, now)
        .lastInsertRowid
    );
    logAudit(ctx.userId, "ai_dev.create_report", "report", id, { name: action.name, modelCode: action.modelCode });
    return {
      index,
      type: action.type,
      status: "created",
      message: `Yeni rapor: ${action.name}`,
      entityId: id,
      entityCode: action.name,
    };
  }

  function doUploadFacts(action: Extract<DevAction, { type: "upload_facts" }>, index: number): ActionResult {
    if (viewerBlocked(ctx)) {
      return { index, type: action.type, status: "error", message: "Bu rol veri yazamaz (viewer)" };
    }
    const model = findModel(action.modelCode);
    if (!model) {
      return { index, type: action.type, status: "error", message: `Model bulunamadı: ${action.modelCode}` };
    }
    if (model.id < 0) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `${action.rows.length} veri satırı yüklenecek — model: ${action.modelCode}`,
      };
    }
    if (dryRun) {
      return {
        index,
        type: action.type,
        status: "created",
        message: `${action.rows.length} veri satırı yüklenecek`,
      };
    }
    const dims = getModelDims(model.id);
    const measures = listEffectiveMeasures(model.id);
    const measureCodeBySlot = new Map(measures.map((m) => [m.slot, m.code]));

    const now = new Date().toISOString();
    const uploadId = Number(
      sqlite
        .prepare(
          "INSERT INTO uploads (model_id, filename, user_id, row_count, status, created_at) VALUES (?,?,?,?,'done',?)"
        )
        .run(model.id, "AI ile geliştirme", ctx.userId, action.rows.length, now).lastInsertRowid
    );
    const factRows = action.rows.map((r) => {
      const coords = dims.map((d) => r.coords[d.code] ?? "");
      const values: Record<number, number | null> = {};
      for (const [slot, code] of measureCodeBySlot) {
        if (slot === 1) continue;
        values[slot] = r.values?.[code] ?? null;
      }
      return { coords, value: r.value, values: Object.keys(values).length > 0 ? values : undefined };
    });
    try {
      upsertFacts(model.id, dims, factRows, uploadId, now, ctx.userId);
    } catch (e) {
      sqlite.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(uploadId);
      throw e;
    }
    logAudit(ctx.userId, "ai_dev.upload_facts", "upload", uploadId, {
      modelCode: action.modelCode,
      rows: action.rows.length,
    });
    return {
      index,
      type: action.type,
      status: "created",
      message: `${action.rows.length} veri satırı yüklendi`,
      entityId: uploadId,
    };
  }
}
