import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  getConnectorConfig,
  updateConnectorConfig,
  deleteConnectorConfig,
} from "@/lib/connector-configs";
import { getConnectorInstance } from "@/lib/connectors";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.string()).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const existing = getConnectorConfig(id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  // Kismi config guncellemesi: gonderilen alanlar eskisinin uzerine yazilir,
  // gonderilmeyenler (orn. maskelenmis sifre '••••••••' degistirilmediyse) korunur.
  const mergedConfig = parsed.data.config
    ? { ...existing.config, ...Object.fromEntries(Object.entries(parsed.data.config).filter(([, v]) => v !== "••••••••")) }
    : undefined;

  const updated = updateConnectorConfig(id, { ...parsed.data, config: mergedConfig });
  logAudit(session.id, "connector_config.update", "connector_config", id, {
    name: parsed.data.name,
    active: parsed.data.active,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const existing = getConnectorConfig(id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  deleteConnectorConfig(id);
  logAudit(session.id, "connector_config.delete", "connector_config", id, { name: existing.name });
  return NextResponse.json({ ok: true });
}

// Baglanti testi: canli Connector.test() cagirir (credential dogrulama vb.)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  const instance = getConnectorInstance(id);
  if (!instance) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const status = await instance.connector.test();
  return NextResponse.json({ ok: status == null, message: status });
}
