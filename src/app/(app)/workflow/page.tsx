"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MemberPicker from "@/components/MemberPicker";
import type { Member } from "@/lib/pivot";
import { getT, readLocaleClient, type TKey } from "@/lib/i18n";

type Dim = { id: number; code: string; name: string; members: Member[] };
type Model = { id: number; code: string; name: string; dims: Dim[] };

type WorkflowStatus = "draft" | "submitted" | "in_review" | "approved" | "rejected" | "locked";

type WorkflowRow = {
  id: number;
  modelId: number;
  name: string;
  status: WorkflowStatus;
  scopeFilters: Record<string, string[]>;
  ownerName: string | null;
  approverName: string | null;
  updatedAt: string;
};

const STATUS_COLOR: Record<WorkflowStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  submitted: "bg-blue-100 text-blue-700",
  in_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  locked: "bg-purple-100 text-purple-700",
};

export default function WorkflowListPage() {
  const t = getT(readLocaleClient());
  const [models, setModels] = useState<Model[]>([]);
  const [items, setItems] = useState<WorkflowRow[]>([]);
  const [role, setRole] = useState("viewer");
  const [showNew, setShowNew] = useState(false);
  const [modelId, setModelId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [scopeFilters, setScopeFilters] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const model = useMemo(() => models.find((m) => m.id === modelId) ?? null, [models, modelId]);

  const load = useCallback(() => {
    fetch("/api/workflow")
      .then((r) => (r.ok ? r.json() : []))
      .then(setItems);
  }, []);

  useEffect(() => {
    load();
    fetch("/api/models").then((r) => r.json()).then((list: Model[]) => {
      setModels(list);
      if (list.length > 0) setModelId(list[0].id);
    });
    fetch("/api/me").then((r) => r.json()).then((me) => setRole(me.role ?? "viewer"));
  }, [load]);

  async function createItem() {
    if (!modelId || !name.trim()) return;
    const res = await fetch("/api/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId, name, scopeFilters }),
    });
    if (res.ok) {
      setShowNew(false);
      setName("");
      setScopeFilters({});
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setMsg(body.detail ?? body.error ?? "Oluşturma başarısız");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("nav.workflow")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("pg.workflow.sub")}</p>
        </div>
        {role !== "viewer" && (
          <button
            onClick={() => setShowNew(!showNew)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t("pg.workflow.new")}
          </button>
        )}
      </div>

      {showNew && (
        <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              {t("pg.workflow.model")}
              <select
                value={modelId ?? ""}
                onChange={(e) => {
                  setModelId(Number(e.target.value));
                  setScopeFilters({});
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
            <label className="flex flex-col text-xs text-slate-500">
              {t("pg.workflow.name")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="örn. 2026 Bütçe - Satış Masraf Yeri"
                className="mt-1 w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            {model?.dims.map((d) => (
              <MemberPicker
                key={d.code}
                label={d.name}
                members={d.members}
                selected={scopeFilters[d.code] ?? []}
                onChange={(codes) => setScopeFilters({ ...scopeFilters, [d.code]: codes })}
              />
            ))}
            <button
              onClick={createItem}
              className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t("pg.workflow.create")}
            </button>
          </div>
          {msg && <div className="mt-2 text-sm text-red-500">{msg}</div>}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-2.5 text-left">{t("pg.workflow.name")}</th>
              <th className="px-5 py-2.5 text-left">{t("pg.workflow.status")}</th>
              <th className="px-5 py-2.5 text-left">{t("pg.workflow.owner")}</th>
              <th className="px-5 py-2.5 text-left">{t("pg.workflow.approver")}</th>
              <th className="px-5 py-2.5 text-right">Güncellenme</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {items.map((item) => (
              <tr key={item.id} className="cursor-pointer hover:bg-blue-50/50">
                <td className="px-5 py-3">
                  <Link href={`/workflow/${item.id}`} className="font-medium text-slate-800 hover:text-blue-600">
                    {item.name}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[item.status]}`}>
                    {t(`wf.status.${item.status}` as TKey)}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs text-slate-500">{item.ownerName ?? "—"}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{item.approverName ?? "—"}</td>
                <td className="px-5 py-3 text-right text-xs text-slate-400">
                  {new Date(item.updatedAt).toLocaleString("tr-TR")}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">
                  Henüz iş akışı yok
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
