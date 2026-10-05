"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Member } from "@/lib/pivot";

// Cok secimli, aramali uye secici (acilir panel)
export default function MemberPicker({
  label,
  members,
  selected,
  onChange,
  badge,
}: {
  label: string;
  members: Member[];
  selected: string[];
  onChange: (codes: string[]) => void;
  badge?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const depthOf = useMemo(() => {
    const map = new Map<number, number>();
    function calc(m: Member): number {
      if (map.has(m.id)) return map.get(m.id)!;
      const d = m.parentId != null && byId.has(m.parentId) ? calc(byId.get(m.parentId)!) + 1 : 0;
      map.set(m.id, d);
      return d;
    }
    members.forEach(calc);
    return map;
  }, [members, byId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLocaleLowerCase("tr");
    return members.filter(
      (m) =>
        m.name.toLocaleLowerCase("tr").includes(q) ||
        m.code.toLocaleLowerCase("tr").includes(q)
    );
  }, [members, search]);

  const selSet = new Set(selected);

  function toggle(code: string) {
    if (selSet.has(code)) onChange(selected.filter((c) => c !== code));
    else onChange([...selected, code]);
  }

  const summary =
    selected.length === 0
      ? "Tümü"
      : selected.length <= 2
        ? selected
            .map((c) => members.find((m) => m.code === c)?.name ?? c)
            .join(", ")
        : `${selected.length} üye`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
          selected.length > 0
            ? "border-blue-300 bg-blue-50 text-blue-800"
            : "border-slate-300 bg-white text-slate-700"
        }`}
      >
        {badge && <span className="text-xs text-slate-400">{badge}</span>}
        <span className="font-medium">{label}:</span> {summary}
        <span className="text-xs text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-80 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ara..."
              className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-slate-900"
            />
            <div className="mt-1 flex gap-2 text-xs">
              <button onClick={() => onChange([])} className="text-blue-600 hover:underline">
                Temizle (Tümü)
              </button>
              <button
                onClick={() => onChange(filtered.map((m) => m.code))}
                className="text-blue-600 hover:underline"
              >
                Görünenleri seç
              </button>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                style={{ paddingLeft: 8 + (search ? 0 : (depthOf.get(m.id) ?? 0) * 14) }}
              >
                <input
                  type="checkbox"
                  checked={selSet.has(m.code)}
                  onChange={() => toggle(m.code)}
                />
                <span>{m.name}</span>
                <span className="ml-auto font-mono text-[10px] text-slate-300">{m.code}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="p-3 text-xs text-slate-400">Sonuç yok</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
