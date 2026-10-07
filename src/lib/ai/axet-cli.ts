import { spawn } from "node:child_process";
import fs from "node:fs";
import { formatT, type TKey } from "@/lib/i18n";

// axet-code CLI entegrasyonu — paylaşılan spawn/timeout mantığı.
// Hem /api/ai/query (NL -> rapor sorgusu) hem de /api/ai/dev/* (NL/Excel ->
// model/boyut/ölçü/rapor OLUŞTURMA planı) bu modülü kullanır. Bu dosya
// SADECE axet-code binary'sini çağırıp ham stdout metnini döndürür — hangi
// JSON şemasının bekleneceğine veya sonucun nasıl uygulanacağına dair HİÇBİR
// bilgi taşımaz (bu ayrım kasıtlı: axet-cli.ts "nasıl çalıştırılır", çağıran
// modüller "ne istenir/sonuç ne yapılır" sorularını cevaplar).
export const AXET_BIN =
  process.env.AXET_CODE_BIN ?? `${process.env.LOCALAPPDATA ?? ""}\\axet-code\\bin\\axet-code.exe`;

export function axetAvailable(): boolean {
  return fs.existsSync(AXET_BIN) && process.env.AXET_DISABLE !== "1";
}

// Uzun prompt stdin uzerinden verilir (arguman uzunluk sinirina takilmasin).
export function runAxet(
  prompt: string,
  t: (key: TKey) => string,
  instruction = "stdin'deki görevi uygula ve SADECE istenen JSON'u döndür"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(AXET_BIN, ["run", "--quiet", instruction], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(t("err.axetTimeout")));
    }, 90000);
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.slice(0, 400) || formatT(t("err.axetExitCode"), { code: String(code) })));
    });
    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });
}
