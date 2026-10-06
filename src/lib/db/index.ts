import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_PATH ?? "./data/planrep.db";
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_hash ON api_keys(key_hash);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  locale TEXT NOT NULL DEFAULT 'tr',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dimensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'standard'
);
CREATE TABLE IF NOT EXISTS dimension_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dimension_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id INTEGER,
  order_idx INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_dim_code ON dimension_members(dimension_id, code);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_dimensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL,
  dimension_id INTEGER NOT NULL,
  slot INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_modeldim_slot ON model_dimensions(model_id, slot);
CREATE UNIQUE INDEX IF NOT EXISTS uq_modeldim_dim ON model_dimensions(model_id, dimension_id);
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL,
  d1 TEXT, d2 TEXT, d3 TEXT, d4 TEXT, d5 TEXT, d6 TEXT, d7 TEXT, d8 TEXT,
  value REAL NOT NULL,
  upload_id INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_facts_model ON facts(model_id);
CREATE INDEX IF NOT EXISTS ix_facts_upload ON facts(upload_id);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'done',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  model_id INTEGER NOT NULL,
  definition TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dashboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  definition TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_dim_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  dimension_id INTEGER NOT NULL,
  member_codes TEXT NOT NULL,
  UNIQUE(user_id, dimension_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  cell_key TEXT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  model_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  scope_filters TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  owner_id INTEGER NOT NULL,
  approver_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  reviewed_at TEXT,
  approved_at TEXT,
  locked_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_workflow_model ON workflow_items(model_id);
CREATE INDEX IF NOT EXISTS ix_workflow_status ON workflow_items(status);
CREATE TABLE IF NOT EXISTS workflow_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_workflow_history_wf ON workflow_history(workflow_id);
CREATE TABLE IF NOT EXISTS business_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  model_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  scope_filters TEXT NOT NULL,
  op TEXT NOT NULL,
  value REAL NOT NULL,
  severity TEXT NOT NULL DEFAULT 'block',
  message TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_business_rules_model ON business_rules(model_id);
CREATE TABLE IF NOT EXISTS fact_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL,
  upload_id INTEGER,
  d1 TEXT, d2 TEXT, d3 TEXT, d4 TEXT, d5 TEXT, d6 TEXT, d7 TEXT, d8 TEXT,
  old_value REAL,
  new_value REAL,
  source TEXT NOT NULL DEFAULT 'write',
  user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fact_audit_model ON fact_audit(model_id);
CREATE INDEX IF NOT EXISTS ix_fact_audit_upload ON fact_audit(upload_id);
CREATE TABLE IF NOT EXISTS connector_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS ix_notifications_user_unread ON notifications(user_id, is_read);
CREATE TABLE IF NOT EXISTS scheduled_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  connector_config_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  model_id INTEGER NOT NULL,
  mapping TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_status TEXT,
  last_error TEXT,
  last_inserted INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_scheduled_syncs_active ON scheduled_syncs(active);
`;

sqlite.exec(DDL);

// Coklu-tenant bootstrap: tenants tablosu bombos ise bir "default" tenant
// olusturulur. Bu INSERT, asagidaki ALTER TABLE ... DEFAULT 1 migration'lari
// calismadan ONCE (ayni senkron modul-yukleme sirasinda) yapildigi icin,
// mevcut (eski) veritabanlarindaki tum satirlar icin DEFAULT 1'in gercekten
// gecerli bir tenant'a karsilik gelmesi garanti edilir (yeni tabloda ilk
// INSERT oldugundan AUTOINCREMENT id=1 alir).
const tenantCount = sqlite.prepare("SELECT COUNT(*) AS c FROM tenants").get() as { c: number };
if (tenantCount.c === 0) {
  sqlite
    .prepare("INSERT INTO tenants (code, name, created_at) VALUES (?,?,?)")
    .run("default", "Default", new Date().toISOString());
}

// Sema gecisleri (mevcut veritabanlarina kolon ekleme)
for (const migration of [
  "ALTER TABLE uploads ADD COLUMN replaced_rows TEXT",
  "ALTER TABLE dimensions ADD COLUMN description TEXT",
  "ALTER TABLE dimensions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",
  "ALTER TABLE dimensions ADD COLUMN owner_model_id INTEGER",
  "ALTER TABLE users ADD COLUMN totp_secret TEXT",
  "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN totp_backup_codes TEXT",
  "ALTER TABLE users ADD COLUMN sso_provider TEXT",
  "ALTER TABLE users ADD COLUMN sso_subject TEXT",
  "ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'",
  "ALTER TABLE users ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE models ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE dimensions ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE reports ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE dashboards ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE workflow_items ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE business_rules ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE connector_configs ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE scheduled_syncs ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE reports ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE dashboards ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
]) {
  try {
    sqlite.exec(migration);
  } catch {
    /* kolon zaten var */
  }
}

function seed() {
  const userCount = sqlite.prepare("SELECT COUNT(*) AS c FROM users").get() as {
    c: number;
  };
  if (userCount.c > 0) return;

  const now = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO users (email, name, password_hash, role, locale, created_at) VALUES (?,?,?,?,?,?)"
    )
    .run(
      "admin@planrep.local",
      "Admin",
      bcrypt.hashSync("Admin123!", 10),
      "admin",
      "tr",
      now
    );

  // --- Demo boyutlar ---
  const insDim = sqlite.prepare(
    "INSERT INTO dimensions (code, name, type) VALUES (?,?,?)"
  );
  const insMem = sqlite.prepare(
    "INSERT INTO dimension_members (dimension_id, code, name, parent_id, order_idx) VALUES (?,?,?,?,?)"
  );

  const versionId = Number(insDim.run("VERSION", "Versiyon", "version").lastInsertRowid);
  ["ACTUAL:Gerçekleşen", "BUDGET:Bütçe", "FORECAST:Tahmin"].forEach((s, i) => {
    const [code, name] = s.split(":");
    insMem.run(versionId, code, name, null, i);
  });

  const timeId = Number(insDim.run("TIME", "Zaman", "time").lastInsertRowid);
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  for (const year of [2025, 2026]) {
    const yearRow = insMem.run(timeId, String(year), String(year), null, year);
    for (let m = 1; m <= 12; m++) {
      const code = `${year}-${String(m).padStart(2, "0")}`;
      insMem.run(timeId, code, `${months[m - 1]} ${year}`, Number(yearRow.lastInsertRowid), year * 100 + m);
    }
  }

  const ccId = Number(insDim.run("COSTCENTER", "Masraf Yeri", "standard").lastInsertRowid);
  const ccAll = insMem.run(ccId, "CC_ALL", "Tüm Masraf Yerleri", null, 0);
  ["CC100:Satış", "CC200:Pazarlama", "CC300:BT", "CC400:İnsan Kaynakları", "CC500:Finans"].forEach(
    (s, i) => {
      const [code, name] = s.split(":");
      insMem.run(ccId, code, name, Number(ccAll.lastInsertRowid), i + 1);
    }
  );

  const accId = Number(insDim.run("ACCOUNT", "Hesap", "standard").lastInsertRowid);
  const rev = insMem.run(accId, "REVENUE", "Gelirler", null, 1);
  ["REV_PROD:Ürün Geliri", "REV_SVC:Hizmet Geliri"].forEach((s, i) => {
    const [code, name] = s.split(":");
    insMem.run(accId, code, name, Number(rev.lastInsertRowid), i);
  });
  const opex = insMem.run(accId, "OPEX", "Faaliyet Giderleri", null, 2);
  ["PERSONNEL:Personel Gideri", "TRAVEL:Seyahat", "IT_COST:BT Giderleri", "RENT:Kira", "OTHER:Diğer"].forEach(
    (s, i) => {
      const [code, name] = s.split(":");
      insMem.run(accId, code, name, Number(opex.lastInsertRowid), i);
    }
  );

  // --- Demo model: Örnek P&L (d1=VERSION, d2=TIME, d3=COSTCENTER, d4=ACCOUNT) ---
  const modelRow = sqlite
    .prepare("INSERT INTO models (code, name, description, created_at) VALUES (?,?,?,?)")
    .run("PNL_DEMO", "Örnek P&L", "Demo kar/zarar planlama modeli", now);
  const modelId = Number(modelRow.lastInsertRowid);
  const insMD = sqlite.prepare(
    "INSERT INTO model_dimensions (model_id, dimension_id, slot) VALUES (?,?,?)"
  );
  insMD.run(modelId, versionId, 1);
  insMD.run(modelId, timeId, 2);
  insMD.run(modelId, ccId, 3);
  insMD.run(modelId, accId, 4);

  // --- Demo veriler: yaprak uyeler icin Actual + Budget ---
  const insFact = sqlite.prepare(
    "INSERT INTO facts (model_id, d1, d2, d3, d4, value, upload_id, updated_at) VALUES (?,?,?,?,?,?,NULL,?)"
  );
  const ccs = ["CC100", "CC200", "CC300", "CC400", "CC500"];
  const accounts: Array<[string, number]> = [
    ["REV_PROD", 800000],
    ["REV_SVC", 300000],
    ["PERSONNEL", -350000],
    ["TRAVEL", -25000],
    ["IT_COST", -60000],
    ["RENT", -40000],
    ["OTHER", -15000],
  ];
  const insertMany = sqlite.transaction(() => {
    for (let m = 1; m <= 12; m++) {
      const t = `2025-${String(m).padStart(2, "0")}`;
      for (const cc of ccs) {
        for (const [acc, base] of accounts) {
          const season = 1 + 0.15 * Math.sin((m / 12) * Math.PI * 2);
          const budget = Math.round((base / ccs.length) * season);
          const actual = Math.round(budget * (0.9 + Math.random() * 0.2));
          insFact.run(modelId, "BUDGET", t, cc, acc, budget, now);
          insFact.run(modelId, "ACTUAL", t, cc, acc, actual, now);
        }
      }
    }
  });
  insertMany();
}

seed();

export const db = drizzle(sqlite, { schema });
export { sqlite };
export * from "./schema";
