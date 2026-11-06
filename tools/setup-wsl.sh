#!/bin/bash
# Переезд на новый компьютер, шаг 2 (Windows → WSL, Ubuntu). Запуск внутри Ubuntu:
#   bash setup-wsl.sh /mnt/c/Users/<имя>/Desktop/garba-move.tar.gz.enc
# Ставит git, rsync, Node 26, Flutter 3.47.4; берёт проект с GitHub в ~/Garba; раскладывает ключи
# из архива (шаг 1 — tools/pack-for-new-pc.sh на Mac); проверяет npm test, flutter analyze и вход на сервер.
# Повторный запуск безопасен: что уже стоит — пропускается.
set -euo pipefail
ARCHIVE="${1:?Укажи путь к garba-move.tar.gz.enc}"
[ -f "$ARCHIVE" ] || { echo "Нет файла $ARCHIVE" >&2; exit 1; }

echo "== Программы"
sudo apt-get update
sudo apt-get install -y git rsync curl unzip xz-utils zip openssl sqlite3 build-essential ca-certificates

echo "== Node 26"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 26
nvm alias default 26

echo "== Flutter 3.47.4 (для веб-сборки в deploy.sh)"
[ -d "$HOME/flutter" ] || git clone --depth 1 -b 3.47.4 https://github.com/flutter/flutter.git "$HOME/flutter"
grep -q 'flutter/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/flutter/bin:$PATH"' >> "$HOME/.bashrc"
export PATH="$HOME/flutter/bin:$PATH"
flutter --version

echo "== Проект"
[ -d "$HOME/Garba/.git" ] || git clone https://github.com/aian20-glitch/Garba.git "$HOME/Garba"

echo "== Ключи из архива (спросит пароль)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$ARCHIVE" | tar -xzf - -C "$TMP"
M="$TMP/garba-move"

mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
cp "$M/ssh/garba_vps" "$M/ssh/garba_vps.pub" "$HOME/.ssh/"
chmod 600 "$HOME/.ssh/garba_vps"
grep -q '^Host garba-vps' "$HOME/.ssh/config" 2>/dev/null || cat "$M/ssh/config-garba" >> "$HOME/.ssh/config"
chmod 600 "$HOME/.ssh/config"
[ -s "$M/ssh/known_hosts" ] && cat "$M/ssh/known_hosts" >> "$HOME/.ssh/known_hosts"

[ -d "$HOME/garba-keys" ] || cp -R "$M/garba-keys" "$HOME/garba-keys"
chmod 700 "$HOME/garba-keys"
sed -i "s#^storeFile=.*#storeFile=$HOME/garba-keys/garba-upload.jks#" "$HOME/garba-keys/key.properties"
cp "$HOME/garba-keys/key.properties" "$HOME/Garba/mobile/android/key.properties"

[ -f "$M/bots.json" ] && cp "$M/bots.json" "$HOME/Garba/tools/.bots.json"
[ -f "$M/tour-bots.json" ] && cp "$M/tour-bots.json" "$HOME/Garba/tools/.tour-bots.json"
[ -f "$M/settings.local.json" ] && mkdir -p "$HOME/Garba/.claude" && cp "$M/settings.local.json" "$HOME/Garba/.claude/"
[ -d "$M/backend-data" ] && mkdir -p "$HOME/Garba/backend/data" && cp -R "$M/backend-data/." "$HOME/Garba/backend/data/"
[ -d "$M/store/android" ] && mkdir -p "$HOME/Garba/store/android" && cp -R "$M/store/android/." "$HOME/Garba/store/android/"
[ -d "$M/garba-backups" ] && mkdir -p "$HOME/garba-backups" && cp -R "$M/garba-backups/." "$HOME/garba-backups/"
if [ -d "$M/memory" ]; then
  MEM="$HOME/.claude/projects/$(echo "$HOME/Garba" | sed 's#/#-#g')/memory"
  mkdir -p "$MEM" && cp -R "$M/memory/." "$MEM/"
fi

echo "== Проверки"
(cd "$HOME/Garba/backend" && npm install && npm test)
(cd "$HOME/Garba/mobile" && flutter pub get && flutter analyze)
ssh -o BatchMode=yes garba-vps 'systemctl is-active garba' && echo "Сервер: вход по ключу работает"

echo
echo "Всё на месте. Осталось: git config --global user.name / user.email и вход в GitHub для git push"
echo "(sudo apt install gh && gh auth login). Выкладка — как раньше: cd ~/Garba && ./deploy/deploy.sh garba-vps"
