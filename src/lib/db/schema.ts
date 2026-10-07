import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

// Harici BI araclari (Power BI/Tableau vb.) icin REST export API'sine
// erisim anahtarlari (bkz. lib/api-keys.ts, app/api/v1/*). Sifre gibi
// bcrypt YERINE sha256 ile hashlenir — API key'ler zaten yuksek entropili
// rastgele degerler oldugundan (32 bayt), kasitli olarak yavaslatilmis bir
// hash fonksiyonuna gerek yok; sha256 hash'i UNIQUE INDEX ile direkt
// DB lookup'u mumkun kilar (bcrypt ile bu mumkun olmazdi — her denemede
// tum anahtarlari teker teker compare etmek gerekirdi).
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: integer("tenant_id").notNull(),
    userId: integer("user_id").notNull(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    // Anahtarin ilk 8 karakteri (prefix) — kullaniciya listede "hangi
    // anahtar bu" diye hatirlatmak icin gosterilir, ham anahtar bir daha
    // GORUNTULENEMEZ (sadece olusturma aninda bir kez verilir).
    keyPrefix: text("key_prefix").notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [uniqueIndex("uq_api_keys_hash").on(t.keyHash)]
);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Coklu-tenant: her kullanici TAM OLARAK bir tenant'a aittir. email halen
  // GLOBAL olarak benzersizdir (tenant'lar arasinda da) - bu bilinen, kasitli
  // bir basitlestirme (bkz. docs/ROADMAP.md Sprint 3.1 madde 3 notu); ayni
  // email'in birden fazla tenant'ta ayri hesaplarla var olmasi desteklenmez.
  tenantId: integer("tenant_id").notNull().default(1),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "planner", "viewer"] })
    .notNull()
    .default("viewer"),
  locale: text("locale").notNull().default("tr"),
  createdAt: text("created_at").notNull(),
  // 2FA (TOTP, RFC 6238): totpSecret kurulum sirasinda (enable() oncesi,
  // henuz onaylanmamis "pending" durumda) ve onaylandiktan sonra ayni
  // kolonda saklanir — totpEnabled=0 iken secret "pending" (henuz dogrulanmamis
  // kurulum), totpEnabled=1 iken aktif secret'tir. totpBackupCodes: JSON
  // string[] (bcrypt hash'leri) — cihaz kaybinda kurtarma icin, her biri
  // tek kullanimlik (kullanildiginda listeden cikarilir).
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled").notNull().default(0),
  totpBackupCodes: text("totp_backup_codes"),
  // SSO (OIDC — Okta/Azure AD vb.): ssoProvider+ssoSubject ilk SSO
  // girisinde doldurulur ("provisioning"). Ayni email'e sahip var olan
  // bir yerel kullanici varsa yeni kayit acilmaz, mevcut kullaniciya
  // SSO kimligi BAGLANIR (bkz. lib/sso/sso-user.ts). SSO ile otomatik
  // olusturulan kullanicilarin passwordHash'i rastgele/bilinmeyen bir
  // deger olur (sifreyle giris fiilen imkansiz hale gelir), authProvider
  // sadece bilgilendirme/denetim amaclidir, giris yontemini KISITLAMAZ
  // (bir admin isterse SSO kullanicisina sonradan sifre atayabilir).
  ssoProvider: text("sso_provider"),
  ssoSubject: text("sso_subject"),
  authProvider: text("auth_provider", { enum: ["local", "sso"] })
    .notNull()
    .default("local"),
});

export const dimensions = sqliteTable("dimensions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type", { enum: ["standard", "time", "version"] })
    .notNull()
    .default("standard"),
});

export const dimensionMembers = sqliteTable(
  "dimension_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dimensionId: integer("dimension_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    parentId: integer("parent_id"),
    orderIdx: integer("order_idx").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_member_dim_code").on(t.dimensionId, t.code)]
);

