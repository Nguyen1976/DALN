# Deploy chỉ phần thật sự đổi — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi lần deploy chỉ tạo lại container của service có image thật sự đổi, và code chỉ một service dùng thôi nằm trong lib dùng chung.

**Architecture:**
- CI build image tái lập được (`SOURCE_DATE_EPOCH=0` + `rewrite-timestamp`).
- Compose cho mỗi image một biến tag.
- `deploy.sh` so vân tay nội dung image mới với image container đang chạy, rồi giữ tag cũ khi giống hệt. Logic nằm trong `deploy/lib/image-tags.sh` để test được.
- Tách ~20 phương thức Redis chỉ-user sang `apps/user` (`UserAuthStore`), 2 phương thức chỉ-recommendation sang `apps/recommendation` (`UserFeaturesCache`), và dời `libs/mailer` sang `apps/notification`.

**Tech Stack:** bash (3.2 và 5) · Docker Compose v2+ · BuildKit / `docker/build-push-action@v6` · NestJS 11 · ioredis · Jest 30 + ts-jest · nest-cli (webpack)

**Spec:** [`docs/superpowers/specs/2026-09-26-deploy-only-what-changed-design.md`](../specs/2026-09-26-deploy-only-what-changed-design.md)

## Global Constraints

- **Dời code không đổi hành vi.** Tên phương thức, khoá Redis, TTL, thứ tự lệnh và nội dung template giữ nguyên từng chữ.
- `choose_image_tag` **chỉ** trả tag cũ khi đọc được cả hai vân tay và chúng bằng nhau. Mọi trường hợp khác trả tag mới.
- Vân tay = sha256 của `{{json .RootFS.Layers}}{{json .Config}}`, cắt 16 ký tự đầu. Không dùng `.Id`.
- Biến tag: `DALN_TAG_<TÊN IMAGE viết hoa, '-' đổi thành '_'>`. Mặc định: `${DALN_TAG_X:-${DALN_IMAGE_TAG:-latest}}`.
- `deploy/lib/image-tags.sh` và test của nó phải chạy được trên **bash 3.2** (test chạy trên macOS) lẫn bash 5 (server): không dùng `${x^^}`, `declare -A`, `mapfile`.
- CI: `SOURCE_DATE_EPOCH: 0` và `outputs: type=image,push=true,rewrite-timestamp=true`.
- Cổng kiểm:
  - backend `npm run typecheck`, `npm test`, `npm run lint:check`;
  - suite Redis thật với `TEST_REDIS_PORT=6380` phải *chạy*, không được skip;
  - `bash deploy/tests/image-tags.test.sh`.
- Commit:
  - Conventional Commits bằng tiếng Anh, mỗi task một commit (hoặc nhiều hơn);
  - `git add` đúng từng đường dẫn;
  - **không** thêm trailer `Co-Authored-By`;
  - không stage `.claude/`, `backend/.env*`, `backend/geoip/`.

## Review Focus

1. **Docker Compose trên server quá cũ, không thế được `${A:-${B}}`.** Deploy phải dừng *trước* khi đụng container, và log phải cho biết phiên bản compose. Task 2 thêm dòng in `docker compose version`, và kiểm rằng lệnh compose đầu tiên đọc cấu hình (`compose pull`) chạy trước mọi thay đổi container. Nghiệm thu trên prod đọc dòng đó.
2. **Deploy lại đúng SHA đang chạy** (workflow_dispatch, chạy tay). Không container nào bị tạo lại và tóm tắt ghi "Image mới: không có". Test: Task 1, các ca "deploy lại đúng tag" của `choose_image_tag` và `image_switching`.
3. **Rollback về SHA cũ có nội dung khác.** Service đó phải chuyển tag. Test: Task 1, ca "nội dung khác → tag mới".
4. **Container của service one-shot chỉ ở trạng thái Created/Exited** (`db-push`, `migrate`). Vẫn phải tìm thấy. Test: Task 1 dựng container bằng `docker create` (không bao giờ start).
5. **Template mail ở runtime trong bố cục bundle webpack** (prod và dev watch). Sai đường dẫn nghĩa là mọi mail đều lỗi. Test: Task 5 build `notification` ở local rồi kiểm file có ở `dist/apps/notification/mailer/templates`; Task 6 kiểm image prod và gửi mail thật qua MailHog trong QC dev.

---

## Cấu trúc tệp

| Tệp | Trách nhiệm |
|---|---|
| `deploy/lib/image-tags.sh` | **Mới.** `image_tag_var`, `image_fingerprint`, `running_image_ref`, `choose_image_tag`, `image_switching` |
| `deploy/tests/image-tags.test.sh` | **Mới.** Test trên Docker thật với image `FROM scratch` tí hon |
| `deploy/deploy.sh` | Source lib; chọn tag sau pull; tóm tắt; dọn image |
| `backend/docker-compose.prod.yml` | 10 dòng `image:` dùng biến tag riêng |
| `.github/workflows/ci-cd.yml` | Build tái lập |
| `deploy/README.md` | Bảng "Deploy chỉ làm lại phần có thay đổi" |
| `backend/apps/user/src/auth-store/user-auth.store.ts` | **Mới** — dời từ `RedisService` |
| `backend/apps/user/src/auth-store/user-auth.store.spec.ts` | **Mới** — dời từ `redis.service.spec.ts` |
| `backend/apps/user/src/auth-store/user-auth.store.redis.spec.ts` | **Dời** từ `libs/redis/src/redis.service.redis.spec.ts` |
| `backend/apps/recommendation/src/services/user-features.cache{,.spec}.ts` | **Mới** |
| `backend/apps/notification/src/mailer/*` | **Dời** từ `libs/mailer/src/*` |
| `backend/libs/redis/src/redis.service{,.spec}.ts` | Bỏ phần đã dời |
| `backend/nest-cli.json`, `tsconfig.json`, `package.json`, `Dockerfile` | Bỏ lib mailer; asset template cho notification |

---

## Task 1: `deploy/lib/image-tags.sh` — chọn tag theo nội dung

**Files:**
- Create: `deploy/lib/image-tags.sh`
- Test: `deploy/tests/image-tags.test.sh`

**Interfaces:**
- Produces (các hàm bash, đọc biến `DALN_IMAGE_PREFIX` và `DALN_COMPOSE_PROJECT`, mặc định `daln-prod`):
  - `image_tag_var <image>` in ra `DALN_TAG_<X>`;
  - `image_fingerprint <ref>` in ra 16 ký tự hex; lỗi thì trả mã ≠ 0;
  - `running_image_ref <service>` in ra tham chiếu, hoặc chuỗi rỗng; luôn trả 0;
  - `choose_image_tag <image> <service> <new_tag>` in ra tag;
  - `image_switching <image> <service> <tag>` trả 0 nếu container sẽ đổi image.

- [ ] **Step 1: Viết test (đỏ)**

Tạo `deploy/tests/image-tags.test.sh`:

