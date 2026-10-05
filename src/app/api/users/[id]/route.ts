import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users, sqlite } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

function adminCountSync(): number {
  const row = sqlite
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")
    .get() as { c: number };
  return row.c;
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "planner", "viewer"]).optional(),
  password: z.string().min(6).optional(),
  locale: z.enum(["tr", "en"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number((await params).id);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Number.isNaN(id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { name, role, password, locale } = parsed.data;

  // Son admin'in rolu dusurulemez — TOCTOU'yu engellemek icin kontrol ve
  // guncelleme ayni senkron transaction icinde (await yok, yarisma riski yok).
  const txResult = sqlite.transaction(() => {
    if (role && role !== "admin" && target.role === "admin" && adminCountSync() <= 1) {
      return { error: "last_admin" as const };
    }
    db.update(users)
      .set({
        ...(name ? { name } : {}),
        ...(role ? { role } : {}),
        ...(locale ? { locale } : {}),
        ...(password ? { passwordHash: hashPassword(password) } : {}),
      })
      .where(eq(users.id, id))
      .run();
    return { ok: true as const };
  })();

  if ("error" in txResult) {
    return NextResponse.json({ error: txResult.error }, { status: 400 });
  }

  logAudit(session.id, "user.update", "user", id, { name, role, locale, passwordChanged: !!password });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number((await params).id);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (id === session.id) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });
  }

  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Son admin silinemez — kontrol + silme ayni senkron transaction icinde.
  const txResult = sqlite.transaction(() => {
    if (target.role === "admin" && adminCountSync() <= 1) {
      return { error: "last_admin" as const };
    }
    db.delete(users).where(eq(users.id, id)).run();
    return { ok: true as const };
  })();

  if ("error" in txResult) {
    return NextResponse.json({ error: txResult.error }, { status: 400 });
  }

  logAudit(session.id, "user.delete", "user", id, { email: target.email });
  return NextResponse.json({ ok: true });
}
