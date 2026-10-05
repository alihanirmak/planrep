// Konnektor arayuzu: SAP (mock/OData) ve gelecekteki kaynaklar bunu uygular
export type ConnectorSource = {
  id: string;
  name: string;
  description: string;
};

export type ConnectorRow = Record<string, string | number>;

export type ConnectorResult = {
  columns: string[];
  rows: ConnectorRow[];
  total: number;
};

export interface Connector {
  id: string;
  name: string;
  /** Baglanti kontrolu; hata mesaji veya null */
  test(): Promise<string | null>;
  listSources(): Promise<ConnectorSource[]>;
  fetchRows(sourceId: string, top?: number): Promise<ConnectorResult>;
}
