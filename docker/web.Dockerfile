# syntax=docker/dockerfile:1
# Imaginile serviciilor `web` (Next.js standalone, ținta implicită `runner`), `worker` (ținta `worker`) și `realtime` (ținta `realtime`).
# Build din rădăcina monorepo-ului: docker compose build

FROM node:22-alpine AS base
# OpenSSL: motorul Prisma îl cere pe Alpine (musl).
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Prin turbo, ca să ruleze întâi și `prisma generate` din @gcs/db (clientul Prisma).
RUN pnpm turbo run build --filter=@gcs/web

# `gcs-worker`: rulează din sursele TypeScript (tsx), cu dependențele workspace-ului (Prisma, sharp, argon2).
# Același user `gcs` ca `web` (același UID), ca să poată citi `.env.runtime` (0600) din volumul de configurare.
FROM build AS worker
ENV NODE_ENV=production
RUN addgroup -S gcs && adduser -S gcs -G gcs \
 && mkdir -p /app/config && chown gcs:gcs /app/config
USER gcs
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/main.ts"]

# `gcs-realtime`: Socket.io (notificări, chat, prezență), tot din surse, cu același user `gcs`.
FROM build AS realtime
ENV NODE_ENV=production     PORT=4000
RUN addgroup -S gcs && adduser -S gcs -G gcs  && mkdir -p /app/config && chown gcs:gcs /app/config
USER gcs
WORKDIR /app/apps/realtime
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5   CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S gcs && adduser -S gcs -G gcs \
 && mkdir -p /app/config && chown gcs:gcs /app/config
COPY --from=build --chown=gcs:gcs /app/apps/web/.next/standalone ./
COPY --from=build --chown=gcs:gcs /app/apps/web/.next/static ./apps/web/.next/static
# CLI-ul `gcs` (un singur fișier, fără dependențe): docker compose exec web node apps/web/cli/gcs.mjs …
COPY --from=build --chown=gcs:gcs /app/apps/web/cli/dist/gcs.mjs ./apps/web/cli/gcs.mjs
USER gcs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
