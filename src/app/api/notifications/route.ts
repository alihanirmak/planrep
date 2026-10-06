import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { listNotifications, countUnreadNotifications, markAllNotificationsRead } from "@/lib/notifications";

const postSchema = z.object({ action: z.literal("markAllRead") });

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "1";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const items = listNotifications(session.id, { unreadOnly, limit });
  const unreadCount = countUnreadNotifications(session.id);
  return NextResponse.json({ items, unreadCount });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const updated = markAllNotificationsRead(session.id);
  return NextResponse.json({ updated });
}
