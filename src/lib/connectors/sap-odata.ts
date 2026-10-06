import type { Connector, ConnectorResult, ConnectorSource, ConnectorTypeDef } from "./types";

export type SapODataConfig = {
  url: string;
  user: string;
  pass: string;
  entities: string; // virgullu entity listesi
};

function parseEntities(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function authHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

// SAP OData konnektoru: S/4HANA CDS servislerinden okuma. Konfigurasyon artik
// connector_configs tablosundan (DB) geliyor — ortam degiskenleri (SAP_ODATA_URL
// vb.) sadece geriye-donuk uyumluluk/ilk-kurulum migrasyonu icin kullaniliyor
// (bkz. lib/connector-configs.ts seedFromEnv).
function createSapODataConnector(config: Partial<SapODataConfig>): Connector {
  const url = config.url?.trim();
  const user = config.user?.trim();
  const pass = config.pass?.trim();
  const entities = parseEntities(config.entities);

  return {
    id: "sap-odata",
    name: "SAP S/4HANA (OData)",
    async test() {
      if (!url) return "URL tanımlı değil";
      if (!user || !pass) return "Kullanıcı adı / şifre tanımlı değil";
      try {
        const res = await fetch(`${url}/$metadata`, {
          headers: { Authorization: authHeader(user, pass) },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return `SAP yanıtı: HTTP ${res.status}`;
        return null;
      } catch (e) {
        return `Bağlantı hatası: ${e instanceof Error ? e.message : "bilinmeyen"}`;
      }
    },
    async listSources(): Promise<ConnectorSource[]> {
      return entities.map((e) => ({
        id: e,
        name: e,
        description: "OData entity set",
      }));
    },
    async fetchRows(sourceId: string, top?: number): Promise<ConnectorResult> {
      if (!url || !user || !pass) {
        throw new Error("SAP OData yapılandırması eksik");
      }
      const res = await fetch(
        `${url}/${encodeURIComponent(sourceId)}?$format=json&$top=${top ?? 5000}`,
        {
          headers: { Authorization: authHeader(user, pass), Accept: "application/json" },
          signal: AbortSignal.timeout(60000),
        }
      );
      if (!res.ok) throw new Error(`SAP yanıtı: HTTP ${res.status}`);
      const body = (await res.json()) as {
        d?: { results?: Array<Record<string, unknown>> };
        value?: Array<Record<string, unknown>>;
      };
      const raw = body.d?.results ?? body.value ?? [];
      const rows = raw.map((r) => {
        const out: Record<string, string | number> = {};
        for (const [k, v] of Object.entries(r)) {
          if (k.startsWith("__")) continue;
          if (typeof v === "number") out[k] = v;
          else if (typeof v === "string") out[k] = v;
        }
        return out;
      });
      return {
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rows,
        total: rows.length,
      };
    },
  };
}

export const sapODataConnectorType: ConnectorTypeDef = {
  type: "sap-odata",
  label: "SAP S/4HANA (OData)",
  description: "Gerçek bir SAP OData servisine (CDS entity set) bağlanır.",
  configFields: [
    {
      key: "url",
      label: "OData URL",
      type: "text",
      required: true,
      placeholder: "https://host:443/sap/opu/odata/sap/API_X",
    },
    { key: "user", label: "Kullanıcı Adı", type: "text", required: true },
    { key: "pass", label: "Şifre", type: "password", required: true },
    {
      key: "entities",
      label: "Entity Listesi (virgülle ayrılmış)",
      type: "textarea",
      required: true,
      placeholder: "C_GLACCOUNTBALANCE, C_COSTCENTERPLAN",
    },
  ],
  create: (config) => createSapODataConnector(config as Partial<SapODataConfig>),
};

// Geriye donuk uyumluluk: ortam degiskenlerinden tekil ornek (artik
// connector-configs uzerinden dinamik olusturulan ornekler tercih edilmeli).
function configFromEnv(): Partial<SapODataConfig> {
  return {
    url: process.env.SAP_ODATA_URL,
    user: process.env.SAP_USER,
    pass: process.env.SAP_PASS,
    entities: process.env.SAP_ODATA_ENTITIES,
  };
}

export const sapODataConnector: Connector = createSapODataConnector(configFromEnv());
