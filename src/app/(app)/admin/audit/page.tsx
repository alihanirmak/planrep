import Link from "next/link";
import { sqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

type AuditRow = {
  id: number;
  action: string;
  entity: string | null;
  entity_id: string | null;
  detail: string | null;
  created_at: string;
  user_name: string | null;
};

export default function AuditPage() {
  const rows = sqlite
    .prepare(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC LIMIT 200`
    )
    .all() as AuditRow[];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Denetim Kaydı</h1>
        <Link
          href="/admin/audit/cells"
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          🔍 Hücre Bazlı Denetim
        </Link>
      </div>
      <div className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3">Zaman</th>
              <th className="px-5 py-3">Kullanıcı</th>
              <th className="px-5 py-3">İşlem</th>
              <th className="px-5 py-3">Nesne</th>
              <th className="px-5 py-3">Detay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-5 py-2 text-xs text-slate-400">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-5 py-2">{r.user_name ?? "—"}</td>
                <td className="px-5 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-5 py-2 text-xs">
                  {r.entity ? `${r.entity} #${r.entity_id}` : "—"}
                </td>
                <td className="max-w-xs truncate px-5 py-2 text-xs text-slate-400">
                  {r.detail ?? ""}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-sm text-slate-400" colSpan={5}>
                  Henüz kayıt yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
