#!/bin/bash
# Первая настройка VPS (Ubuntu 24.04) под ГАРБУ. Запускается один раз, от root:
#   ./deploy/deploy.sh garba-vps --first                      (кладёт файлы в /root/garba-deploy)
#   ssh garba-vps 'bash /root/garba-deploy/setup-server.sh garba.kz'
set -euo pipefail
DOMAIN=${1:?укажи домен: setup-server.sh garba.kz}
NODE_MAJOR=26
SRC=/root/garba-deploy

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates rsync sqlite3 ufw caddy fail2ban unattended-upgrades

# SSH — только по ключу (27.09.2026: первый сервер взломали подбором пароля root в первые
# сутки и поставили майнер). Пароль выключаем, только если ключ уже лежит — иначе сами
# останемся за дверью. fail2ban банит адреса, подбирающие пароль; обновления безопасности
# Ubuntu ставятся сами.
if grep -q '^ssh-' /root/.ssh/authorized_keys 2>/dev/null; then
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' \
    > /etc/ssh/sshd_config.d/00-garba.conf
  systemctl reload ssh
else
  echo "ВНИМАНИЕ: в /root/.ssh/authorized_keys нет ключа — вход по паролю оставлен включённым"
fi
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

# Node.js той же ветки, что при разработке (в нём встроен node:sqlite).
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

# Отдельный пользователь без входа; код — /opt/garba, база — /var/lib/garba.
id garba >/dev/null 2>&1 || useradd --system --home /opt/garba --shell /usr/sbin/nologin garba
mkdir -p /opt/garba/backend /var/lib/garba /var/backups/garba
chown -R garba:garba /opt/garba /var/lib/garba

# Сервис, копия базы, Caddy с доменом.
install -m 644 "$SRC/garba.service" /etc/systemd/system/garba.service
install -m 755 "$SRC/garba-backup.sh" /usr/local/bin/garba-backup.sh
install -m 644 "$SRC/garba-backup.service" /etc/systemd/system/garba-backup.service
install -m 644 "$SRC/garba-backup.timer" /etc/systemd/system/garba-backup.timer
install -m 644 "$SRC/Caddyfile" /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=GARBA_DOMAIN=%s\n' "$DOMAIN" > /etc/systemd/system/caddy.service.d/garba.conf

systemctl daemon-reload
systemctl enable garba garba-backup.timer
systemctl restart caddy

# Файрвол: только SSH и веб.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "Готово. Node $(node -v). Дальше: deploy.sh выкладывает код и запускает сервер."
