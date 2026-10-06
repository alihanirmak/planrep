import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getConnectorInstance } from "@/lib/connectors";
import { getServerT } from "@/lib/i18n-server";

const schema = z.object({
  connector: z.number().int(),
  source: z.string(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const instance = getConnectorInstance(parsed.data.connector, session.tenantId);
  if (!instance) return NextResponse.json({ error: "connector_not_found" }, { status: 404 });

  try {
    const result = await instance.connector.fetchRows(parsed.data.source, 20);
    return NextResponse.json(result);
  } catch (e) {
    const { t } = await getServerT();
    return NextResponse.json(
      { error: "fetch_failed", message: e instanceof Error ? e.message : t("err.generic") },
      { status: 502 }
    );
  }
}
