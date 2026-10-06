import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listNotifications, countUnreadNotifications, markAllNotificationsRead } from "@/lib/notifications";

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

  const body = await req.json().catch(() => null);
  if (body?.action !== "markAllRead") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const updated = markAllNotificationsRead(session.id);
  return NextResponse.json({ updated });
}
