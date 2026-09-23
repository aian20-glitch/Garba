// Проверка готовности перед стартом (решение владельца, 23.09.2026).
//
// Комната набралась — всем звучит сигнал и появляется кнопка «ГОТОВ», на неё 30 секунд.
// Нажали все — игра начинается сама, без кнопки создателя. Кто не нажал за 30 секунд —
// выходит из комнаты, остальные ждут новых игроков на освободившиеся места.
// Не нажал сам создатель — выходит, как все, а создателем становится следующий по входу.
// Чистые функции; таймер и сама посадка — в index.ts.

export const READY_MS = 30_000;

export type ReadyCheck = {
  startedAt: number;
  readyIds: string[];
};

export function startReadyCheck(now: number): ReadyCheck {
  return { startedAt: now, readyIds: [] };
}

// Игрок нажал «ГОТОВ». Повторное нажатие ничего не меняет.
export function markReady(check: ReadyCheck, playerId: string): ReadyCheck {
  if (check.readyIds.includes(playerId)) return check;
  return { ...check, readyIds: [...check.readyIds, playerId] };
}

export type ReadyOutcome =
  | { kind: 'wait' }
  | { kind: 'start' }
  // Время вышло: drop — кто выходит из комнаты, creatorId — создатель после этого
  // (null — в комнате никого не осталось).
  | { kind: 'expired'; drop: string[]; creatorId: string | null };

// memberIds — игроки комнаты в порядке входа.
export function readyOutcome(
  check: ReadyCheck,
  memberIds: string[],
  creatorId: string,
  now: number,
  readyMs: number = READY_MS,
): ReadyOutcome {
  if (memberIds.every((id) => check.readyIds.includes(id))) return { kind: 'start' };
  if (now - check.startedAt < readyMs) return { kind: 'wait' };

  const drop = memberIds.filter((id) => !check.readyIds.includes(id));
  const stay = memberIds.filter((id) => check.readyIds.includes(id));
  const nextCreator = drop.includes(creatorId) ? (stay[0] ?? null) : creatorId;
  return { kind: 'expired', drop, creatorId: nextCreator };
}

export function readySecondsLeft(check: ReadyCheck, now: number, readyMs: number = READY_MS): number {
  return Math.max(0, Math.ceil((check.startedAt + readyMs - now) / 1000));
}
