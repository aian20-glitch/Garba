// Отдать часть выигрыша другому игроку (RULES.md §11.8, решение владельца, 22.10.2026).
// Главный сказал РАЗ или ДВА и выиграл — до следующей раздачи он может по своей воле отдать
// часть выигрыша любому игроку за столом: от взноса стола до 10% выигрыша. Чистые функции;
// деньги, статистика и рассылка — в index.ts.

import { COIN_STEP } from './money.js';

// Больше этой доли выигрыша отдать нельзя.
export const SHARE_PERCENT = 10;

// Кто может отдавать: сказавший РАЗ или ДВА. Взявший спецкарту играет как РАЗ (§7) — тоже.
// КОН — нет: он забирает базовый кон (§11.6), 10% от него всегда меньше взноса.
export const SHARE_DECLARATIONS = ['РАЗ', 'ДВА'];

// Сколько можно отдать: от взноса (на столько играют за этим столом) до 10% выигрыша,
// вниз до сотни — монеты ходят сотнями. null — выигрыш мал: 10% от него меньше взноса.
export function shareLimits(win: number, ante: number): { min: number; max: number } | null {
  const max = Math.floor((win * SHARE_PERCENT) / 100 / COIN_STEP) * COIN_STEP;
  if (!Number.isFinite(max) || max < ante) return null;
  return { min: ante, max };
}

// Итог раздачи для главного — что нужно, чтобы понять, может ли он отдать.
export type ShareResult = { playerId: string; declaration: string; won: boolean; delta: number };

// Сколько может отдать игрок сейчас: раздача сыграна, он главный — сказал РАЗ или ДВА и выиграл,
// в этой раздаче ещё не отдавал. null — сейчас нельзя.
export function canShare(g: {
  stage: string;
  result: ShareResult[] | null;
  shared: boolean;
  playerId: string;
  ante: number;
}): { min: number; max: number } | null {
  if (g.stage !== 'round_done' || g.shared) return null;
  const mine = (g.result ?? []).find((r) => r.playerId === g.playerId);
  if (!mine || !mine.won || mine.delta <= 0 || !SHARE_DECLARATIONS.includes(mine.declaration)) return null;
  return shareLimits(mine.delta, g.ante);
}

// Сколько отдаёт: целое число монет, кратно 100, в пределах. null — так нельзя.
export function checkShareAmount(raw: unknown, limits: { min: number; max: number }): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount % COIN_STEP !== 0) return null;
  if (amount < limits.min || amount > limits.max) return null;
  return amount;
}
