// Locale-duyarli sayi ayristirici: Excel/SAP kaynakli metinleri (TR/EN/vb.)
// ondalik/binlik ayirici hatasiz sekilde number'a cevirir.
//
// Desteklenen formatlar (ornekler):
//   "1234.56"        -> 1234.56   (nokta ondalik)
//   "1234,56"        -> 1234.56   (virgul ondalik)
//   "1,234.56"       -> 1234.56   (US: virgul binlik, nokta ondalik)
//   "1.234,56"       -> 1234.56   (TR/EU: nokta binlik, virgul ondalik)
//   "1 234,56"       -> 1234.56   (bosluk binlik)
//   "1234"           -> 1234
//   "-1.234,56"      -> -1234.56
//   "(1.234,56)"     -> -1234.56  (muhasebe negatif gosterimi)
export function parseLocaleNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  let s = String(raw ?? "").trim();
  if (s === "") return NaN;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (/^[+-]/.test(s)) {
    if (s[0] === "-") negative = true;
    s = s.slice(1);
  }

  // Para birimi sembolleri ve bosluklar (binlik ayirici olarak kullanilan
  // normal/ince bosluk dahil) kaldirilir.
  s = s.replace(/[\s\u00A0]/g, "").replace(/[^\d.,]/g, "");
  if (s === "") return NaN;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Hem nokta hem virgul var: en sagdaki ondalik ayiracidir, digeri binlik.
    const decimalIsComma = lastComma > lastDot;
    const decimalChar = decimalIsComma ? "," : ".";
    const thousandChar = decimalIsComma ? "." : ",";
    normalized =
      s.split(thousandChar).join("").replace(decimalChar, ".");
  } else if (lastComma >= 0) {
    // Sadece virgul var: binlik mi ondalik mi, konumuna/basamak sayisina gore belirle.
    const parts = s.split(",");
    const lastPart = parts[parts.length - 1];
    const looksLikeThousands = parts.length > 2 || lastPart.length === 3;
    normalized = looksLikeThousands ? parts.join("") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    // Sadece nokta var: binlik mi ondalik mi, konumuna/basamak sayisina gore belirle.
    const parts = s.split(".");
    const lastPart = parts[parts.length - 1];
    const looksLikeThousands = parts.length > 2 || lastPart.length === 3;
    normalized = looksLikeThousands ? parts.join("") : s;
  } else {
    normalized = s;
  }

  const num = parseFloat(normalized);
  if (Number.isNaN(num)) return NaN;
  return negative ? -num : num;
}
