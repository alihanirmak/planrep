import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import { getModelDims } from "@/lib/model";
import { allowedSets } from "@/lib/access";
import { upsertFacts } from "@/lib/facts-write";
import { WorkflowLockError } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { parseLocaleNumber } from "@/lib/number";

const MAX_ERRORS = 50;

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return String(v.result ?? "");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role === "viewer") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const modelId = Number(form?.get("modelId"));
  if (!form || !(file instanceof File) || Number.isNaN(modelId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const dims = getModelDims(modelId);
  if (dims.length === 0) {
    return NextResponse.json({ error: "model_not_found" }, { status: 404 });
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "invalid_file" }, { status: 400 });
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }

  // Basliklari boyutlara esle (kod veya ad, buyuk/kucuk harf duyarsiz)
  const headerRow = ws.getRow(1);
  const colMap = new Map<number, number>(); // excel kolonu -> dim index
  let valueCol = -1;
  const errors: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    const h = cellText(cell.value).toLocaleLowerCase("tr");
    if (!h) return;
    if (["deger", "değer", "value", "tutar"].includes(h)) {
      valueCol = colNumber;
      return;
    }
    const idx = dims.findIndex(
      (d) =>
        d.code.toLocaleLowerCase("tr") === h || d.name.toLocaleLowerCase("tr") === h
    );
    if (idx >= 0) colMap.set(colNumber, idx);
    else errors.push(`Bilinmeyen kolon başlığı: "${cellText(cell.value)}"`);
  });
  if (valueCol < 0) errors.push('Değer kolonu bulunamadı (başlık "DEGER" veya "Value" olmalı)');
  for (const d of dims) {
    if (![...colMap.values()].includes(dims.indexOf(d))) {
      errors.push(`Eksik boyut kolonu: ${d.code} (${d.name})`);
    }
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation", errors }, { status: 400 });
  }

  // Uye dogrulama haritalari: kod ve ad -> kod
  const memberLookup = dims.map((d) => {
    const map = new Map<string, string>();
    for (const m of d.members) {
      map.set(m.code.toLocaleLowerCase("tr"), m.code);
      map.set(m.name.toLocaleLowerCase("tr"), m.code);
    }
    return map;
  });

  // Boyut bazli veri yetkisi: kullanicinin yazamayacagi uyeler reddedilir
  const access = allowedSets(session.id, dims);

  type FactRow = { coords: string[]; value: number };
  const parsed: FactRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const isEmpty = !row.hasValues;
    if (isEmpty) continue;
    const coords: string[] = new Array(dims.length).fill("");
    let bad = false;
    for (const [colNumber, dimIdx] of colMap) {
      const raw = cellText(row.getCell(colNumber).value);
      const code = memberLookup[dimIdx].get(raw.toLocaleLowerCase("tr"));
      if (!code) {
        if (errors.length < MAX_ERRORS)
          errors.push(`Satır ${r}: "${raw}" ${dims[dimIdx].name} boyutunda bulunamadı`);
        bad = true;
      } else {
        const allowed = access.get(dims[dimIdx].code);
        if (allowed && !allowed.has(code)) {
          if (errors.length < MAX_ERRORS)
            errors.push(`Satır ${r}: "${raw}" (${dims[dimIdx].name}) için yazma yetkiniz yok`);
          bad = true;
        } else {
          coords[dimIdx] = code;
        }
      }
    }
    const rawVal = row.getCell(valueCol).value;
    const num = parseLocaleNumber(typeof rawVal === "number" ? rawVal : cellText(rawVal));
    if (Number.isNaN(num)) {
      if (errors.length < MAX_ERRORS) errors.push(`Satır ${r}: geçersiz sayı değeri`);
      bad = true;
    }
    if (!bad) parsed.push({ coords, value: num });
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: "validation", errors, validRows: parsed.length },
      { status: 400 }
    );
  }
  if (parsed.length === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const uploadId = Number(
    sqlite
      .prepare(
        "INSERT INTO uploads (model_id, filename, user_id, row_count, status, created_at) VALUES (?,?,?,?,'done',?)"
      )
      .run(modelId, file.name, session.id, parsed.length, now).lastInsertRowid
  );

  try {
    upsertFacts(modelId, dims, parsed, uploadId, now);
  } catch (e) {
    if (e instanceof WorkflowLockError) {
      sqlite.prepare("UPDATE uploads SET status = 'failed' WHERE id = ?").run(uploadId);
      return NextResponse.json({ error: "workflow_locked", message: e.message }, { status: 423 });
    }
    throw e;
  }

  logAudit(session.id, "upload.excel", "upload", uploadId, {
    modelId,
    filename: file.name,
    rows: parsed.length,
  });
  return NextResponse.json({ ok: true, uploadId, inserted: parsed.length });
}