```bash
#!/usr/bin/env bash
# Test cho deploy/lib/image-tags.sh trên Docker THẬT (local, không đụng prod).
#
#   bash deploy/tests/image-tags.test.sh
#
# Dựng vài image FROM scratch tí hon và container "đã tạo, chưa chạy" mang nhãn
# compose của một project test riêng — đúng trạng thái của db-push/migrate trên
# server (Exited). Dọn sạch khi xong, kể cả khi test đỏ.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DALN_IMAGE_PREFIX="daln-tagtest"
export DALN_COMPOSE_PROJECT="daln-tagtest-$$"
# shellcheck source=../lib/image-tags.sh
source "${ROOT}/deploy/lib/image-tags.sh"

pass=0
fail=0
is() {
  if [ "$1" = "$2" ]; then
    echo "  ✅ $3 ($1)"
    pass=$((pass + 1))
  else
    echo "  ❌ $3 — mong $2, nhận $1"
    fail=$((fail + 1))
  fi
}

WORK="$(mktemp -d)"
cleanup() {
  for id in $(docker ps -aq --filter "label=com.docker.compose.project=${DALN_COMPOSE_PROJECT}"); do
    docker rm -f "${id}" >/dev/null 2>&1
  done
  for ref in $(docker image ls --filter "reference=${DALN_IMAGE_PREFIX}/*" --format '{{.Repository}}:{{.Tag}}'); do
    docker rmi -f "${ref}" >/dev/null 2>&1
  done
  rm -rf "${WORK}"
}
trap cleanup EXIT

# build <ref> <nội dung>: image FROM scratch chứa đúng một file. Cùng nội dung ->
# cùng thư mục -> cùng file (cả mtime) -> layer giống hệt, nhưng --no-cache nên
# với containerd image store .Id vẫn khác: đúng tình huống vân tay phải xử lý.
build() {
  mkdir -p "${WORK}/$2"
  [ -f "${WORK}/$2/f.txt" ] || printf '%s' "$2" >"${WORK}/$2/f.txt"
  printf 'FROM scratch\nCOPY f.txt /f.txt\n' >"${WORK}/$2/Dockerfile"
  docker build -q --no-cache -t "$1" "${WORK}/$2" >/dev/null
}

# make_container <service> <ref>: container chỉ TẠO, không chạy.
make_container() {
  docker create \
    --label "com.docker.compose.project=${DALN_COMPOSE_PROJECT}" \
    --label "com.docker.compose.service=$1" \
    "$2" /f.txt >/dev/null
}

echo "== image_tag_var"
is "$(image_tag_var user)" DALN_TAG_USER "tên đơn"
is "$(image_tag_var db-push)" DALN_TAG_DB_PUSH "gạch ngang -> gạch dưới"
is "$(image_tag_var saga-orchestrator)" DALN_TAG_SAGA_ORCHESTRATOR "tên dài"

echo "== choose_image_tag"
build daln-tagtest/svc:old a
build daln-tagtest/svc:same a
build daln-tagtest/svc:new b
make_container svc daln-tagtest/svc:old
is "$(choose_image_tag svc svc same)" old "nội dung giống hệt -> giữ tag đang chạy"
is "$(choose_image_tag svc svc new)" new "nội dung khác -> tag mới (cũng là ca rollback)"
is "$(choose_image_tag svc svc old)" old "deploy lại đúng tag đang chạy -> giữ nguyên"
is "$(choose_image_tag svc chua-co-container same)" same "chưa có container -> tag mới"
is "$(choose_image_tag svc svc chua-pull)" chua-pull "image mới không inspect được -> tag mới"

build daln-tagtest/other:x a
make_container svc2 daln-tagtest/other:x
is "$(choose_image_tag svc svc2 same)" same "container chạy image của repo khác -> tag mới"

build daln-tagtest/svc3:old a
make_container svc3 daln-tagtest/svc3:old
build daln-tagtest/svc3:same a
docker rmi -f daln-tagtest/svc3:old >/dev/null 2>&1
is "$(choose_image_tag svc3 svc3 same)" same "image đang chạy không inspect được -> tag mới"

echo "== image_switching"
if image_switching svc svc old; then r=yes; else r=no; fi
is "${r}" no "đang chạy đúng tag đó -> không đổi image"
if image_switching svc svc new; then r=yes; else r=no; fi
is "${r}" yes "tag khác -> đổi image"
if image_switching svc chua-co-container new; then r=yes; else r=no; fi
is "${r}" yes "chưa có container -> tạo mới"

echo
echo "TỔNG: ${pass} pass / ${fail} fail"
[ "${fail}" -eq 0 ]
```

- [ ] **Step 2: Chạy, xác nhận đỏ**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN && bash deploy/tests/image-tags.test.sh
```

Mong đợi: exit ≠ 0, với lỗi `deploy/lib/image-tags.sh: No such file or directory` và các hàm `command not found`.

- [ ] **Step 3: Cài đặt**

Tạo `deploy/lib/image-tags.sh`:

```bash
# shellcheck shell=bash
# ============================================================================
# Chọn tag image cho từng service lúc deploy.
#
# Mọi image mang tag là SHA của commit, nên nếu compose dùng thẳng SHA mới thì
# chuỗi `image:` của MỌI service đổi ở MỌI lần deploy và `up -d` tạo lại hết —
# kể cả service không đổi một byte. Ở đây: image mới nào giống hệt NỘI DUNG
# image mà container đang chạy thì GIỮ tag đang chạy, compose thấy cấu hình y
# nguyên và không đụng tới container đó.
#
# Viết cho cả bash 3.2 (test chạy trên macOS) lẫn bash 5 (server).
# ============================================================================

DALN_COMPOSE_PROJECT="${DALN_COMPOSE_PROJECT:-daln-prod}"

# Biến tag của một image: user -> DALN_TAG_USER, db-push -> DALN_TAG_DB_PUSH.
# Phải khớp với các biến trong backend/docker-compose.prod.yml.
image_tag_var() {
  printf 'DALN_TAG_%s\n' "$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')"
}

# Vân tay NỘI DUNG của image: layer (diffID) + config. Không dùng .Id — với
# containerd image store (server đang dùng), .Id là digest của index và đổi sau
# mỗi lần build dù nội dung y hệt. Không inspect được thì trả mã lỗi.
image_fingerprint() {
  local out
  out="$(docker image inspect -f '{{json .RootFS.Layers}}{{json .Config}}' "$1" 2>/dev/null)" || return 1
  [ -n "${out}" ] || return 1
  printf '%s' "${out}" | sha256sum | cut -c1-16
}

# Tham chiếu image của container thuộc <service>, kể cả container đã dừng —
# db-push và migrate là one-shot nên lúc deploy chúng luôn ở trạng thái Exited.
# Không có container: chuỗi rỗng. Luôn trả 0 (head đóng pipe sớm là bình thường).
running_image_ref() {
  docker ps -a \
    --filter "label=com.docker.compose.project=${DALN_COMPOSE_PROJECT}" \
    --filter "label=com.docker.compose.service=$1" \
    --format '{{.Image}}' 2>/dev/null | head -n 1 || true
}

# In ra tag nên dùng cho <image> (tìm container qua <service>): tag đang chạy nếu
# image <new_tag> giống hệt nội dung, còn lại <new_tag>.
#
# Mọi chỗ không chắc đều nghiêng về bản mới: không có container, container chạy
# image của repo khác, inspect lỗi. Giữ nhầm tag cũ cho một image ĐÃ đổi là lỗi
# duy nhất không được phép xảy ra — tạo lại thừa một container chỉ tốn vài giây.
choose_image_tag() {
  local image="$1" service="$2" new_tag="$3"
  local repo="${DALN_IMAGE_PREFIX}/${image}"
  local running running_tag new_fp running_fp

  running="$(running_image_ref "${service}")"
  case "${running}" in
    "${repo}:"*) running_tag="${running#"${repo}:"}" ;;
    *)
      printf '%s\n' "${new_tag}"
      return 0
      ;;
  esac

  if new_fp="$(image_fingerprint "${repo}:${new_tag}")" &&
    running_fp="$(image_fingerprint "${running}")" &&
    [ "${new_fp}" = "${running_fp}" ]; then
    printf '%s\n' "${running_tag}"
  else
    printf '%s\n' "${new_tag}"
  fi
}

# Container của <service> có phải đổi sang <image>:<tag> không — tức là lần
# deploy này thật sự thay image của nó. Deploy lại đúng tag đang chạy thì không.
image_switching() {
  [ "$(running_image_ref "$2")" != "${DALN_IMAGE_PREFIX}/$1:$3" ]
}
```

- [ ] **Step 4: Chạy, xác nhận xanh**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN && bash deploy/tests/image-tags.test.sh
docker image ls --filter 'reference=daln-tagtest/*' -q | wc -l
```

