# Web image — build from the repo root: docker build -f apps/web/Dockerfile .
# Next.js standalone server on :3000. /api/* is proxied to API_ORIGIN, fixed at build time.
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @prakai/web
COPY packages/core packages/core
COPY apps/web apps/web
ARG API_ORIGIN=http://pos-backend:4000
ENV API_ORIGIN=$API_ORIGIN
RUN npm run build -w @prakai/web

FROM node:22-alpine
LABEL project=pos
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
