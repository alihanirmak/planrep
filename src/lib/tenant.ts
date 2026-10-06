// Coklu-tenant: tenant CRUD katmani.
//
// Mimari karar (bkz. docs/ROADMAP.md Sprint 3.1 madde 3 tamamlama notu):
// tenant_id SADECE kullanicinin dogrudan "sahip" oldugu/raw id ile aranan
// ust-seviye kaynaklara eklendi (users, models, dimensions, reports,
// dashboards, workflow_items, business_rules, connector_configs,
// scheduled_syncs). facts/uploads/comments/notifications/fact_audit/
// workflow_history/user_dim_access gibi "cocuk" tablolar kendi tenant_id
// kolonuna sahip DEGIL — bunlarin izolasyonu her zaman ebeveyn kaynagin
// (model_id/entity sahipligi) tenant kontrolunden GECTIKTEN SONRA
// saglanir (transitive izolasyon). Bu, her yazma yolunda tenant_id
// kopyalamaktan kaynaklanabilecek tutarsizlik riskini azaltir ve mevcut
// "facts" EAV tablosuna (zaten d1..d8 sabit kolon limiti var) yeni bir
// kolon eklemekten kacinir.
//
// Bu uygulamada ayri bir "superadmin" rolu YOK — her tenant kendi admin'ini
// kendi (self-service) signup akisiyla olusturur (bkz. api/auth/signup).
// Platform genelinde tenant listesi gorebilen bir UI kasitli olarak
// eklenmedi (kapsam disi, gerekirse ayri bir is).
import { eq } from "drizzle-orm";
import { db, tenants } from "./db";

export type Tenant = { id: number; code: string; name: string; createdAt: string };

export function getTenant(id: number): Tenant | null {
  return db.select().from(tenants).where(eq(tenants.id, id)).get() ?? null;
}

export function getTenantByCode(code: string): Tenant | null {
  return db.select().from(tenants).where(eq(tenants.code, code)).get() ?? null;
}

export function createTenant(input: { code: string; name: string }): Tenant {
  return db
    .insert(tenants)
    .values({ code: input.code, name: input.name, createdAt: new Date().toISOString() })
    .returning()
    .get();
}
