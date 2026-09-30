#!/bin/bash
# PreToolUse (Read|Edit|Write): секреты и живые данные — не трогать.
#   запрет:  ключи подписи, key.properties, токены ботов, база и её копии
#   вопрос:  RULES.md — правила игры придумывает только владелец (CLAUDE.md, правило 3)
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0

case "$f" in
  */garba-keys/*|*/key.properties|*.jks|*.keystore|*/tools/.bots.json|*/backend/data/*|*/garba-backups/*|*.db|*.db-wal|*.db-shm)
    echo "Запрещено: $f — секрет или живые данные (ключ подписи, токены ботов, база). Потеря или утечка необратима." >&2
    exit 2
    ;;
  */RULES.md)
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:"RULES.md — правила игры от владельца. Менять только по его решению."}}'
    ;;
esac
exit 0
