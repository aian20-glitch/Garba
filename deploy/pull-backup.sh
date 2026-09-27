#!/bin/bash
# Забрать свежую копию базы с сервера на этот Mac (28.09.2026): копии на самом сервере
# пропадут вместе с ним — при взломе или потере диска. Храним 30 последних.
#   ./deploy/pull-backup.sh garba-vps
set -euo pipefail
TARGET=${1:?укажи сервер: pull-backup.sh garba-vps}
DEST="$HOME/garba-backups"
mkdir -p "$DEST"
chmod 700 "$DEST"
# Свежая копия прямо сейчас — не ждём ночной.
ssh "$TARGET" 'systemctl start garba-backup'
LATEST=$(ssh "$TARGET" 'ls -1t /var/backups/garba/garba-*.db | head -1')
scp -q "$TARGET:$LATEST" "$DEST/"
chmod 600 "$DEST"/garba-*.db
ls -1t "$DEST"/garba-*.db | tail -n +31 | while read -r old; do rm -- "$old"; done
echo "Копия: $DEST/$(basename "$LATEST")"
