import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTenantAccessEntries } from "@/lib/access";

// Satir-seviyesi guvenlik denetim ekrani (/admin/access) icin: tenant'in TUM
// kullanicilarinin TUM boyutlardaki erisim kayitlarini tek seferde doner.
// Per-user duzenleme hala /api/users/[id]/access (GET/PUT) uzerinden yapilir
// — bu uc SADECE salt-okunur bir genel bakis saglar.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const entries = getTenantAccessEntries(session.tenantId);
  return NextResponse.json(entries);
}