Mong đợi: `TỔNG: 13 pass / 0 fail`, exit 0. Không còn image `daln-tagtest/*` nào (trap đã dọn).

- [ ] **Step 5: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add deploy/lib/image-tags.sh deploy/tests/image-tags.test.sh
git commit -m "feat(deploy): choose each image's tag by content so unchanged services keep theirs"
```

---

## Task 2: Nối vào compose, `deploy.sh`, CI và README

**Files:**
- Modify: `backend/docker-compose.prod.yml` (10 dòng `image:`)
- Modify: `deploy/deploy.sh`
- Modify: `.github/workflows/ci-cd.yml` (bước `Build & push`)
- Modify: `deploy/README.md` (mục "Deploy chỉ làm lại phần có thay đổi")

**Interfaces:**
- Consumes: mọi hàm của Task 1.
- Produces: các biến môi trường `DALN_TAG_<IMAGE>` do `deploy.sh` export trước `up -d`, và dòng tóm tắt `Giữ nguyên`.

- [ ] **Step 1: Compose — mỗi image một biến tag**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend && python3 - <<'PY'
import re
p = 'docker-compose.prod.yml'
s = open(p, encoding='utf-8').read()
pat = re.compile(r'(image: \$\{DALN_IMAGE_PREFIX:-daln\}/)([a-z-]+)(:)\$\{DALN_IMAGE_TAG:-latest\}')
def repl(m):
    var = 'DALN_TAG_' + m.group(2).upper().replace('-', '_')
    return f'{m.group(1)}{m.group(2)}{m.group(3)}${{{var}:-${{DALN_IMAGE_TAG:-latest}}}}'
s, n = pat.subn(repl, s)
assert n == 10, n
open(p, 'w', encoding='utf-8').write(s)
print('replaced', n)
PY
grep -n 'image: \${DALN_IMAGE_PREFIX' docker-compose.prod.yml
```

Mong đợi: `replaced 10`. Mỗi dòng có dạng `…/user:${DALN_TAG_USER:-${DALN_IMAGE_TAG:-latest}}`; `db-push` và `recommendation` xuất hiện 2 lần.

Kiểm compose thế biến đúng:

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
DALN_IMAGE_PREFIX=ghcr.io/x/daln DALN_IMAGE_TAG=newsha DALN_TAG_USER=oldsha DALN_TAG_DB_PUSH=dbsha \
  docker compose -f docker-compose.prod.yml --env-file .env.production.example config --format json 2>/dev/null |
  node -e 'const c=JSON.parse(require("fs").readFileSync(0));for(const[n,s]of Object.entries(c.services))if(s.image&&s.image.includes("ghcr.io/x/daln"))console.log(n.padEnd(22),s.image)'
```

Mong đợi: `user` → `…/user:oldsha`; `db-push`, `migrate`, `migrate-background` → `…/db-push:dbsha`; mọi service khác → `:newsha`. Nếu `config` báo thiếu biến bắt buộc, tạo một env file tạm trong scratchpad (copy từ `.env.production.example`, điền giá trị giả cho biến bị báo) rồi dùng file đó, **không** tạo `backend/.env.production`.

- [ ] **Step 2: `deploy.sh` — source lib, bỏ `DALN_TAG_*` sót lại, in phiên bản compose**

Ngay sau dòng `export DALN_IMAGE_PREFIX DALN_IMAGE_TAG`, thêm:

```bash

# Tag thật sự dùng được chọn theo từng image SAU khi có image (xem
# deploy/lib/image-tags.sh). Xoá mọi DALN_TAG_* sót trong môi trường để pull và
# build luôn nhắm đúng SHA mới.
for var in $(compgen -v DALN_TAG_ || true); do unset "${var}"; done
# shellcheck source=lib/image-tags.sh
source "${ROOT}/deploy/lib/image-tags.sh"
```

Thay thân `image_id()`, giữ nguyên comment phía trên nó:

```bash
image_id() {
  image_fingerprint "${DALN_IMAGE_PREFIX}/$1:${DALN_IMAGE_TAG}" || true
}
```

Ngay sau dòng `echo "[deploy] Commit $(git -C "${ROOT}" log -1 --format='%h %s')"`, thêm:

```bash
# Compose phải thế được biến lồng nhau ${DALN_TAG_X:-${DALN_IMAGE_TAG}}. Bản quá
# cũ sẽ báo lỗi ngay ở `compose pull` — trước khi đụng container — và dòng này
# cho biết vì sao.
echo "[deploy] $(docker compose version)"
```

- [ ] **Step 3: `deploy.sh` — chọn tag ngay sau khi có image**

Trong khối khởi tạo biến tóm tắt (`built=""`, `recreated=""`, …), thêm dòng `kept=""` ngay sau `built=""`.

Trong `summary()`, ngay sau dòng `echo "[deploy] Image mới   :${built:- không có}"`, thêm:

```bash
  echo "[deploy] Giữ nguyên  :${kept:- không có}"
```

Trong `build_local()`, xoá dòng `built+=" ${svc}"`; hai dòng log bên cạnh giữ nguyên.

Thay đoạn từ `pull_started=${SECONDS}` tới hết khối `if/elif/else … fi` của bước lấy image bằng:

```bash
pull_started=${SECONDS}

if [ -n "${DALN_BUILD_LOCAL:-}" ]; then
  image_source="build tại chỗ (DALN_BUILD_LOCAL)"
  build_local
elif compose pull --quiet ${SERVICES}; then
  image_source="pull ${DALN_IMAGE_PREFIX}:${DALN_IMAGE_TAG:0:7} ($((SECONDS - pull_started))s)"
  echo "[deploy] Pull xong sau $((SECONDS - pull_started))s"
else
  # Tag chưa có trên registry (commit chưa qua CI), mạng hỏng, hoặc GHCR sự cố.
  echo "[deploy] Pull thất bại -> quay về build tại chỗ" >&2
  image_source="pull THẤT BẠI -> build tại chỗ"
  build_local
fi

# ---- Chọn tag từng image: giữ tag đang chạy khi nội dung không đổi ----
# Phải xong TRƯỚC bước đếm migration và `up -d`: cả hai đọc image qua compose,
# và `up -d` chỉ tạo lại container có chuỗi `image:` (hay cấu hình khác) đổi.
for svc in ${SERVICES}; do
  tag="$(choose_image_tag "${svc}" "${svc}" "${DALN_IMAGE_TAG}")"
  export "$(image_tag_var "${svc}")=${tag}"
  if image_switching "${svc}" "${svc}" "${tag}"; then
    built+=" ${svc}"
  else
    kept+=" ${svc}(${tag:0:7})"
  fi
done
echo "[deploy] Image mới   :${built:- không có}"
echo "[deploy] Giữ nguyên  :${kept:- không có}"
```

Mỗi mục trong `SERVICES` vừa là tên image vừa là service đại diện của image đó (`db-push` cho `db-push`/`migrate`/`migrate-background`, `recommendation` cho cả `recommendation-worker`).

- [ ] **Step 4: `deploy.sh` — dọn image giữ mọi tag còn dùng**

Thay khối dọn image theo tag (từ comment `# Image của các lần deploy TRƯỚC mang tag là SHA của chúng…` tới `xargs -r docker rmi >/dev/null 2>&1 || true`) bằng:

