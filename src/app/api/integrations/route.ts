import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectors } from "@/lib/connectors";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const list = await Promise.all(
    connectors.map(async (c) => ({
      id: c.id,
      name: c.name,
      status: await c.test(),
      sources: await c.listSources().catch(() => []),
    }))
  );
  return NextResponse.json(list);
}
