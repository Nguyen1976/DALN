# Kong Migration Notes

This document summarizes all updates applied to replace the old runtime API gateway entrypoint with Kong.

## 1. Goal

- Remove `api-gateway` from runtime traffic path.
- Use Kong as the single public HTTP entrypoint.
- Keep frontend contract unchanged (`/user`, `/chat`, `/notification` routes).
- Support local development where backend services run with `npm run start:dev`.

## 2. Architecture After Update

- Public gateway: Kong
- Kong proxy port: `8080`
- Kong admin port: `8002`
- Upstream targets (dev mode):
  - `http://host.docker.internal:3002` -> user service
  - `http://host.docker.internal:3003` -> chat service
  - `http://host.docker.internal:3004` -> notification service

Frontend calls Kong at:

- `http://localhost:8080`

## 3. Main Changes

### 3.1 Kong config and routing

Updated `backend/kong/kong.yml`:

- Declarative config with 3 services (`user-http`, `chat-http`, `notification-http`)
- Route prefixes:
  - `/user`
  - `/chat`
  - `/notification`
- Global CORS plugin
- Rate limiting plugin per route

### 3.2 Docker compose

Updated `backend/docker-compose.yml`:

- Keep Kong as standalone service for gateway runtime.
- Kong no longer depends on app containers for startup.
- Kong port mapping:
  - `8080:8000`
  - `8002:8001`
- Redis and RabbitMQ are treated as external in your machine setup.

### 3.3 Backend services (user/chat/notification)

Services were updated to support HTTP + gRPC behavior needed for old gateway compatibility:

- HTTP endpoints exposed in each service.
- Auth guard used at service level.
- Validation + response envelope + exception mapping applied.
- Existing route shape kept for frontend compatibility.

### 3.4 External dependency support

RabbitMQ/Redis URLs were made environment-driven in service modules:

- `RABBITMQ_URL`
- `REDIS_HOST`
- `REDIS_PORT`

This allows running services in Docker or local dev without hardcoded host assumptions.

### 3.5 Frontend API endpoint

Updated `frontend/src/utils/constant.ts`:

- `API_ROOT` moved to `http://localhost:8080`

## 4. How To Run (Your Preferred Mode)

### Mode A: Only run Kong in Docker

```bash
cd backend
docker compose up -d kong
```

Then run services locally in separate terminals:

```bash
cd backend
npm run start:dev user
npm run start:dev chat
npm run start:dev notification
# optional
npm run start:dev realtime-gateway
```

### Mode B: Run Kong directly with docker run

Example command (already tested in your terminal):

```bash
docker run -d \
  --name kong \
  --add-host=host.docker.internal:host-gateway \
  -e KONG_DATABASE=off \
  -e KONG_DECLARATIVE_CONFIG=/etc/kong/kong.yml \
  -e KONG_PROXY_ACCESS_LOG=/dev/stdout \
  -e KONG_ADMIN_ACCESS_LOG=/dev/stdout \
  -e KONG_PROXY_ERROR_LOG=/dev/stderr \
  -e KONG_ADMIN_ERROR_LOG=/dev/stderr \
  -e KONG_ADMIN_LISTEN=0.0.0.0:8001 \
  -p 8080:8000 \
  -p 8002:8001 \
  -v $(pwd)/kong/kong.yml:/etc/kong/kong.yml:ro \
  kong:3.7
```

## 5. Verification Commands

Check Kong container status:

```bash
docker ps | grep kong
```

Check Kong admin API:

```bash
curl http://localhost:8002/services
curl http://localhost:8002/routes
curl http://localhost:8002/plugins
```

Quick route smoke test:

```bash
curl -i http://localhost:8080/user
```

## 6. Known Notes

- If backend services are not running on ports `3002/3003/3004`, Kong returns upstream connection errors.
- If login cookies are used, keep frontend requests with credentials enabled.
- If you switch back to full Docker app containers, you may want to point Kong upstreams back to container service names.

## 7. Files Most Relevant To This Migration

- `backend/kong/kong.yml`
- `backend/docker-compose.yml`
- `backend/apps/user/src/http/user-http.controller.ts`
- `backend/apps/chat/src/http/chat-http.controller.ts`
- `backend/apps/notification/src/http/notification-http.controller.ts`
- `backend/libs/common/src/http/grpc-http.filter.ts`
- `backend/libs/common/src/http/response.interceptor.ts`
- `frontend/src/utils/constant.ts`
