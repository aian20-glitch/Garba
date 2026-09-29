#!/bin/bash
# Жалобы игроков (29.09.2026, Apple Guideline 1.2): смотреть и разбирать с этого Mac.
# Apple требует реагировать на жалобы в течение суток — запускать хотя бы раз в день.
#
#   ./deploy/reports.sh garba-vps                      открытые жалобы
#   ./deploy/reports.sh garba-vps all                  все, и разобранные
#   ./deploy/reports.sh garba-vps resolve 12           жалоба 12 разобрана (и все на того же игрока)
#   ./deploy/reports.sh garba-vps rename ABC123 Игрок  сменить имя нарушителю
#   ./deploy/reports.sh garba-vps delete ABC123        удалить аккаунт нарушителя навсегда
#
# Служебные адреса отвечают только самому серверу, поэтому идём по ssh и там зовём curl.
set -euo pipefail
TARGET=${1:?укажи сервер: reports.sh garba-vps [all|resolve ID|rename КОД ИМЯ|delete КОД]}
ACTION=${2:-list}
API=http://127.0.0.1:3000

# JSON собираем здесь (кириллица, кавычки) и отдаём curl через stdin.
post() {
  printf '%s' "$2" | ssh "$TARGET" "curl -s -X POST -H 'Content-Type: application/json' --data-binary @- $API$1"
  echo
}

case "$ACTION" in
  list) ssh "$TARGET" "curl -s $API/admin/reports" | python3 -m json.tool --no-ensure-ascii ;;
  all) ssh "$TARGET" "curl -s '$API/admin/reports?all=1'" | python3 -m json.tool --no-ensure-ascii ;;
  resolve) post "/admin/reports/${3:?номер жалобы}/resolve" '{}' ;;
  rename)
    CODE=${3:?код игрока}
    NAME=${4:?новое имя}
    post /admin/rename "$(python3 -c 'import json,sys; print(json.dumps({"code": sys.argv[1], "name": sys.argv[2]}, ensure_ascii=False))' "$CODE" "$NAME")"
    ;;
  delete)
    CODE=${3:?код игрока}
    read -r -p "Удалить аккаунт $CODE навсегда? (да/нет) " OK
    [ "$OK" = "да" ] || exit 1
    post /admin/delete "{\"code\":\"$CODE\"}"
    ;;
  *) echo "Неизвестное действие: $ACTION" >&2; exit 1 ;;
esac
