import { sqlite } from "./db";
import type { ConnectorTypeId } from "./connectors/types";

export type ConnectorConfig = {
  id: number;
  type: ConnectorTypeId;
  name: string;
  config: Record<string, string>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: number;
  type: ConnectorTypeId;
  name: string;
  config: string;
  active: number;
  created_at: string;
  updated_at: string;
};

function mapRow(r: Row): ConnectorConfig {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    config: JSON.parse(r.config),
    active: r.active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listConnectorConfigs(opts?: { activeOnly?: boolean }): ConnectorConfig[] {
  const where = opts?.activeOnly ? " WHERE active = 1" : "";
  const rows = sqlite.prepare(`SELECT * FROM connector_configs${where} ORDER BY id ASC`).all() as Row[];
  return rows.map(mapRow);
}

export function getConnectorConfig(id: number): ConnectorConfig | null {
  const row = sqlite.prepare("SELECT * FROM connector_configs WHERE id = ?").get(id) as Row | undefined;
  return row ? mapRow(row) : null;
}

export function createConnectorConfig(input: {
  type: ConnectorTypeId;
  name: string;
  config: Record<string, string>;
}): ConnectorConfig {
  const now = new Date().toISOString();
  const id = Number(
    sqlite
      .prepare(
        "INSERT INTO connector_configs (type, name, config, active, created_at, updated_at) VALUES (?,?,?,1,?,?)"
      )
      .run(input.type, input.name, JSON.stringify(input.config), now, now).lastInsertRowid
  );
  return getConnectorConfig(id)!;
}

export function updateConnectorConfig(
  id: number,
  patch: Partial<{ name: string; config: Record<string, string>; active: boolean }>
): ConnectorConfig | null {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `UPDATE connector_configs SET
         name = COALESCE(?, name),
         config = COALESCE(?, config),
         active = COALESCE(?, active),
         updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? null,
      patch.config != null ? JSON.stringify(patch.config) : null,
      patch.active != null ? (patch.active ? 1 : 0) : null,
      now,
      id
    );
  return getConnectorConfig(id);
}

export function deleteConnectorConfig(id: number) {
  sqlite.prepare("DELETE FROM connector_configs WHERE id = ?").run(id);
}

// Geriye donuk uyumluluk: eski ortam degiskeni tabanli SAP OData yapilandirmasi
// (SAP_ODATA_URL/SAP_USER/SAP_PASS/SAP_ODATA_ENTITIES) tanimliyse ve henuz
// hicbir connector_configs kaydi yoksa, bunu otomatik olarak bir config
// kaydina donusturur. Boylece .env.local uzerinden calisan mevcut kurulumlar
// yeni dinamik sisteme gectikten sonra da elle yeniden yapilandirma gerektirmez.
export function seedConnectorConfigsFromEnv() {
  const existing = sqlite.prepare("SELECT COUNT(*) AS c FROM connector_configs").get() as { c: number };
  if (existing.c > 0) return;

  const now = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO connector_configs (type, name, config, active, created_at, updated_at) VALUES (?,?,?,1,?,?)"
    )
    .run("sap-mock", "SAP S/4HANA (Mock)", JSON.stringify({}), now, now);

  const url = process.env.SAP_ODATA_URL;
  const user = process.env.SAP_USER;
  const pass = process.env.SAP_PASS;
  const entities = process.env.SAP_ODATA_ENTITIES;
  if (url && user && pass) {
    sqlite
      .prepare(
        "INSERT INTO connector_configs (type, name, config, active, created_at, updated_at) VALUES (?,?,?,1,?,?)"
      )
      .run(
        "sap-odata",
        "SAP S/4HANA (OData)",
        JSON.stringify({ url, user, pass, entities: entities ?? "" }),
        now,
        now
      );
  }
}

// Modul yuklendiginde bir kez calisir (db/index.ts'teki seed() cagrisiyla ayni
// desen). connector-configs.ts -> db/index.ts tek yonlu bagimlilik oldugundan
// (tersi degil) dongusel import riski yok.
seedConnectorConfigsFromEnv();