```bash
# Image của các lần deploy TRƯỚC mang tag là SHA của chúng, nên chúng KHÔNG
# dangling và `docker image prune` không đụng tới — đĩa sẽ đầy dần. Xoá mọi tag
# daln không còn service nào dùng. Tag đang dùng không chỉ là SHA mới: service
# có image không đổi vẫn chạy bằng tag cũ của nó. Docker vốn từ chối xoá image
# còn container dùng; lọc ở đây để ý định hiện rõ. Rollback vẫn được: image
# nằm trên GHCR.
in_use="$(for svc in ${SERVICES}; do
  var="$(image_tag_var "${svc}")"
  printf '%s\n' "${!var:-${DALN_IMAGE_TAG}}"
done | sort -u | paste -sd '|' -)"
docker image ls --filter "reference=${DALN_IMAGE_PREFIX}/*" --format '{{.Repository}}:{{.Tag}}' |
  grep -vE ":(${in_use})\$" |
  xargs -r docker rmi >/dev/null 2>&1 || true
```

- [ ] **Step 5: `deploy.sh` — comment đầu file**

Trong comment đầu file, thay dòng `#   - \`up -d\` chỉ tạo lại container có image/cấu hình đổi;` bằng:

```bash
#   - mỗi image một tag: image mới giống hệt nội dung image đang chạy thì giữ
#     tag cũ (deploy/lib/image-tags.sh), nên `up -d` không tạo lại container đó;
#   - `up -d` chỉ tạo lại container có image/cấu hình đổi;
```

- [ ] **Step 6: CI — build tái lập**

Trong `.github/workflows/ci-cd.yml`, bước `- name: Build & push`: thêm khối `env:` ngay sau dòng `uses: docker/build-push-action@v6`, và thay dòng `push: true` trong `with:`:

```yaml
      - name: Build & push
        uses: docker/build-push-action@v6
        env:
          # Build tái lập: mọi timestamp trong layer và config cố định ở 0, nên
          # cùng input ra cùng image kể cả khi cache GHA bị miss (cache chỉ 10GB,
          # 8 scope mode=max rất hay bị đẩy ra). deploy.sh dựa vào đó để giữ
          # nguyên container của service không đổi.
          SOURCE_DATE_EPOCH: 0
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.context }}/Dockerfile
          target: ${{ matrix.target }}
          # Đẩy qua `outputs` thay cho `push: true` để bật rewrite-timestamp.
          outputs: type=image,push=true,rewrite-timestamp=true
```

Các khoá còn lại trong `with:` (`tags`, `build-args`, `cache-from`, `cache-to`) giữ nguyên.

- [ ] **Step 7: README**

Trong `deploy/README.md`, thay bảng và đoạn văn ngay dưới tiêu đề `## Deploy chỉ làm lại phần có thay đổi` (tới trước đoạn `Chạy tay \`dc up -d\``) bằng:

```markdown
## Deploy chỉ làm lại phần có thay đổi

CI build đủ 8 image cho mỗi commit (song song, có cache) và build **tái lập được**
(`SOURCE_DATE_EPOCH=0` + `rewrite-timestamp`): cùng input ra cùng image. Mỗi image có
biến tag riêng trong compose (`DALN_TAG_USER`, `DALN_TAG_DB_PUSH`, …).
`deploy.sh` so nội dung image mới với image container đang chạy
(`deploy/lib/image-tags.sh`): giống hệt thì giữ tag cũ, nên `up -d` không đụng tới
container đó.

| Sửa ở đâu | Container bị tạo lại |
|---|---|
| `backend/apps/<svc>/` | chỉ `<svc>`; restart Kong nếu `<svc>` nằm sau Kong |
| `backend/apps/*/prisma/` | như trên, cộng db-push đồng bộ index |
| `backend/migrations/` | chỉ `db-push`/`migrate`; có migration chờ thì backup Mongo + chạy migrate trước khi đụng tới app |
| `backend/libs/<lib>/` | chỉ các service có bundle chứa đúng file vừa sửa. Barrel `@app/common`, `@app/util` kéo cả lib vào bundle |
| `backend/docker/`, `package*.json`, `tsconfig*.json`, `nest-cli.json`, `Dockerfile` | thường là cả 6 service backend |
| `frontend/` | chỉ `web`, API không gián đoạn |
| `backend/kong/kong.yml` | chỉ Kong |
| docs, `backend/scripts/`, `deploy/` | không container nào |

Cuối log deploy có bảng tóm tắt:
- `Image mới` là các image thật sự đổi;
- `Giữ nguyên` là các image giữ tag cũ, kèm 7 ký tự đầu của tag;
- sau đó là container được tạo lại, Kong, migration, backup, dead-letter, thời gian.

Lần deploy đầu tiên sau khi bật build tái lập, mọi image khác một lần.
```

- [ ] **Step 8: Kiểm tra**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
bash -n deploy/deploy.sh && echo "syntax ok"
bash deploy/tests/image-tags.test.sh | tail -1
grep -n "before_ids\|built+=" deploy/deploy.sh
for svc in db-push user chat notification realtime-gateway recommendation saga-orchestrator web; do
  v="DALN_TAG_$(printf '%s' "$svc" | tr '[:lower:]-' '[:upper:]_')"
  grep -q "\${$v:-" backend/docker-compose.prod.yml && echo "ok $v" || echo "THIẾU $v"
done
node -e 'require("/Users/nguyenn/Documents/Source/project/DALN/backend/node_modules/js-yaml").load(require("fs").readFileSync(".github/workflows/ci-cd.yml","utf8")); console.log("ci yaml ok")'
awk '/compose pull --quiet/{p=NR} /compose (up|run)/ && !u{u=NR} END{print (p<u)?"pull trước up/run: ok":"SAI THỨ TỰ"}' deploy/deploy.sh
```

Mong đợi:
- `syntax ok`;
- `TỔNG: 13 pass / 0 fail`;
- `grep` chỉ còn **một** `built+=`, nằm trong vòng chọn tag, và không còn `before_ids`;
- 8 dòng `ok`, `ci yaml ok`, `pull trước up/run: ok`.

- [ ] **Step 9: Build tái lập, thử ở local**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
for i in 1 2; do
  SOURCE_DATE_EPOCH=0 docker buildx build --no-cache --target production \
    --build-arg SERVICE=saga-orchestrator \
    --output "type=image,name=daln-repro/saga:$i,rewrite-timestamp=true" . >/dev/null 2>&1 || echo "build $i lỗi"
done
source ../deploy/lib/image-tags.sh
echo "saga: $(image_fingerprint daln-repro/saga:1) vs $(image_fingerprint daln-repro/saga:2)"
cd ../frontend
for i in 1 2; do
  SOURCE_DATE_EPOCH=0 docker buildx build --no-cache \
    --build-arg VITE_API_ROOT=https://x/api --build-arg VITE_SOCKET_URL=https://x \
    --output "type=image,name=daln-repro/web:$i,rewrite-timestamp=true" . >/dev/null 2>&1 || echo "build web $i lỗi"
done
echo "web:  $(image_fingerprint daln-repro/web:1) vs $(image_fingerprint daln-repro/web:2)"
docker rmi daln-repro/saga:1 daln-repro/saga:2 daln-repro/web:1 daln-repro/web:2 >/dev/null
```

Mong đợi: hai vân tay của `saga` bằng nhau, và hai vân tay của `web` bằng nhau. Nếu **không** bằng nhau thì dừng lại: tìm layer khác nhau bằng cách so `.RootFS.Layers` của hai image, sửa cho tái lập được, rồi mới commit. Nếu builder local không hỗ trợ `rewrite-timestamp`, ghi ruling và dựa vào lần nghiệm thu trên prod để kiểm.

- [ ] **Step 10: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add backend/docker-compose.prod.yml deploy/deploy.sh .github/workflows/ci-cd.yml deploy/README.md
git commit -m "feat(deploy): recreate only the containers whose image content changed"
```

---

## Task 3: `UserAuthStore` — trạng thái Redis của luồng xác thực về `apps/user`

**Files:**
- Create: `backend/apps/user/src/auth-store/user-auth.store.ts`
- Create: `backend/apps/user/src/auth-store/user-auth.store.spec.ts` (từ `redis.service.spec.ts`)
- Move: `backend/libs/redis/src/redis.service.redis.spec.ts` → `backend/apps/user/src/auth-store/user-auth.store.redis.spec.ts`
- Modify: `backend/libs/redis/src/redis.service.ts`, `backend/libs/redis/src/redis.service.spec.ts`
- Modify: `backend/apps/user/src/user.service.ts`, `backend/apps/user/src/user.module.ts`
- Modify: `backend/apps/user/src/user.service.{session,password-reset,change-password,make-friend}.spec.ts`

**Interfaces:**
- Produces:
  - `class UserAuthStore`, constructor `(redisClient: Redis /* @Inject('REDIS_CLIENT') */, redis: RedisService)`;
  - 20 phương thức giữ **nguyên** tên và chữ ký: `saveOTP`, `verifyOTP`, `deleteOTP`, `claimOtpAttempt`, `claimOtpResendSlot`, `saveChangePasswordOtp`, `verifyChangePasswordOtp`, `deleteChangePasswordOtp`, `claimChangePasswordOtpAttempt`, `claimChangePasswordOtpResendSlot`, `countLoginFailure`, `loginFailureCount`, `clearLoginFailures`, `savePasswordResetToken`, `peekPasswordResetToken`, `consumePasswordResetToken`, `clearPasswordResetIndex`, `claimPasswordResetSlot`, `claimPasswordResetIpSlot`, `claimPasswordResetHourlySlot`;
  - `UserService` có tham số thứ 13 là `authStore: UserAuthStore`.

- [ ] **Step 1: Dời test (đỏ)**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
mkdir -p apps/user/src/auth-store
git mv libs/redis/src/redis.service.redis.spec.ts apps/user/src/auth-store/user-auth.store.redis.spec.ts
python3 - <<'PY'
p = 'apps/user/src/auth-store/user-auth.store.redis.spec.ts'
s = open(p, encoding='utf-8').read()
edits = [
  ("import { RedisService } from './redis.service'\n",
   "import { RedisService } from '@app/redis/redis.service'\nimport { UserAuthStore } from './user-auth.store'\n", 1),
  ("  let redis: RedisService\n", "  let redis: UserAuthStore\n", 3),
  ("    redis = new RedisService(client)\n", "    redis = new UserAuthStore(client, new RedisService(client))\n", 3),
  ("describeRedis('RedisService — ", "describeRedis('UserAuthStore — ", 3),
]
for old, new, n in edits:
    assert s.count(old) == n, (old, s.count(old))
    s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)

src = 'libs/redis/src/redis.service.spec.ts'
s = open(src, encoding='utf-8').read()
cut = s.index("describe('RedisService — token đặt lại mật khẩu', () => {")
moved = s[cut:]
open(src, 'w', encoding='utf-8').write(s[:cut].rstrip() + '\n')
edits = [
  ("describe('RedisService — token đặt lại mật khẩu', () => {", "describe('UserAuthStore — token đặt lại mật khẩu', () => {", 1),
  ("  let service: RedisService\n", "  let service: UserAuthStore\n", 1),
  ("      providers: [RedisService, { provide: 'REDIS_CLIENT', useValue: client }],\n",
   "      providers: [\n        UserAuthStore,\n        RedisService,\n        { provide: 'REDIS_CLIENT', useValue: client },\n      ],\n", 1),
  ("    service = module.get<RedisService>(RedisService)\n", "    service = module.get<UserAuthStore>(UserAuthStore)\n", 1),
]
for old, new, n in edits:
    assert moved.count(old) == n, (old, moved.count(old))
    moved = moved.replace(old, new)
header = ("import { Test, TestingModule } from '@nestjs/testing'\n"
          "import { RedisService } from '@app/redis/redis.service'\n"
          "import { UserAuthStore } from './user-auth.store'\n\n")
open('apps/user/src/auth-store/user-auth.store.spec.ts', 'w', encoding='utf-8').write(header + moved)
print('tests moved')
PY
```

