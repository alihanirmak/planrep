import { sapMockConnector } from "./sap-mock";
import { sapODataConnector } from "./sap-odata";
import type { Connector } from "./types";

export const connectors: Connector[] = [sapMockConnector, sapODataConnector];

export function getConnector(id: string): Connector | undefined {
  return connectors.find((c) => c.id === id);
}

export * from "./types";