// Boyut uyesi ozellikleri (dimension member attributes) — hiyerarsi disi ek
// nitelik tanimlari (orn. "Musteri" boyutundaki uyenin "Bolge"si). type
// "member_ref" ise deger baska bir boyuttaki (refDimensionId) bir uyenin
// KODUDUR (raw id DEGIL) — projenin genelindeki "kod birincil disaridan
// gorunur kimlik" konvansiyonuyla tutarli (bkz. scopeFilters/withDescendants).
// type/refDimensionId olusturulduktan sonra DEGISTIRILEMEZ (route seviyesinde
// engellenir) — tip degisimi var olan degerleri yanlis yorumlatirdi, silip
// yeniden olusturmak gerekir.
export const dimensionAttributes = sqliteTable(
  "dimension_attributes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dimensionId: integer("dimension_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ["text", "number", "date", "member_ref"] }).notNull(),
    refDimensionId: integer("ref_dimension_id"),
    orderIdx: integer("order_idx").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_dim_attr_code").on(t.dimensionId, t.code),
    index("ix_dim_attr_dimension").on(t.dimensionId),
  ]
);

// Her uye x attribute icin tek bir deger satiri (EAV — attribute sayisi
// sinirsizdir, facts tablosundaki d1..d16 sabit kolon kisitina TABI DEGIL).
// value her zaman TEXT: number/date tipleri bile string olarak saklanir,
// dogrulama route seviyesinde (lib/dimension-attributes.ts validateAttributeValue)
// yapilir.
export const dimensionMemberAttributeValues = sqliteTable(
  "dimension_member_attribute_values",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id").notNull(),
    attributeId: integer("attribute_id").notNull(),
    value: text("value"),
  },
  (t) => [
    uniqueIndex("uq_dim_attr_value_member_attr").on(t.memberId, t.attributeId),
    index("ix_dim_attr_value_attribute").on(t.attributeId),
  ]
);

export const models = sqliteTable("models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
});

// Bir modelin boyutlari: slot 1..16 -> facts tablosundaki d1..d16 kolonlarina karsilik gelir
export const modelDimensions = sqliteTable(
  "model_dimensions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    modelId: integer("model_id").notNull(),
    dimensionId: integer("dimension_id").notNull(),
    slot: integer("slot").notNull(), // 1..16
  },
  (t) => [
    uniqueIndex("uq_modeldim_slot").on(t.modelId, t.slot),
    uniqueIndex("uq_modeldim_dim").on(t.modelId, t.dimensionId),
  ]
);

// Bir modelin olculeri (measures): slot 1 -> facts.value (mevcut kolon,
// DEGISTIRILMEDI), slot 2..8 -> facts.value2..value8. Hic satir yoksa model
// "varsayilan tekil olcu" modundadir (bkz. lib/model-measures.ts
// listEffectiveMeasures) — GERIYE UYUMLULUK icin KASITLI.
export const modelMeasures = sqliteTable(
  "model_measures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    modelId: integer("model_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    slot: integer("slot").notNull(), // 1..8
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_modelmeasure_slot").on(t.modelId, t.slot),
    uniqueIndex("uq_modelmeasure_code").on(t.modelId, t.code),
  ]
);

export const facts = sqliteTable(
  "facts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    modelId: integer("model_id").notNull(),
    d1: text("d1"),
    d2: text("d2"),
    d3: text("d3"),
    d4: text("d4"),
    d5: text("d5"),
    d6: text("d6"),
    d7: text("d7"),
    d8: text("d8"),
    d9: text("d9"),
    d10: text("d10"),
    d11: text("d11"),
    d12: text("d12"),
    d13: text("d13"),
    d14: text("d14"),
    d15: text("d15"),
    d16: text("d16"),
    value: real("value").notNull(),
    value2: real("value2"),
    value3: real("value3"),
    value4: real("value4"),
    value5: real("value5"),
    value6: real("value6"),
    value7: real("value7"),
    value8: real("value8"),
    uploadId: integer("upload_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("ix_facts_model").on(t.modelId),
    index("ix_facts_upload").on(t.uploadId),
  ]
);

