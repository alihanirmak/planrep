// Bildirim tipleri ve render fonksiyonu — DB bagimliligi YOK (better-sqlite3
// client bundle'a sizmasin diye). Hem server (lib/notifications.ts) hem
// client (components/NotificationBell.tsx) bu dosyayi guvenle import edebilir.
import { getT, formatT, type TKey } from "./i18n";

export type NotificationType =
  | "comment_new"
  | "comment_mention"
  | "workflow_review_needed"
  | "workflow_approved"
  | "workflow_rejected";

export type Notification = {
  id: number;
  userId: number;
  type: NotificationType;
  params: Record<string, string>;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

// Bildirim metnini alicinin locale'ine gore cevirir ({placeholder}'lari
// params ile doldurur). "type" lib/i18n.ts'te ayni adli bir "notif.<type>"
// anahtari olarak tanimli olmalidir.
export function renderNotification(n: Notification, locale: string): string {
  const t = getT(locale);
  const template = t(`notif.${n.type}` as TKey);
  return formatT(template, n.params);
}
