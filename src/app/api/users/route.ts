import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rows = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      locale: users.locale,
      createdAt: users.createdAt,
    })
    .from(users)
    .all();
  return NextResponse.json(rows);
}

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6),
  role: z.enum(["admin", "planner", "viewer"]),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { email, name, password, role } = parsed.data;

  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) {
    return NextResponse.json({ error: "email_exists" }, { status: 409 });
  }

  const inserted = db
    .insert(users)
    .values({
      email,
      name,
      passwordHash: hashPassword(password),
      role,
      locale: "tr",
      createdAt: new Date().toISOString(),
    })
    .returning({ id: users.id })
    .get();

  logAudit(session.id, "user.create", "user", inserted.id, { email, role });
  return NextResponse.json({ id: inserted.id }, { status: 201 });
}
