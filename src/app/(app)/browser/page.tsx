"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MemberPicker from "@/components/MemberPicker";
import type { Member } from "@/lib/pivot";
import { getT, readLocaleClient } from "@/lib/i18n";
import { parseLocaleNumber } from "@/lib/number";
import { useHotkey } from "@/lib/shortcuts";

type Dim = { id: number; code: string; name: string; members: Member[] };
type Model = { id: number; code: string; name: string; dims: Dim[] };
type FactRow = Record<string, string | number | null> & {
  id: number;
  value: number;
  uploadId: number | null;
  updatedAt: string;
};

// Hucre-bazli undo/redo yigini: sadece bu sayfa oturumunda yapilan
// duzenlemeleri tutar (sayfa degisince/model-filtre degisince sifirlanir).
// Her giris, duzenlemenin urettigi fact_audit kaydinin id'sidir — gercek
// deger geri yukleme mantigi SUNUCUDA (rollbackFactAudit) yasar, istemci
// sadece hangi denetim kaydinin geri alinacagini zincirler (bkz.
// lib/fact-audit.ts rollbackFactAudit dokumantasyonu: her rollback cagrisi
// kendi basina YENI bir kayit uretir, bu yuzden "redo" = o yeni kaydin
// rollback'i).
type UndoEntry = { auditId: number };

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const PAGE_SIZE = 50;

