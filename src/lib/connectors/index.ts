import { sapMockConnectorType } from "./sap-mock";
import { sapODataConnectorType } from "./sap-odata";
import type { Connector, ConnectorTypeDef, ConnectorTypeId } from "./types";
import { listConnectorConfigs, getConnectorConfig } from "../connector-configs";

// Kod-seviyesinde kayitli connector TURLERI (implementasyonlar). Gercek
// baglanti ORNEKLERI (farkli isim/credential ile) artik veritabaninda
// connector_configs tablosunda saklanir — yeni bir baglanti eklemek icin
// kod degisikligi/redeploy gerekmez.
export const CONNECTOR_TYPES: ConnectorTypeDef[] = [sapMockConnectorType, sapODataConnectorType];

export function getConnectorType(type: string): ConnectorTypeDef | undefined {
  return CONNECTOR_TYPES.find((t) => t.type === type);
}

export type ConnectorInstance = {
  configId: number;
  name: string;
  typeLabel: string;
  connector: Connector;
};

function instantiate(configId: number, type: ConnectorTypeId, name: string, config: Record<string, string>): ConnectorInstance | null {
  const typeDef = getConnectorType(type);
  if (!typeDef) return null;
  return { configId, name, typeLabel: typeDef.label, connector: typeDef.create(config) };
}

// Aktif tum connector_configs kayitlarini canli Connector orneklerine cevirir.
export function listConnectorInstances(): ConnectorInstance[] {
  const configs = listConnectorConfigs({ activeOnly: true });
  const out: ConnectorInstance[] = [];
  for (const cfg of configs) {
    const inst = instantiate(cfg.id, cfg.type, cfg.name, cfg.config);
    if (inst) out.push(inst);
  }
  return out;
}

// Tek bir connector_config id'sinden canli Connector orneği uretir (preview/import ucu icin).
export function getConnectorInstance(configId: number): ConnectorInstance | null {
  const cfg = getConnectorConfig(configId);
  if (!cfg || !cfg.active) return null;
  return instantiate(cfg.id, cfg.type, cfg.name, cfg.config);
}

export * from "./types";
