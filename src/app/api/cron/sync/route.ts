import { NextResponse } from "next/server";
import { runDueScheduledSyncs } from "@/lib/scheduled-sync";

// Harici bir cron (OS crontab, k8s CronJob, GitHub Actions scheduled
// workflow) veya webhook tarafindan periyodik olarak cagrilacak uc. Normal
// kullanici oturumu (cookie) GEREKTIRMEZ — bunun yerine `X-Cron-Secret`
// header'i `CRON_SECRET` env degiskeniyle eslesmelidir. CRON_SECRET
// tanimlanmamissa bu uc kasitli olarak 503 doner (varsayilan olarak acik,
// korumasiz bir yazma endpoint'i olmasin diye).
//
// Kullanim ornegi (OS crontab, her 15 dakikada bir):
//   */15 * * * * curl -fsS -X POST https://planrep.ornek.com/api/cron/sync \
//     -H "X-Cron-Secret: $CRON_SECRET" >/dev/null
//
// Sadece vadesi gelmis (interval_minutes suresi dolmus) aktif senkronizasyonlari
// calistirir — bu endpoint'in cagrilma sikligi ile her senkronizasyonun kendi
// interval_minutes degeri birbirinden bagimsizdir (cok sik cagrilsa da erken
// calismaz).
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const outcomes = await runDueScheduledSyncs();
  return NextResponse.json({
    ran: outcomes.length,
    succeeded: outcomes.filter((o) => o.status === "success").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  });
}
