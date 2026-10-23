// Общий рейтинг и медали (решение владельца, 23.10.2026; RULES.md §16.8, §16.9).
// Чистые функции: неделя для «ТОП-3 недели», монеты за неделю в комнате, медали за монеты.

import { DAY_OFFSET_HOURS } from './bonus.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Неделя — с понедельника 00:00 по времени Казахстана (UTC+5). Ключ — дата понедельника.
export function weekKey(timeMs: number, offsetHours = DAY_OFFSET_HOURS): string {
  const local = new Date(timeMs + offsetHours * 60 * 60 * 1000);
  const sinceMonday = (local.getUTCDay() + 6) % 7; // понедельник — 0
  const monday = new Date(local.getTime() - sinceMonday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

// Монеты за неделю в комнате: { неделя: { игрок: чистый плюс } }. Копятся там же, где
// статистика (recordMoney) — взносы, выигрыши, доли кона. Бонусы и подарки — не игра.
export type WeeklyCoins = Record<string, Record<string, number>>;

export function addWeekly(weekly: WeeklyCoins, week: string, playerId: string, delta: number): WeeklyCoins {
  if (!delta) return weekly;
  const byPlayer = weekly[week] ?? {};
  return { ...weekly, [week]: { ...byPlayer, [playerId]: (byPlayer[playerId] ?? 0) + delta } };
}

// ТОП-3 недели — только кто в плюсе за неделю, по убыванию плюса.
export const WEEK_TOP = 3;

export function weekTop<T extends { coins: number; name: string }>(rows: T[], size = WEEK_TOP): T[] {
  return rows
    .filter((r) => r.coins > 0)
    .sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name))
    .slice(0, size);
}

// Медали за монеты: каждый миллион — своя медаль, без потолка. Считается самый большой
// баланс, до которого игрок дошёл (кошелёк + за столом) — потратил или проиграл, медаль
// остаётся. Показываем полученные и следующую закрытую.
export const MEDAL_STEP = 1_000_000;

export type CoinMedal = { coins: number; earned: boolean };

export function coinMedals(peakBalance: number, step = MEDAL_STEP): CoinMedal[] {
  const earned = Math.max(0, Math.floor(peakBalance / step));
  const medals: CoinMedal[] = [];
  for (let level = 1; level <= earned; level++) medals.push({ coins: level * step, earned: true });
  medals.push({ coins: (earned + 1) * step, earned: false });
  return medals;
}
