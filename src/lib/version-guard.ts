// Optimistic concurrency icin paylasilan kucuk yardimci. reports/dashboards
// gibi "sahip tarafindan duzenlenebilir + shared=1 ile baskalarina gorunur"
// kaynaklarda ayni semantigi tekrar tekrar SQL olarak yazmamak icin
// cikarildi — hem api/reports/[id]/route.ts hem api/dashboards/[id]/route.ts
// bunu kullanir, boylece davranis asla birbirinden sapmaz ve birim test
// edilebilir (route.ts'ler kasitli olarak ince HTTP sarmalayici kalir —
// bkz. lib/workflow.ts/business-rules.ts ile ayni mimari desen).
import { sqlite } from "./db";

export type VersionedUpdateResult =
  | { ok: true; newVersion: number }
  | { ok: false; reason: "stale_expected_version" | "race_condition" };

// `table` guvenlik acisindan ONEMLI: cagiran tarafindan kullanici girdisinden
// degil, sabit bir string literal'dan gelmelidir (SQL injection riskini
// onlemek icin — bu fonksiyon parametreli sorgu KULLANAMAZ cunku tablo adi
// bir parametre olarak baglanamaz, bu yuzden sadece internal/sabit
// cagrilarda kullanilmalidir).
export function versionedUpdate(
  table: "reports" | "dashboards",
  id: number,
  currentVersion: number,
  expectedVersion: number | undefined,
  setSql: string,
  setParams: unknown[]
): VersionedUpdateResult {
  // Istemcinin son GET'te gordugu versiyon ile DB'deki mevcut versiyon
  // uyusmuyorsa, araya baska bir yazma girmis — istemciye hemen 409
  // dondurulmeli, UPDATE'i hic denemeye gerek yok.
  if (expectedVersion != null && expectedVersion !== currentVersion) {
    return { ok: false, reason: "stale_expected_version" };
  }

  const info = sqlite
    .prepare(`UPDATE ${table} SET ${setSql}, version = version + 1 WHERE id = ? AND version = ?`)
    .run(...setParams, id, currentVersion);

  // changes === 0: expectedVersion gonderilmemisti (eski/basit istemci)
  // AMA tam bu anda (okuma ile UPDATE arasindaki kisa pencerede) baska
  // bir istek araya girip versiyonu degistirdi — nadir bir yaris durumu,
  // ayni sekilde conflict olarak ele alinir (lost-update'i engellemek icin).
  if (info.changes === 0) {
    return { ok: false, reason: "race_condition" };
  }
  return { ok: true, newVersion: currentVersion + 1 };
}
