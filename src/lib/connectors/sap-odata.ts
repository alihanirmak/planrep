import type { Connector, ConnectorResult, ConnectorSource } from "./types";

// SAP OData konnektoru: S/4HANA CDS servislerinden okuma.
// Ortam degiskenleri: SAP_ODATA_URL (ör. https://host:443/sap/opu/odata/sap/API_X),
// SAP_USER, SAP_PASS, SAP_ODATA_ENTITIES (virgullu entity listesi).
function config() {
  return {
    url: process.env.SAP_ODATA_URL,
    user: process.env.SAP_USER,
    pass: process.env.SAP_PASS,
    entities: (process.env.SAP_ODATA_ENTITIES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

function authHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export const sapODataConnector: Connector = {
  id: "sap-odata",
  name: "SAP S/4HANA (OData)",
  async test() {
    const c = config();
    if (!c.url) return "SAP_ODATA_URL tanımlı değil (.env.local)";
    if (!c.user || !c.pass) return "SAP_USER / SAP_PASS tanımlı değil";
    try {
      const res = await fetch(`${c.url}/$metadata`, {
        headers: { Authorization: authHeader(c.user, c.pass) },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return `SAP yanıtı: HTTP ${res.status}`;
      return null;
    } catch (e) {
      return `Bağlantı hatası: ${e instanceof Error ? e.message : "bilinmeyen"}`;
    }
  },
  async listSources(): Promise<ConnectorSource[]> {
    const c = config();
    return c.entities.map((e) => ({
      id: e,
      name: e,
      description: "OData entity set",
    }));
  },
  async fetchRows(sourceId: string, top?: number): Promise<ConnectorResult> {
    const c = config();
    if (!c.url || !c.user || !c.pass) {
      throw new Error("SAP OData yapılandırması eksik");
    }
    const res = await fetch(
      `${c.url}/${encodeURIComponent(sourceId)}?$format=json&$top=${top ?? 5000}`,
      {
        headers: { Authorization: authHeader(c.user, c.pass), Accept: "application/json" },
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
