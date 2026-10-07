"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import MemberPicker from "@/components/MemberPicker";
import type { Member } from "@/lib/pivot";

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
  measures: Array<{ id: number; modelId: number; code: string; name: string; slot: number }>;
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

type MeasureInfo = ModelDetail["measures"][number];

type DimWithMembers = { id: number; code: string; name: string; members: Member[] };

type BusinessRule = {
  id: number;
  modelId: number;
  name: string;
  scopeFilters: Record<string, string[]>;
  op: "<" | ">" | "<=" | ">=" | "=" | "<>";
  value: number;
  measureCode: string | null;
  severity: "block" | "warn";
  message: string | null;
  active: boolean;
};

const OP_LABEL: Record<BusinessRule["op"], string> = {
  "<": "küçükse (<)",
  ">": "büyükse (>)",
  "<=": "küçük/eşitse (<=)",
  ">=": "büyük/eşitse (>=)",
  "=": "eşitse (=)",
  "<>": "eşit değilse (<>)",
};

const TYPE_ICON: Record<string, string> = { standard: "❖", time: "📅", version: "🏷" };
const nf = new Intl.NumberFormat("tr-TR");

export default function ModelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [role, setRole] = useState("viewer");
  const [dimsWithMembers, setDimsWithMembers] = useState<DimWithMembers[]>([]);
  const [rules, setRules] = useState<BusinessRule[]>([]);
  const [showNewRule, setShowNewRule] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleOp, setRuleOp] = useState<BusinessRule["op"]>("<");
  const [ruleValue, setRuleValue] = useState("0");
  const [ruleSeverity, setRuleSeverity] = useState<BusinessRule["severity"]>("block");
  const [ruleMessage, setRuleMessage] = useState("");
  const [ruleScope, setRuleScope] = useState<Record<string, string[]>>({});
  const [ruleMeasureCode, setRuleMeasureCode] = useState("");
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);
  const [showNewMeasure, setShowNewMeasure] = useState(false);
  const [measureCode, setMeasureCode] = useState("");
  const [measureName, setMeasureName] = useState("");
  const [measureMsg, setMeasureMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/models/${id}`).then((r) => (r.ok ? r.json() : null)).then(setModel);
    fetch(`/api/business-rules?modelId=${id}`).then((r) => (r.ok ? r.json() : [])).then(setRules);
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/me").then((r) => r.json()).then((me) => setRole(me.role ?? "viewer"));
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: Array<{ id: number; dims: DimWithMembers[] }>) => {
        const m = list.find((x) => x.id === Number(id));
        setDimsWithMembers(m?.dims ?? []);
      });
  }, [load, id]);

  async function removeModel() {
    if (!model) return;
    if (!confirm(`"${model.name}" modeli, verileri ve raporlarıyla birlikte silinsin mi?`)) return;
    const res = await fetch(`/api/models/${model.id}`, { method: "DELETE" });
    if (res.ok) router.push("/modeling");
  }

  async function addRule() {
    if (!model || !ruleName.trim()) return;
    const value = Number(ruleValue.replace(",", "."));
    if (Number.isNaN(value)) {
      setRuleMsg("Geçersiz sayı");
      return;
    }
    const res = await fetch("/api/business-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: model.id,
        name: ruleName,
        scopeFilters: ruleScope,
        op: ruleOp,
        value,
        measureCode: ruleMeasureCode || null,
        severity: ruleSeverity,
        message: ruleMessage.trim() || null,
      }),
    });
    if (res.ok) {
      setShowNewRule(false);
      setRuleName("");
      setRuleValue("0");
      setRuleMessage("");
      setRuleScope({});
      setRuleMeasureCode("");
      setRuleMsg(null);
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setRuleMsg(body.detail ?? body.error ?? "Kural oluşturulamadı");
    }
  }

  async function toggleRule(rule: BusinessRule) {
    await fetch(`/api/business-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !rule.active }),
    });
    load();
  }

  async function removeRule(rule: BusinessRule) {
    if (!confirm(`"${rule.name}" kuralı silinsin mi?`)) return;
    await fetch(`/api/business-rules/${rule.id}`, { method: "DELETE" });
    load();
  }

  async function addMeasure() {
    if (!model || !measureCode.trim() || !measureName.trim()) return;
    const res = await fetch(`/api/models/${model.id}/measures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: measureCode.trim().toUpperCase(), name: measureName.trim() }),
    });
    if (res.ok) {
      setShowNewMeasure(false);
      setMeasureCode("");
      setMeasureName("");
      setMeasureMsg(null);
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setMeasureMsg(body.message ?? body.error ?? "Ölçü oluşturulamadı");
    }
  }

  async function removeMeasure(measure: MeasureInfo) {
    if (!model) return;
    if (!confirm(`"${measure.name}" ölçüsü silinsin mi?`)) return;
    const res = await fetch(`/api/models/${model.id}/measures/${measure.id}`, { method: "DELETE" });
    if (res.ok) {
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setMeasureMsg(body.message ?? body.error ?? "Ölçü silinemedi");
    }
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

      {/* Olculer (measures) */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Ölçüler (Measures)
        </h2>
        {role === "admin" && model.measures.length < 8 && (
          <button
            onClick={() => setShowNewMeasure(!showNewMeasure)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            + Yeni Ölçü
          </button>
        )}
      </div>
      {model.measures.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Henüz ölçü tanımlanmadı — model varsayılan tek bir &quot;Değer&quot; ölçüsüyle çalışır. Ölçü
          eklemek, model başına birden fazla değer (örn. Tutar + Miktar) tutmayı mümkün kılar.
        </p>
      )}

      {showNewMeasure && (
        <div className="mt-2 rounded-xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Kod
              <input
                value={measureCode}
                onChange={(e) => setMeasureCode(e.target.value)}
                placeholder="AMOUNT"
                className="mt-1 w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-mono"
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Ad
              <input
                value={measureName}
                onChange={(e) => setMeasureName(e.target.value)}
                placeholder="Tutar"
                className="mt-1 w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <button
              onClick={addMeasure}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Oluştur
            </button>
          </div>
          {measureMsg && <div className="mt-2 text-sm text-red-500">{measureMsg}</div>}
        </div>
      )}

      {model.measures.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-14 px-5 py-2.5 text-left">Slot</th>
                <th className="px-5 py-2.5 text-left">Kod</th>
                <th className="px-5 py-2.5 text-left">Ad</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {model.measures.map((m) => (
                <tr key={m.id}>
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">v{m.slot}</td>
                  <td className="px-5 py-3 font-mono text-xs">{m.code}</td>
                  <td className="px-5 py-3 font-medium">{m.name}</td>
                  <td className="px-5 py-3 text-right">
                    {role === "admin" && (
                      <button onClick={() => removeMeasure(m)} className="text-xs text-red-500 hover:underline">
                        Sil
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {measureMsg && !showNewMeasure && <div className="mt-2 text-sm text-red-500">{measureMsg}</div>}

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

      {/* Is kurallari */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          İş Kuralları (Veri Doğrulama)
        </h2>
        {role === "admin" && (
          <button
            onClick={() => setShowNewRule(!showNewRule)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            + Yeni Kural
          </button>
        )}
      </div>

      {showNewRule && (
        <div className="mt-2 rounded-xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Kural Adı
              <input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="Bütçe negatif olamaz"
                className="mt-1 w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Koşul
              <select
                value={ruleOp}
                onChange={(e) => setRuleOp(e.target.value as BusinessRule["op"])}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                {Object.entries(OP_LABEL).map(([op, label]) => (
                  <option key={op} value={op}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Eşik Değer
              <input
                value={ruleValue}
                onChange={(e) => setRuleValue(e.target.value)}
                className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            {model.measures.length > 0 && (
              <label className="flex flex-col text-xs text-slate-500">
                Ölçü
                <select
                  value={ruleMeasureCode}
                  onChange={(e) => setRuleMeasureCode(e.target.value)}
                  className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">(tüm ölçüler)</option>
                  {model.measures.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col text-xs text-slate-500">
              Şiddet
              <select
                value={ruleSeverity}
                onChange={(e) => setRuleSeverity(e.target.value as BusinessRule["severity"])}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="block">Engelle (block)</option>
                <option value="warn">Uyar (warn)</option>
              </select>
            </label>
            {dimsWithMembers.map((d) => (
              <MemberPicker
                key={d.code}
                label={d.name}
                members={d.members}
                selected={ruleScope[d.code] ?? []}
                onChange={(codes) => setRuleScope({ ...ruleScope, [d.code]: codes })}
              />
            ))}
            <label className="flex flex-col text-xs text-slate-500">
              Hata Mesajı (opsiyonel)
              <input
                value={ruleMessage}
                onChange={(e) => setRuleMessage(e.target.value)}
                placeholder="OPEX negatif olamaz"
                className="mt-1 w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <button
              onClick={addRule}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Oluştur
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">
            Kural, kapsamdaki (yukarıda seçilen boyut üyeleri) her yazma işleminde değerin koşulu
            sağlayıp sağlamadığını kontrol eder. Hiçbir boyut seçilmezse kural modelin tüm verisine uygulanır.
          </p>
          {ruleMsg && <div className="mt-2 text-sm text-red-500">{ruleMsg}</div>}
        </div>
      )}

      <div className="mt-2 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-2.5 text-left">Ad</th>
              <th className="px-5 py-2.5 text-left">Koşul</th>
              <th className="px-5 py-2.5 text-left">Ölçü</th>
              <th className="px-5 py-2.5 text-left">Kapsam</th>
              <th className="px-5 py-2.5 text-left">Şiddet</th>
              <th className="px-5 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {rules.map((r) => (
              <tr key={r.id} className={r.active ? "" : "opacity-40"}>
                <td className="px-5 py-2.5 font-medium">{r.name}</td>
                <td className="px-5 py-2.5 text-xs">
                  değer {OP_LABEL[r.op]} {r.value}
                </td>
                <td className="px-5 py-2.5 font-mono text-xs text-slate-500">
                  {r.measureCode ?? "Tüm ölçüler"}
                </td>
                <td className="px-5 py-2.5 text-xs text-slate-500">
                  {Object.keys(r.scopeFilters).length === 0
                    ? "Tüm veri"
                    : Object.entries(r.scopeFilters)
                        .map(([dim, codes]) => `${dim}:${codes.join(",")}`)
                        .join(" ")}
                </td>
                <td className="px-5 py-2.5 text-xs">
                  <span
                    className={`rounded px-2 py-0.5 ${
                      r.severity === "block" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {r.severity === "block" ? "Engelle" : "Uyar"}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right">
                  {role === "admin" && (
                    <div className="flex justify-end gap-2 text-xs">
                      <button onClick={() => toggleRule(r)} className="text-blue-500 hover:underline">
                        {r.active ? "Pasifleştir" : "Aktifleştir"}
                      </button>
                      <button onClick={() => removeRule(r)} className="text-red-500 hover:underline">
                        Sil
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-5 text-sm text-slate-400">
                  Henüz iş kuralı tanımlanmadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
