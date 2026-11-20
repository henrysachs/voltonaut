# syntax=docker/dockerfile:1
# Production image for the Voltonaut API (ADR-004: Docker behind the existing Financensor Traefik).
# Build from the repository root: docker build -f deploy/Dockerfile -t voltonaut-server:<tag> .

FROM node:24.22.3-slim AS build
WORKDIR /repo
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD keeps apps/web's postinstall a no-op; the server image needs no browsers.
ENV CI=true PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable pnpm
COPY .npmrc package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @voltonaut/server build
# Standalone bundle: dist plus production node_modules (verified with `pnpm --filter @voltonaut/server deploy --prod`).
RUN pnpm --filter @voltonaut/server deploy --prod /out/server

FROM node:24.22.3-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/server ./
# SQLite lives on a named volume shared with the Litestream sidecar (used from E5 on).
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
