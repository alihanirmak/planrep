"use client";

import { useEffect, useRef } from "react";

// ESC tusuna basildiginda cagrilir (modal/acilir panel kapama). `active`
// false ise listener eklenmez (gereksiz global event handler'i onler).
export function useEscapeKey(onEscape: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onEscape();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onEscape]);
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Bir container (modal/acilir panel) icindeki klavye odagini (Tab/Shift+Tab)
// hapseder; acildiginda ilk odaklanabilir ogeye odaklanir, kapandiginda
// odagi tetikleyen elemente (focus-return) geri verir. `active` false
// oldugunda hicbir sey yapmaz (ör. acilir panel kapaliyken).
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    const focusables = () =>
      container ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];

    const first = focusables()[0];
    first?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !container) return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [active]);

  return containerRef;
}
