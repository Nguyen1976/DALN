# Monitoring Stack — Kong + Prometheus + Grafana + cAdvisor

Tài liệu này mô tả toàn bộ quá trình cấu hình monitoring stack cho dự án DALN.

---

## 1. Kiến trúc tổng quan

```
Browser / Client
       │
       ▼
  Kong Gateway  (:8080)
  ├── /user        → user service  (localhost:3002)
  ├── /chat        → chat service  (localhost:3003)
  └── /notification→ notification  (localhost:3004)
       │
       │  Kong Admin API (:8002)
       │  └── /metrics  ← Prometheus scrapes mỗi 5s
       ▼
  Prometheus (:9090) ← cũng scrapes cAdvisor
       │
       ▼
  Grafana (:3030)   ← visualize dashboards

  cAdvisor (:8082)  ← CPU/memory từng Docker container
```

---

## 2. File đã tạo / chỉnh sửa

| File                 | Mô tả                                                     |
| -------------------- | --------------------------------------------------------- |
| `docker-compose.yml` | Định nghĩa 4 service: kong, prometheus, grafana, cadvisor |
| `prometheus.yml`     | Cấu hình scrape targets cho Prometheus                    |
| `kong/kong.yml`      | _(đã có sẵn)_ — đã bật plugin `prometheus` từ trước       |

---

## 3. Chi tiết từng thành phần

### 3.1 Kong (`kong:3.7` — DB-less)

- Chạy ở chế độ **DB-less**, đọc config từ `kong/kong.yml`.
- Dùng `host.docker.internal:host-gateway` để forward request đến các service NestJS đang chạy local (`npm run start:dev`).
- Plugin `prometheus` đã được bật ở global trong `kong/kong.yml`, tự động expose metrics tại:
  ```
  http://localhost:8002/metrics
  ```
- Port mapping:
  - `8080:8000` — proxy (client gọi vào đây)
  - `8002:8001` — admin API + metrics endpoint

**Tại sao DB-less?** Không cần PostgreSQL, config được quản lý bằng file YAML, phù hợp cho môi trường dev và CI/CD.

### 3.2 Prometheus (`prom/prometheus:latest`)

Config trong `prometheus.yml`:

```yaml
global:
  scrape_interval: 5s # thu thập metrics mỗi 5 giây

scrape_configs:
  - job_name: 'kong'
    static_configs:
      - targets: ['kong:8001']
    metrics_path: /metrics # Kong expose tại /metrics

  - job_name: 'cadvisor'
    static_configs:
      - targets: ['cadvisor:8080']
```

Data được lưu trữ trong Docker volume `prometheus_data`, retention **7 ngày**.

**Metrics quan trọng từ Kong:**

| Metric                                | Ý nghĩa                     |
| ------------------------------------- | --------------------------- |
| `kong_http_requests_total`            | Tổng số request (RPS)       |
| `kong_latency_bucket`                 | Latency histogram (P95/P99) |
| `kong_bandwidth_bytes`                | Bandwidth in/out            |
| `kong_nginx_http_current_connections` | Active connections          |

### 3.3 Grafana (`grafana/grafana:latest`)

- Port: **3030** (3000 bị frontend chiếm, 3001 bị một Node process chiếm)
- Login mặc định: `admin / admin`
- Data được persist qua Docker volume `grafana_data`
- Self-registration bị tắt (`GF_USERS_ALLOW_SIGN_UP=false`)

### 3.4 cAdvisor (`gcr.io/cadvisor/cadvisor:latest`)

- Monitor **CPU, memory, network I/O** của từng Docker container.
- Mount read-only vào `/`, `/sys`, `/var/lib/docker` để đọc cgroup stats.
- Prometheus scrapes cAdvisor mỗi 5s ở `cadvisor:8080`.

**Metrics quan trọng từ cAdvisor:**

| Metric                                   | Ý nghĩa        |
| ---------------------------------------- | -------------- |
| `container_cpu_usage_seconds_total`      | CPU usage      |
| `container_memory_usage_bytes`           | RAM đang dùng  |
| `container_network_transmit_bytes_total` | Bytes gửi ra   |
| `container_network_receive_bytes_total`  | Bytes nhận vào |

---

## 4. Cách chạy

### Chỉ chạy Kong (như cũ)

```bash
cd backend
docker compose up kong --build
```

### Chạy full monitoring stack

```bash
cd backend
docker compose up -d
```

### Dừng stack

```bash
docker compose down
```

### Dừng và xóa toàn bộ data (volumes)

```bash
docker compose down -v
```

---

## 5. Kiểm tra sau khi chạy

```bash
# Kong hoạt động không?
curl http://localhost:8002/status

# Metrics có expose không?
curl http://localhost:8002/metrics | grep kong_http_requests_total

# Prometheus scrape thành công chưa?
# Vào http://localhost:9090/targets → State phải là "UP"

# Test route
curl http://localhost:8080/user
```

---

## 6. Cấu hình Grafana (lần đầu)

### Bước 1 — Thêm Prometheus Data Source

1. Vào `http://localhost:3030`
2. Login: `admin / admin`
3. **Connections → Data Sources → Add data source**
4. Chọn **Prometheus**
5. URL nhập: `http://prometheus:9090`
6. Nhấn **Save & Test** → phải hiện "Data source is working"

### Bước 2 — Import Dashboard Kong

1. **Dashboards → Import**
2. Nhập ID: **`7424`** (Kong Official Prometheus Dashboard)
3. Chọn data source vừa tạo → **Import**

### Bước 3 — Import Dashboard cAdvisor (Container Metrics)

1. **Dashboards → Import**
2. Nhập ID: **`14282`** hoặc **`193`**
3. Chọn data source Prometheus → **Import**

---

## 7. Các metrics có thể xem trên Grafana

| Metric                   | Dashboard         |
| ------------------------ | ----------------- |
| RPS (request per second) | Kong (#7424)      |
| P95 / P99 latency        | Kong (#7424)      |
| 4xx / 5xx error rate     | Kong (#7424)      |
| Upstream latency         | Kong (#7424)      |
| Bandwidth in/out         | Kong (#7424)      |
| CPU từng container       | cAdvisor (#14282) |
| Memory từng container    | cAdvisor (#14282) |
| Network I/O container    | cAdvisor (#14282) |

---

## 8. Port summary

| Service              | Host port | URL                             |
| -------------------- | --------- | ------------------------------- |
| Kong Proxy           | 8080      | `http://localhost:8080`         |
| Kong Admin / Metrics | 8002      | `http://localhost:8002/metrics` |
| Prometheus           | 9090      | `http://localhost:9090`         |
| Grafana              | 3030      | `http://localhost:3030`         |
| cAdvisor             | 8082      | `http://localhost:8082`         |
| user service (local) | 3002      | `http://localhost:3002`         |
| chat service (local) | 3003      | `http://localhost:3003`         |
| notification (local) | 3004      | `http://localhost:3004`         |
| frontend dev         | 5173      | `http://localhost:5173`         |

---

## 9. Load test để xem Grafana nhảy số

Dùng script có sẵn trong `testing/`:

```bash
cd testing
node script.js
```

Hoặc curl đơn giản:

```bash
# Gửi 100 request liên tục
for i in {1..100}; do curl -s http://localhost:8080/user > /dev/null; done
```

Sau đó vào Grafana → Dashboard Kong → thấy RPS và latency graph thay đổi realtime.
