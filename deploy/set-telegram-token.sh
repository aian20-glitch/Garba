#!/bin/bash
# Положить токен бота Telegram на сервер (07.10.2026). Токен спрашивается без показа на
# экране и в git не попадает: /etc/garba/telegram.env, только для root.
#   ./deploy/set-telegram-token.sh garba-vps
set -euo pipefail
TARGET=${1:?укажи сервер: set-telegram-token.sh garba-vps}
read -rsp "Токен бота от @BotFather: " TOKEN
echo
if ! [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; then
  echo "Это не похоже на токен бота (вид: 1234567890:AA...)." >&2
  exit 1
fi
printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TOKEN" | ssh "$TARGET" 'set -e
  install -d -m 700 /etc/garba
  umask 077
  cat > /etc/garba/telegram.env
  systemctl restart garba
  sleep 3
  journalctl -u garba -n 30 --no-pager | grep -E "TELEGRAM|running" | tail -3'
echo "Готово: токен на сервере, сервер перезапущен."
