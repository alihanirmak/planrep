import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { exportPayloadSchema } from "@/lib/export-schema";

const STYLE_MAP: Record<string, { color?: string; fill?: string }> = {
  "red-text": { color: "CC0000" },
  "green-text": { color: "107C41" },
  "red-bg": { fill: "FFC7CE" },
  "green-bg": { fill: "C6EFCE" },
  "yellow-bg": { fill: "FFEB9C" },
};

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
    const nf = new Intl.NumberFormat("tr-TR", {
      maximumFractionDigits: body.decimals ?? 0,
      minimumFractionDigits: body.decimals ?? 0,
    });

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
    pptx.layout = "WIDE";

    const cover = pptx.addSlide();
    cover.background = { color: "1E293B" };
    cover.addText("PlanRep", { x: 0.8, y: 2.2, w: 11.7, h: 1, fontSize: 40, bold: true, color: "FFFFFF" });
    cover.addText(name, { x: 0.8, y: 3.3, w: 11.7, h: 0.8, fontSize: 24, color: "93C5FD" });
    cover.addText(new Date().toLocaleDateString("tr-TR"), { x: 0.8, y: 4.1, w: 11.7, h: 0.5, fontSize: 14, color: "94A3B8" });

    type Cell = { text: string; options?: Record<string, unknown> };
    const headerRows: Cell[][] = body.headerRows.map((hr, i) => [
      {
        text: i === body.headerRows.length - 1 ? body.rowHeader : "",
        options: { bold: true, color: "FFFFFF", fill: { color: "1E293B" } },
      },
      ...hr.map((h) => ({
        text: h,
        options: { bold: true, color: "FFFFFF", fill: { color: "1E293B" }, align: "center" as const },
      })),
    ]);

    const bodyRows: Cell[][] = body.rows.map((r) => [
      { text: "  ".repeat(r.depth) + r.name, options: { bold: r.bold, align: "left" } },
      ...r.values.map((sc) => {
        const st = sc.style ? STYLE_MAP[sc.style] : undefined;
        return {
          text: sc.v != null ? nf.format(sc.v) : "—",
          options: {
            align: "right",
            bold: r.bold,
            ...(st?.color ? { color: st.color } : {}),
            ...(st?.fill ? { fill: { color: st.fill } } : {}),
          },
        };
      }),
    ]);
    const totalCells: Cell[] = [
      { text: "Genel Toplam", options: { bold: true, fill: { color: "E2E8F0" } } },
      ...body.totals.map((sc) => ({
        text: sc.v != null ? nf.format(sc.v) : "—",
        options: { bold: true, align: "right" as const, fill: { color: "E2E8F0" } },
      })),
    ];

    const slide = pptx.addSlide();
    slide.addText(name, { x: 0.5, y: 0.25, w: 12.3, h: 0.5, fontSize: 20, bold: true, color: "1E293B" });
    slide.addTable([...headerRows, ...bodyRows, totalCells], {
      x: 0.5,
      y: 0.9,
      w: 12.3,
      fontSize: 9,
      border: { type: "solid", color: "CBD5E1", pt: 0.5 },
      autoPage: true,
      autoPageRepeatHeader: true,
      autoPageSlideStartY: 0.9,
    });

    logAudit(session.id, "export.pptx", "report", undefined, { name });

    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="rapor.pptx"`,
      },
    });
  } catch (err) {
    console.error("[export/pptx]", err);
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }
}
