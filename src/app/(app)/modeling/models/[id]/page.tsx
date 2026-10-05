"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type ModelDetail = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  createdAt: string;
  dims: Array<{
    id: number;
    code: string;
    name: string;
    type: string;
    visibility: string;
    slot: number;
    memberCount: number;
  }>;
  factCount: number;
  reportCount: number;
  uploads: Array<{
    id: number;
    filename: string;
    rowCount: number;
    status: string;
    createdAt: string;
    userName: string | null;
  }>;
};

const TYPE_ICON: Record<string, string> = { standard: "❖", time: "📅", version: "🏷" };
const nf = new Intl.NumberFormat("tr-TR");

export default function ModelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [role, setRole] = useState("viewer");

  const load = useCallback(() => {
    fetch(`/api/models/${id}`).then((r) => (r.ok ? r.json() : null)).then(setModel);
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/me").then((r) => r.json()).then((me) => setRole(me.role ?? "viewer"));
  }, [load]);

  async function removeModel() {
    if (!model) return;
    if (!confirm(`"${model.name}" modeli, verileri ve raporlarıyla birlikte silinsin mi?`)) return;
    const res = await fetch(`/api/models/${model.id}`, { method: "DELETE" });
    if (res.ok) router.push("/modeling");
  }

  if (!model) {
    return <div className="text-sm text-slate-400">Yükleniyor...</div>;
  }

  return (
    <div>
      {/* Kirinti + baslik */}
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Link href="/modeling" className="hover:text-blue-600">
          Modelleme
        </Link>
        <span>›</span>
        <span className="text-slate-600">{model.name}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-800">🧊 {model.name}</h1>
        <span className="font-mono text-xs text-slate-400">{model.code}</span>
        {role === "admin" && (
          <button
            onClick={removeModel}
            className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
          >
            Modeli sil
          </button>
        )}
      </div>
      {model.description && <p className="mt-1 text-sm text-slate-500">{model.description}</p>}

      {/* Ozet kartlar */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Boyut", model.dims.length, null],
          ["Veri Kaydı", nf.format(model.factCount), "/browser"],
          ["Rapor", model.reportCount, "/reports"],
          ["Oluşturulma", new Date(model.createdAt).toLocaleDateString("tr-TR"), null],
        ].map(([label, value, href], i) => {
          const inner = (
            <div className="rounded-xl bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xl font-bold text-slate-800">{value as string}</div>
              <div className="text-xs text-slate-400">{label as string}</div>
            </div>
          );
          return href ? (
            <Link key={i} href={href as string}>
              {inner}
            </Link>
          ) : (
            <div key={i}>{inner}</div>
          );
        })}
      </div>

      {/* Boyutlar */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Model Boyutları
      </h2>
      <div className="mt-2 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-14 px-5 py-2.5 text-left">Slot</th>
              <th className="px-5 py-2.5 text-left">Boyut</th>
              <th className="px-5 py-2.5 text-left">Tip</th>
              <th className="px-5 py-2.5 text-left">Görünürlük</th>
              <th className="px-5 py-2.5 text-right">Üye</th>
              <th className="px-5 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {model.dims.map((d) => (
              <tr
                key={d.id}
                onClick={() => router.push(`/modeling/dimensions/${d.id}`)}
                className="cursor-pointer hover:bg-blue-50/50"
              >
                <td className="px-5 py-3 font-mono text-xs text-slate-400">d{d.slot}</td>
                <td className="px-5 py-3 font-medium">
                  {TYPE_ICON[d.type] ?? "❖"} {d.name}
                  <span className="ml-2 font-mono text-xs font-normal text-slate-400">{d.code}</span>
                </td>
                <td className="px-5 py-3 text-xs">{d.type}</td>
                <td className="px-5 py-3 text-xs">
                  {d.visibility === "private" ? "🔒 Private" : "🌐 Public"}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{d.memberCount}</td>
                <td className="px-5 py-3 text-right text-slate-300">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Son yuklemeler */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Son Yüklemeler
      </h2>
      <div className="mt-2 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {model.uploads.map((u) => (
              <tr key={u.id}>
                <td className="px-5 py-2.5">{u.filename}</td>
                <td className="px-5 py-2.5 text-xs text-slate-400">{u.userName}</td>
                <td className="px-5 py-2.5 text-right text-xs tabular-nums">{u.rowCount} satır</td>
                <td className="px-5 py-2.5 text-right">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      u.status === "done"
                        ? "bg-green-100 text-green-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {u.status === "done" ? "yüklendi" : "geri alındı"}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right text-xs text-slate-400">
                  {new Date(u.createdAt).toLocaleString("tr-TR")}
                </td>
              </tr>
            ))}
            {model.uploads.length === 0 && (
              <tr>
                <td className="px-5 py-5 text-sm text-slate-400">
                  Henüz yükleme yok — <Link href="/upload" className="text-blue-500 hover:underline">Veri Yükleme</Link> veya{" "}
                  <Link href="/integrations" className="text-blue-500 hover:underline">Entegrasyonlar</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
