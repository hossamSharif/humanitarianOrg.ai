# syntax=docker/dockerfile:1.6
# @ngo/api image for Fly.io. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t ngo-api .
# Builds the workspace deps (@ngo/shared, @ngo/database) and the API, then ships a prod-only
# bundle produced by `pnpm deploy`.

ARG NODE_VERSION=20-slim

# ---------- base ----------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
WORKDIR /repo

# ---------- builder ----------
FROM base AS builder

# Manifests first so the install layer survives source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
RUN pnpm install --frozen-lockfile --filter @ngo/api...

COPY packages/shared ./packages/shared
COPY packages/database ./packages/database
COPY apps/api ./apps/api

RUN pnpm --filter @ngo/shared build \
 && pnpm --filter @ngo/database build \
 && pnpm --filter @ngo/api build \
 && pnpm --filter @ngo/api --prod deploy /deploy

# ---------- runner ----------
FROM node:${NODE_VERSION} AS runner
RUN apt-get update && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=builder --chown=node:node /deploy/package.json ./
COPY --from=builder --chown=node:node /deploy/node_modules ./node_modules
COPY --from=builder --chown=node:node /deploy/dist ./dist

USER node
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
