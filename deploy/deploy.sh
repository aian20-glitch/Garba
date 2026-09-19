#!/bin/bash
# Выложить сервер ГАРБА на VPS с этого Mac.
#   ./deploy/deploy.sh garba-vps            — обновить код и перезапустить
#   ./deploy/deploy.sh garba-vps --first    — плюс положить файлы настройки для setup-server.sh
# garba-vps — имя из ~/.ssh/config (адрес сервера и ключ garba_vps).
set -euo pipefail
TARGET=${1:?укажи сервер: deploy.sh garba-vps}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${2:-}" = "--first" ]; then
  rsync -az "$ROOT/deploy/" "$TARGET:/root/garba-deploy/"
  echo "Файлы настройки на сервере. Теперь: ssh $TARGET 'bash /root/garba-deploy/setup-server.sh <домен>'"
  exit 0
fi

cd "$ROOT/backend"
npm test
rm -rf dist && npm run build
rsync -az --delete dist package.json package-lock.json "$TARGET:/opt/garba/backend/"
ssh "$TARGET" 'set -e
  cd /opt/garba/backend
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  chown -R garba:garba /opt/garba
  systemctl restart garba
  sleep 2
  curl -fsS http://127.0.0.1:3000/health && echo " — сервер работает"'
