# ===== Stage 1: Build =====
FROM --platform=linux/amd64 node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# 1. Tạo Prisma Client (Nhớ kiểm tra binaryTargets trong schema.prisma như đã bàn)
RUN npx prisma generate --schema=apps/user/prisma/schema.prisma

# 2. Build code NestJS
RUN npm run build -- user

# 3. MẸO QUYẾT ĐỊNH: Copy file engine vào thư mục dist trước khi sang Stage 2
# Webpack của NestJS thường nằm ở dist/apps/user/main.js
# Ta copy file engine (.node) vào cùng cấp với main.js
RUN cp node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node ./dist/apps/user/ || true

# ===== Stage 2: Production =====
FROM --platform=linux/amd64 node:20-alpine

WORKDIR /app

COPY package*.json ./
# Cài production deps nhưng phải có cả prisma client để runtime gọi được
RUN npm ci --only=production && npm install @prisma/client

# Copy thư mục dist đã có sẵn file engine bên trong
COPY --from=builder /app/dist ./dist

# Copy ngược lại thư mục .prisma để chắc chắn Prisma tìm thấy schema
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

CMD ["node", "dist/apps/user/main.js"]