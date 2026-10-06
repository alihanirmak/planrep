"use client";

import { useState } from "react";
import MemberPicker from "@/components/MemberPicker";
import type { Member } from "@/lib/pivot";
import type { TKey } from "@/lib/i18n";

export type AccessDim = { id: number; name: string; members: Member[] };

// Tek bir kullanicinin TUM boyutlardaki veri yetkisini duzenleyen panel.
// `admin/users` (satir ici) ve `admin/access` (denetim matrisi) sayfalari
// arasinda paylasilir — kod tekrarini onlemek icin cikarildi.
export default function DataAccessEditor({
  userId,
  userName,
  dims,
  initialMap,
  t,
  onClose,
  onSaved,
}: {
  userId: number;
  userName: string;
  dims: AccessDim[];
  initialMap: Record<number, string[]>;
  t: (key: TKey) => string;
  onClose: () => void;
  onSaved: (map: Record<number, string[]>) => void;
}) {
  const [map, setMap] = useState<Record<number, string[]>>(initialMap);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setMsg(null);
    const entries = Object.entries(map)
      .map(([dimId, codes]) => ({ dimensionId: Number(dimId), memberCodes: codes }))
      .filter((e) => e.memberCodes.length > 0);
    const res = await fetch(`/api/users/${userId}/access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    setSaving(false);
    if (res.ok) {
      setMsg(`✅ ${t("common.save")}`);
      onSaved(map);
    } else {
      setMsg(t("common.error"));
    }
  }

  return (
    <div className="mt-6 rounded-xl border-2 border-blue-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-700">🔐 {userName}</h2>
        <span className="text-xs text-slate-400">{t("access.editorHint")}</span>
        <button
          onClick={onClose}
          className="ml-auto text-slate-400 hover:text-slate-700"
          aria-label={t("common.cancel")}
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {dims.map((d) => (
          <MemberPicker
            key={d.id}
            label={d.name}
            members={d.members}
            selected={map[d.id] ?? []}
            onChange={(codes) => setMap({ ...map, [d.id]: codes })}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t("common.save")}
        </button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}