export const uploads = sqliteTable("uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  modelId: integer("model_id").notNull(),
  filename: text("filename").notNull(),
  userId: integer("user_id").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  status: text("status", { enum: ["done", "reverted", "failed"] })
    .notNull()
    .default("done"),
  createdAt: text("created_at").notNull(),
});

// definition: JSON — satir/sutun boyutlari, filtreler, hesaplanan kolonlar, kosullu bicimlendirme
export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1),
  name: text("name").notNull(),
  ownerId: integer("owner_id").notNull(),
  modelId: integer("model_id").notNull(),
  definition: text("definition").notNull(),
  shared: integer("shared").notNull().default(0),
  // Optimistic concurrency: her basarili PUT 1 artirir. Istemci son GET'te
  // aldigi versiyonu PUT govdesinde geri gonderir; sunucudaki versiyon
  // uyusmazsa (araya baska bir yazma girmis) 409 donulur — bkz.
  // api/reports/[id]/route.ts. Boylece iki kullanicinin birbirinin
  // degisikligini sessizce ezmesi (lost update) onlenir.
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const dashboards = sqliteTable("dashboards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1),
  name: text("name").notNull(),
  ownerId: integer("owner_id").notNull(),
  definition: text("definition").notNull(),
  shared: integer("shared").notNull().default(0),
  // bkz. reports.version ustundeki not — ayni optimistic concurrency semantigi.
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  detail: text("detail"),
  createdAt: text("created_at").notNull(),
});

export const comments = sqliteTable("comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type", { enum: ["report", "dashboard", "cell"] }).notNull(),
  entityId: text("entity_id").notNull(),
  cellKey: text("cell_key"),
  userId: integer("user_id").notNull(),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull(),
});

// scopeFilters: JSON — Record<dimCode, string[]>; bu is akisinin kapsadigi veri kesiti.
// status zinciri: draft -> submitted -> in_review -> approved -> locked (terminal),
// reddetme (rejected) her asamadan donus, admin "reopen" ile locked'tan draft'a donebilir.
export const workflowItems = sqliteTable(
  "workflow_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: integer("tenant_id").notNull().default(1),
    modelId: integer("model_id").notNull(),
    name: text("name").notNull(),
    scopeFilters: text("scope_filters").notNull(),
    status: text("status", {
      enum: ["draft", "submitted", "in_review", "approved", "rejected", "locked"],
    })
      .notNull()
      .default("draft"),
    ownerId: integer("owner_id").notNull(),
    approverId: integer("approver_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    submittedAt: text("submitted_at"),
    reviewedAt: text("reviewed_at"),
    approvedAt: text("approved_at"),
    lockedAt: text("locked_at"),
  },
  (t) => [index("ix_workflow_model").on(t.modelId), index("ix_workflow_status").on(t.status)]
);

export const workflowHistory = sqliteTable(
  "workflow_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workflowId: integer("workflow_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    userId: integer("user_id").notNull(),
    comment: text("comment"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_workflow_history_wf").on(t.workflowId)]
);

// scopeFilters: JSON — Record<dimCode, string[]>; kurahn uygulandigi veri
// kesiti. "block" ihlal halinde yazmayi reddeder, "warn" sadece bildirir.
export const businessRules = sqliteTable(
  "business_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: integer("tenant_id").notNull().default(1),
    modelId: integer("model_id").notNull(),
    name: text("name").notNull(),
    scopeFilters: text("scope_filters").notNull(),
    op: text("op", { enum: ["<", ">", "<=", ">=", "=", "<>"] }).notNull(),
    value: real("value").notNull(),
    // null = varsayilan olcu (slot 1/"value") — geriye uyumlu, mevcut
    // kurallarin hicbirinde bu kolon doldurulmamistir. Dolu ise, kural
    // sadece o measure code'una ait yazimlar icin degerlendirilir (bkz.
    // lib/business-rules.ts evaluateBusinessRules).
    measureCode: text("measure_code"),
    severity: text("severity", { enum: ["block", "warn"] })
      .notNull()
      .default("block"),
    message: text("message"),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("ix_business_rules_model").on(t.modelId)]
);

