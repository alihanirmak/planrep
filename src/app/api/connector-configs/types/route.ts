import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CONNECTOR_TYPES } from "@/lib/connectors";

// Yeni baglanti olusturma formu icin: desteklenen connector turleri + bu
// turlerin ihtiyac duydugu konfigurasyon alanlari (configFields).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json(
    CONNECTOR_TYPES.map((t) => ({
      type: t.type,
      label: t.label,
      description: t.description,
      configFields: t.configFields,
    }))
  );
}
