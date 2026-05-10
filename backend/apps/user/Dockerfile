# ===== Stage 1: Build =====
FROM --platform=linux/amd64 node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Dùng install thay vì ci để đảm bảo generate chạy tốt
RUN npm install 

COPY . .
# Chạy generate TRƯỚC KHI build
RUN npx prisma generate --schema=apps/user/prisma/schema.prisma
RUN npm run build -- user

# ===== Stage 2: Production =====
FROM --platform=linux/amd64 node:20-alpine

WORKDIR /app

# Chỉ copy những thứ thực sự cần thiết
COPY package*.json ./
RUN npm ci --only=production

# 1. Copy thư mục dist (chứa code đã build)
COPY --from=builder /app/dist ./dist

# 2. QUAN TRỌNG: Copy thư mục prisma đã generate (Chứa engine cho Linux)
# Prisma mặc định lưu ở node_modules/.prisma, ta cần nó ở Stage 2
COPY --from=builder /app/node_modules/.prisma/client/*.node ./dist/apps/user/
COPY --from=builder /app/node_modules/.prisma/client/*.node ./
# 3. (Optional) Nếu bạn có custom output cho prisma, hãy copy cả thư mục đó
# Ví dụ: COPY --from=builder /app/apps/user/src/generated ./apps/user/src/generated

CMD ["node", "dist/apps/user/main.js"]