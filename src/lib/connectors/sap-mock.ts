import type { Connector, ConnectorResult, ConnectorRow, ConnectorSource } from "./types";

// SAP Mock: gercek baglanti olmadan gelistirme/demo icin ornek SAP verisi.
// Kolon adlari S/4HANA ACDOCA/CDS alan adlarini taklit eder.
const SOURCES: ConnectorSource[] = [
  {
    id: "C_GLACCOUNTBALANCE",
    name: "Ana Defter Bakiyeleri (mock)",
    description: "ACDOCA benzeri masraf yeri/hesap bakiyeleri — 2025 gerçekleşen",
  },
  {
    id: "C_COSTCENTERPLAN",
    name: "Masraf Yeri Plan Verisi (mock)",
    description: "Masraf yeri bazlı 2026 bütçe verisi",
  },
];

const CCS = ["CC100", "CC200", "CC300", "CC400", "CC500"];
const ACCOUNTS: Array<[string, number]> = [
  ["REV_PROD", 165000],
  ["REV_SVC", 61000],
  ["PERSONNEL", -71000],
  ["TRAVEL", -5100],
  ["IT_COST", -12300],
  ["RENT", -8200],
  ["OTHER", -3100],
];

function generate(version: string, year: number): ConnectorRow[] {
  const rows: ConnectorRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const period = `${year}-${String(m).padStart(2, "0")}`;
    for (const cc of CCS) {
      for (const [acc, base] of ACCOUNTS) {
        const season = 1 + 0.12 * Math.sin((m / 12) * Math.PI * 2);
        const noise = 0.92 + Math.random() * 0.16;
        rows.push({
          Ledger: "0L",
          FiscalPeriod: period,
          Version: version,
          CostCenter: cc,
          GLAccount: acc,
          AmountInCompanyCodeCurrency: Math.round(base * season * noise),
        });
      }
    }
  }
  return rows;
}

export const sapMockConnector: Connector = {
  id: "sap-mock",
  name: "SAP S/4HANA (Mock)",
  async test() {
    return null; // her zaman baglanir
  },
  async listSources() {
    return SOURCES;
  },
  async fetchRows(sourceId: string, top?: number): Promise<ConnectorResult> {
    const rows =
      sourceId === "C_GLACCOUNTBALANCE"
        ? generate("ACTUAL", 2025)
        : sourceId === "C_COSTCENTERPLAN"
          ? generate("BUDGET", 2026)
          : [];
    const limited = top != null ? rows.slice(0, top) : rows;
    return {
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows: limited,
      total: rows.length,
    };
  },
};
