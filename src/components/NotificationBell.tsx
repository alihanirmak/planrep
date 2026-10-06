"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getT, type Locale } from "@/lib/i18n";
import { renderNotification, type Notification } from "@/lib/notifications-shared";
import { useEscapeKey, useFocusTrap } from "@/lib/a11y";

const POLL_INTERVAL_MS = 30000;

export default function NotificationBell({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const panelRef = useFocusTrap<HTMLDivElement>(open);
  useEscapeKey(() => setOpen(false), open);
  const aliveRef = useRef(true);

  const load = useCallback(() => {
    fetch("/api/notifications?limit=20")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !aliveRef.current) return;
        setItems(d.items ?? []);
        setUnreadCount(d.unreadCount ?? 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [load]);

  async function handleClick(n: Notification) {
    if (!n.isRead) {
      await fetch(`/api/notifications/${n.id}`, { method: "PATCH" });
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markAllRead" }),
    });
    setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
    setUnreadCount(0);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-label={t("nav.notifications")}
        className="relative rounded-lg px-2 py-1.5 text-lg text-slate-300 hover:bg-slate-800 hover:text-white"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          id="notification-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.notifications")}
          className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold">{t("nav.notifications")}</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-blue-600 hover:underline"
              >
                {t("notif.markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-slate-400">{t("notif.empty")}</div>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={`block w-full border-b border-slate-50 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50 ${
                  n.isRead ? "text-slate-500" : "font-medium text-slate-800"
                }`}
              >
                <span className="mr-1.5">{n.isRead ? "" : "🔵"}</span>
                {renderNotification(n, locale)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
