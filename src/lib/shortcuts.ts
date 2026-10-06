"use client";

// Global klavye kisayolu altyapisi. Projede ONCEDEN hic Ctrl/Cmd kombinasyonu
// yoktu (sadece Escape/Tab-trap vardi, bkz. lib/a11y.ts) — bu modul ayni
// "use client" hook + document-level keydown dinleyici" desenini izler.
//
// Tasarim karari: tek bir global "command palette" (Ctrl/Cmd+K) + "yardim"
// (?) kisayolu + sayfa-ozel kaydet/calistir kisayollari (Ctrl/Cmd+S,
// Ctrl/Cmd+Enter) — GitHub tarzi iki-tuslu "g sonra r" dizileri KASITLI
// OLARAK eklenmedi (durum makinesi + zaman asimi gerektirir, test edilmesi
// ve a11y acisindan dogrulanmasi daha zordur; command palette ayni ihtiyaci
// -hizli sayfa gecisi- daha kesfedilebilir sekilde kapsar).
import { useEffect } from "react";

export type HotkeySpec = {
  // KeyboardEvent.key degeri, kucuk/buyuk harf duyarsiz karsilastirilir
  // (orn. "k", "s", "Enter", "?", "Escape")
  key: string;
  // true: Ctrl (Windows/Linux) VEYA Cmd (Mac) tuslarindan biri basili olmali.
  // false/undefined: hicbiri basili OLMAMALI (duz tus kisayolu, orn. "?").
  mod?: boolean;
};

export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

type MinimalKeyboardEvent = { key: string; ctrlKey: boolean; metaKey: boolean };

export function matchesHotkey(e: MinimalKeyboardEvent, spec: HotkeySpec): boolean {
  const modPressed = e.ctrlKey || e.metaKey;
  if (!!spec.mod !== modPressed) return false;
  return e.key.toLowerCase() === spec.key.toLowerCase();
}

// Duz tus kisayollari (mod yok) metin girilen alanlarda (input/textarea/
// select/contenteditable) KASITLI OLARAK tetiklenmez — orn. bir arama
// kutusuna "?" yazarken yardim penceresinin acilmasini onlemek icin.
// Mod'lu kisayollar (Ctrl/Cmd+S gibi) her zaman tetiklenir — bunlar zaten
// taraycinin kendi varsayilan davranisini (sayfa kaydetme diyalogu vb.)
// ezdigi icin bilincli bir eylem sayilir.
export function useHotkey(
  spec: HotkeySpec,
  handler: (e: KeyboardEvent) => void,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!matchesHotkey(e, spec)) return;
      if (!spec.mod && isEditableTarget(e.target)) return;
      e.preventDefault();
      handler(e);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, spec.key, spec.mod, handler]);
}
