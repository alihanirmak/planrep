"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type AttributeType = "text" | "number" | "date" | "member_ref";
type Attribute = {
  id: number;
  code: string;
  name: string;
  type: AttributeType;
  refDimensionId: number | null;
  refDimensionName: string | null;
};
type Member = {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
  orderIdx: number;
  attributes: Record<string, string | null>;
};
type DimDetail = {
  id: number;
  code: string;
  name: string;
  type: string;
  description: string | null;
  visibility: "public" | "private";
  ownerModelName: string | null;
  members: Member[];
  attributes: Attribute[];
  refOptions: Record<number, Array<{ code: string; name: string }>>;
  usedIn: Array<{ id: number; name: string; code: string; slot: number }>;
};

const TYPE_LABEL: Record<string, string> = { standard: "Standart", time: "Zaman", version: "Versiyon" };
const ATTR_TYPE_LABEL: Record<AttributeType, string> = {
  text: "Metin",
  number: "Sayı",
  date: "Tarih",
  member_ref: "Üye Referansı",
};

export default function DimensionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [dim, setDim] = useState<DimDetail | null>(null);
  const [role, setRole] = useState("viewer");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState({ code: "", name: "", parentCode: "" });
  const [meta, setMeta] = useState({ name: "", description: "", visibility: "public" as "public" | "private" });
  const [allDims, setAllDims] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [attrDraft, setAttrDraft] = useState({
    code: "",
    name: "",
    type: "text" as AttributeType,
    refDimensionId: "",
  });

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
    fetch("/api/dimensions").then((r) => (r.ok ? r.json() : [])).then(setAllDims);
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

  async function addAttribute() {
    if (!attrDraft.code.trim() || !attrDraft.name.trim()) return;
    if (attrDraft.type === "member_ref" && !attrDraft.refDimensionId) {
      setMsg("⚠ Referans boyut seçilmeli");
      return;
    }
    if (
      await api(`/api/dimensions/${id}/attributes`, {
        code: attrDraft.code.trim().toUpperCase(),
        name: attrDraft.name.trim(),
        type: attrDraft.type,
        refDimensionId: attrDraft.type === "member_ref" ? Number(attrDraft.refDimensionId) : null,
      })
    ) {
      setAttrDraft({ code: "", name: "", type: "text", refDimensionId: "" });
    }
  }

  async function removeAttribute(attrId: number, name: string) {
    if (!confirm(`"${name}" özelliği ve tüm üye değerleri silinsin mi?`)) return;
    api(`/api/dimensions/${id}/attributes/${attrId}`, null, "DELETE");
  }

  function setMemberAttr(memberId: number, code: string, value: string) {
    api(`/api/members/${memberId}/attributes`, { values: { [code]: value === "" ? null : value } }, "PATCH");
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
                  {dim.attributes.map((a) => (
                    <th key={a.id} className="px-4 py-2 text-left">
                      {a.name}
                    </th>
                  ))}
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
                    {dim.attributes.map((a) => (
                      <td key={a.id} className="px-4 py-2"></td>
                    ))}
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
                    {dim.attributes.map((a) => {
                      const raw = m.attributes[a.code] ?? "";
                      return (
                        <td key={a.id} className="px-4 py-1.5">
                          {canEdit ? (
                            a.type === "member_ref" ? (
                              <select
                                value={raw}
                                onChange={(e) => setMemberAttr(m.id, a.code, e.target.value)}
                                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-600 hover:border-slate-200"
                              >
                                <option value="">—</option>
                                {(dim.refOptions[a.refDimensionId ?? -1] ?? []).map((o) => (
                                  <option key={o.code} value={o.code}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={a.type === "number" ? "number" : a.type === "date" ? "date" : "text"}
                                defaultValue={raw}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v !== raw) setMemberAttr(m.id, a.code, v);
                                }}
                                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-600 hover:border-slate-200 focus:border-blue-400 focus:bg-white focus:outline-none"
                              />
                            )
                          ) : (
                            <span className="text-xs text-slate-400">
                              {a.type === "member_ref"
                                ? (dim.refOptions[a.refDimensionId ?? -1] ?? []).find((o) => o.code === raw)
                                    ?.name ?? raw ?? "—"
                                : raw || "—"}
                            </span>
                          )}
                        </td>
                      );
                    })}
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
              Özellikler (Attributes)
            </h3>
            <div className="mt-2 space-y-1.5">
              {dim.attributes.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <div>
                    <span className="font-medium">{a.name}</span>{" "}
                    <span className="font-mono text-xs text-slate-400">{a.code}</span>
                    <div className="text-xs text-slate-400">
                      {ATTR_TYPE_LABEL[a.type]}
                      {a.type === "member_ref" && a.refDimensionName ? ` → ${a.refDimensionName}` : ""}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => removeAttribute(a.id, a.name)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {dim.attributes.length === 0 && (
                <div className="text-xs text-slate-400">Henüz bir özellik tanımlanmadı.</div>
              )}
            </div>
            {canEdit && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <input
                  value={attrDraft.code}
                  onChange={(e) => setAttrDraft({ ...attrDraft, code: e.target.value })}
                  placeholder="Kod (örn. REGION)"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
                <input
                  value={attrDraft.name}
                  onChange={(e) => setAttrDraft({ ...attrDraft, name: e.target.value })}
                  placeholder="Ad (örn. Bölge)"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900"
                />
                <select
                  value={attrDraft.type}
                  onChange={(e) =>
                    setAttrDraft({ ...attrDraft, type: e.target.value as AttributeType, refDimensionId: "" })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  <option value="text">Metin</option>
                  <option value="number">Sayı</option>
                  <option value="date">Tarih</option>
                  <option value="member_ref">Üye Referansı</option>
                </select>
                {attrDraft.type === "member_ref" && (
                  <select
                    value={attrDraft.refDimensionId}
                    onChange={(e) => setAttrDraft({ ...attrDraft, refDimensionId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                  >
                    <option value="">Referans boyut seç...</option>
                    {allDims
                      .filter((d) => d.id !== dim.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                )}
                <button
                  onClick={addAttribute}
                  className="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  + Özellik Ekle
                </button>
              </div>
            )}
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