Chạy:

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
npx jest apps/user/src/auth-store
```

Mong đợi: **FAIL**, `Cannot find module './user-auth.store'`, ở cả hai suite.

- [ ] **Step 2: Dời code**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend && python3 - <<'PY'
p = 'libs/redis/src/redis.service.ts'
s = open(p, encoding='utf-8').read()
u1s = s.index("  /**\n   * Một luồng OTP = một bộ ba khoá tách biệt.")
u1e = s.index("  /**\n   * Giành quyền xử lý một lần cho `key`")
u2s = s.index("  /* ---------------- Khoá tài khoản sau nhiều lần sai ---------------- */")
u2e = s.index("  // Feature Hydration Cache methods")
nss = s.index("/**\n * Ba khoá Redis của một luồng OTP")
nse = s.index("/** Set chỉ mục các user đang online")
assert nss < nse < u1s < u1e < u2s < u2e

body = s[u1s:u1e] + s[u2s:u2e]
body = (body.replace('RedisService.REGISTRATION_OTP', 'UserAuthStore.REGISTRATION_OTP')
            .replace('RedisService.CHANGE_PASSWORD_OTP', 'UserAuthStore.CHANGE_PASSWORD_OTP')
            .replace('this.claimOnce(', 'this.redis.claimOnce('))
assert 'RedisService.' not in body and 'this.claimOnce(' not in body

store = ("import { createHash, timingSafeEqual } from 'node:crypto'\n"
         "import { Inject, Injectable } from '@nestjs/common'\n"
         "import type Redis from 'ioredis'\n"
         "import { RedisService } from '@app/redis/redis.service'\n\n"
         + s[nss:nse] +
         "/**\n"
         " * Trạng thái Redis của các luồng xác thực: OTP đăng ký, OTP đổi mật khẩu, khoá\n"
         " * tài khoản sau nhiều lần sai, token và hạn mức đặt lại mật khẩu.\n"
         " *\n"
         " * Chỉ service user dùng, nên nó sống ở đây chứ không trong libs/redis: nằm ở\n"
         " * lib thì mỗi lần sửa một luồng OTP, bundle của cả 5 service dùng RedisService\n"
         " * đều đổi và cả 5 bị deploy lại. Khoá, TTL và thứ tự lệnh giữ nguyên từng chữ\n"
         " * so với bản cũ trong RedisService, nên dữ liệu đang sống trên Redis vẫn đọc\n"
         " * được sau deploy.\n"
         " */\n"
         "@Injectable()\n"
         "export class UserAuthStore {\n"
         "  constructor(\n"
         "    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,\n"
         "    private readonly redis: RedisService,\n"
         "  ) {}\n\n"
         + body.rstrip() + "\n}\n")
open('apps/user/src/auth-store/user-auth.store.ts', 'w', encoding='utf-8').write(store)

s = s[:u2s] + s[u2e:]
s = s[:u1s] + s[u1e:]
s = s[:nss] + s[nse:]
s = s.replace("import { createHash, timingSafeEqual } from 'node:crypto'\n", '')
assert 'createHash' not in s and 'timingSafeEqual' not in s and 'OtpNamespace' not in s
open(p, 'w', encoding='utf-8').write(s)
print('code moved')
PY
npx eslint --fix apps/user/src/auth-store libs/redis/src
```

