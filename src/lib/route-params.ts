// Route param (dinamik segment) ayristirma/dogrulama yardimcisi.
//
// Next.js dinamik route segmentleri (`[id]`) her zaman string gelir; `Number(...)`
// ile cevirmek gecersiz girdilerde (orn. "/api/models/abc" veya "/api/models/-1")
// NaN uretir. Bu NaN deger dogrudan better-sqlite3'e bind edilirse
// "TypeError: invalid bind parameter" firlatir -> yakalanmamis hata, Next.js
// genel 500 sayfasi dondurur. Bu, projenin "input sanitization tutarliligi"
// acigi olarak ROADMAP'te isaretlenmisti; bu modul tum `[id]` route'larinda
// ayni tutarli 400 davranisini saglar.
import { NextResponse } from "next/server";

// Sadece pozitif tam sayilari kabul eder (DB id'leri her zaman >= 1).
export function parseIdParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function invalidIdResponse() {
  return NextResponse.json({ error: "invalid_id" }, { status: 400 });
}
