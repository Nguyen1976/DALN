# syntax=docker/dockerfile:1
# ============================================================================
# Frontend production: build tĩnh bằng Vite rồi phục vụ bằng nginx.
#
# VITE_* được "nướng" vào bundle lúc build, nên đổi địa chỉ API = build lại
# image. Biến truyền qua build-arg thắng giá trị trong .env.production (Vite
# không ghi đè biến đã có sẵn trong môi trường).
# ============================================================================

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_ROOT
ARG VITE_SOCKET_URL
# Chuỗi rỗng vẫn đè .env.production và app sẽ lặng lẽ gọi localhost -> chặn sớm.
RUN test -n "${VITE_API_ROOT}" && test -n "${VITE_SOCKET_URL}" \
    || { echo "Thiếu build-arg VITE_API_ROOT / VITE_SOCKET_URL" >&2; exit 1; }
ENV VITE_API_ROOT=${VITE_API_ROOT} \
    VITE_SOCKET_URL=${VITE_SOCKET_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
