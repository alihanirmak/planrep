import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "planner", "viewer"] })
    .notNull()
    .default("viewer"),
  locale: text("locale").notNull().default("tr"),
  createdAt: text("created_at").notNull(),
});

export const dimensions = sqliteTable("dimensions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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

export const models = sqliteTable("models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
});

// Bir modelin boyutlari: slot 1..8 -> facts tablosundaki d1..d8 kolonlarina karsilik gelir
export const modelDimensions = sqliteTable(
  "model_dimensions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    modelId: integer("model_id").notNull(),
    dimensionId: integer("dimension_id").notNull(),
    slot: integer("slot").notNull(), // 1..8
  },
  (t) => [
    uniqueIndex("uq_modeldim_slot").on(t.modelId, t.slot),
    uniqueIndex("uq_modeldim_dim").on(t.modelId, t.dimensionId),
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
    value: real("value").notNull(),
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
  name: text("name").notNull(),
  ownerId: integer("owner_id").notNull(),
  modelId: integer("model_id").notNull(),
  definition: text("definition").notNull(),
  shared: integer("shared").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const dashboards = sqliteTable("dashboards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  ownerId: integer("owner_id").notNull(),
  definition: text("definition").notNull(),
  shared: integer("shared").notNull().default(0),
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
    modelId: integer("model_id").notNull(),
    name: text("name").notNull(),
    scopeFilters: text("scope_filters").notNull(),
    op: text("op", { enum: ["<", ">", "<=", ">=", "=", "<>"] }).notNull(),
    value: real("value").notNull(),
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
    oldValue: real("old_value"),
    newValue: real("new_value"),
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
