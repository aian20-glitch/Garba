// Ежедневный бонус, подарки, приглашения (ТЗ §3–5, этап 9.3). Чистые функции.

import { COIN_STEP } from './money.js';

// --- Ежедневный бонус (ТЗ §3) ---
export const DAILY_BONUS = 1_000;
export const STREAK_DAYS = 7;
export const STREAK_BONUS = 5_000; // сверху на 7-й день подряд: итого 6 000

// --- Приглашение (ТЗ §4) ---
export const REFERRAL_BONUS = 10_000; // решение владельца, 25.09.2026 (было 1 000)
// Пригласившему +1 000 — только когда друг доиграл 3 комнаты (решение владельца правил,
// 19.09.2026): фейковые аккаунты не играют, накрутить бонус нельзя.
export const REFERRAL_ROOMS = 3;

export function referralDue(roomsPlayed: number, alreadyPaid: boolean): boolean {
  return !alreadyPaid && roomsPlayed >= REFERRAL_ROOMS;
}

// --- Подарки (ТЗ §5) ---
export const MAX_GIFT = 10_000; // решение владельца, 25.09.2026 (было 1 000)

// Сутки считаем по времени Казахстана (UTC+5): «сегодня» у всех игроков одно.
export const DAY_OFFSET_HOURS = 5;

// Календарный день 'YYYY-MM-DD' для момента времени.
export function dayKey(timeMs: number, offsetHours = DAY_OFFSET_HOURS): string {
  return new Date(timeMs + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

// Предыдущий календарный день.
export function previousDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export type DailyClaim =
  | { claimable: false; streak: number }
  | { claimable: true; streak: number; amount: number };

// Можно ли сегодня забрать бонус, какой это день серии и сколько монет.
// lastDay — день последнего бонуса (null — ещё не брал), streak — его день серии 1…7.
// Пропустил день — серия заново. После 7/7 серия начинается с 1/7.
export function dailyClaim(lastDay: string | null, streak: number, today: string): DailyClaim {
  if (lastDay === today) return { claimable: false, streak };

  const continues = lastDay !== null && lastDay === previousDay(today) && streak < STREAK_DAYS;
  const next = continues ? streak + 1 : 1;
  const amount = DAILY_BONUS + (next === STREAK_DAYS ? STREAK_BONUS : 0);
  return { claimable: true, streak: next, amount };
}

// --- Подарки ---

export type GiftError =
  | 'bad amount' // не 100…10 000 с шагом 100
  | 'self' // себе дарить нельзя
  | 'already gifted today' // за сутки уже подарил все 10 000
  | 'over daily limit' // этот подарок не влезает в остаток на сегодня
  | 'not enough coins';

// Сколько ещё можно подарить сегодня: 10 000 в сутки на всех вместе — одному 10 000 или
// десятерым по 1 000 (решение владельца, 08.10.2026; раньше — один подарок в сутки).
export function giftLeftToday(sentToday: number): number {
  return Math.max(0, MAX_GIFT - sentToday);
}

// Проверка подарка. Сумма — от 100 до 10 000, кратно 100: монеты в игре ходят сотнями.
export function giftError(p: {
  amount: number;
  balance: number;
  sentToday: number; // сколько уже подарил сегодня, всем вместе
  toSelf: boolean;
}): GiftError | null {
  if (!Number.isInteger(p.amount) || p.amount < COIN_STEP || p.amount > MAX_GIFT || p.amount % COIN_STEP !== 0) {
    return 'bad amount';
  }
  if (p.toSelf) return 'self';
  if (giftLeftToday(p.sentToday) <= 0) return 'already gifted today';
  if (p.amount > giftLeftToday(p.sentToday)) return 'over daily limit';
  if (p.balance < p.amount) return 'not enough coins';
  return null;
}

// --- Код игрока ---
// Один короткий код на аккаунт: по нему приглашают друзей и дарят монеты.
// Без похожих символов (0/O, 1/I/L), чтобы код легко продиктовать.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function makePlayerCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

// Код, как его ввёл человек: без пробелов, в верхнем регистре.
export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, '').toUpperCase() : '';
}
