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

# Выкладываем только с main (04.11.2026): в ветке shah идёт новая игра ШАХ — она не должна
# попасть на сервер раньше времени. Осознанно с другой ветки — GARBA_BRANCH_OK=1.
BRANCH="$(git -C "$ROOT" branch --show-current)"
if [ "$BRANCH" != "main" ] && [ "${GARBA_BRANCH_OK:-}" != "1" ]; then
  echo "Сейчас ветка «$BRANCH» — выкладка только с main (git switch main) или GARBA_BRANCH_OK=1." >&2
  exit 1
fi

# Выкладываем только закоммиченное (28.09.2026): иначе на сервер уйдут случайные правки,
# которых нет в git. Осознанно без коммита — GARBA_DIRTY_OK=1.
if [ -n "$(git -C "$ROOT" status --porcelain -- backend deploy mobile)" ] && [ "${GARBA_DIRTY_OK:-}" != "1" ]; then
  echo "В backend, deploy или mobile есть незакоммиченные изменения — сначала коммит (или GARBA_DIRTY_OK=1)." >&2
  git -C "$ROOT" status --short -- backend deploy mobile >&2
  exit 1
fi

cd "$ROOT/backend"
npm test
rm -rf dist && npm run build
rsync -az --delete dist package.json package-lock.json "$TARGET:/opt/garba/backend/"
# Веб-сборка игры для браузера и Telegram (07.10.2026). Имя бота — deploy/telegram-bot
# (без @), из него игра строит ссылки t.me/<бот>?startapp=... для приглашений.
TG_BOT="$(tr -d '[:space:]' < "$ROOT/deploy/telegram-bot" 2>/dev/null || true)"
(cd "$ROOT/mobile" && flutter build web --release --base-href /play/ --no-wasm-dry-run \
  --dart-define=TG_BOT="$TG_BOT")
ssh "$TARGET" 'mkdir -p /opt/garba/web'
rsync -az --delete "$ROOT/mobile/build/web/" "$TARGET:/opt/garba/web/"
# Файлы настройки (сервис, копия базы) — тоже свежие: их меняют вместе с кодом.
rsync -az "$ROOT/deploy/" "$TARGET:/root/garba-deploy/"
ssh "$TARGET" 'set -e
  cd /opt/garba/backend
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  # Код — root, только для чтения процессу игры; база — garba.
  chown -R root:root /opt/garba
  chmod -R go-w /opt/garba
  chown -R garba:garba /var/lib/garba
  install -m 644 /root/garba-deploy/garba.service /etc/systemd/system/garba.service
  install -m 755 /root/garba-deploy/garba-backup.sh /usr/local/bin/garba-backup.sh
  chmod 700 /var/lib/garba /var/backups/garba
  systemctl daemon-reload
  systemctl restart garba
  sleep 2
  curl -fsS http://127.0.0.1:3000/health && echo " — сервер работает"'
