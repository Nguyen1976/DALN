# ===== Stage 1: Build =====
FROM --platform=linux/amd64 node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Generate Prisma (sẽ xuất ra apps/user/src/generated theo cấu hình trên)
RUN npx prisma generate --schema=apps/user/prisma/schema.prisma

# Build NestJS
RUN npm run build -- user

# MẸO QUYẾT ĐỊNH: Copy file engine vào đúng thư mục dist để Webpack không làm mất
RUN cp apps/user/src/generated/*.node dist/apps/user/

# ===== Stage 2: Production =====
FROM --platform=linux/amd64 node:20-alpine
WORKDIR /app

COPY package*.json ./
# Cài cả prisma để có runtime engine
RUN npm ci --only=production && npm install @prisma/client

# Copy toàn bộ thư mục dist đã có sẵn file engine bên trong
COPY --from=builder /app/dist ./dist
# Copy thư mục generated để Prisma Client tham chiếu schema
COPY --from=builder /app/apps/user/src/generated ./apps/user/src/generated

# Môi trường báo cho Prisma biết nơi tìm engine (nếu cần)
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/dist/apps/user/libquery_engine-linux-musl-openssl-3.0.x.so.node

CMD ["node", "dist/apps/user/main.js"]