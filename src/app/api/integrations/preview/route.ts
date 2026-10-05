import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getConnector } from "@/lib/connectors";

const schema = z.object({
  connector: z.string(),
  source: z.string(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const connector = getConnector(parsed.data.connector);
  if (!connector) return NextResponse.json({ error: "connector_not_found" }, { status: 404 });

  try {
    const result = await connector.fetchRows(parsed.data.source, 20);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", message: e instanceof Error ? e.message : "hata" },
      { status: 502 }
    );
  }
}
