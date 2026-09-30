#!/bin/bash
# PostToolUse (Edit|Write): после правки кода сразу проверяем его.
#   backend/**/*.ts   → tsc --noEmit (типы всего бэкенда)
#   mobile/**/*.dart  → dart analyze по изменённому файлу
# Ошибки уходят в stderr с кодом 2 — Claude их видит и правит сам.
# Правило проекта (CLAUDE.md): tsc и flutter analyze должны быть чистыми.
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0

case "$f" in
  */backend/*.ts)
    cd "${f%%/backend/*}/backend" || exit 0
    out=$(npx tsc --noEmit 2>&1) || { echo "tsc: ошибки типов после правки $f" >&2; echo "$out" | head -25 >&2; exit 2; }
    ;;
  */mobile/lib/*.dart)
    cd "${f%%/mobile/*}/mobile" || exit 0
    out=$(dart analyze "$f" 2>&1)
    if echo "$out" | grep -qE '^\s*(error|warning|info) '; then
      echo "dart analyze: замечания в $f" >&2; echo "$out" | head -25 >&2; exit 2
    fi
    ;;
esac
exit 0
