# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Generate Prisma
RUN npx prisma generate --schema=apps/user/prisma/schema.prisma
# Build NestJS
RUN npm run build -- user

# CHIÊU CUỐI: Tìm file engine và copy vào thẳng thư mục dist
RUN find node_modules/.prisma/client -name "*.node" -exec cp {} dist/apps/user/ \;

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app

# Chỉ copy package.json và cài production
COPY package*.json ./
RUN npm ci --only=production

# Copy toàn bộ dist (đã có sẵn file engine bên trong)
COPY --from=builder /app/dist ./dist

# Đảm bảo Prisma Client có thể đọc được schema
COPY --from=builder /app/node_modules/@prisma/client/user ./node_modules/@prisma/client/user
COPY --from=builder /app/apps/user/prisma ./apps/user/prisma

# Khai báo biến môi trường chỉ thẳng đường dẫn Engine
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/dist/apps/user/libquery_engine-linux-musl-openssl-3.0.x.so.node

CMD ["node", "dist/apps/user/main.js"]