// Hucre bazli yazma gecmisi: her upsert/revert/rollback bir satir uretir.
// oldValue null ise koordinat daha once yoktu (yeni ekleme); newValue null
// ise satir silindi.
export const factAudit = sqliteTable(
  "fact_audit",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    modelId: integer("model_id").notNull(),
    uploadId: integer("upload_id"),
    d1: text("d1"),
    d2: text("d2"),
    d3: text("d3"),
    d4: text("d4"),
    d5: text("d5"),
    d6: text("d6"),
    d7: text("d7"),
    d8: text("d8"),
    d9: text("d9"),
    d10: text("d10"),
    d11: text("d11"),
    d12: text("d12"),
    d13: text("d13"),
    d14: text("d14"),
    d15: text("d15"),
    d16: text("d16"),
    oldValue: real("old_value"),
    newValue: real("new_value"),
    oldValue2: real("old_value2"),
    newValue2: real("new_value2"),
    oldValue3: real("old_value3"),
    newValue3: real("new_value3"),
    oldValue4: real("old_value4"),
    newValue4: real("new_value4"),
    oldValue5: real("old_value5"),
    newValue5: real("new_value5"),
    oldValue6: real("old_value6"),
    newValue6: real("new_value6"),
    oldValue7: real("old_value7"),
    newValue7: real("new_value7"),
    oldValue8: real("old_value8"),
    newValue8: real("new_value8"),
    source: text("source", { enum: ["write", "revert", "rollback"] })
      .notNull()
      .default("write"),
    userId: integer("user_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_fact_audit_model").on(t.modelId), index("ix_fact_audit_upload").on(t.uploadId)]
);

// config: JSON — ConnectorTypeDef'in configFields'ina gore anahtar/deger
// (ornek sap-odata icin: {url, user, pass, entities}).
export const connectorConfigs = sqliteTable("connector_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1),
  type: text("type").notNull(),
  name: text("name").notNull(),
  config: text("config").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// In-app bildirim sistemi. "type" bir i18n anahtarina karsilik gelir
// (lib/i18n.ts "notif.*"), "params" o anahtardaki {placeholder}'lari
// doldurmak icin JSON Record<string,string>; boylece bildirim metni
// OLUSTURULDUGU anda degil, GOSTERILDIGI anda (alicinin kendi locale'ine
// gore) cevrilir. "link" tiklandiginda gidilecek sayfa (opsiyonel).
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    type: text("type").notNull(),
    params: text("params").notNull().default("{}"),
    link: text("link"),
    isRead: integer("is_read").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("ix_notifications_user").on(t.userId),
    index("ix_notifications_user_unread").on(t.userId, t.isRead),
  ]
);

// Zamanlanmis veri yenileme: bir connector_config + source + model + mapping
// kombinasyonunu periyodik olarak (interval_minutes) tekrar calistirir.
// Gercek tetikleme harici bir cron/webhook cagrisiyla (POST /api/cron/sync,
// CRON_SECRET header'i ile korunur) yapilir — uygulama icinde arka plan
// zamanlayici (setInterval) YOK, cunku Next.js build/page-collection asamasi
// da modul kodunu calistirir ve bir timer'in build sirasinda baslamasi
// istenmeyen bir yan etki olurdu. mapping: JSON — kaynak kolonu -> boyut
// kodu veya "DEGER" (api/integrations/import ile ayni format).
export const scheduledSyncs = sqliteTable(
  "scheduled_syncs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: integer("tenant_id").notNull().default(1),
    name: text("name").notNull(),
    connectorConfigId: integer("connector_config_id").notNull(),
    source: text("source").notNull(),
    modelId: integer("model_id").notNull(),
    mapping: text("mapping").notNull(),
    intervalMinutes: integer("interval_minutes").notNull().default(60),
    active: integer("active").notNull().default(1),
    lastRunAt: text("last_run_at"),
    lastStatus: text("last_status", { enum: ["success", "failed"] }),
    lastError: text("last_error"),
    lastInserted: integer("last_inserted"),
    createdBy: integer("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("ix_scheduled_syncs_active").on(t.active)]
);