export default function BrowserPage() {
  const t = getT(readLocaleClient());
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<FactRow[]>([]);
  const [names, setNames] = useState<Record<string, Record<string, string>>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [role, setRole] = useState<string>("viewer");
  const [msg, setMsg] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);

  const model = useMemo(() => models.find((m) => m.id === modelId) ?? null, [models, modelId]);
  const canEdit = role !== "viewer";

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: Model[]) => {
        setModels(list);
        if (list.length > 0) setModelId(list[0].id);
      });
    fetch("/api/me")
      .then((r) => r.json())
      .then((me) => setRole(me.role ?? "viewer"));
  }, []);

  const load = useCallback(
    (p: number) => {
      if (modelId == null) return;
      fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, filters, page: p, pageSize: PAGE_SIZE }),
      })
        .then((r) => r.json())
        .then((d) => {
          setRows(d.rows ?? []);
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

  // Model veya filtre degistiginde undo/redo yiginini sifirlar. React'in
  // resmi "adjusting state during render" deseni kullanilir (useState ile
  // onceki anahtari saklamak + render icinde kosullu setState) — bir effect
  // icinde senkron setState'den kaynaklanan React Compiler kuralini ihlal
  // etmez; useRef render sirasinda okunamadigindan (ayni kural) burada
  // KASITLI OLARAK useState kullanildi.
  const scopeKey = `${modelId}:${JSON.stringify(filters)}`;
  const [prevScopeKey, setPrevScopeKey] = useState(scopeKey);
  if (scopeKey !== prevScopeKey) {
    setPrevScopeKey(scopeKey);
    setUndoStack([]);
    setRedoStack([]);
  }

  async function deleteSlice() {
    if (modelId == null) return;
    const hasFilter = Object.values(filters).some((v) => v.length > 0);
    if (!hasFilter) {
      setMsg("Silmek için en az bir filtre seçmelisin (tüm modeli silmek engellenmiştir)");
      return;
    }
    if (!confirm(`Filtreye uyan ${total} kayıt kalıcı olarak silinsin mi?`)) return;
    const res = await fetch("/api/facts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId, filters }),
    });
    const body = await res.json().catch(() => ({}));
    setMsg(res.ok ? `🗑 ${body.deleted} kayıt silindi` : "Silme başarısız");
    load(0);
  }

  function startEdit(r: FactRow) {
    if (!canEdit) return;
    setEditingId(r.id);
    setDraft(String(r.value));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  async function commitEdit(r: FactRow) {
    const num = parseLocaleNumber(draft);
    if (Number.isNaN(num)) {
      setMsg(t("pg.browser.editFailed"));
      cancelEdit();
      return;
    }
    if (num === r.value) {
      cancelEdit();
      return;
    }
    const res = await fetch(`/api/facts/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: num }),
    });
    const body = await res.json().catch(() => ({}));
    cancelEdit();
    if (res.ok && body.auditId != null) {
      setUndoStack((s) => [...s, { auditId: body.auditId }]);
      setRedoStack([]);
      setMsg(t("pg.browser.editSaved"));
      load(page);
    } else if (res.status === 423) {
      setMsg(`🔒 ${body.message ?? "Veri kilitli"}`);
    } else {
      setMsg(body.message ?? body.error ?? t("pg.browser.editFailed"));
    }
  }

  // undo/redo asagida PLAIN fonksiyon olarak tanimlı; useCallback KASITLI
  // OLARAK kullanilmadi — `t` her render'da yeni bir fonksiyon referansi
  // oldugundan (getT(...) her cagrida yeni closure uretir) bagimlilik
  // dizisine girince React Compiler'in memoization'i koruyamamasina
  // sebep oluyordu (bkz. reports/dashboards sayfalarindaki ayni karar:
  // save()/run() de plain fonksiyon, useCallback degil). useHotkey zaten
  // her render'da handler'i yeniden baglayip eski dinleyiciyi kaldiriyor,
  // bu ucuz bir islem (sadece addEventListener/removeEventListener).
  async function undo() {
    if (undoStack.length === 0) {
      setMsg(t("pg.browser.nothingToUndo"));
      return;
    }
    const target = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    const res = await fetch(`/api/fact-audit/${target.auditId}/rollback`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.entry?.id != null) {
      setRedoStack([...redoStack, { auditId: body.entry.id }]);
      setMsg(t("pg.browser.undoDone"));
      load(page);
    } else {
      setMsg(body.message ?? body.error ?? t("pg.browser.editFailed"));
    }
  }

  async function redo() {
    if (redoStack.length === 0) {
      setMsg(t("pg.browser.nothingToRedo"));
      return;
    }
    const target = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    const res = await fetch(`/api/fact-audit/${target.auditId}/rollback`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.entry?.id != null) {
      setUndoStack([...undoStack, { auditId: body.entry.id }]);
      setMsg(t("pg.browser.redoDone"));
      load(page);
    } else {
      setMsg(body.message ?? body.error ?? t("pg.browser.editFailed"));
    }
  }

  useHotkey({ key: "z", mod: true }, () => void undo(), canEdit);
  useHotkey({ key: "z", mod: true, shift: true }, () => void redo(), canEdit);
  useHotkey({ key: "y", mod: true }, () => void redo(), canEdit);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{t("nav.browser")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("pg.browser.sub")}</p>
      {canEdit && <p className="mt-1 text-xs text-slate-400">{t("pg.browser.editHint")}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-white p-4 shadow-sm">
        <label className="flex flex-col text-xs text-slate-500">
          Model
          <select
            value={modelId ?? ""}
            onChange={(e) => {
              setModelId(Number(e.target.value));
              setFilters({});
            }}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {model?.dims.map((d) => (
          <MemberPicker
            key={d.code}
            label={d.name}
            members={d.members}
            selected={filters[d.code] ?? []}
            onChange={(codes) => setFilters({ ...filters, [d.code]: codes })}
          />
        ))}
        {role !== "viewer" && (
          <button
            onClick={deleteSlice}
            className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            {t("pg.browser.deleteSlice")}
          </button>
        )}
      </div>
      {msg && <div className="mt-2 text-sm text-slate-500">{msg}</div>}

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {model?.dims.map((d) => (
                <th key={d.code} className="px-4 py-2.5 text-left">
                  {d.name}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right">Değer</th>
              <th className="px-4 py-2.5 text-right">Yükleme</th>
              <th className="px-4 py-2.5 text-right">Güncellenme</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {rows.map((r) => (
              <tr key={r.id}>
                {model?.dims.map((d) => (
                  <td key={d.code} className="whitespace-nowrap px-4 py-1.5">
                    {names[d.code]?.[String(r[d.code])] ?? String(r[d.code])}
                    <span className="ml-1.5 font-mono text-[10px] text-slate-300">
                      {String(r[d.code])}
                    </span>
                  </td>
                ))}
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {editingId === r.id ? (
                    <input
                      autoFocus
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitEdit(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(r);
                        else if (e.key === "Escape") cancelEdit();
                      }}
                      className="w-28 rounded border border-blue-300 px-2 py-0.5 text-right text-sm text-slate-900 outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => startEdit(r)}
                      className={`tabular-nums ${r.value < 0 ? "text-red-600" : ""} ${
                        canEdit ? "rounded px-1 hover:bg-blue-50" : ""
                      }`}
                    >
                      {nf.format(r.value)}
                    </button>
                  )}
                </td>
                <td className="px-4 py-1.5 text-right text-xs text-slate-400">
                  {r.uploadId != null ? `#${r.uploadId}` : "—"}
                </td>
                <td className="px-4 py-1.5 text-right text-xs text-slate-400">
                  {new Date(r.updatedAt).toLocaleString("tr-TR")}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={(model?.dims.length ?? 0) + 3} className="px-4 py-8 text-center text-sm text-slate-400">
                  Kayıt bulunamadı
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center text-sm text-slate-500">
        Toplam {nf.format(total)} kayıt
        <div className="ml-auto flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => load(page - 1)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            ← Önceki
          </button>
          <span className="py-1.5">
            {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => load(page + 1)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Sonraki →
          </button>
        </div>
      </div>
    </div>
  );
}
