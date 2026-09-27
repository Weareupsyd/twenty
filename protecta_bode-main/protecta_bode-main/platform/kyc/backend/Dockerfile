# syntax=docker/dockerfile:1.7
# ── Kabila API - Multi-stage build ──────────────────
# Stage 1: install deps, build shared package, compile TypeScript
# Stage 2: slim runtime with only what's needed to run
#
# Follows docker-image-optimization-skill.md:
#   - multi-stage build (§2), minimal base image node:24-slim (§1/§7)
#   - npm ci for reproducible installs (§3)
#   - caches cleaned in the same layer (§4)
#   - non-root runtime user (§9)
#   - root .dockerignore keeps the build context small (§6)
#
# ML dependencies (TensorFlow, ONNX, PaddleOCR, canvas) have been moved
# to the Engine Worker container. This image is ~250MB - below the
# skill's 500MB warning threshold.
#
# Build context is the repo root (configured in docker-compose.yml):
#   docker compose up -d --build
# ─────────────────────────────────────────────────────

ARG NODE_IMAGE=node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

# ── Stage 1: Build ──────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# All backend native modules publish compatible pre-built binaries. No compiler,
# wget, curl, or OS package manager payload is needed in this build stage.

# Copy workspace root + package manifests + lockfile (for npm workspace resolution)
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/

# npm ci = reproducible installs from the committed lockfile (no --audit/--fund
# noise in builds; npm audit runs separately in CI). On some Docker overlayfs
# hosts npm/esbuild can sporadically fail with ETXTBSY while validating a
# freshly unpacked binary; retry from a clean node_modules tree to keep local
# source deployments deterministic without weakening lockfile enforcement.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    for attempt in 1 2 3; do \
      npm ci --no-audit --no-fund && break; \
      status=$?; \
      if [ "$attempt" -eq 3 ]; then exit "$status"; fi; \
      echo "npm ci failed (attempt $attempt/3); retrying after clean install..."; \
      rm -rf node_modules; \
      sleep $((attempt * 2)); \
    done

# Build shared package first (backend depends on it)
COPY shared/src/ shared/src/
COPY shared/tsconfig.json shared/
RUN cd shared && npx tsc && npx tsc-alias

# Migration SQL travels with the image. The entrypoint auto-migrates from
# MIGRATIONS_DIR, and a host with no bind mount (Railway deploys this Dockerfile
# directly) previously had no migrations directory at all, so `npm run migrate`
# at boot was skipped in silence and schema repairs that exist as files in the
# repo never reached production. Compose still bind-mounts the host copy over
# /app/backend/migrations, so a mounted checkout keeps winning.
COPY supabase/migrations/ /app/supabase/migrations/

# Copy backend source, entrypoint, and compile TypeScript
COPY backend/src/ backend/src/
COPY backend/tsconfig.json backend/
COPY backend/docker-entrypoint.sh backend/docker-entrypoint.sh
RUN cd backend && npx tsc && npx tsc-alias

# Strip devDependencies - only production deps go to runtime stage. Keep the
# workspace node_modules directory present even if a future npm version hoists
# every package; Docker COPY requires its source path to exist.
RUN npm prune --omit=dev && mkdir -p backend/node_modules

# ── Stage 2: Runtime ────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app/backend

# OCI metadata for locally built images. Optional build args default to
# dev/local values when Compose builds directly from this checkout.
ARG VERSION=dev
ARG SOURCE_COMMIT=
LABEL org.opencontainers.image.title="Kabila API" \
      org.opencontainers.image.description="Kabila core identity verification API" \
      org.opencontainers.image.source="https://github.com/weareupsyd/kabila" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.licenses="MIT"

# Health checks use Node's built-in HTTP client, so the runtime needs no apt
# packages beyond the libraries already present in the pinned Node slim base.

# Use the same fixed high UID/GID as the retired Python downloader. The
# OpenSanctions bind mount can therefore be repaired once and remain writable
# across upgrades instead of depending on the base image's next free system UID.
ARG APP_UID=10001
ARG APP_GID=10001
RUN groupadd --gid "${APP_GID}" nodeuser \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --no-create-home --shell /bin/false nodeuser

# Copy compiled output preserving workspace structure for @kabila/shared resolution.
# npm workspaces hoists most dependencies to /app/node_modules, but packages
# with version conflicts remain in /app/backend/node_modules. The API needs
# both locations at runtime (dotenv and several other production dependencies
# are workspace-local in the committed lockfile).
COPY --from=build --chown=nodeuser:nodeuser /app/node_modules /app/node_modules
COPY --from=build --chown=nodeuser:nodeuser /app/backend/node_modules ./node_modules
COPY --from=build --chown=nodeuser:nodeuser /app/backend/dist ./dist
COPY --from=build --chown=nodeuser:nodeuser /app/shared/dist /app/shared/dist
COPY --from=build --chown=nodeuser:nodeuser /app/shared/package.json /app/shared/package.json
COPY --from=build --chown=nodeuser:nodeuser /app/backend/package.json ./package.json

# Catch omitted workspace-local dependencies during the image build instead of
# allowing the API container to fail repeatedly at startup.
RUN node -e "import('dotenv/config')"

# Entrypoint: auto-migrate then start server
# sed converts Windows CRLF -> LF (git on Windows may check out with \r\n)
COPY --from=build --chown=nodeuser:nodeuser /app/backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod 0555 ./docker-entrypoint.sh \
    && mkdir -p ./uploads ./temp ./logs \
    && chown nodeuser:nodeuser ./uploads ./temp ./logs

# Migrations: baked into the image so auto-migrate works anywhere, and
# docker-compose bind-mounts the host supabase/migrations/ over this same path
# (a mount shadows the image copy, so a mounted checkout is still authoritative).
COPY --from=build --chown=nodeuser:nodeuser /app/supabase/migrations ./migrations
ENV MIGRATIONS_DIR=/app/backend/migrations

USER nodeuser

EXPOSE 3001

CMD ["sh", "./docker-entrypoint.sh"]
