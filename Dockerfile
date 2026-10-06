# PlanRep - cok asamali (multi-stage) Docker build.
# better-sqlite3 native modul oldugundan derleme asamasinda build araclari gerekir;
# calisma (runner) imajinda sadece derlenmis cikti (standalone) tasinir.

# ---- deps: bagimliliklari kur (native derleme icin build araclariyla) ----
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

# ---- builder: Next.js production build ----
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# JWT_SECRET sadece build-time modul yuklemesini gecirmek icin (next build,
# NODE_ENV=production ile route modullerini import eder). Gercek, gizli deger
# runtime'da docker-compose/ortam degiskeni ile saglanir, bu build-time degeri
# ASLA calisma zamaninda kullanilmaz.
ENV JWT_SECRET=build-time-placeholder-not-used-at-runtime
RUN npm run build

# ---- runner: minimal calisma zamani ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/planrep.db

CMD ["node", "server.js"]
