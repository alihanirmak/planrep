import { NextResponse } from "next/server";
import { z } from "zod";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims, getModelTenantId } from "@/lib/model";
import { allowedSets } from "@/lib/access";
import { upsertFacts } from "@/lib/facts-write";
import { WorkflowLockError } from "@/lib/workflow";
import { BusinessRuleError } from "@/lib/business-rules";
import { logAudit } from "@/lib/audit";
import { listEffectiveMeasures, valueColumnForSlot } from "@/lib/model-measures";

// measureCode: opsiyonel, coklu-olcu modellerinde HANGI olcunun duzenlendigini
// belirtir (verilmezse slot 1 / birincil olcu varsayilir — geriye uyumlu,
// tek-olcu modellerde zaten tek secenek budur).
const bodySchema = z.object({ value: z.number().finite(), measureCode: z.string().max(40).optional() });

// Tek bir ham fact satirinin degerini duzenler (/browser sayfasindaki
// hucre-ici duzenleme icin). Mevcut toplu yazma altyapisini (upsertFacts)
// TEK satirla cagirarak yeniden kullanir — bu sayede lock/is-kurali
// kontrolleri ve fact_audit kaydi otomatik olarak ayni sekilde islenir
// (bkz. /api/upload, /api/scenario/copy ile ayni desen).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = parseIdParam((await params).id);
  if (id === null) return invalidIdResponse();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const modelRow = sqlite.prepare("SELECT model_id AS modelId FROM facts WHERE id = ?").get(id) as
    | { modelId: number }
    | undefined;
  if (!modelRow || getModelTenantId(modelRow.modelId) !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const dims = getModelDims(modelRow.modelId);
  const slots = dims.map((d) => d.slot);
  const measures = listEffectiveMeasures(modelRow.modelId);
  const measureSlots = measures.map((m) => m.slot);
  const targetMeasure = parsed.data.measureCode
    ? measures.find((m) => m.code === parsed.data.measureCode)
    : measures.find((m) => m.slot === 1) ?? measures[0];
  if (!targetMeasure) return NextResponse.json({ error: "measure_not_found" }, { status: 400 });

  const measureSelCols = measureSlots.map((s) => `${valueColumnForSlot(s)} AS ${valueColumnForSlot(s)}`).join(", ");
  const factRow = sqlite
    .prepare(`SELECT ${slots.map((s) => `d${s}`).join(", ")}, ${measureSelCols} FROM facts WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!factRow) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const coords = slots.map((s) => String(factRow[`d${s}`] ?? ""));

  // Boyut-bazli yazma yetkisi (upload route'uyla ayni kontrol — bkz.
  // src/app/api/upload/route.ts): kullanicinin erisim kisiti disinda kalan
  // bir koordinatin degeri bu uc uzerinden de duzenlenemez.
  const access = allowedSets(session.id, dims);
  for (let i = 0; i < dims.length; i++) {
    const allowed = access.get(dims[i].code);
    if (allowed && !allowed.has(coords[i])) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const now = new Date().toISOString();
  const uploadId = Number(
    sqlite
      .prepare(
        "INSERT INTO uploads (model_id, filename, user_id, row_count, status, created_at) VALUES (?,?,?,?,'done',?)"
      )
      .run(modelRow.modelId, `Hücre düzenleme #${id}`, session.id, 1, now).lastInsertRowid
  );

  // Satir TAMAMEN SIL-YENIDEN-YAZ semantigiyle yazildigindan (bkz.
  // lib/facts-write.ts), coklu-olcu modellerinde HEDEFLENMEYEN olculerin
  // mevcut degerleri (factRow'dan) birlikte gonderilir — aksi halde
  // duzenlenmeyen olculer NULL'a duserdi.
  const oldTargetValue = Number(factRow[valueColumnForSlot(targetMeasure.slot)]);
  const value =
    targetMeasure.slot === 1 ? parsed.data.value : Number(factRow[valueColumnForSlot(1)] ?? 0);
  const values: Record<number, number | null> = {};
  for (const s of measureSlots) {
    if (s === 1) continue;
    values[s] = s === targetMeasure.slot ? parsed.data.value : ((factRow[valueColumnForSlot(s)] as number | null) ?? null);
  }

  try {
    upsertFacts(
      modelRow.modelId,
      dims,
      [{ coords, value, values: measureSlots.length > 1 ? values : undefined }],
      uploadId,
      now,
      session.id
    );
  } catch (e) {
    if (e instanceof WorkflowLockError) {
      return NextResponse.json({ error: "workflow_locked", message: e.message }, { status: 423 });
    }
    if (e instanceof BusinessRuleError) {
      return NextResponse.json({ error: "business_rule_violated", message: e.message }, { status: 400 });
    }
    throw e;
  }

  // upsertFacts tek satir yaziyor; bu sentetik upload'a ait TEK fact_audit
  // kaydi upload_id uzerinden kesin olarak bulunur — istemci bu id'yi
  // hucre-bazli undo/redo yiginina koyar (bkz. lib/fact-audit.ts).
  const auditRow = sqlite
    .prepare("SELECT id FROM fact_audit WHERE upload_id = ? ORDER BY id DESC LIMIT 1")
    .get(uploadId) as { id: number } | undefined;

  logAudit(session.id, "facts.edit", "fact", id, {
    modelId: modelRow.modelId,
    coords,
    measureCode: targetMeasure.code,
    oldValue: oldTargetValue,
    newValue: parsed.data.value,
  });

  return NextResponse.json({
    ok: true,
    auditId: auditRow?.id ?? null,
    measureCode: targetMeasure.code,
    oldValue: oldTargetValue,
    newValue: parsed.data.value,
  });
}
