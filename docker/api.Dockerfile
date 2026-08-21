# KIZAMI API (apps/api) container image.
#
# Build context MUST be the repository root, e.g.:
#   docker build -f docker/api.Dockerfile -t ghcr.io/sasagar/kizami-api:latest .
#
# NOTE: apps/api and packages/db/packages/engine ship as TypeScript source
# (their package.json "exports" point directly at src/*.ts) — there is no
# bundling/build step for the API yet. This image therefore runs the app
# with `tsx` instead of a compiled `node` entrypoint. `tsx` was moved from
# apps/api's devDependencies to dependencies for this reason (see
# apps/api/package.json). Adding a real build pipeline (tsc/tsup emitting
# plain JS, dropping the tsx runtime dependency) is tracked as future work.

########################################################################
# Stage: deps — install production-only dependencies for @kizami/api and
# its workspace dependencies (@kizami/db, @kizami/engine). The full repo
# is copied in so pnpm sees the same workspace project set that
# pnpm-lock.yaml was generated against (required for --frozen-lockfile);
# only the subset needed at runtime is copied out into later stages.
########################################################################
FROM node:26-slim AS deps
WORKDIR /app

# node:26-slim does not ship corepack pre-installed; install pnpm directly,
# pinned to the version in package.json's "packageManager" field.
RUN npm install -g pnpm@10.33.0

COPY . .

RUN pnpm install --frozen-lockfile --prod --filter @kizami/api...

########################################################################
# Stage: runtime — slim image containing only what @kizami/api needs to
# run: its own source, its workspace dependencies' source, and the prod
# node_modules produced above (pnpm workspace deps are filesystem
# symlinks, so the relative apps/packages layout must be preserved).
########################################################################
FROM node:26-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_URL=file:/data/kizami.db
WORKDIR /app

RUN groupadd --system --gid 1001 kizami \
  && useradd --system --uid 1001 --gid kizami --home-dir /app kizami \
  && mkdir -p /data \
  && chown -R kizami:kizami /data /app

COPY --from=deps --chown=kizami:kizami /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=deps --chown=kizami:kizami /app/apps/api ./apps/api
COPY --from=deps --chown=kizami:kizami /app/packages/db ./packages/db
COPY --from=deps --chown=kizami:kizami /app/packages/engine ./packages/engine
COPY --from=deps --chown=kizami:kizami /app/node_modules ./node_modules

USER kizami
WORKDIR /app/apps/api

# /data is where the SQLite file (DATABASE_URL=file:/data/kizami.db) lives;
# mount a PersistentVolume (or bind mount locally) here for durability.
VOLUME ["/data"]

EXPOSE 3001

CMD ["node_modules/.bin/tsx", "src/node.ts"]
