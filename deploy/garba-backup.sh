#!/bin/bash
# Копия базы ГАРБА раз в сутки; храним 14 последних. sqlite3 .backup — безопасно
# и на работающей базе: копия целая, даже если в этот момент идёт запись.
set -euo pipefail
DIR=/var/backups/garba
mkdir -p "$DIR"
sqlite3 /var/lib/garba/garba.db ".backup '$DIR/garba-$(date +%F).db'"
ls -1t "$DIR"/garba-*.db | tail -n +15 | xargs -r rm --
