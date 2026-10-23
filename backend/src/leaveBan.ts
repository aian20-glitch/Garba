// Бан за выход из начатой игры (решение владельца, 23.10.2026; RULES.md §13d).
// Сам нажал «Выйти» посреди игры — −1.0 рейтинга (как раньше) и бан на вход за стол:
// 1-й выход — 10 минут, 2-й — 20, … 6-й и дальше — 60. Шесть часов без выходов — счёт
// сначала. Чистые функции.

export const BAN_STEP_MS = 10 * 60_000;
export const BAN_MAX_MS = 60 * 60_000;
export const BAN_RESET_MS = 6 * 60 * 60_000;

export type LeaveRecord = { count: number; lastAt: number; until: number };

// Новый выход: какой он по счёту и до какого времени бан.
export function nextLeaveBan(prev: LeaveRecord | null, now: number): LeaveRecord {
  const fresh = !prev || now - prev.lastAt >= BAN_RESET_MS;
  const count = fresh ? 1 : prev.count + 1;
  return { count, lastAt: now, until: now + Math.min(count * BAN_STEP_MS, BAN_MAX_MS) };
}

// Сколько секунд бана осталось; 0 — бана нет.
export function banSecondsLeft(rec: LeaveRecord | null, now: number): number {
  if (!rec || rec.until <= now) return 0;
  return Math.ceil((rec.until - now) / 1000);
}