- [ ] **Step 3: Chạy test đã dời, xác nhận xanh**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
TEST_REDIS_PORT=6380 npx jest apps/user/src/auth-store libs/redis
```

Mong đợi: PASS.
- `user-auth.store.redis.spec.ts` báo đủ test OTP đăng ký, khoá tài khoản và OTP đổi mật khẩu là `passed`, **không** `skipped`.
- `user-auth.store.spec.ts` báo 12 test đặt lại mật khẩu.
- `redis.service.spec.ts` còn 2 test.

- [ ] **Step 4: `UserService` dùng `UserAuthStore`**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend && python3 - <<'PY'
import re
METHODS = ['saveOTP', 'verifyOTP', 'deleteOTP', 'claimOtpAttempt', 'claimOtpResendSlot',
           'saveChangePasswordOtp', 'verifyChangePasswordOtp', 'deleteChangePasswordOtp',
           'claimChangePasswordOtpAttempt', 'claimChangePasswordOtpResendSlot',
           'countLoginFailure', 'loginFailureCount', 'clearLoginFailures',
           'savePasswordResetToken', 'peekPasswordResetToken', 'consumePasswordResetToken',
           'clearPasswordResetIndex', 'claimPasswordResetSlot', 'claimPasswordResetIpSlot',
           'claimPasswordResetHourlySlot']
p = 'apps/user/src/user.service.ts'
s = open(p, encoding='utf-8').read()
s, n = re.subn(r'this\.redisService\.(' + '|'.join(METHODS) + r')\(', r'this.authStore.\1(', s)
assert n == 21, n
for old, new in [
  ("import { GeoIpService } from './geoip/geoip.service'\n",
   "import { GeoIpService } from './geoip/geoip.service'\nimport { UserAuthStore } from './auth-store/user-auth.store'\n"),
  ("    private readonly geoIp: GeoIpService,\n  ) {}",
   "    private readonly geoIp: GeoIpService,\n    private readonly authStore: UserAuthStore,\n  ) {}"),
]:
    assert s.count(old) == 1, old
    s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)

p = 'apps/user/src/user.module.ts'
s = open(p, encoding='utf-8').read()
for old, new in [
  ("import { GeoIpService } from './geoip/geoip.service'\n",
   "import { GeoIpService } from './geoip/geoip.service'\nimport { UserAuthStore } from './auth-store/user-auth.store'\n"),
  ("    GeoIpService,\n", "    GeoIpService,\n    UserAuthStore,\n"),
]:
    assert s.count(old) == 1, old
    s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)

# Spec: stub `redisService` đã mang đúng tên 20 phương thức -> truyền luôn cho authStore.
for f, old in [
  ('apps/user/src/user.service.session.spec.ts', "    geoIp as never,\n"),
  ('apps/user/src/user.service.password-reset.spec.ts', "    {} as never, // geoIp\n"),
  ('apps/user/src/user.service.change-password.spec.ts', "    {} as never, // geoIp\n"),
]:
    s = open(f, encoding='utf-8').read()
    assert s.count(old) == 1, (f, s.count(old))
    s = s.replace(old, old + "    redisService as never, // authStore: cùng stub, đã có đủ các phương thức đã dời\n")
    open(f, 'w', encoding='utf-8').write(s)
f = 'apps/user/src/user.service.make-friend.spec.ts'
s = open(f, encoding='utf-8').read()
s, n = re.subn(r'^( +)\{\} as never, // geoIp\n', lambda m: m.group(0) + m.group(1) + '{} as never, // authStore\n', s, flags=re.M)
assert n == 3, n
open(f, 'w', encoding='utf-8').write(s)
print('user service wired')
PY
grep -c "this.redisService\." apps/user/src/user.service.ts
```

Mong đợi: `user service wired`. `grep -c` in ra `1`: chỉ còn `isOnlineBatch`. Nếu `assert n == 21` sai, đếm lại bằng `grep -oE "this\.redisService\.[a-zA-Z]+\(" apps/user/src/user.service.ts | sort | uniq -c`, rồi sửa hằng số theo số lời gọi thật **của đúng 20 phương thức trên**. Mọi lời gọi của 20 phương thức đó phải được đổi hết.

- [ ] **Step 5: Cổng backend**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
npx eslint --fix apps/user/src libs/redis/src
npm run typecheck
TEST_REDIS_PORT=6380 npm test
npm run lint:check
```

Mong đợi: tất cả PASS. Số test tổng không đổi so với trước task: test được dời, không bị mất.

- [ ] **Step 6: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add backend/apps/user/src/auth-store backend/libs/redis/src backend/apps/user/src/user.service.ts backend/apps/user/src/user.module.ts backend/apps/user/src/user.service.session.spec.ts backend/apps/user/src/user.service.password-reset.spec.ts backend/apps/user/src/user.service.change-password.spec.ts backend/apps/user/src/user.service.make-friend.spec.ts
git status --short
git commit -m "refactor(user): move auth-flow Redis state out of the shared RedisService"
```

`git status` phải cho thấy `redis.service.redis.spec.ts` được *rename* sang `apps/user/…`.

---

## Task 4: `UserFeaturesCache` — cache feature về `apps/recommendation`

**Files:**
- Create: `backend/apps/recommendation/src/services/user-features.cache.ts`
- Test: `backend/apps/recommendation/src/services/user-features.cache.spec.ts`
- Modify: `backend/libs/redis/src/redis.service.ts`
- Modify: `backend/apps/recommendation/src/recommendation.service.ts`, `recommendation.module.ts`, `recommendation.service.read.spec.ts`

**Interfaces:**
- Produces:
  - `interface CachedFeatures { bio: string | null; location: unknown; interests: string[] }`;
  - `class UserFeaturesCache`, constructor `(redisClient: Redis /* @Inject('REDIS_CLIENT') */)`;
  - `getUserFeaturesBatch(userIds: string[]): Promise<Record<string, CachedFeatures>>`;
  - `setUserFeaturesBatch(profiles: Array<{ id: string; bio?: string | null; location?: unknown; interests?: string[] }>, ttl = 86400): Promise<void>`;
  - `RecommendationService` có tham số thứ 11 là `featuresCache: UserFeaturesCache`.

- [ ] **Step 1: Viết test (đỏ)**

Tạo `apps/recommendation/src/services/user-features.cache.spec.ts`:

