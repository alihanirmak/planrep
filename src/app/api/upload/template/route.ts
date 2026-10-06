import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { getModelDims, type Member } from "@/lib/model";
import { sqlite } from "@/lib/db";

function firstLeaf(members: Member[]): Member | undefined {
  const parents = new Set(members.map((m) => m.parentId).filter((p) => p != null));
  return members.find((m) => !parents.has(m.id));
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const modelId = Number(url.searchParams.get("modelId"));
  const model = sqlite
    .prepare("SELECT code, name FROM models WHERE id = ? AND tenant_id = ?")
    .get(modelId, session.tenantId) as { code: string; name: string } | undefined;
  if (!model) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const dims = getModelDims(modelId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Veri");

  const headers = [...dims.map((d) => d.code), "DEGER"];
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 16));

  const example = dims.map((d) => firstLeaf(d.members)?.code ?? "");
  ws.addRow([...example, 1000]);

  const notes = wb.addWorksheet("Uyeler");
  notes.addRow(["Boyut", "Kod", "Ad"]).font = { bold: true };
  for (const d of dims) {
    for (const m of d.members) notes.addRow([d.code, m.code, m.name]);
  }
  notes.columns.forEach((c) => (c.width = 22));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${model.code}_sablon.xlsx"`,
    },
  });
}
