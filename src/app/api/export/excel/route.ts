import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { exportPayloadSchema } from "@/lib/export-schema";
import type { ExportCell } from "@/lib/report-types";

const STYLE_MAP: Record<string, { font?: Partial<ExcelJS.Font>; fill?: string }> = {
  "red-text": { font: { color: { argb: "FFCC0000" } } },
  "green-text": { font: { color: { argb: "FF107C41" } } },
  "red-bg": { fill: "FFFFC7CE" },
  "green-bg": { fill: "FFC6EFCE" },
  "yellow-bg": { fill: "FFFFEB9C" },
};

function numFmt(decimals: number): string {
  return decimals > 0 ? `#,##0.${"0".repeat(decimals)}` : "#,##0";
}

function applyCell(cell: ExcelJS.Cell, sc: ExportCell, fmt: string) {
  cell.value = sc.v;
  cell.numFmt = fmt;
  if (sc.style && STYLE_MAP[sc.style]) {
    const s = STYLE_MAP[sc.style];
    if (s.font) cell.font = { ...cell.font, ...s.font };
    if (s.fill)
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: s.fill } };
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const json = await req.json().catch(() => null);
    const parsed = exportPayloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const name = body.name?.trim() || "Rapor";
    const fmt = numFmt(body.decimals ?? 0);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(name.slice(0, 31).replace(/[\\/*?:[\]]/g, "-"));

    for (let h = 0; h < body.headerRows.length; h++) {
      const row = ws.addRow([h === body.headerRows.length - 1 ? body.rowHeader : "", ...body.headerRows[h]]);
      row.font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
      });
    }

    for (const r of body.rows) {
      const row = ws.addRow([]);
      const nameCell = row.getCell(1);
      nameCell.value = " ".repeat(r.depth * 2) + r.name;
      if (r.bold) nameCell.font = { bold: true };
      r.values.forEach((sc, i) => {
        const cell = row.getCell(i + 2);
        applyCell(cell, sc, fmt);
        if (r.bold) cell.font = { ...cell.font, bold: true };
      });
    }

    const totalRow = ws.addRow([]);
    totalRow.getCell(1).value = "Genel Toplam";
    body.totals.forEach((sc, i) => applyCell(totalRow.getCell(i + 2), sc, fmt));
    totalRow.font = { bold: true };
    totalRow.eachCell((c) => {
      c.border = { top: { style: "double" } };
    });

    ws.getColumn(1).width = 34;
    const colCount = body.headerRows[body.headerRows.length - 1]?.length ?? 0;
    for (let i = 2; i <= colCount + 1; i++) ws.getColumn(i).width = 14;
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: body.headerRows.length }];

    logAudit(session.id, "export.excel", "report", undefined, { name });

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="rapor.xlsx"`,
      },
    });
  } catch (err) {
    console.error("[export/excel]", err);
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }
}