```ts
import { UserFeaturesCache } from './user-features.cache'

/**
 * Cache đặc trưng user cho bước xếp hạng: đọc/ghi theo lô, và KHÔNG BAO GIỜ
 * làm hỏng luồng gợi ý — Redis lỗi thì coi như cache miss.
 */
describe('UserFeaturesCache', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('đọc lô bằng một lệnh MGET, bỏ qua user chưa có trong cache', async () => {
    const client = {
      mget: jest
        .fn()
        .mockResolvedValue([
          JSON.stringify({ bio: 'b', location: null, interests: ['x'] }),
          null,
        ]),
    }
    const cache = new UserFeaturesCache(client as never)

    await expect(cache.getUserFeaturesBatch(['u1', 'u2'])).resolves.toEqual({
      u1: { bio: 'b', location: null, interests: ['x'] },
    })
    expect(client.mget).toHaveBeenCalledWith(
      'user:u1:features',
      'user:u2:features',
    )
  })

  it('bản ghi hỏng JSON -> coi như cache miss', async () => {
    const client = { mget: jest.fn().mockResolvedValue(['{hong']) }
    const cache = new UserFeaturesCache(client as never)

    await expect(cache.getUserFeaturesBatch(['u1'])).resolves.toEqual({})
  })

  it('Redis lỗi khi đọc -> trả rỗng, không ném', async () => {
    const client = { mget: jest.fn().mockRejectedValue(new Error('down')) }
    const cache = new UserFeaturesCache(client as never)

    await expect(cache.getUserFeaturesBatch(['u1'])).resolves.toEqual({})
  })

  it('ghi lô bằng một pipeline, TTL mặc định 1 ngày', async () => {
    const pipeline = {
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }
    const client = { pipeline: jest.fn(() => pipeline) }
    const cache = new UserFeaturesCache(client as never)

    await cache.setUserFeaturesBatch([
      { id: 'u1', bio: null, interests: ['a'] },
    ])

    expect(pipeline.set).toHaveBeenCalledWith(
      'user:u1:features',
      JSON.stringify({ bio: null, location: null, interests: ['a'] }),
      'EX',
      86400,
    )
    expect(pipeline.exec).toHaveBeenCalledTimes(1)
  })

  it('Redis lỗi khi ghi -> không ném', async () => {
    const pipeline = {
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('down')),
    }
    const client = { pipeline: jest.fn(() => pipeline) }
    const cache = new UserFeaturesCache(client as never)

    await expect(
      cache.setUserFeaturesBatch([{ id: 'u1' }]),
    ).resolves.toBeUndefined()
  })
})
```

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend && npx jest apps/recommendation/src/services/user-features.cache
```

Mong đợi: **FAIL**, `Cannot find module './user-features.cache'`.

- [ ] **Step 2: Dời code**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend && python3 - <<'PY'
p = 'libs/redis/src/redis.service.ts'
s = open(p, encoding='utf-8').read()
rs = s.index("  // Feature Hydration Cache methods")
re_ = s.rindex("}\n")
cfs = s.index("/** What the recommendation feature cache holds per user")
cfe = s.index("}\n", cfs) + 2
assert cfs < cfe < rs < re_
rec = s[rs:re_].rstrip().replace('[RedisService]', '[UserFeaturesCache]')
iface = s[cfs:cfe]

out = ("import { Inject, Injectable } from '@nestjs/common'\n"
       "import type Redis from 'ioredis'\n\n"
       + iface + "\n"
       "/**\n"
       " * Cache đặc trưng user cho bước xếp hạng gợi ý kết bạn. Chỉ service\n"
       " * recommendation dùng, nên nó sống ở đây chứ không trong libs/redis: nằm ở\n"
       " * lib thì mỗi lần sửa, bundle của cả 5 service dùng RedisService đổi theo.\n"
       " * Khoá và TTL giữ nguyên như bản cũ.\n"
       " */\n"
       "@Injectable()\n"
       "export class UserFeaturesCache {\n"
       "  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}\n\n"
       + rec + "\n}\n")
open('apps/recommendation/src/services/user-features.cache.ts', 'w', encoding='utf-8').write(out)

s = s[:rs].rstrip() + "\n}\n"
s = s[:cfs] + s[cfe:].lstrip('\n')
assert 'CachedFeatures' not in s and 'getFeaturesKey' not in s
open(p, 'w', encoding='utf-8').write(s)
print('features cache moved')
PY
npx eslint --fix apps/recommendation/src/services/user-features.cache.ts libs/redis/src/redis.service.ts
npx jest apps/recommendation/src/services/user-features.cache
```

Mong đợi: 5/5 PASS.

- [ ] **Step 3: `RecommendationService` dùng `UserFeaturesCache`**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend && python3 - <<'PY'
p = 'apps/recommendation/src/recommendation.service.ts'
s = open(p, encoding='utf-8').read()
for old, new, n in [
  ("this.redisService.getUserFeaturesBatch(", "this.featuresCache.getUserFeaturesBatch(", 1),
  ("this.redisService.setUserFeaturesBatch(", "this.featuresCache.setUserFeaturesBatch(", 1),
  ("    private readonly dirty: RecommendationDirtyService,\n  ) {}",
   "    private readonly dirty: RecommendationDirtyService,\n    private readonly featuresCache: UserFeaturesCache,\n  ) {}", 1),
  ("import { RecommendationDirtyService } from './services/recommendation-dirty.service'\n",
   "import { RecommendationDirtyService } from './services/recommendation-dirty.service'\nimport { UserFeaturesCache } from './services/user-features.cache'\n", 1),
]:
    assert s.count(old) == n, (old, s.count(old))
    s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)

p = 'apps/recommendation/src/recommendation.module.ts'
s = open(p, encoding='utf-8').read()
old = "    RecommendationService,\n"
assert s.count(old) == 1
s = s.replace(old, old + "    UserFeaturesCache,\n")
imp = "import { UserFeaturesCache } from './services/user-features.cache'\n"
first_import_end = s.index('\n', s.index('import ')) + 1
s = s[:first_import_end] + imp + s[first_import_end:]
open(p, 'w', encoding='utf-8').write(s)

p = 'apps/recommendation/src/recommendation.service.read.spec.ts'
s = open(p, encoding='utf-8').read()
old = "    {} as never, // dirty queue\n"
assert s.count(old) == 1
s = s.replace(old, old + "    {} as never, // features cache\n")
open(p, 'w', encoding='utf-8').write(s)
print('recommendation wired')
PY
grep -rn "UserFeaturesBatch" apps libs --include="*.ts" | grep -v "user-features.cache"
```

Mong đợi: hai dòng còn lại đều gọi qua `this.featuresCache.` trong `recommendation.service.ts`.

- [ ] **Step 4: Cổng backend**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
npx eslint --fix apps/recommendation/src
npm run typecheck && npm test && npm run lint:check
```

Mong đợi: tất cả PASS; tổng số test tăng đúng 5 so với cuối Task 3.

- [ ] **Step 5: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add backend/apps/recommendation/src/services/user-features.cache.ts backend/apps/recommendation/src/services/user-features.cache.spec.ts backend/libs/redis/src/redis.service.ts backend/apps/recommendation/src/recommendation.service.ts backend/apps/recommendation/src/recommendation.module.ts backend/apps/recommendation/src/recommendation.service.read.spec.ts
git commit -m "refactor(recommendation): move the user feature cache out of the shared RedisService"
```

---

## Task 5: Mailer về `apps/notification`

**Files:**
- Move: `backend/libs/mailer/src/{mailer.module.ts,mailer.service.ts,mailer.service.spec.ts,templates/}` → `backend/apps/notification/src/mailer/`
- Delete: `backend/libs/mailer/` (còn lại `src/index.ts`, `tsconfig.lib.json`)
- Modify: `backend/apps/notification/src/notification.{module,service}.ts`
- Modify: `backend/nest-cli.json`, `backend/tsconfig.json`, `backend/package.json`, `backend/Dockerfile`

**Interfaces:**
- Produces: `MailerModule`, `MailerService` import từ `./mailer/mailer.module` và `./mailer/mailer.service`, API không đổi. Template nằm ở `apps/notification/src/mailer/templates/` trong mã nguồn và ở `dist/apps/notification/mailer/templates/` sau build.

- [ ] **Step 1: Dời spec trước (đỏ)**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
mkdir -p apps/notification/src/mailer
git mv libs/mailer/src/mailer.service.spec.ts apps/notification/src/mailer/mailer.service.spec.ts
npx jest apps/notification/src/mailer
```

Mong đợi: **FAIL**, `Cannot find module './mailer.service'`.

- [ ] **Step 2: Dời code và template, sửa đường dẫn template**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
git mv libs/mailer/src/mailer.module.ts apps/notification/src/mailer/mailer.module.ts
git mv libs/mailer/src/mailer.service.ts apps/notification/src/mailer/mailer.service.ts
git mv libs/mailer/src/templates apps/notification/src/mailer/templates
git rm -q -r libs/mailer
python3 - <<'PY'
p = 'apps/notification/src/mailer/mailer.service.ts'
s = open(p, encoding='utf-8').read()
old = """    const candidates = [
      join(process.cwd(), 'libs/mailer/src/templates', filename),
      join(__dirname, 'templates', filename),
    ]"""
