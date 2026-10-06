// RFC 6238 (TOTP) + RFC 4226 (HOTP) minimal, bagimliliksiz implementasyon
// (node:crypto HMAC-SHA1 ustune). Harici bir "qrcode"/"otplib" paketi
// eklemeden (bagimlilik yuzeyini buyutmemek icin) standart Google
// Authenticator/Authy/1Password uyumlu TOTP uretir ve dogrular.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 20 bayt (160 bit) — RFC 4226'nin onerdigi minimum secret uzunlugu.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  // Counter 64-bit big-endian; JS number guvenli tam sayi sinirinin
  // (2^53) cok altinda kaldigi icin (TOTP counter'i 30sn adimlarla
  // ~292 milyar yil sonra tasar) BigInt'e gerek yok.
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(counter, 4);

  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const str = String(binCode % 10 ** digits);
  return str.padStart(digits, "0");
}

export type TotpOptions = { digits?: number; stepSeconds?: number };

export function generateTotp(
  secretBase32: string,
  options: TotpOptions = {},
  forTime: number = Date.now()
): string {
  const { digits = 6, stepSeconds = 30 } = options;
  const counter = Math.floor(forTime / 1000 / stepSeconds);
  return hotp(base32Decode(secretBase32), counter, digits);
}

// Saat kaymasini tolere etmek icin verifyWindow adim once/sonrasini da
// kontrol eder (varsayilan 1 -> ±30sn). timingSafeEqual ile sabit zamanli
// karsilastirma yapilir (timing attack riskini azaltmak icin).
export function verifyTotp(
  secretBase32: string,
  token: string,
  options: TotpOptions & { window?: number } = {},
  forTime: number = Date.now()
): boolean {
  const { digits = 6, stepSeconds = 30, window = 1 } = options;
  const cleanToken = token.replace(/\s+/g, "");
  if (!/^\d+$/.test(cleanToken) || cleanToken.length !== digits) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(forTime / 1000 / stepSeconds);
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(secret, counter + i, digits);
    if (safeEqualStr(candidate, cleanToken)) return true;
  }
  return false;
}

function safeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Google Authenticator/Authy/1Password gibi uygulamalarin tanidigi standart
// otpauth:// URI'si. QR kod uretimi icin harici bir paket eklenmedi; kullanici
// bu URI'yi (veya ciplak secret'i) uygulamasina MANUEL olarak girebilir —
// tum yaygin authenticator uygulamalari manuel giris destekler.
export function buildOtpAuthUri(secretBase32: string, accountLabel: string, issuer = "PlanRep"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Yedek kurtarma kodlari: cihaz kaybinda hesaba girebilmek icin. 8 kod,
// her biri "XXXX-XXXX" formatinda (okunakli, karistirilmasi zor karakterler
// — 0/O ve 1/I/L cikarildi).
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(8);
    let raw = "";
    for (const b of bytes) raw += BACKUP_CODE_ALPHABET[b % BACKUP_CODE_ALPHABET.length];
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}
