#!/usr/bin/env bash
# ============================================================================
# SSH forced command cho key deploy của GitHub Actions.
#
# Cài một lần trên server:
#   install -m 755 deploy/remote-entry.sh /usr/local/bin/daln-deploy
# Dòng trong /root/.ssh/authorized_keys:
#   restrict,command="/usr/local/bin/daln-deploy" ssh-ed25519 AAAA... github-actions-deploy
#
# Key này KHÔNG mở được shell: nó chỉ nhận đúng một commit SHA đã nằm trên main,
# kéo commit đó về rồi chạy deploy/deploy.sh của chính commit đó.
# ============================================================================
set -euo pipefail

REPO="${DALN_REPO:-/root/workspace/DALN}"
SHA="${SSH_ORIGINAL_COMMAND:-}"

if [[ ! "${SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[daln-deploy] Chỉ nhận commit SHA đủ 40 ký tự hex" >&2
  exit 2
fi

# Hai lượt deploy chồng nhau (CI + chạy tay) sẽ giẫm lên nhau -> xếp hàng.
exec 9>/var/lock/daln-deploy.lock
flock -w 3600 9

cd "${REPO}"
git fetch --prune --quiet origin main
if ! git merge-base --is-ancestor "${SHA}" origin/main 2>/dev/null; then
  echo "[daln-deploy] ${SHA} không nằm trên origin/main — từ chối" >&2
  exit 4
fi

git reset --hard --quiet "${SHA}"
echo "[daln-deploy] Đã chuyển tới $(git log -1 --format='%h %s')"

# Lock (fd 9) được giữ suốt quá trình deploy vì exec kế thừa file descriptor.
exec bash deploy/deploy.sh
