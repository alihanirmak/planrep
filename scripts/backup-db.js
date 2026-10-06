#!/usr/bin/env node
// Temel SQLite yedekleme scripti: better-sqlite3'un yerlesik backup() API'si
// ile WAL-guvenli, tutarli bir snapshot alir ve eski yedekleri rotasyonlar.
//
// Kullanim:
//   node scripts/backup-db.js
//
// Env degiskenleri:
//   DATABASE_PATH     - kaynak veritabani dosyasi (varsayilan: ./data/planrep.db)
//   BACKUP_DIR         - yedeklerin yazilacagi klasor (varsayilan: <db-klasoru>/backups)
//   BACKUP_RETENTION   - saklanacak maksimum yedek sayisi (varsayilan: 14)

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

async function main() {
  const dbPath = path.resolve(process.env.DATABASE_PATH ?? "./data/planrep.db");
  const backupDir = path.resolve(
    process.env.BACKUP_DIR ?? path.join(path.dirname(dbPath), "backups")
  );
  const retention = Number(process.env.BACKUP_RETENTION ?? 14);

  if (!fs.existsSync(dbPath)) {
    console.error(`[backup] Veritabani dosyasi bulunamadi: ${dbPath}`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destPath = path.join(backupDir, `planrep-${stamp}.db`);

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destPath);
  } finally {
    db.close();
  }

  const destSize = fs.statSync(destPath).size;
  console.log(`[backup] Yedek olusturuldu: ${destPath} (${(destSize / 1024 / 1024).toFixed(2)} MB)`);

  rotate(backupDir, retention);
}

// En eski yedekleri silip 'retention' kadarini (en yeniden eskiye) tutar.
function rotate(backupDir, retention) {
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("planrep-") && f.endsWith(".db"))
    .map((f) => ({ name: f, full: path.join(backupDir, f) }))
    .map((f) => ({ ...f, mtime: fs.statSync(f.full).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = files.slice(Math.max(retention, 0));
  for (const f of toDelete) {
    fs.unlinkSync(f.full);
    console.log(`[backup] Rotasyon: eski yedek silindi: ${f.name}`);
  }
  console.log(`[backup] Toplam ${files.length - toDelete.length} yedek saklaniyor (limit: ${retention}).`);
}

main().catch((err) => {
  console.error("[backup] Hata:", err);
  process.exitCode = 1;
});
