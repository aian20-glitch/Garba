#!/bin/bash
# Переезд на новый компьютер, шаг 1 (запускать на старом Mac, в обычном Терминале).
# Собирает всё, чего нет в git, в один зашифрованный архив (AES-256, пароль спросит openssl):
#   ключ подписи Android (~/garba-keys), SSH-ключ сервера и запись garba-vps, ключ хоста сервера,
#   копии базы (~/garba-backups), токены ботов, память Claude о проекте.
# Шаг 2 — tools/setup-wsl.sh на новом компьютере.
#   ./tools/pack-for-new-pc.sh [куда положить архив]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HOME/Desktop/garba-move.tar.gz.enc}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
M="$STAGE/garba-move"
mkdir -p "$M/ssh"

cp -R "$HOME/garba-keys" "$M/garba-keys"
cp "$HOME/.ssh/garba_vps" "$HOME/.ssh/garba_vps.pub" "$M/ssh/"
cat > "$M/ssh/config-garba" <<'EOF'

Host garba-vps
    HostName 89.126.200.50
    User root
    IdentityFile ~/.ssh/garba_vps
EOF
# Ключ хоста — чтобы новый компьютер узнал наш сервер, а не поверил первому встречному.
ssh-keygen -F 89.126.200.50 -f "$HOME/.ssh/known_hosts" | grep -v '^#' > "$M/ssh/known_hosts" || true
[ -f "$ROOT/tools/.bots.json" ] && cp "$ROOT/tools/.bots.json" "$M/bots.json"
[ -d "$HOME/garba-backups" ] && cp -R "$HOME/garba-backups" "$M/garba-backups"
MEM="$HOME/.claude/projects/$(echo "$ROOT" | sed 's#/#-#g')/memory"
[ -d "$MEM" ] && cp -R "$MEM" "$M/memory"

echo "Придумай пароль для архива (его же спросит новый компьютер). Не пересылай его вместе с архивом."
tar -czf - -C "$STAGE" garba-move | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -out "$OUT"
echo "Готово: $OUT ($(du -h "$OUT" | cut -f1)). Перенеси его флешкой."
