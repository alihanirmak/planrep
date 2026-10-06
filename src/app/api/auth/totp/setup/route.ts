import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTotpStatus, startTotpSetup } from "@/lib/totp-user";
import { buildOtpAuthUri } from "@/lib/totp";

// Yeni bir "pending" secret uretir ve otpauth:// URI'sini doner (QR kodu
// yerine kullanici secret'i authenticator uygulamasina manuel girebilir —
// bkz. lib/totp.ts ustundeki not). 2FA zaten AKTIFSE reddedilir — aksi halde
// aktif secret, yeni kod dogrulanmadan sessizce degisir ve kullanici
// kilitlenebilir; once /api/auth/totp/disable ile kapatip yeniden kurmali.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (getTotpStatus(session.id).enabled) {
    return NextResponse.json({ error: "already_enabled" }, { status: 400 });
  }

  const { secret } = startTotpSetup(session.id);
  const otpAuthUri = buildOtpAuthUri(secret, session.email);
  return NextResponse.json({ secret, otpAuthUri });
}
