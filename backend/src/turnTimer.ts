// Время на ход (RULES.md §13a, решение владельца правил): 20 секунд на любое решение.
// Не успел — за игрока ходит сервер: в торгах и в борьбе за спецкарту — ПАС, в розыгрыше
// и при сбросе — случайная допустимая карта, КОН — козырь по РАЗ, раздающий — раздаёт,
// в голосовании «продолжаем / делим» — «делим».
// Два пропуска подряд — игрок считается ушедшим: пауза на 5 минут, как при отключении.
// Чистые функции; таймеры и сами ходы — в index.ts.

export const TURN_MS = 20_000;
export const AWAY_AFTER_MISSES = 2;

export type TurnClock = { key: string; since: number };

// Часы хода: пока ждём того же решения (ключ тот же) — время идёт с прежнего момента;
// ждём нового — отсчёт заново. Ключ null — сейчас никого не ждём.
export function clockFor(prev: TurnClock | undefined, key: string | null, now: number): TurnClock | null {
  if (key === null) return null;
  if (prev && prev.key === key) return prev;
  return { key, since: now };
}

// Сколько секунд осталось на ход (для отсчёта на экране).
export function turnSecondsLeft(clock: TurnClock | null, now: number, turnMs: number): number | null {
  if (!clock) return null;
  return Math.max(0, Math.ceil((clock.since + turnMs - now) / 1000));
}

// За игрока сходил таймер: пропусков подряд стало на один больше. Второй подряд — ушёл.
export function addMiss(
  missed: Record<string, number>,
  playerId: string,
): { missed: Record<string, number>; away: boolean } {
  const count = (missed[playerId] ?? 0) + 1;
  return { missed: { ...missed, [playerId]: count }, away: count >= AWAY_AFTER_MISSES };
}

// Случайный элемент — какой картой сходит за игрока таймер.
export function pickRandom<T>(items: T[], random: () => number = Math.random): T {
  return items[Math.floor(random() * items.length)];
}
