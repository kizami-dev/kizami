# KIZAMI Web (apps/web, Waku/React) container image.
#
# Build context MUST be the repository root, e.g.:
#   docker build -f docker/web.Dockerfile -t ghcr.io/kizami-dev/kizami-web:latest .
#
# WAKU_PUBLIC_API_URL is a build-time value (inlined into the client bundle
# by Vite/Waku's static env replacement), so it must be set at `waku build`
# time, not just at container run time. It is fixed to "/api" here because
# the API is published under the same origin at the /api/* path (Cloudflare
# Tunnel path routing — see deploy/k8s/README.md).

########################################################################
# Stage: build — installs the full (non --prod) dependency set for
# @kizami/web. This is intentional, not just for the `waku build` step:
# `waku start` itself loads apps/web/waku.config.ts at boot via Vite
# (see waku's lib/vite-rsc/loader.js), so `vite`/`dotenv` (waku's own
# transitive deps) must be present at runtime too. Pruning to --prod
# only shaves off @types/react and @types/react-dom (tiny, type-only),
# so a full install is kept for simplicity/robustness.
########################################################################
FROM node:26-slim AS build
WORKDIR /app

# node:26-slim does not ship corepack pre-installed; install pnpm directly,
# pinned to the version in package.json's "packageManager" field.
RUN npm install -g pnpm@10.33.0

COPY . .

RUN pnpm install --frozen-lockfile --filter @kizami/web...

ENV WAKU_PUBLIC_API_URL=/api
RUN pnpm --filter @kizami/web build

########################################################################
# Stage: runtime — only the built dist/ plus the production node_modules
# needed to run `waku start` (waku itself + its runtime deps).
########################################################################
FROM node:26-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

RUN groupadd --system --gid 1001 kizami \
  && useradd --system --uid 1001 --gid kizami --home-dir /app kizami

COPY --from=build --chown=kizami:kizami /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build --chown=kizami:kizami /app/apps/web/package.json /app/apps/web/waku.config.ts ./apps/web/
COPY --from=build --chown=kizami:kizami /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=kizami:kizami /app/node_modules ./node_modules
COPY --from=build --chown=kizami:kizami /app/apps/web/node_modules ./apps/web/node_modules

USER kizami
WORKDIR /app/apps/web

EXPOSE 3000

CMD ["node_modules/.bin/waku", "start", "--port", "3000"]
