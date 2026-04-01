docker run -d --name kong \
  -e "KONG_DATABASE=off" \
  -e "KONG_DECLARATIVE_CONFIG=/kong/kong.yml" \
  -e "KONG_PROXY_ACCESS_LOG=/dev/stdout" \
  -e "KONG_ADMIN_ACCESS_LOG=/dev/stdout" \
  -e "KONG_PROXY_ERROR_LOG=/dev/stderr" \
  -e "KONG_ADMIN_ERROR_LOG=/dev/stderr" \
  -e "KONG_ADMIN_LISTEN=0.0.0.0:8001" \
  -e "KONG_STATUS_LISTEN=0.0.0.0:9542" \
  -p 8080:8000 \
  -p 8443:8443 \
  -p 8001:8001 \
  -p 9542:9542 \
  -v "./kong/kong.yml:/kong/kong.yml:ro" \
  kong:3.7

  docker run -d --name prometheus \
  -p 9090:9090 \
  -v ./prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus

  docker run -d --name grafana \
  -p 3000:3000 \
  grafana/grafana