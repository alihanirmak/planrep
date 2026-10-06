// app/api/v1/* REST export API'si icin ortak kimlik dogrulama yardimcisi.
// Bu uc, harici BI araclari (Power BI/Tableau vb.) icin tasarlandigindan
// SESSION_COOKIE DEGIL, `Authorization: Bearer <api-key>` basligi
// kullanir — bkz. lib/api-keys.ts, proxy.ts PUBLIC_PATHS'teki "/api/v1"
// istisnasi (middleware bu yolu session kontrolunden gecirmez, kimlik
// dogrulama route'un kendisinde — burada — yapilir).
import { NextResponse } from "next/server";
import { verifyApiKey, type VerifiedApiKey } from "./api-keys";

export function requireApiKey(req: Request): { auth: VerifiedApiKey } | { error: NextResponse } {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return {
      error: NextResponse.json(
        { error: "unauthorized", message: "Authorization: Bearer <api-key> başlığı gerekli" },
        { status: 401 }
      ),
    };
  }
  const auth = verifyApiKey(match[1].trim());
  if (!auth) {
    return {
      error: NextResponse.json({ error: "unauthorized", message: "Geçersiz veya iptal edilmiş API anahtarı" }, { status: 401 }),
    };
  }
  return { auth };
}
