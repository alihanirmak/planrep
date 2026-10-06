"use client";

import { useEffect } from "react";

// Service worker kaydi: production'da (ve sadece tarayici destekliyorsa)
// bir kez calisir. Development'ta KASITLI OLARAK devre disi — next dev
// sik sik yeniden derleme/HMR yaptigindan, bir service worker'in eski
// statik dosyalari cache'lemesi gelistirme deneyimini bozar (bayat kod
// gorunmesi). bkz. public/sw.js — kapsam sadece statik app-shell
// varliklariyla sinirli, API/HTML asla cache'lenmez.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Kayit basarisiz olursa (orn. tarayici destegi yok/HTTPS yok)
      // sessizce yoksay — PWA sadece bir gelistirme, uygulamanin
      // calismasi icin zorunlu degil.
    });
  }, []);

  return null;
}
