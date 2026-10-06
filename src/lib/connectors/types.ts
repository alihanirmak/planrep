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

// --- Dinamik (DB tabanli) connector kayit sistemi ---
//
// Her "tur" (ConnectorTypeDef) kod seviyesinde kayitli bir implementasyondur
// (sap-mock, sap-odata, ...). Gercek baglanti ORNEKLERI (farkli URL/kullanici
// ile birden fazla SAP sistemi gibi) veritabaninda `connector_configs`
// tablosunda saklanir ve calisma zamaninda bu tur tanimlarinin `create()`
// fabrikasiyla somut bir Connector'a donusturulur. Böylece yeni bir baglanti
// eklemek icin kod degisikligi/redeploy gerekmez — sadece admin UI'dan yeni
// bir config kaydi eklenir.
export type ConnectorConfigFieldType = "text" | "password" | "textarea";

export type ConnectorConfigField = {
  key: string;
  label: string;
  type: ConnectorConfigFieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
};

export type ConnectorTypeId = "sap-mock" | "sap-odata";

export type ConnectorTypeDef = {
  type: ConnectorTypeId;
  label: string;
  description: string;
  configFields: ConnectorConfigField[];
  create: (config: Record<string, string>) => Connector;
};
