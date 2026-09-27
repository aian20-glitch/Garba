#!/bin/bash
# Копия базы ГАРБА раз в сутки; храним 14 последних. sqlite3 .backup — безопасно
# и на работающей базе: копия целая, даже если в этот момент идёт запись.
# Копии читает только root: в базе хеши токенов и кодов восстановления (28.09.2026).
# Копия вне сервера — deploy/pull-backup.sh на Mac.
set -euo pipefail
umask 077
DIR=/var/backups/garba
mkdir -p "$DIR"
chmod 700 "$DIR"
sqlite3 /var/lib/garba/garba.db ".backup '$DIR/garba-$(date +%F).db'"
ls -1t "$DIR"/garba-*.db | tail -n +15 | xargs -r rm --
