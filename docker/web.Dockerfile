# syntax=docker/dockerfile:1
# Imaginea serviciului `web` (Next.js standalone). Build din rădăcina monorepo-ului:
#   docker compose build web

FROM node:22-alpine AS base
# OpenSSL: motorul Prisma îl cere pe Alpine (musl).
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Prin turbo, ca să ruleze întâi și `prisma generate` din @gcs/db (clientul Prisma).
RUN pnpm turbo run build --filter=@gcs/web

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
USER gcs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
