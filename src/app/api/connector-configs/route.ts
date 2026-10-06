import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { listConnectorConfigs, createConnectorConfig } from "@/lib/connector-configs";
import { getConnectorType } from "@/lib/connectors";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Credential alanlarini (password tipi) response'a dahil etme — sadece
  // UI'nin "configured" gostermesi icin maskelenmis bir ozet dondur.
  const configs = listConnectorConfigs({ tenantId: session.tenantId }).map((c) => {
    const typeDef = getConnectorType(c.type);
    const maskedConfig: Record<string, string> = {};
    for (const field of typeDef?.configFields ?? []) {
      const v = c.config[field.key];
      maskedConfig[field.key] = field.type === "password" ? (v ? "••••••••" : "") : v ?? "";
    }
    return { ...c, config: maskedConfig };
  });
  return NextResponse.json(configs);
}

const createSchema = z.object({
  type: z.enum(["sap-mock", "sap-odata"]),
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.string()).default({}),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const typeDef = getConnectorType(parsed.data.type);
  if (!typeDef) return NextResponse.json({ error: "unknown_type" }, { status: 400 });

  const missing = typeDef.configFields.filter((f) => f.required && !parsed.data.config[f.key]?.trim());
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "missing_fields", fields: missing.map((f) => f.key) },
      { status: 400 }
    );
  }

  const config = createConnectorConfig({ ...parsed.data, tenantId: session.tenantId });
  logAudit(session.id, "connector_config.create", "connector_config", config.id, {
    type: parsed.data.type,
    name: parsed.data.name,
  });
  return NextResponse.json(config, { status: 201 });
}
