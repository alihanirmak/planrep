"use client";

import { useId } from "react";
import { useEscapeKey, useFocusTrap } from "@/lib/a11y";
import type { TKey } from "@/lib/i18n";

// Statik liste — sayfa-ozel kisayollar (Ctrl/Cmd+S, Ctrl/Cmd+Enter) ilgili
// sayfalarda (reports/dashboards) ayrica kayitlidir, burada SADECE
// kullaniciya gosterilecek dokuman amaclidir (dinamik bir kayit defteri
// YOK — kapsam kasitli olarak kucuk tutuldu).
const ROWS: Array<{ keys: string; labelKey: TKey }> = [
  { keys: "Ctrl/⌘ + K", labelKey: "shortcuts.palette" },
  { keys: "Ctrl/⌘ + S", labelKey: "shortcuts.save" },
  { keys: "Ctrl/⌘ + Enter", labelKey: "shortcuts.run" },
  { keys: "Esc", labelKey: "shortcuts.closeDialog" },
  { keys: "?", labelKey: "shortcuts.openHelp" },
];

export default function ShortcutsHelpModal({
  t,
  onClose,
}: {
  t: (key: TKey) => string;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeKey(onClose, true);

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
        className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-slate-100 px-5 py-3">
          <h2 id={titleId} className="text-sm font-semibold text-slate-800">
            ⌨️ {t("shortcuts.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="ml-auto text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <ul className="divide-y divide-slate-100 px-5 py-2 text-sm text-slate-700">
          {ROWS.map((r) => (
            <li key={r.labelKey} className="flex items-center justify-between py-2">
              <span>{t(r.labelKey)}</span>
              <kbd className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600">
                {r.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