new = """    // Hai bố cục chạy thật: mã nguồn (jest) có templates/ nằm cạnh file này;
    // bundle webpack (dev watch và prod) nằm ở dist/apps/notification, template
    // được nest-cli copy vào mailer/templates cạnh main.js. webpack của Nest
    // giữ __dirname thật (node.__dirname: false).
    const candidates = [
      join(__dirname, 'templates', filename),
      join(__dirname, 'mailer', 'templates', filename),
    ]"""
assert s.count(old) == 1
s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)

for p, old, new in [
  ('apps/notification/src/notification.service.ts', "import { MailerService } from '@app/mailer'\n", "import { MailerService } from './mailer/mailer.service'\n"),
  ('apps/notification/src/notification.module.ts', "import { MailerModule } from '@app/mailer'\n", "import { MailerModule } from './mailer/mailer.module'\n"),
]:
    s = open(p, encoding='utf-8').read()
    assert s.count(old) == 1, p
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))
print('mailer moved')
PY
npx jest apps/notification/src/mailer
```

Mong đợi: PASS, đủ test của `MailerService` (điền biến cho mọi template, nhúng logo…).

- [ ] **Step 3: Cấu hình build — bỏ lib `mailer`, template đi theo `notification`**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend && node - <<'JS'
const fs = require('fs')
const cli = JSON.parse(fs.readFileSync('nest-cli.json', 'utf8'))
delete cli.projects.mailer
const notif = cli.projects.notification
notif.compilerOptions.assets.push({ include: 'mailer/templates/**/*', outDir: 'dist/apps/notification' })
fs.writeFileSync('nest-cli.json', JSON.stringify(cli, null, 2) + '\n')

const ts = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'))
delete ts.compilerOptions.paths['@app/mailer']
delete ts.compilerOptions.paths['@app/mailer/*']
fs.writeFileSync('tsconfig.json', JSON.stringify(ts, null, 2) + '\n')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
delete pkg.jest.moduleNameMapper['^@app/mailer(|/.*)$']
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log('config updated')
JS
git diff --stat nest-cli.json tsconfig.json package.json
```

`JSON.stringify` có thể đổi định dạng các file này. Nếu `git diff --stat` cho thấy nhiều hơn vài dòng mỗi file thì hoàn tác (`git checkout -- <file>`) và sửa tay đúng các khoá trên. Mục tiêu là diff chỉ gồm các dòng liên quan.

Trong `backend/Dockerfile`, xoá hai dòng:

```dockerfile
# Email HTML templates (notification service reads at runtime)
COPY --from=build /app/libs/mailer/src/templates ./libs/mailer/src/templates
```

- [ ] **Step 4: Build `notification` ở local, template phải nằm cạnh bundle**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
npm run build -- notification >/dev/null 2>&1 && echo "build ok"
ls dist/apps/notification/mailer/templates
grep -c "__dirname" dist/apps/notification/main.js
grep -rn "libs/mailer\|@app/mailer" --include="*.ts" --include="*.json" --include="Dockerfile" . | grep -v node_modules | grep -v "^./dist"
```

Mong đợi:
- `build ok`;
- đủ 8 file template (`brand-mark.png`, `change-password-otp.html`, `make-friend.html`, `password-changed.html`, `password-reset.html`, `register-otp.html`, `session-revoked.html`, `welcome.html`);
- `__dirname` còn trong bundle (số > 0);
- grep cuối không in gì.

- [ ] **Step 5: Cổng backend**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
npx eslint --fix apps/notification/src
npm run typecheck && npm test && npm run lint:check
```

Mong đợi: tất cả PASS, số test tổng không đổi so với cuối Task 4.

- [ ] **Step 6: Commit**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
git add -A backend/libs/mailer backend/apps/notification/src backend/nest-cli.json backend/tsconfig.json backend/package.json backend/Dockerfile
git status --short
git commit -m "refactor(notification): move the mailer and its templates into the notification app"
```

`git status` phải cho thấy các file *rename* từ `libs/mailer/src/...` sang `apps/notification/src/mailer/...`, không kèm file nào ngoài danh sách trên.

---

## Task 6: Kiểm liên thông — image prod ở local và QC dev

**Files:** không đổi code. Chỉ commit nếu có sửa lỗi, và mỗi sửa lỗi phải có ruling trong ledger.

- [ ] **Step 1: Image prod ở local**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
for svc in notification user recommendation; do
  docker build -q -f Dockerfile --target production --build-arg SERVICE=$svc -t daln-verify/$svc:local . >/dev/null 2>&1 && echo "$svc build ok (check-externals đã qua)" || echo "$svc BUILD LỖI"
done
docker run --rm --entrypoint sh daln-verify/notification:local -c 'ls /app/dist/apps/notification/mailer/templates | wc -l; ls /app/libs 2>/dev/null || echo "không có /app/libs"'
docker run --rm --entrypoint sh daln-verify/user:local -c 'ls /app/libs 2>/dev/null || echo "không có /app/libs"'
docker rmi daln-verify/notification:local daln-verify/user:local daln-verify/recommendation:local >/dev/null
```

Mong đợi:
- ba dòng `build ok`;
- `notification` có `8` template;
- cả hai image đều in `không có /app/libs`, tức template không còn bị copy vào mọi image.

- [ ] **Step 2: Nạp code mới vào dev**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/backend
docker restart daln-user daln-notification daln-recommendation >/dev/null
docker restart daln-kong >/dev/null
for c in daln-user daln-notification daln-recommendation; do
  for i in $(seq 1 60); do docker logs --since 5m $c 2>&1 | grep -q "Nest application successfully started" && break; sleep 3; done
  docker logs --since 5m $c 2>&1 | grep -E "successfully started|Error" | tail -1 | cut -c1-160
done
```

Mong đợi: cả ba container báo `Nest application successfully started`, không có `Error`.

- [ ] **Step 3: QC dev**

Frontend dev phải đang chạy ở 5174.

```bash
cd /Users/nguyenn/Documents/Source/project/DALN/qc
./auth-api.sh 2>&1 | tail -1
node change-password-browser.mjs 2>&1 | tail -1
node auth-browser.mjs 2>&1 | tail -1
node session-location-browser.mjs 2>&1 | tail -1
```

Mong đợi: cả bốn `0 fail`.
- `auth-api.sh` phủ OTP đăng ký, khoá đăng nhập và đặt lại mật khẩu, tức `UserAuthStore` trên Redis thật.
- `change-password-browser.mjs` phủ OTP đổi mật khẩu và **mail thật tới MailHog**, tức template đọc từ bố cục bundle ở dev.

- [ ] **Step 4: Toàn bộ cổng lần cuối**

```bash
cd /Users/nguyenn/Documents/Source/project/DALN
(cd backend && npm run typecheck && TEST_REDIS_PORT=6380 npm test 2>&1 | grep -E "^Tests:|^Test Suites:" && npm run lint:check)
(cd frontend && npm run lint >/dev/null && npm run build >/dev/null && echo "frontend ok")
bash deploy/tests/image-tags.test.sh | tail -1
```

---

## Sau khi xong: nghiệm thu trên prod

Làm trong bước kết thúc nhánh (`finishing-a-development-branch`), sau review cuối.

1. Push `develop`, mở PR `develop → main`, đợi CI xanh, rồi merge. Lần merge này ship cả tính năng vị trí phiên đang nằm trên `develop`.
2. **Lần deploy 1:** mọi image khác một lần, vì quy tắc timestamp đổi. Log phải có dòng `[deploy] Docker Compose version …`, và không có lỗi thế biến.
3. **Lần deploy 2**, bằng một commit chỉ sửa tài liệu (ví dụ ghi kết quả nghiệm thu vào spec):
   - log phải ghi `Image mới   : không có`;
   - `Giữ nguyên` phải liệt kê đủ 8 image;
   - `Tạo lại     : không có`.
4. Cập nhật memory `project-prod-deploy.md` (mục "Only what changed") theo cơ chế mới.
