import { NextResponse } from "next/server";
import { parseIdParam, invalidIdResponse } from "@/lib/route-params";
import { getSession } from "@/lib/auth";
import { getScheduledSync, runScheduledSync } from "@/lib/scheduled-sync";

// Admin'in UI'dan "şimdi çalıştır" ile manuel tetikleyebilmesi için — asıl
// otomatik tetikleme POST /api/cron/sync üzerinden harici cron/webhook ile
// yapılır (bkz. docs). Bu uç normal oturum (session) yetkilendirmesi kullanır.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = parseIdParam((await params).id);

  if (id === null) return invalidIdResponse();
  const existing = getScheduledSync(id);
  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const outcome = await runScheduledSync(id);
  return NextResponse.json(outcome);
}
