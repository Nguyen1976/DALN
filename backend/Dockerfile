# syntax=docker/dockerfile:1
# ============================================================================
# Dockerfile DÙNG CHUNG cho toàn bộ NestJS monorepo (microservices).
#
#   - target "development": 1 image duy nhất cho TẤT CẢ service, chạy
#     `nest start <SERVICE> --watch`. Service nào chạy do biến môi trường
#     SERVICE quyết định lúc runtime (xem docker-compose.yml) -> hot-reload.
#   - target "production": build theo từng service qua build-arg SERVICE,
#     chạy `node dist/apps/<SERVICE>/main.js`.
#
# SERVICE hợp lệ: user | chat | notification | realtime-gateway | recommendation | saga-orchestrator
# ============================================================================

ARG NODE_IMAGE=node:20-alpine

# ----------------------------------------------------------------------------
# Base: dùng chung cho mọi stage
# ----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app
# openssl: Prisma engine cần trên alpine. bash: chạy entrypoint script.
RUN apk add --no-cache openssl bash

# ----------------------------------------------------------------------------
# Deps: cài node_modules (cache theo package*.json) - dùng cho dev & build
# ----------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ----------------------------------------------------------------------------
# Development: 1 image cho tất cả service, source được bind-mount lúc runtime
# ----------------------------------------------------------------------------
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
# Copy source làm fallback (khi chạy không mount). Lúc dev compose sẽ mount đè ./
COPY . .
COPY docker/entrypoint.dev.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 3001 3002 3003 3004 3005
ENTRYPOINT ["entrypoint.sh"]

# ----------------------------------------------------------------------------
# Build: build 1 service cụ thể (production)
# ----------------------------------------------------------------------------
FROM base AS build
ARG SERVICE
ARG TARGETARCH
ENV SERVICE=${SERVICE}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma: chỉ sinh query engine cho OS/arch của image (không ship native/darwin).
RUN if [ -f "apps/${SERVICE}/prisma/schema.prisma" ]; then \
      rm -rf "apps/${SERVICE}/src/generated" && \
      case "${TARGETARCH}" in \
        arm64) PRISMA_BT="linux-musl-arm64-openssl-3.0.x" ;; \
        amd64) PRISMA_BT="linux-musl-openssl-3.0.x" ;; \
        *) PRISMA_BT="linux-musl-openssl-3.0.x" ;; \
      esac && \
      sed -i.bak "s/binaryTargets = \[.*\]/binaryTargets = [\"${PRISMA_BT}\"]/" \
        "apps/${SERVICE}/prisma/schema.prisma" && \
      npx prisma generate --schema="apps/${SERVICE}/prisma/schema.prisma"; \
    fi
RUN npm run build -- "${SERVICE}" \
    && find dist -name '*.dylib.node' -delete

# ----------------------------------------------------------------------------
# Prod deps: prune trong stage riêng để layer COPY sang production không mang dev deps
# ----------------------------------------------------------------------------
FROM base AS prod-deps
ARG SERVICE
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY docker/prune-prod-deps.sh /tmp/prune-prod-deps.sh
RUN chmod +x /tmp/prune-prod-deps.sh \
    && npm prune --omit=dev \
    && npm cache clean --force \
    && /tmp/prune-prod-deps.sh "${SERVICE}"

# ----------------------------------------------------------------------------
# Production: image gọn — node_modules đã prune theo SERVICE + dist webpack
# ----------------------------------------------------------------------------
FROM base AS production
ARG SERVICE
ENV SERVICE=${SERVICE}
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Email HTML templates (notification service reads at runtime)
COPY --from=build /app/libs/mailer/src/templates ./libs/mailer/src/templates
COPY docker/link-prisma-generated.sh /tmp/link-prisma-generated.sh
RUN chmod +x /tmp/link-prisma-generated.sh \
    && /tmp/link-prisma-generated.sh "${SERVICE}"
COPY docker/entrypoint.prod.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 3001 3002 3003 3004 3005
ENTRYPOINT ["entrypoint.sh"]
