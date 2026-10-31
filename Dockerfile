# syntax=docker/dockerfile:1

# One image for the API and the built client: same origin, no CORS, no second
# deployment. Node strips the types off the server and the core at startup, so
# only `apps/web` has a build step.

FROM node:26-alpine AS base
WORKDIR /app
# Node no longer bundles Corepack, and the image must use the pnpm this repo
# pins rather than a second version that happens to be current today.
COPY package.json ./
RUN npm install --global "pnpm@$(node -p 'require("./package.json").packageManager.split("@")[1]')"

# Full install for the build: the web build needs Vite and the core sources.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @brigue/web build

# Runtime dependencies only, still in the workspace layout: `@brigue/core`
# stays a symlink out of node_modules, which is the only place Node agrees to
# strip types.
FROM base AS runtime-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# A fresh base, not `base`: production has no package manager in it.
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    WEB_ROOT=/app/web
COPY --from=runtime-deps /app/node_modules node_modules
COPY --from=runtime-deps /app/apps/server/node_modules apps/server/node_modules
COPY --from=build /app/apps/web/dist web
COPY apps/server/src apps/server/src
COPY apps/server/scripts apps/server/scripts
COPY apps/server/db apps/server/db
COPY apps/server/package.json apps/server/
COPY packages/core/src packages/core/src
COPY packages/core/package.json packages/core/

# The port comes from PORT, set by whatever runs the image.
USER node
WORKDIR /app/apps/server
CMD ["node", "src/main.ts"]
