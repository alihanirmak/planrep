import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Her test dosyasi kendi gecici DATABASE_PATH'ini kendi dynamic import'undan
    // once ayarliyor (bkz. src/lib/*.test.ts), bu yuzden ayri calisma context'i
    // onemli: test dosyalari birbirinin modul/side-effect durumunu paylasmasin.
    isolate: true,
  },
});
