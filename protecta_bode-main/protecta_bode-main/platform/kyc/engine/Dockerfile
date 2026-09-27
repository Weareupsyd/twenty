# syntax=docker/dockerfile:1.7
# ── Kabila Engine Worker - Multi-stage build ────────────────────
# Stage 1: install deps, download models, build shared package, compile TypeScript
# Stage 2: slim runtime with only what's needed to run ML inference
#
# Follows docker-image-optimization-skill.md:
#   - multi-stage build (§2), minimal base image node:24-slim (§1/§7)
#   - npm ci for reproducible installs (§3)
#   - caches cleaned in the same layer (§4)
#   - runtime stage installs runtime libs only - no compilers (§3)
#   - non-root runtime user (§9)
#   - root .dockerignore keeps the build context small (§6)
#
# This remains the bundle's largest application image because OCR, face,
# liveness, and deepfake dependencies/models are required offline. Voice ASR,
# speaker models, sherpa-onnx, and ffmpeg are isolated behind the explicit
# WITH_VOICE_AUTH=true variant instead of burdening the default image.
#
# Build context is the repo root (configured in docker-compose.yml):
#   docker compose up -d --build
# ─────────────────────────────────────────────────────

ARG NODE_IMAGE=node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
# false is the default because per-developer voice authentication is disabled by
# default. The opt-in variant adds sherpa-onnx, speech models, and ffmpeg.
ARG WITH_VOICE_AUTH=false

# ── Stage 1: Build ──────────────────────────────────
FROM ${NODE_IMAGE} AS build
ARG WITH_VOICE_AUTH
WORKDIR /app

# Native build dependencies (needed to compile canvas, sharp, onnxruntime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    bzip2 \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace root + package manifests + lockfile (for npm workspace resolution)
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY engine/package.json engine/

# The slim variant never installs sherpa's native package. Adjust only the
# disposable copies of package.json/package-lock.json so the committed lockfile
# remains the source of truth for the opt-in voice build.
RUN if [ "$WITH_VOICE_AUTH" != "true" ]; then \
      node -e 'const fs=require("fs"); const pkg=JSON.parse(fs.readFileSync("engine/package.json")); delete pkg.dependencies["sherpa-onnx-node"]; fs.writeFileSync("engine/package.json",JSON.stringify(pkg)); const lock=JSON.parse(fs.readFileSync("package-lock.json")); delete lock.packages.engine.dependencies["sherpa-onnx-node"]; for (const key of Object.keys(lock.packages)) if (key.startsWith("node_modules/sherpa-onnx-")) delete lock.packages[key]; fs.writeFileSync("package-lock.json",JSON.stringify(lock));'; \
    fi

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

# Copy pre-generated models (e.g., deepfake-detector.onnx from export script)
COPY shared/models/ shared/models/

# Download face detection model weights + the deepfake detector model.
# The deepfake model defaults to a PUBLIC HuggingFace ONNX export (Apache-2.0,
# no GITHUB_TOKEN / private repo needed) and downloads automatically at build
# time; it can also be committed at shared/models/deepfake-detector.onnx.
# Set DEEPFAKE_MODEL_URL to override the source.
COPY engine/download-models.js engine/
RUN cd engine && WITH_VOICE_AUTH="$WITH_VOICE_AUTH" node download-models.js

# Build shared package first (engine depends on it)
COPY shared/src/ shared/src/
COPY shared/tsconfig.json shared/
RUN cd shared && npx tsc && npx tsc-alias

# Copy engine source and compile TypeScript
COPY engine/src/ engine/src/
COPY engine/tsconfig.json engine/
RUN cd engine && npx tsc && npx tsc-alias

# Strip devDependencies - only production deps go to runtime stage. Keep the
# workspace node_modules directory present even if a future npm version hoists
# every package; Docker COPY requires its source path to exist.
RUN npm prune --omit=dev && mkdir -p engine/node_modules

# ── Stage 2: common runtime ─────────────────────────
FROM ${NODE_IMAGE} AS runtime-base
WORKDIR /app/engine

# Runtime-only native libraries for canvas. Health checks use Node itself, so
# wget/curl are unnecessary. ffmpeg belongs only in the voice-auth variant.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libjpeg62-turbo \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with home directory (PaddleOCR caches models in ~/.cache).
RUN groupadd -r nodeuser && useradd -r -g nodeuser -m -s /bin/false nodeuser \
    && mkdir -p /home/nodeuser/.cache/ppu-paddle-ocr \
    && chown -R nodeuser:nodeuser /home/nodeuser

# The default stage adds nothing. Voice auth opts into ffmpeg and its large
# codec dependency tree; the selected stage is copied into the final image.
FROM runtime-base AS runtime-false

FROM runtime-base AS runtime-true
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

FROM runtime-${WITH_VOICE_AUTH} AS runtime
ARG WITH_VOICE_AUTH
ENV VOICE_AUTH_ENABLED=${WITH_VOICE_AUTH}

# OCI metadata for locally built images. Optional build args default to
# dev/local values when Compose builds directly from this checkout.
ARG VERSION=dev
ARG SOURCE_COMMIT=
LABEL org.opencontainers.image.title="Kabila Engine" \
      org.opencontainers.image.description="Kabila ML verification engine (OCR, face detection, liveness)" \
      org.opencontainers.image.source="https://github.com/weareupsyd/kabila" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.licenses="MIT"

# Copy compiled output preserving workspace structure for @kabila/shared resolution.
# --chown applies ownership while files enter their layer; a later recursive
# chown would create a large metadata-only layer over the ML dependency tree.
COPY --from=build --chown=nodeuser:nodeuser /app/node_modules /app/node_modules
COPY --from=build --chown=nodeuser:nodeuser /app/engine/node_modules ./node_modules
COPY --from=build --chown=nodeuser:nodeuser /app/engine/dist ./dist
COPY --from=build --chown=nodeuser:nodeuser /app/engine/models ./models
COPY --from=build --chown=nodeuser:nodeuser /app/shared/dist /app/shared/dist
COPY --from=build --chown=nodeuser:nodeuser /app/shared/models /app/shared/models
COPY --from=build --chown=nodeuser:nodeuser /app/shared/package.json /app/shared/package.json
COPY --from=build --chown=nodeuser:nodeuser /app/engine/package.json ./package.json

# Fail the image build rather than shipping a container that crash-loops when
# a workspace-local runtime dependency was omitted from the final stage.
RUN node -e "import('dotenv/config')"

USER nodeuser
EXPOSE 3002
CMD ["node", "dist/server.js"]
