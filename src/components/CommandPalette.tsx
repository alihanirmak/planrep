"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEscapeKey, useFocusTrap } from "@/lib/a11y";
import type { TKey } from "@/lib/i18n";

export type PaletteItem = { href: string; label: string; icon: string };

// Hizli-git komut paleti (Ctrl/Cmd+K). Sidebar'daki NAV listesini arama
// kutusuyla filtreleyip ok tuslariyla gezinme + Enter ile gitme imkani verir
// — GitHub/VSCode "command palette" deseninin kucuk bir alt kumesi.
export default function CommandPalette({
  items,
  t,
  onClose,
}: {
  items: PaletteItem[];
  t: (key: TKey) => string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const titleId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(onClose, true);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (!q) return items;
    return items.filter((it) => it.label.toLocaleLowerCase("tr").includes(q));
  }, [items, query]);

  // Liste sorguya gore degistiginde secimi gecersiz bir indekste birakmamak
  // icin sinirlanir (bir onceki aramanin indeksi yeni listede disari tasabilir).
  // Bunu bir effect icinde setState ile yapmak yerine render sirasinda
  // tureterek yapiyoruz (React Compiler'in "effect icinde senkron setState"
  // kuralini ihlal etmemek icin — bkz. virtualize/Sidebar'daki benzer kararlar).
  const safeActiveIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));

  function go(href: string) {
    router.push(href);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(safeActiveIndex + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(safeActiveIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[safeActiveIndex];
      if (item) go(item.href);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6 pt-24"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">
          {t("palette.title")}
        </h2>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("palette.placeholder")}
          className="w-full border-b border-slate-100 px-4 py-3 text-sm text-slate-900 outline-none"
          aria-label={t("palette.placeholder")}
        />
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-slate-400">{t("palette.empty")}</li>
          ) : (
            filtered.map((it, i) => (
              <li key={it.href} role="option" aria-selected={i === safeActiveIndex}>
                <button
                  type="button"
                  onClick={() => go(it.href)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                    i === safeActiveIndex ? "bg-blue-50 text-blue-700" : "text-slate-700"
                  }`}
                >
                  <span>{it.icon}</span>
                  {it.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
