"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getT, readLocaleClient, type TKey } from "@/lib/i18n";

type WorkflowStatus = "draft" | "submitted" | "in_review" | "approved" | "rejected" | "locked";
type WorkflowAction = "submit" | "review" | "approve" | "reject" | "lock" | "reopen";

type HistoryEntry = {
  id: number;
  fromStatus: WorkflowStatus | null;
  toStatus: WorkflowStatus;
  userId: number;
  comment: string | null;
  createdAt: string;
};

type WorkflowDetail = {
  id: number;
  modelId: number;
  name: string;
  scopeFilters: Record<string, string[]>;
  status: WorkflowStatus;
  ownerId: number;
  approverId: number | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  history: HistoryEntry[];
};

const STATUS_COLOR: Record<WorkflowStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  submitted: "bg-blue-100 text-blue-700",
  in_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  locked: "bg-purple-100 text-purple-700",
};

const NEXT_ACTIONS: Record<WorkflowStatus, WorkflowAction[]> = {
  draft: ["submit"],
  submitted: ["review", "reject"],
  in_review: ["approve", "reject"],
  approved: ["lock"],
  rejected: ["submit"],
  locked: ["reopen"],
};

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = getT(readLocaleClient());
  const [item, setItem] = useState<WorkflowDetail | null>(null);
  const [role, setRole] = useState("viewer");
  const [userId, setUserId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/workflow/${id}`).then((r) => (r.ok ? r.json() : null)).then(setItem);
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/me")
      .then((r) => r.json())
      .then((me) => {
        setRole(me.role ?? "viewer");
        setUserId(me.id ?? null);
      });
  }, [load]);

  async function act(action: WorkflowAction) {
    setMsg(null);
    const res = await fetch(`/api/workflow/${id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, comment: comment.trim() || null }),
    });
    if (res.ok) {
      setComment("");
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setMsg(
        body.error === "comment_required"
          ? "Bu işlem için yorum zorunlu"
          : body.error === "forbidden"
            ? "Bu işlem için yetkiniz yok"
            : "İşlem başarısız"
      );
    }
  }

  async function removeItem() {
    if (!item) return;
    if (!confirm(`"${item.name}" silinsin mi?`)) return;
    const res = await fetch(`/api/workflow/${item.id}`, { method: "DELETE" });
    if (res.ok) router.push("/workflow");
  }

  if (!item) {
    return <div className="text-sm text-slate-400">{t("common.loading")}</div>;
  }

  const actions = NEXT_ACTIONS[item.status];
  const canAct = role === "admin" || userId === item.ownerId || userId === item.approverId;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Link href="/workflow" className="hover:text-blue-600">
          {t("nav.workflow")}
        </Link>
        <span>›</span>
        <span className="text-slate-600">{item.name}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-800">{item.name}</h1>
        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[item.status]}`}>
          {t(`wf.status.${item.status}` as TKey)}
        </span>
        {item.status === "draft" && (role === "admin" || role !== "viewer") && (
          <button
            onClick={removeItem}
            className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
          >
            Sil
          </button>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Kapsam</h2>
          {Object.keys(item.scopeFilters).length === 0 ? (
            <div className="text-sm text-slate-400">Kısıt yok (modelin tüm verisi)</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(item.scopeFilters).map(([dim, codes]) => (
                <span key={dim} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  <span className="font-semibold">{dim}:</span>{" "}
                  {codes.length === 0 ? "Tümü" : codes.join(", ")}
                </span>
              ))}
            </div>
          )}

          {actions.length > 0 && canAct && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">İşlem</h2>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Yorum (reddet/yeniden aç için zorunlu)"
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                rows={2}
              />
              <div className="flex flex-wrap gap-2">
                {actions.map((action) => (
                  <button
                    key={action}
                    onClick={() => act(action)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      action === "reject"
                        ? "bg-red-50 text-red-600 hover:bg-red-100"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {t(`wf.action.${action}` as TKey)}
                  </button>
                ))}
              </div>
              {msg && <div className="mt-2 text-sm text-red-500">{msg}</div>}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Geçmiş</h2>
          <div className="space-y-2">
            {item.history.map((h) => (
              <div key={h.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                <div className="text-slate-700">
                  {h.fromStatus ? `${t(`wf.status.${h.fromStatus}` as TKey)} → ` : ""}
                  <span className="font-medium">{t(`wf.status.${h.toStatus}` as TKey)}</span>
                </div>
                <div className="text-xs text-slate-400">{new Date(h.createdAt).toLocaleString("tr-TR")}</div>
                {h.comment && <div className="mt-0.5 text-xs text-slate-500">💬 {h.comment}</div>}
              </div>
            ))}
            {item.history.length === 0 && (
              <div className="text-sm text-slate-400">Henüz işlem yapılmadı (taslak)</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
