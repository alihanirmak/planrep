"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type Member = { id: number; code: string; name: string; parentId: number | null; orderIdx: number };
type DimDetail = {
  id: number;
  code: string;
  name: string;
  type: string;
  description: string | null;
  visibility: "public" | "private";
  ownerModelName: string | null;
  members: Member[];
  usedIn: Array<{ id: number; name: string; code: string; slot: number }>;
};

const TYPE_LABEL: Record<string, string> = { standard: "Standart", time: "Zaman", version: "Versiyon" };

export default function DimensionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [dim, setDim] = useState<DimDetail | null>(null);
  const [role, setRole] = useState("viewer");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState({ code: "", name: "", parentCode: "" });
  const [meta, setMeta] = useState({ name: "", description: "", visibility: "public" as "public" | "private" });

  const canEdit = role !== "viewer";

  const load = useCallback(() => {
    fetch(`/api/dimensions/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DimDetail | null) => {
        setDim(d);
        if (d) setMeta({ name: d.name, description: d.description ?? "", visibility: d.visibility });
      });
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/me").then((r) => r.json()).then((me) => setRole(me.role ?? "viewer"));
  }, [load]);

  const byId = useMemo(() => new Map((dim?.members ?? []).map((m) => [m.id, m])), [dim]);
  const depthOf = useMemo(() => {
    const map = new Map<number, number>();
    function calc(m: Member): number {
      if (map.has(m.id)) return map.get(m.id)!;
      const d = m.parentId != null && byId.has(m.parentId) ? calc(byId.get(m.parentId)!) + 1 : 0;
      map.set(m.id, d);
      return d;
    }
    dim?.members.forEach(calc);
    return map;
  }, [dim, byId]);

  // Hiyerarsik sirali liste (DFS)
  const ordered = useMemo(() => {
    if (!dim) return [];
    const children = new Map<number | null, Member[]>();
    for (const m of dim.members) {
      const key = m.parentId != null && byId.has(m.parentId) ? m.parentId : null;
      const arr = children.get(key) ?? [];
      arr.push(m);
      children.set(key, arr);
    }
    for (const arr of children.values()) arr.sort((a, b) => a.orderIdx - b.orderIdx || a.id - b.id);
    const out: Member[] = [];
    function walk(list: Member[]) {
      for (const m of list) {
        out.push(m);
        walk(children.get(m.id) ?? []);
      }
    }
    walk(children.get(null) ?? []);
    return out;
  }, [dim, byId]);

  const visible = useMemo(() => {
    if (!search.trim()) return ordered;
    const q = search.toLocaleLowerCase("tr");
    return ordered.filter(
      (m) => m.name.toLocaleLowerCase("tr").includes(q) || m.code.toLocaleLowerCase("tr").includes(q)
    );
  }, [ordered, search]);

  async function api(url: string, body: unknown, method = "POST") {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setMsg(`⚠ ${b.message ?? b.error ?? "İşlem başarısız"}`);
    } else setMsg(null);
    load();
    return res.ok;
  }

  async function addMember() {
    if (!draft.code.trim() || !draft.name.trim()) return;
    if (
      await api(`/api/dimensions/${id}/members`, {
        code: draft.code.trim(),
        name: draft.name.trim(),
        parentCode: draft.parentCode || null,
      })
    ) {
      setDraft({ ...draft, code: "", name: "" });
    }
  }

  async function saveMeta() {
    await api(`/api/dimensions/${id}`, meta, "PATCH");
  }

  async function removeDim() {
    if (!dim) return;
    if (!confirm(`"${dim.name}" boyutu ve tüm üyeleri silinsin mi?`)) return;
    if (await api(`/api/dimensions/${id}`, null, "DELETE")) router.push("/modeling");
  }

  if (!dim) return <div className="text-sm text-slate-400">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Link href="/modeling" className="hover:text-blue-600">
          Modelleme
        </Link>
        <span>›</span>
        <span className="text-slate-600">{dim.name}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-800">❖ {dim.name}</h1>
        <span className="font-mono text-xs text-slate-400">{dim.code}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            dim.visibility === "private" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {dim.visibility === "private" ? "🔒 Private" : "🌐 Public"} Dimension
        </span>
        {msg && <span className="text-sm text-amber-600">{msg}</span>}
      </div>

      <div className="mt-4 flex flex-col gap-4 xl:flex-row">
        {/* Uye tablosu */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 rounded-t-xl border-b border-slate-100 bg-white px-4 py-2.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Üye ara..."
              className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900"
            />
            <span className="text-xs text-slate-400">{dim.members.length} üye</span>
          </div>
          <div className="max-h-[62vh] overflow-y-auto rounded-b-xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Kod</th>
                  <th className="px-4 py-2 text-left">Ad</th>
                  <th className="px-4 py-2 text-left">Üst Üye</th>
                  <th className="w-20 px-4 py-2 text-right">Sıra</th>
                  {canEdit && <th className="w-14 px-4 py-2"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {canEdit && (
                  <tr className="bg-blue-50/60">
                    <td className="px-4 py-2">
                      <input
                        value={draft.code}
                        onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                        placeholder="Yeni kod"
                        className="w-full rounded border border-blue-200 bg-white px-2 py-1 font-mono text-xs text-slate-900"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && addMember()}
                        placeholder="Yeni üye adı"
                        className="w-full rounded border border-blue-200 bg-white px-2 py-1 text-xs text-slate-900"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={draft.parentCode}
                        onChange={(e) => setDraft({ ...draft, parentCode: e.target.value })}
                        className="w-full rounded border border-blue-200 bg-white px-2 py-1 text-xs text-slate-900"
                      >
                        <option value="">(kök)</option>
                        {ordered.map((m) => (
                          <option key={m.code} value={m.code}>
                            {" ".repeat((depthOf.get(m.id) ?? 0) * 2)}
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={addMember}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        +
                      </button>
                    </td>
                  </tr>
                )}
                {visible.map((m) => (
                  <tr key={m.id} className="group hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-4 py-1.5 font-mono text-xs text-slate-500">
                      {m.code}
                    </td>
                    <td
                      className="px-4 py-1.5"
                      style={{ paddingLeft: 16 + (search ? 0 : (depthOf.get(m.id) ?? 0) * 18) }}
                    >
                      {canEdit ? (
                        <input
                          defaultValue={m.name}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== m.name) api(`/api/members/${m.id}`, { name: v }, "PATCH");
                          }}
                          className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-200 focus:border-blue-400 focus:bg-white focus:outline-none ${
                            (depthOf.get(m.id) ?? 0) === 0 ? "font-semibold" : ""
                          }`}
                        />
                      ) : (
                        <span className={(depthOf.get(m.id) ?? 0) === 0 ? "font-semibold" : ""}>
                          {m.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-1.5">
                      {canEdit ? (
                        <select
                          value={m.parentId != null ? byId.get(m.parentId)?.code ?? "" : ""}
                          onChange={(e) =>
                            api(`/api/members/${m.id}`, { parentCode: e.target.value || null }, "PATCH")
                          }
                          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-500 hover:border-slate-200"
                        >
                          <option value="">(kök)</option>
                          {ordered
                            .filter((p) => p.id !== m.id)
                            .map((p) => (
                              <option key={p.code} value={p.code}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {m.parentId != null ? byId.get(m.parentId)?.name ?? "—" : "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {canEdit ? (
                        <input
                          type="number"
                          defaultValue={m.orderIdx}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isNaN(v) && v !== m.orderIdx)
                              api(`/api/members/${m.id}`, { orderIdx: v }, "PATCH");
                          }}
                          className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-xs text-slate-500 hover:border-slate-200"
                        />
                      ) : (
                        <span className="text-xs text-slate-400">{m.orderIdx}</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-1.5 text-right">
                        <button
                          onClick={() => {
                            if (confirm(`"${m.name}" silinsin mi?`))
                              api(`/api/members/${m.id}`, null, "DELETE");
                          }}
                          className="invisible text-xs text-red-400 hover:text-red-600 group-hover:visible"
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sag panel: genel bilgiler */}
        <div className="w-full shrink-0 xl:w-80">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Genel</h3>
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <div className="text-xs text-slate-400">Tip</div>
                <div className="text-slate-700">{TYPE_LABEL[dim.type] ?? dim.type}</div>
              </div>
              <label className="block">
                <div className="text-xs text-slate-400">Ad</div>
                <input
                  value={meta.name}
                  disabled={!canEdit}
                  onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900"
                />
              </label>
              <label className="block">
                <div className="text-xs text-slate-400">Açıklama</div>
                <input
                  value={meta.description}
                  disabled={!canEdit}
                  onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900"
                />
              </label>
              <label className="block">
                <div className="text-xs text-slate-400">Görünürlük</div>
                <select
                  value={meta.visibility}
                  disabled={!canEdit}
                  onChange={(e) => setMeta({ ...meta, visibility: e.target.value as "public" | "private" })}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                >
                  <option value="public">🌐 Public</option>
                  <option value="private">🔒 Private</option>
                </select>
              </label>
              {canEdit && (
                <button
                  onClick={saveMeta}
                  className="w-full rounded-lg bg-slate-800 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  💾 Kaydet
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Kullanan Modeller
            </h3>
            <div className="mt-2 space-y-1">
              {dim.usedIn.map((m) => (
                <Link
                  key={m.id}
                  href={`/modeling/models/${m.id}`}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-blue-50"
                >
                  <span>🧊 {m.name}</span>
                  <span className="font-mono text-xs text-slate-300">d{m.slot}</span>
                </Link>
              ))}
              {dim.usedIn.length === 0 && (
                <div className="text-xs text-slate-400">Henüz bir modelde kullanılmıyor.</div>
              )}
            </div>
          </div>

          {canEdit && dim.usedIn.length === 0 && (
            <button
              onClick={removeDim}
              className="mt-4 w-full rounded-xl border border-red-200 py-2 text-sm text-red-500 hover:bg-red-50"
            >
              Boyutu sil
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
