# API image — build from the repo root: docker build -f apps/api/Dockerfile .
# Runs TypeScript directly with tsx (as in dev); applies pending migrations, then serves on :4000.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @prakai/api --omit=dev && mkdir -p apps/api/node_modules

FROM node:22-alpine
LABEL project=pos
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
# Menu photos live here; mount a volume on it. Pre-created and owned by node so a fresh named volume inherits that.
RUN mkdir -p /data/uploads && chown -R node:node /data
VOLUME /data/uploads
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["sh", "-c", "node --import tsx src/migrate-cli.ts && exec node --import tsx src/server.ts"]
