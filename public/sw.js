// Minimal, bagimliliksiz service worker (next-pwa/workbox gibi harici bir
// paket eklenmedi — bkz. lib/totp.ts/lib/cache.ts'teki benzer "bagimlilik
// yuzeyini buyutme" kararlari). Kapsam KASITLI OLARAK sinirli: SADECE
// statik app-shell varliklarini (CSS/JS/font/manifest/ikon) cache'ler —
// API yanitlarini veya HTML sayfalarini cache'LEMEZ, cunku bu uygulama
// JWT cookie tabanli oturum + sunucu taraflı render kullaniyor; API/HTML
// cache'lemek bayat/yanlis veri (orn. kilitli bir workflow'un eski
// durumu) gostermeye veya oturum sonlandiktan sonra da sayfanin "calisir
// gibi" gorunmesine yol acabilirdi. Bu sinirli kapsam, cevrimdisiyken
// "sayfa hic yuklenemiyor" beyaz ekranini onlerken veri dogrulugundan
// odun vermez.
const CACHE_NAME = "planrep-shell-v1";
const SHELL_PATTERNS = [/\/_next\/static\//, /\/icons\//, /manifest\.json$/];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShellAsset(url) {
  return SHELL_PATTERNS.some((re) => re.test(url));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Sadece GET + ayni origin + app-shell deseniyle eslesen istekler
  // cache-first stratejisiyle ele alinir; her sey disinda tarayicinin
  // varsayilan agdan getirme davranisina (hicbir mudahale) birakilir.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !isShellAsset(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const response = await fetch(req);
      if (response.ok) cache.put(req, response.clone());
      return response;
    })
  );
});
