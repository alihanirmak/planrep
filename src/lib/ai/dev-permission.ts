import { sqlite } from "../db";
import type { SessionUser } from "../session";

// aiDevAccess JWT'de (session.aiDevAccess) tasinir ama admin bir kullanicinin
// erisimini GERI ALDIGINDA bunun aninda etkili olmasini saglamak icin, bu
// ozelligin YAZMA yapan uclarinda (plan/apply) EK OLARAK DB'den canli
// kontrol edilir — JWT 12 saate kadar bayat olabilir (role icin de kabul
// edilen bir sinirlama, bkz. session.ts), ama bu ozellik model/veri
// OLUSTURABILDIGINDEN savunma-katmani olarak canli kontrol tercih edildi.
export function hasLiveAiDevAccess(session: SessionUser): boolean {
  if (!session.aiDevAccess) return false;
  const row = sqlite.prepare("SELECT ai_dev_access AS v FROM users WHERE id = ?").get(session.id) as
    | { v: number }
    | undefined;
  return !!row?.v;
}

// Tenant basina gunluk uygulanan (apply edilmis) AI eylem sayisi tavani —
// kacak/kotuye kullanim riskine karsi (bkz. docs/ROADMAP.md "AI ile
// gelistirme" maddesi). audit_log'daki "ai_dev.*" aksiyonlari sayilir.
export const MAX_AI_DEV_ACTIONS_PER_DAY = 100;

export function aiDevActionsToday(tenantId: number): number {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM audit_log al JOIN users u ON u.id = al.user_id
       WHERE u.tenant_id = ? AND al.action LIKE 'ai_dev.%' AND al.created_at >= ?`
    )
    .get(tenantId, new Date(Date.now() - 24 * 3600 * 1000).toISOString()) as { c: number };
  return row.c;
}
