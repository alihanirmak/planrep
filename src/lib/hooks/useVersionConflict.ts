"use client";

// Rapor/dashboard duzenleme sayfalari icin paylasilan "coklu kullanici
// farkindaligi" hook'u. Bu projede WebSocket/SSE altyapisi YOK (bkz.
// docs/ROADMAP.md Sprint 3.2 madde 3 tamamlama notu) — mevcut "canli
// guncelleme" idiomu NotificationBell.tsx'teki basit setInterval polling,
// bu hook ayni deseni takip eder. Iki ayri mekanizma sunar:
//
// 1) Optimistic concurrency: PUT'a `expectedVersion` eklenir; sunucu 409
//    donerse (bkz. lib/version-guard.ts) `conflict` state'i doldurulur ve
//    sayfanin kendi degisikligi SESSIZCE ustune yazilmaz.
// 2) Arka plan polling: duzenlenen kayit baska bir kullanici tarafindan
//    guncellenmisse (version artmissa) kullaniciya "baskasi guncelledi"
//    bir banner gosterilir — otomatik yenileme YAPILMAZ, kullanici karar verir.
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 20000;

export type RemoteVersionInfo = { version: number };

export type ConflictInfo<T> = { current: T };

export function useVersionConflict<T extends RemoteVersionInfo>(opts: {
  entityId: number | null;
  isMine: boolean;
  fetchLatest: (id: number) => Promise<T | null>;
}) {
  const { entityId, isMine, fetchLatest } = opts;
  const [knownVersion, setKnownVersion] = useState<number | null>(null);
  const [remoteUpdated, setRemoteUpdated] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo<T> | null>(null);
  const aliveRef = useRef(true);
  const entityIdRef = useRef(entityId);
  const knownVersionRef = useRef(knownVersion);

  // Render sirasinda ref'e yazmak React Compiler tarafindan yasaklanir
  // (bkz. eslint-plugin-react-hooks v7 "react-hooks/refs" kurali) — bu
  // yuzden entityId/knownVersion degistiginde ref'ler bir effect icinde
  // senkronize edilir (polling tick'inin her zaman en guncel degerleri
  // gormesini saglamak icin, effect'i her tick'te yeniden kurmadan).
  useEffect(() => {
    entityIdRef.current = entityId;
    knownVersionRef.current = knownVersion;
  }, [entityId, knownVersion]);

  // Yeni bir kayit yuklendiginde (veya kaydedildikten sonra) "bilinen"
  // versiyon sifirlanir/guncellenir, uzaktan-guncelleme banner'i kapanir.
  const syncVersion = useCallback((version: number) => {
    setKnownVersion(version);
    setRemoteUpdated(false);
    setConflict(null);
  }, []);

  // Arka plan polling: SADECE kaydedilmis (entityId var) ve kullanicinin
  // SAHIBI OLDUGU kayitlar icin calisir — paylasilmayan/baskasina ait
  // kayitlarda zaten duzenleme yapilamadigindan polling'e gerek yok.
  useEffect(() => {
    aliveRef.current = true;
    if (!entityId || !isMine) return;

    const tick = async () => {
      const id = entityIdRef.current;
      if (!id || !aliveRef.current) return;
      const latest = await fetchLatest(id).catch(() => null);
      if (!latest || !aliveRef.current) return;
      const known = knownVersionRef.current;
      if (known != null && latest.version > known) {
        setRemoteUpdated(true);
      }
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [entityId, isMine, fetchLatest]);

  // PUT 409 dondugunde cagrilir — current (sunucudaki) kaydi conflict
  // state'ine koyar, boylece UI "baskasi guncelledi, ne yapmak istersiniz"
  // secenegini (uzerine yaz / yeniden yukle) gosterebilir.
  const handleConflict = useCallback((current: T) => {
    setConflict({ current });
  }, []);

  const dismissConflict = useCallback(() => setConflict(null), []);
  const dismissRemoteUpdated = useCallback(() => setRemoteUpdated(false), []);

  return {
    knownVersion,
    syncVersion,
    remoteUpdated,
    dismissRemoteUpdated,
    conflict,
    handleConflict,
    dismissConflict,
  };
}
