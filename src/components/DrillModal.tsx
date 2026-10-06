"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useEscapeKey, useFocusTrap } from "@/lib/a11y";

type FactRow = Record<string, string | number | null> & {
  id: number;
  value: number;
  updatedAt: string;
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

// Hucre detayi (drill-through): filtreye uyan ham kayitlar
export default function DrillModal({
  modelId,
  filters,
  title,
  onClose,
}: {
  modelId: number;
  filters: Record<string, string[]>;
  title: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<FactRow[]>([]);
  const [dims, setDims] = useState<Array<{ code: string; name: string }>>([]);
  const [names, setNames] = useState<Record<string, Record<string, string>>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>(true);

  useEscapeKey(onClose, true);

  const load = useCallback(
    (p: number) => {
      fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, filters, page: p, pageSize }),
      })
        .then((r) => r.json())
        .then((d) => {
          setRows(d.rows ?? []);
          setDims(d.dims ?? []);
          setNames(d.names ?? {});
          setTotal(d.total ?? 0);
          setPage(p);
        });
    },
    [modelId, filters]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-slate-100 px-5 py-3">
          <div>
            <h3 id={titleId} className="text-sm font-semibold text-slate-800">🔍 Detay Kayıtları</h3>
            <div className="text-xs text-slate-400">{title}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Kapat" className="ml-auto text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                {dims.map((d) => (
                  <th key={d.code} className="px-4 py-2 text-left">
                    {d.name}
                  </th>
                ))}
                <th className="px-4 py-2 text-right">Değer</th>
                <th className="px-4 py-2 text-right">Güncellenme</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rows.map((r) => (
                <tr key={r.id}>
                  {dims.map((d) => (
                    <td key={d.code} className="px-4 py-1.5">
                      {names[d.code]?.[String(r[d.code])] ?? String(r[d.code])}
                    </td>
                  ))}
                  <td
                    className={`px-4 py-1.5 text-right tabular-nums ${
                      r.value < 0 ? "text-red-600" : ""
                    }`}
                  >
                    {nf.format(r.value)}
                  </td>
                  <td className="px-4 py-1.5 text-right text-slate-400">
                    {new Date(r.updatedAt).toLocaleDateString("tr-TR")}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={dims.length + 2} className="px-4 py-6 text-slate-400">
                    Kayıt bulunamadı
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center border-t border-slate-100 px-5 py-2 text-xs text-slate-500">
          Toplam {total} kayıt
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => load(page - 1)}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              ← Önceki
            </button>
            <span className="py-1">
              {page + 1} / {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <button
              type="button"
              disabled={(page + 1) * pageSize >= total}
              onClick={() => load(page + 1)}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              Sonraki →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
