import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listConnectorInstances } from "@/lib/connectors";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const instances = listConnectorInstances();
  const list = await Promise.all(
    instances.map(async (inst) => ({
      id: inst.configId,
      name: inst.name,
      typeLabel: inst.typeLabel,
      status: await inst.connector.test(),
      sources: await inst.connector.listSources().catch(() => []),
    }))
  );
  return NextResponse.json(list);
}
