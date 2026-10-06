import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { createTenant, getTenantByCode } from "@/lib/tenant";
import { hashPassword, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  tenantCode: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Kod sadece kucuk harf/rakam/tire"),
  tenantName: z.string().min(1).max(120),
  adminName: z.string().min(1).max(120),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(6),
});

// Yeni bir organizasyon (tenant) + o organizasyonun ilk admin kullanicisini
// olusturan self-service kayit akisi. Ayri bir "superadmin" rolu/ekrani
// olmadigindan, coklu-tenant'a giris SADECE bu uctan yapilir — platformu
// isleten kisi tenant'lari manuel olarak DB'ye eklemek zorunda degildir.
// Basarili olursa dogrudan oturum acilir (ekstra bir login adimi gerekmez).
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", detail: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }
  const { tenantCode, tenantName, adminName, adminEmail, adminPassword } = parsed.data;
  const code = tenantCode.toLowerCase();

  if (getTenantByCode(code)) {
    return NextResponse.json({ error: "tenant_code_exists" }, { status: 409 });
  }
  const existingUser = db.select().from(users).where(eq(users.email, adminEmail)).get();
  if (existingUser) {
    return NextResponse.json({ error: "email_exists" }, { status: 409 });
  }

  const tenant = createTenant({ code, name: tenantName });
  const now = new Date().toISOString();
  const admin = db
    .insert(users)
    .values({
      tenantId: tenant.id,
      email: adminEmail,
      name: adminName,
      passwordHash: hashPassword(adminPassword),
      role: "admin",
      locale: "tr",
      createdAt: now,
    })
    .returning()
    .get();

  logAudit(admin.id, "tenant.signup", "tenant", tenant.id, { code, name: tenantName });

  const token = await createSessionToken({
    id: admin.id,
    tenantId: admin.tenantId,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    locale: admin.locale,
  });
  const res = NextResponse.json({ ok: true }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
