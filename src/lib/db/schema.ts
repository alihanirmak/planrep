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
