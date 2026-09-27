# syntax=docker/dockerfile:1.7
# ── Kabila Frontend (Developer Portal) - Multi-stage build ─────
# Stage 1: install deps + build the static React bundle
# Stage 2: serve the bundle with non-root nginx (nginx-unprivileged)
#
# Follows docker-image-optimization-skill.md:
#   - multi-stage build (§2), node:24-slim build stage (§1/§7)
#   - npm ci for reproducible installs (§3)
#   - non-root nginx runtime (nginxinc/nginx-unprivileged:alpine, §9)
#   - frontend/.dockerignore keeps the build context small (§6)
# ─────────────────────────────────────────────────────

ARG NODE_IMAGE=node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

FROM ${NODE_IMAGE} AS build
WORKDIR /app

# npm ci installs exactly what package-lock.json declares, so images are
# reproducible across machines/CI. The lockfile is committed and kept in
# sync with package.json (verified by the CI job). On some Docker overlayfs
# hosts npm/esbuild can sporadically fail with ETXTBSY while validating a
# freshly unpacked binary; retry from a clean node_modules tree.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    for attempt in 1 2 3; do \
      npm ci --no-audit --no-fund && break; \
      status=$?; \
      if [ "$attempt" -eq 3 ]; then exit "$status"; fi; \
      echo "npm ci failed (attempt $attempt/3); retrying after clean install..."; \
      rm -rf node_modules; \
      sleep $((attempt * 2)); \
    done

# Edition flag - defaults to community for self-hosted
ARG VITE_EDITION=community
# Optional: override API base URL (leave empty for same-origin via nginx proxy)
ARG VITE_API_URL

COPY . .
# .dockerignore already excludes .env.* - belt-and-braces removal so
# container builds always use the same-origin API (nginx proxy)
RUN rm -f .env.production && npm run build

# Serve with the slim non-root nginx variant; no build tooling is retained.
FROM nginxinc/nginx-unprivileged:stable-alpine-slim@sha256:bcf91d2c73ab64fa1c4ac7fbac5ac523057c8af7d553ab9251c7aef38c260979

# OCI metadata (self-hosted-docker-production-skill.md: traceability).
ARG VERSION=dev
ARG SOURCE_COMMIT=
LABEL org.opencontainers.image.title="Kabila Frontend" \
      org.opencontainers.image.description="Kabila developer portal (React)" \
      org.opencontainers.image.source="https://github.com/weareupsyd/kabila" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.licenses="MIT"

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
